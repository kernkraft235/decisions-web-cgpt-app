import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { createLibrary, providerSchema } from './library.js';
import { createWorkspaceStore, workspaceSummary } from './workspaces.js';
import { assetInput } from './assets.js';
import { evaluationSchema, questionListSchema } from './schema.js';
import { buildRequest, fetchJson, listModels, normalizeAnswers, providerKey, llamaBaseUrl, OPENAI_MODEL } from './providers.js';
import { AppError, checkRevision, errorInfo, serialQueue } from './errors.js';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function summarizeRun(run, full = false) {
  if (!run) return null;
  const names = new Map(run.snapshot.questions.map(question => [question.id, question.name]));
  return {
    runId: run.id, workspaceId: run.workspaceId, status: run.status, workspaceRevision: run.workspaceRevision, contentRevision: run.contentRevision,
    provider: run.provider, model: run.model, startedAt: run.startedAt, finishedAt: run.finishedAt,
    elapsedMs: run.elapsedMs, usage: run.usage,
    ...(run.error ? { error: run.error } : {}),
    answers: (run.answers || []).map(answer => {
      const { probabilities, ...summary } = answer;
      const selected = probabilities?.find(item => item.label === answer.choice);
      return {
        ...summary, type: answer.type === 'noul' ? 'predicate' : answer.type, name: names.get(answer.id),
        ...(selected ? { selectedProbability: selected.probability } : {}),
        ...(full ? { probabilities } : {}),
      };
    }),
  };
}

async function compactProviderImages(request) {
  if (request.provider !== 'openrouter' || !request.images.length) return request;
  if (/(?:^|\/)clef(?:-|$)/.test(request.model)) {
    if (request.images.length > 4) throw new AppError('This OpenRouter model accepts up to 4 images.');
    const targetBytes = Math.floor(0.15 * 1024 * 1024 / request.images.length);
    const images = [];
    for (const image of request.images) {
      const original = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
      let width = 1600;
      let quality = 80;
      let buffer;
      do {
        buffer = await sharp(original).rotate().resize(width, width, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality }).toBuffer();
        width = Math.max(320, Math.floor(width * 0.8));
        quality = Math.max(25, quality - 10);
      } while (buffer.length > targetBytes && (width > 320 || quality > 25));
      if (buffer.length > targetBytes) throw new AppError('This image cannot fit the selected OpenRouter model’s image limit. Use another model or a smaller image.');
      images.push(`data:image/jpeg;base64,${buffer.toString('base64')}`);
    }
    return { ...request, images };
  }
  if (/mercury-decide/.test(request.model) && request.images.length > 16) throw new AppError('This OpenRouter model accepts up to 16 images.');
  return request;
}

