import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError, checkRevision, nameKey, serialQueue } from './errors.js';
import { assetFiles, downloadFile, readAssetFile, storeAsset } from './assets.js';
import { providerSchema } from './library.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
const patchSchema = z.object({
  input: z.string().max(2 * 1024 * 1024, 'Use a file attachment for more than 2 MiB of typed text.').optional(),
  provider: providerSchema.nullable().optional(),
  model: z.string().trim().max(300).nullable().optional(),
  removeAssetIds: z.array(z.string()).max(128).optional(),
});

async function writeJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    await rename(temporary, filename);
  } finally { await rm(temporary, { force: true }); }
}

async function sizeOf(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) bytes += await sizeOf(filename);
    else if (entry.isFile()) bytes += (await stat(filename)).size;
  }
  return bytes;
}

function numericSetting(name, fallback) {
  const value = process.env[name]?.trim();
  const number = value ? Number(value) : fallback;
  if (!Number.isSafeInteger(number) || number < 0) throw new AppError(`${name} must be a nonnegative integer.`);
  return number;
}

export const workspaceSummary = workspace => ({
  id: workspace.id, name: workspace.name || null, saved: workspace.saved, revision: workspace.revision,
  createdAt: workspace.createdAt, updatedAt: workspace.updatedAt, lastAccessedAt: workspace.lastAccessedAt,
  questionCount: workspace.questions.length, fileCount: workspace.assets.length,
  provider: workspace.provider || null, model: workspace.model || null,
  latestRunId: workspace.runIds[0] || null,
});

export async function createWorkspaceStore(dataDir, library) {
  const root = path.join(dataDir, 'workspaces');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const documents = new Map();
  const queue = serialQueue();
  const active = new Set();
  const maxBytes = numericSetting('WORKSPACE_MAX_BYTES', 1073741824);
  const ttlDays = numericSetting('WORKSPACE_TTL_DAYS', 30);
  const excludeValue = process.env.WORKSPACE_EXCLUDE_SAVED_FROM_LIMIT?.trim().toLowerCase() || 'true';
  if (!['true', 'false', '1', '0'].includes(excludeValue)) throw new AppError('WORKSPACE_EXCLUDE_SAVED_FROM_LIMIT must be true or false.');
  const excludeSaved = ['true', '1'].includes(excludeValue);
  const directory = id => {
    if (!UUID.test(id || '')) throw new AppError('Use a valid workspace UUID.');
    return path.join(root, id);
  };
  const assetsDirectory = id => path.join(directory(id), 'assets');
  const runPath = (workspaceId, runId) => {
    if (!UUID.test(runId || '')) throw new AppError('Use a valid run UUID.');
    return path.join(directory(workspaceId), 'runs', `${runId}.json`);
  };
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
    try {
      const document = JSON.parse(await readFile(path.join(directory(entry.name), 'workspace.json'), 'utf8'));
      if (document.id !== entry.name || !Array.isArray(document.questions) || !Array.isArray(document.assets) || !Array.isArray(document.runIds)) throw new Error('Invalid metadata');
      documents.set(document.id, document);
      for (const runId of document.runIds) {
        const filename = runPath(document.id, runId);
        const run = JSON.parse(await readFile(filename, 'utf8'));
        if (['running', 'pending'].includes(run.status)) await writeJson(filename, { ...run, status: 'interrupted', finishedAt: now(), error: 'The server restarted before this run completed. Run it again when ready.' });
      }
    } catch {
      console.warn(`Workspace ${entry.name} has unreadable metadata; its files were retained.`);
    }
  }
  function resolve(ref = {}) {
    const id = typeof ref === 'string' ? ref : ref.workspaceId || ref.id;
    const name = typeof ref === 'string' ? undefined : ref.workspaceName || ref.name;
    if (id && name) throw new AppError('Use a workspace ID or name, not both.');
    const workspace = id ? documents.get(id) : name ? [...documents.values()].find(item => nameKey(item.name) === nameKey(name)) : null;
    if (!workspace) throw new AppError('This workspace is missing or has expired. Open a saved workspace or create a new one.', 404, 'WORKSPACE_NOT_FOUND');
    return workspace;
  }
  function validateName(value, exceptId) {
    const name = z.string().trim().min(1, 'Name this workspace.').max(120).parse(value).normalize('NFKC');
    if (/[\\/\x00-\x1f\x7f]/.test(name) || ['.', '..', 'by-id'].includes(nameKey(name))) throw new AppError('Choose a workspace name without path separators or control characters.');
    if ([...documents.values()].some(item => item.id !== exceptId && nameKey(item.name) === nameKey(name))) throw new AppError('A workspace already uses that name.', 409, 'NAME_CONFLICT');
    return name;
  }
  async function removeDirectory(id) {
    await rm(directory(id), { recursive: true, force: true });
    documents.delete(id);
  }
  async function usage() {
    let totalBytes = 0;
    let countedBytes = 0;
    const sizes = new Map();
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      const bytes = await sizeOf(directory(entry.name));
      sizes.set(entry.name, bytes);
      totalBytes += bytes;
      if (!(excludeSaved && documents.get(entry.name)?.saved)) countedBytes += bytes;
    }
    return { totalBytes, countedBytes, sizes };
  }
  async function collect(protectedIds = []) {
    const protect = new Set([...active, ...protectedIds]);
    const candidates = () => [...documents.values()].filter(item => !item.saved && !protect.has(item.id)).sort((a, b) => a.lastAccessedAt.localeCompare(b.lastAccessedAt));
    const expiredBefore = Date.now() - ttlDays * 86400000;
    if (ttlDays) for (const workspace of candidates()) if (Date.parse(workspace.lastAccessedAt) < expiredBefore) await removeDirectory(workspace.id);
    const current = await usage();
    if (maxBytes) for (const workspace of candidates()) {
      if (current.countedBytes <= maxBytes) break;
      const bytes = current.sizes.get(workspace.id) || 0;
      await removeDirectory(workspace.id);
      current.totalBytes -= bytes;
      current.countedBytes -= bytes;
    }
    return { totalBytes: current.totalBytes, countedBytes: current.countedBytes, maxBytes, excludeSaved, ttlDays, overBudget: Boolean(maxBytes && current.countedBytes > maxBytes) };
  }
  async function pruneAssets(workspace) {
    const retained = new Set(workspace.assets.flatMap(assetFiles));
    for (const runId of workspace.runIds) {
      const run = JSON.parse(await readFile(runPath(workspace.id, runId), 'utf8'));
      for (const asset of run.snapshot?.assets || []) for (const filename of assetFiles(asset)) retained.add(filename);
    }
    for (const entry of await readdir(assetsDirectory(workspace.id), { withFileTypes: true })) {
      if (entry.isFile() && !retained.has(entry.name)) await rm(path.join(assetsDirectory(workspace.id), entry.name), { force: true });
    }
  }
  async function commit(workspace, previous) {
    const filename = path.join(directory(workspace.id), 'workspace.json');
    await writeJson(filename, workspace);
    documents.set(workspace.id, clone(workspace));
    const storage = await collect([workspace.id]);
    if (storage.overBudget) {
      if (previous) {
        documents.set(previous.id, previous);
        await writeJson(filename, previous);
        await pruneAssets(previous);
      } else await removeDirectory(workspace.id);
      throw new AppError('Workspace storage is full. Delete unused workspaces, raise WORKSPACE_MAX_BYTES, or exclude saved workspaces from the limit.', 507, 'WORKSPACE_STORAGE_FULL');
    }
    return clone(workspace);
  }
  async function ingest(workspace, { files = [], images = [], uploads = [] } = {}) {
    if (files.length + images.length + uploads.length > 16) throw new AppError('Add up to 16 files at a time.');
    const additions = [];
    for (const reference of files) {
      const { buffer, mimeType } = await downloadFile(reference);
      additions.push(await storeAsset(assetsDirectory(workspace.id), { buffer, name: reference.file_name, mimeType, fileId: reference.file_id }));
    }
    for (let index = 0; index < images.length; index++) {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(images[index]);
      if (!match) throw new AppError('Supply JPEG, PNG, or WebP image data URLs.');
      additions.push(await storeAsset(assetsDirectory(workspace.id), { buffer: Buffer.from(match[2], 'base64'), name: `Image ${index + 1}.${match[1].split('/')[1]}`, mimeType: match[1] }));
    }
    for (const upload of uploads) additions.push(await storeAsset(assetsDirectory(workspace.id), upload));
    for (const asset of additions) {
      const existing = workspace.assets.findIndex(item => item.id === asset.id);
      if (existing < 0) workspace.assets.push(asset); else workspace.assets[existing] = asset;
    }
    if (workspace.assets.length > 128) throw new AppError('A workspace can hold up to 128 files.');
  }
  const store = {
    root, active, assetsDirectory,
    read: ref => clone(resolve(ref)),
    list: ({ savedOnly = false, query = '' } = {}) => [...documents.values()].filter(item => (!savedOnly || item.saved) && (!query || nameKey(item.name).includes(nameKey(query)))).sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt)).map(workspaceSummary),
    async create(input = {}) {
      return queue(async () => {
        const timestamp = now();
        const patch = patchSchema.parse(input);
        const workspace = {
          id: randomUUID(), name: null, saved: false, revision: 1, contentRevision: 1, createdAt: timestamp, updatedAt: timestamp, lastAccessedAt: timestamp,
          input: patch.input || '', provider: patch.provider || null, model: patch.model || null,
          questions: library.select(input, { draft: true }) || [], assets: [], runIds: [],
          setName: input.setName || null,
        };
        await mkdir(assetsDirectory(workspace.id), { recursive: true, mode: 0o700 });
        await mkdir(path.join(directory(workspace.id), 'runs'), { mode: 0o700 });
        try { await ingest(workspace, input); return await commit(workspace); }
        catch (error) { await removeDirectory(workspace.id); throw error; }
      });
    },
    async update(ref, input, expectedRevision) {
      return queue(async () => {
        const previous = clone(resolve(ref));
        checkRevision(previous, expectedRevision);
        const workspace = clone(previous);
        const patch = patchSchema.parse(input);
        for (const key of ['input', 'provider', 'model']) if (patch[key] !== undefined) workspace[key] = patch[key];
        const selected = library.select(input, { draft: true });
        if (selected !== undefined) { workspace.questions = selected; workspace.setName = input.setName || null; }
        if (patch.removeAssetIds) workspace.assets = workspace.assets.filter(asset => !patch.removeAssetIds.includes(asset.id));
        try {
          await ingest(workspace, input);
          workspace.revision++;
          workspace.contentRevision = (previous.contentRevision || previous.revision) + 1;
          workspace.updatedAt = workspace.lastAccessedAt = now();
          const result = await commit(workspace, previous);
          await pruneAssets(workspace);
          return result;
        } catch (error) { await pruneAssets(previous); throw error; }
      });
    },
    async touch(ref) {
      return queue(async () => {
        const workspace = clone(resolve(ref));
        workspace.lastAccessedAt = now();
        await writeJson(path.join(directory(workspace.id), 'workspace.json'), workspace);
        documents.set(workspace.id, workspace);
        return clone(workspace);
      });
    },
    async save(ref, name, expectedRevision) {
      return queue(async () => {
        const previous = clone(resolve(ref));
        checkRevision(previous, expectedRevision);
        const workspace = { ...previous, name: validateName(name || previous.name, previous.id), saved: true, revision: previous.revision + 1, updatedAt: now(), lastAccessedAt: now() };
        return commit(workspace, previous);
      });
    },
    async rename(ref, name, expectedRevision) {
      return queue(async () => {
        const previous = clone(resolve(ref));
        checkRevision(previous, expectedRevision);
        return commit({ ...previous, name: validateName(name, previous.id), revision: previous.revision + 1, updatedAt: now(), lastAccessedAt: now() }, previous);
      });
    },
    async remove(ref, expectedRevision) {
      return queue(async () => {
        const workspace = resolve(ref);
        checkRevision(workspace, expectedRevision);
        if (active.has(workspace.id)) throw new AppError('Cancel the active run before deleting this workspace.', 409, 'WORKSPACE_BUSY');
        await removeDirectory(workspace.id);
        return { id: workspace.id, name: workspace.name, deleted: true };
      });
    },
    async duplicate(ref) {
      return queue(async () => {
        const source = resolve(ref);
        const timestamp = now();
        const workspace = { ...clone(source), id: randomUUID(), name: null, saved: false, revision: 1, contentRevision: 1, runIds: [], createdAt: timestamp, updatedAt: timestamp, lastAccessedAt: timestamp };
        await mkdir(assetsDirectory(workspace.id), { recursive: true, mode: 0o700 });
        await mkdir(path.join(directory(workspace.id), 'runs'), { mode: 0o700 });
        try {
          await Promise.all([...new Set(workspace.assets.flatMap(assetFiles))].map(filename => copyFile(path.join(assetsDirectory(source.id), filename), path.join(assetsDirectory(workspace.id), filename), constants.COPYFILE_FICLONE)));
          return await commit(workspace);
        } catch (error) { await removeDirectory(workspace.id); throw error; }
      });
    },
    readRun(ref, runId) {
      const workspace = resolve(ref);
      if (!workspace.runIds.includes(runId)) throw new AppError('This run is missing or has been removed from history.', 404, 'RUN_NOT_FOUND');
      return readFile(runPath(workspace.id, runId), 'utf8').then(JSON.parse);
    },
    async putRun(ref, run) {
      return queue(async () => {
        const previous = clone(resolve(ref));
        const filename = runPath(previous.id, run.id);
        let priorRun;
        try { priorRun = JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await writeJson(filename, run);
        const workspace = { ...previous, runIds: [run.id, ...previous.runIds.filter(id => id !== run.id)].slice(0, 20), lastAccessedAt: now() };
        try { await commit(workspace, previous); }
        catch (error) { if (priorRun) await writeJson(filename, priorRun); else await rm(filename, { force: true }); throw error; }
        for (const runId of previous.runIds) if (!workspace.runIds.includes(runId)) await rm(runPath(workspace.id, runId), { force: true });
        await pruneAssets(workspace);
        return clone(run);
      });
    },
    async asset(ref, assetId) {
      const workspace = resolve(ref);
      let asset = workspace.assets.find(item => item.id === assetId);
      if (!asset) for (const runId of workspace.runIds) {
        const run = await store.readRun(workspace.id, runId);
        asset = run.snapshot?.assets?.find(item => item.id === assetId);
        if (asset) break;
      }
      if (!asset) throw new AppError('This file is missing or has expired.', 404, 'ASSET_NOT_FOUND');
      return clone(asset);
    },
    async hydrate(ref, { previews = false } = {}) {
      const workspace = clone(resolve(ref));
      let previewBytes = 0;
      workspace.assets = await Promise.all(workspace.assets.map(async asset => {
        const { originalFile, imageFile, previewFile, textFile, ...metadata } = asset;
        if (previews && previewFile && previewBytes < 2 * 1024 * 1024) {
          const buffer = await readAssetFile(assetsDirectory(workspace.id), previewFile);
          previewBytes += buffer.length;
          if (previewBytes <= 2 * 1024 * 1024) metadata.previewUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        } else if (previewFile && !previews) metadata.previewUrl = `/api/workspaces/${workspace.id}/assets/${asset.id}?preview=1`;
        return metadata;
      }));
      const runs = await Promise.all(workspace.runIds.map(runId => store.readRun(workspace.id, runId)));
      const latest = runs[0] || null;
      const run = latest ? { ...latest, snapshot: { ...latest.snapshot, assets: undefined } } : null;
      const history = runs.map(item => ({ id: item.id, status: item.status, model: item.model, startedAt: item.startedAt }));
      return { workspace, run, history };
    },
    cleanup: () => queue(() => collect()),
    storage: async () => { const current = await usage(); return { totalBytes: current.totalBytes, countedBytes: current.countedBytes, maxBytes, ttlDays, excludeSaved }; },
  };
  await store.cleanup();
  const timer = setInterval(() => store.cleanup().catch(() => console.warn('Workspace cleanup could not finish.')), 3600000);
  timer.unref();
  store.close = () => clearInterval(timer);
  return store;
}