export async function createServices(dataDir) {
  const library = await createLibrary(dataDir);
  const workspaces = await createWorkspaceStore(dataDir, library);
  const jobs = new Map();
  const startQueue = serialQueue();
  const modelCache = new Map();
  let localBase = 'http://127.0.0.1:4379';
  function frontendBase() {
    const value = process.env.FRONTEND_BASE_URL?.trim() || localBase;
    let url;
    try { url = new URL(value); } catch { throw new AppError('FRONTEND_BASE_URL must be an HTTP or HTTPS origin.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new AppError('FRONTEND_BASE_URL must be an HTTP or HTTPS origin without a path.');
    return url.origin;
  }
  const services = {
    library, workspaces,
    setLocalBase(value) { localBase = value; },
    config() {
      return {
        llamaBaseUrl: llamaBaseUrl(), openaiModel: OPENAI_MODEL, defaults: library.defaults(), frontendBaseUrl: frontendBase(),
        keys: { openai: Boolean(providerKey('openai')), openrouter: Boolean(providerKey('openrouter')) },
      };
    },
    links(ref) {
      const workspace = workspaces.read(ref);
      const base = frontendBase();
      const canonicalUrl = `${base}/workspace/by-id/${workspace.id}`;
      return { workspaceId: workspace.id, name: workspace.name, url: workspace.name ? `${base}/workspace/${encodeURIComponent(workspace.name)}` : canonicalUrl, canonicalUrl };
    },
    async models(provider, { baseUrl, key, signal, fresh = false } = {}) {
      providerSchema.parse(provider);
      const cacheable = !baseUrl && !key && !signal;
      const cached = cacheable && modelCache.get(provider);
      if (!fresh && cached && Date.now() - cached.timestamp < 30000) return structuredClone(cached.models);
      const models = await listModels(provider, baseUrl, providerKey(provider, key), signal);
      if (cacheable) modelCache.set(provider, { timestamp: Date.now(), models });
      return models;
    },
    async directEvaluation(input, { key, signal } = {}) {
      let request = evaluationSchema.parse(input);
      const credential = providerKey(request.provider, key);
      if (request.provider !== 'llama' && !credential) throw new AppError('Add the provider key in Settings or .env first.', 400, 'PROVIDER_KEY_MISSING');
      if (request.provider === 'openai' && request.model !== OPENAI_MODEL) throw new AppError(`OpenAI Decisions uses ${OPENAI_MODEL}.`);
      request = await compactProviderImages(request);
      const { url, body } = buildRequest(request);
      const started = performance.now();
      const data = await fetchJson(url, { method: 'POST', body: JSON.stringify(body), key: credential, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000) });
      return { answers: normalizeAnswers(data, request.questions, request.provider), model: data.model || request.model, elapsedMs: Math.round(performance.now() - started), usage: data.usage, raw: data };
    },
    async evaluate(input, { key, waitMs = 20000 } = {}) {
      const started = await startQueue(async () => {
        let workspace = input.workspaceId || input.workspaceName ? workspaces.read(input) : null;
        if (!workspace && input.requestId) for (const candidate of workspaces.list()) {
          const previous = workspaces.read(candidate.id);
          for (const runId of previous.runIds) {
            const run = await workspaces.readRun(previous.id, runId);
            if (run.requestId === input.requestId) return { workspace: previous, run };
          }
        }
        if (workspace) {
          const existingJob = jobs.get(workspace.id);
          if (existingJob) {
            if (input.requestId && existingJob.requestId === input.requestId) return { workspace, job: existingJob };
            throw new AppError('This workspace already has an active run.', 409, 'WORKSPACE_BUSY', { workspaceId: workspace.id, runId: existingJob.runId });
          }
          if (input.requestId) for (const runId of workspace.runIds) {
            const run = await workspaces.readRun(workspace.id, runId);
            if (run.requestId === input.requestId) return { workspace, run };
          }
          const fields = ['input', 'files', 'images', 'setName', 'questionNames', 'questions'];
          const hasChanges = fields.some(field => input[field] !== undefined);
          if (hasChanges) {
            const changes = Object.fromEntries(fields.filter(field => input[field] !== undefined).map(field => [field, input[field]]));
            workspace = await workspaces.update(workspace.id, changes, input.expectedRevision);
          } else if (input.expectedRevision != null) checkRevision(workspace, input.expectedRevision);
        } else workspace = await workspaces.create(input);
        const defaults = library.defaults();
        const provider = input.provider || workspace.provider || defaults.provider;
        const model = input.model || (provider === workspace.provider ? workspace.model : null) || (provider === defaults.provider ? defaults.model : null);
        if (!model) throw new AppError('Choose a model or save a server default in Decisions Settings.', 400, 'MODEL_NOT_CONFIGURED', { workspaceId: workspace.id });
        if (provider !== 'llama' && !providerKey(provider, key)) throw new AppError('Add this provider’s key to the server .env before using it from ChatGPT.', 400, 'PROVIDER_KEY_MISSING', { workspaceId: workspace.id });
        questionListSchema.parse(workspace.questions);
        const models = await services.models(provider, { key });
        const selected = models.find(item => item.id === model);
        if (!selected) throw new AppError('The selected model is not available from this provider. Choose another model explicitly.', 400, 'MODEL_NOT_AVAILABLE', { workspaceId: workspace.id });
        if (selected.supportsImages === false && workspace.assets.some(asset => asset.kind === 'image')) throw new AppError('This model is text-only. Choose a model with image support or remove the image.');
        const evidence = await assetInput(workspaces.assetsDirectory(workspace.id), workspace.assets);
        const request = evaluationSchema.parse({ provider, model, text: [workspace.input, evidence.text].filter(Boolean).join('\n\n'), images: evidence.images, questions: workspace.questions });
        const run = {
          id: randomUUID(), workspaceId: workspace.id, workspaceRevision: workspace.revision, contentRevision: workspace.contentRevision || workspace.revision,
          requestId: input.requestId || randomUUID(), provider, model, status: 'running', startedAt: new Date().toISOString(), answers: [],
          snapshot: { input: workspace.input, questions: workspace.questions, assets: workspace.assets },
        };
        workspaces.active.add(workspace.id);
        try { await workspaces.putRun(workspace.id, run); }
        catch (error) { workspaces.active.delete(workspace.id); throw error; }
        const controller = new AbortController();
        const job = { runId: run.id, requestId: run.requestId, controller };
        jobs.set(workspace.id, job);
        job.promise = (async () => {
          let completed;
          try {
            const { raw, ...result } = await services.directEvaluation(request, { key, signal: controller.signal });
            completed = { ...run, ...result, status: controller.signal.aborted ? 'cancelled' : 'completed', finishedAt: new Date().toISOString() };
          } catch (error) {
            completed = { ...run, status: controller.signal.aborted ? 'cancelled' : 'failed', error: controller.signal.aborted ? 'Evaluation cancelled.' : errorInfo(error).error, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(run.startedAt) };
          }
          try { await workspaces.putRun(workspace.id, completed); }
          catch { console.warn(`Run ${run.id} completed, but its result could not be saved.`); }
          finally { jobs.delete(workspace.id); workspaces.active.delete(workspace.id); }
          return completed;
        })();
        return { workspace, job };
      });
      const run = started.run || await Promise.race([started.job.promise, sleep(Math.min(20000, Math.max(0, waitMs))).then(() => null)]) || await workspaces.readRun(started.workspace.id, started.job.runId);
      return { workspace: workspaces.read(started.workspace.id), run };
    },
    async cancelRun(ref, runId) {
      const workspace = workspaces.read(ref);
      const job = jobs.get(workspace.id);
      const id = runId || job?.runId || workspace.runIds[0];
      if (!id) throw new AppError('This workspace has no runs.', 404, 'RUN_NOT_FOUND');
      if (job?.runId === id) {
        job.controller.abort();
        return { ...await workspaces.readRun(workspace.id, id), status: 'cancelling' };
      }
      return workspaces.readRun(workspace.id, id);
    },
    close() {
      for (const job of jobs.values()) job.controller.abort();
      workspaces.close();
    },
  };
  services.config();
  return services;
}
