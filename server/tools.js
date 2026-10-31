import { z } from 'zod';
import { AppError, errorInfo } from './errors.js';
import { providerSchema } from './library.js';
import { summarizeRun } from './services.js';
import { workspaceSummary } from './workspaces.js';

export const fileReferenceSchema = z.object({
  download_url: z.string().min(1).max(16384),
  file_id: z.string().min(1).max(500),
  mime_type: z.string().max(200).optional(),
  file_name: z.string().max(500).optional(),
});
const option = z.object({ id: z.string().max(100).optional(), label: z.string().max(500), description: z.string().max(8192).optional() });
const question = z.object({
  id: z.string().min(1).max(100).optional(), savedId: z.string().max(100).optional(),
  name: z.string().max(200).optional(),
  type: z.enum(['predicate', 'noul', 'choice', 'score']).describe('predicate is yes/no; choice selects an option; score uses ordered levels.'),
  instructions: z.string().max(32768),
  trueDescription: z.string().max(8192).optional(), falseDescription: z.string().max(8192).optional(),
  choices: z.array(option).max(255).optional(), levels: z.array(option).max(10).optional(),
});
const selection = {
  setName: z.string().trim().min(1).max(200).optional(),
  questionNames: z.array(z.string().trim().min(1).max(200)).min(1).max(200).optional(),
  questions: z.array(question).max(200).optional(),
};
const evidence = {
  input: z.string().max(2 * 1024 * 1024).optional(),
  files: z.array(fileReferenceSchema).max(16).optional(),
  images: z.array(z.string().max(10 * 1024 * 1024)).max(16).optional().describe('Optional image data URLs for MCP clients without file-reference support.'),
};
const workspaceRef = {
  workspaceId: z.string().uuid().optional(),
  workspaceName: z.string().trim().min(1).max(120).optional(),
};
const execution = { provider: providerSchema.optional(), model: z.string().trim().min(1).max(300).optional() };
const revision = z.number().int().nonnegative();
const itemRef = { kind: z.enum(['question', 'set', 'workspace']), id: z.string().min(1).optional(), name: z.string().trim().min(1).optional() };
const publicQuestion = q => ({ ...q, type: q.type === 'noul' ? 'predicate' : q.type });
const publicDefinition = (kind, item) => kind === 'sets' ? { ...item, questions: item.questions.map(publicQuestion) } : publicQuestion(item);

export function result(data, text = 'Done.', meta) {
  return { structuredContent: data, content: [{ type: 'text', text }], ...(meta ? { _meta: meta } : {}) };
}

export function createTools(services) {
  const { library, workspaces } = services;
  async function workspaceResult(ref, view, runOverride) {
    const workspace = workspaces.read(ref);
    const hydration = await workspaces.hydrate(workspace.id, { previews: true });
    if (runOverride) hydration.run = { ...runOverride, snapshot: { ...runOverride.snapshot, assets: undefined } };
    const summary = {
      ...workspaceSummary(workspace), ...services.links(workspace.id),
      questions: workspace.questions.map(q => ({ id: q.id, name: q.name, type: q.type === 'noul' ? 'predicate' : q.type })),
      files: workspace.assets.map(asset => ({ id: asset.id, name: asset.name, kind: asset.kind, bytes: asset.bytes, status: asset.status, ...(asset.warning ? { warning: asset.warning } : {}) })),
      runs: hydration.history,
    };
    const status = runOverride ? (['running', 'pending'].includes(runOverride.status) ? 'Evaluation is running. Use get_run for its status; do not start another evaluation.' : `Evaluation ${runOverride.status}.`) : workspace.name ? `Workspace “${workspace.name}”.` : 'Workspace ready.';
    return result({ workspace: summary, run: summarizeRun(runOverride || hydration.run) }, status, {
      ...hydration, library: library.all(), config: services.config(), ...(view ? { view } : {}),
    });
  }
  function tool(name, title, description, schema, run, options = {}) {
    return {
      name, title, description: `Use this when ${description}`, schema, run,
      annotations: { readOnlyHint: Boolean(options.readOnly), destructiveHint: Boolean(options.destructive), openWorldHint: Boolean(options.openWorld), ...(options.idempotent ? { idempotentHint: true } : {}) },
      _meta: {
        ui: { visibility: options.appOnly ? ['app'] : ['model', 'app'], ...(options.render ? { resourceUri: 'ui://jev-decisions/workspace-v1.html' } : {}) },
        'openai/widgetAccessible': true,
        ...(options.appOnly ? { 'openai/visibility': 'private' } : {}),
        ...(options.files ? { 'openai/fileParams': ['files'] } : {}),
        ...(options.render ? { 'openai/outputTemplate': 'ui://jev-decisions/workspace-v1.html' } : {}),
      },
    };
  }
  const definitions = [
    tool('list_models', 'Available decision models', 'you need available models or the server default before selecting a provider. Custom lists every local model. Never switch providers automatically.', z.object({ provider: providerSchema.optional(), refresh: z.boolean().optional() }), async (input, context) => {
      const defaults = library.defaults();
      const provider = input.provider || defaults.provider;
      return result({ provider, models: await services.models(provider, { fresh: input.refresh, key: context?.key }), defaults }, 'Available models and server default.');
    }, { readOnly: true }),
    tool('list_library', 'Saved questions and sets', 'you need to find saved questions or question sets by name. This returns summaries; get_definition retrieves a complete definition.', z.object({ kind: z.enum(['questions', 'sets']).optional(), query: z.string().max(200).optional() }), input => result(library.list(input), 'Saved library.', { library: library.all() }), { readOnly: true }),
    tool('get_definition', 'Question or set definition', 'you need to inspect a saved question or set before editing or reusing it. Supply an ID or exact name.', z.object({ kind: z.enum(['question', 'set']), id: z.string().optional(), name: z.string().optional() }), input => {
      const kind = input.kind === 'question' ? 'questions' : 'sets';
      return result({ kind: input.kind, item: publicDefinition(kind, library.find(kind, input)) }, 'Saved definition.');
    }, { readOnly: true }),
    tool('save_question', 'Save a named question', 'the user asks to save a reusable question. Drafting alone does not authorize saving. For updates, provide the saved ID and current expectedRevision.', z.object({ id: z.string().optional(), expectedRevision: revision.optional(), question: question.extend({ name: z.string().trim().min(1).max(200), instructions: z.string().trim().min(1).max(32768) }) }), async input => {
      const saved = await library.saveQuestion(input);
      return result({ question: publicQuestion(saved) }, `Saved question “${saved.name}”.`, { library: library.all() });
    }),
    tool('save_set', 'Save a named question set', 'the user asks to save a set of questions. Supply inline questions or saved questionNames. Sets store independent snapshots. Updates require ID and expectedRevision.', z.object({ id: z.string().optional(), expectedRevision: revision.optional(), name: z.string().trim().min(1).max(200), questions: z.array(question).min(1).max(200).optional(), questionNames: selection.questionNames }), async input => {
      const saved = await library.saveSet(input);
      return result({ set: publicDefinition('sets', saved) }, `Saved set “${saved.name}”.`, { library: library.all() });
    }),
    tool('rename_item', 'Rename a saved item', 'the user asks to rename a question, set, or workspace. Retrieve its revision first. Existing set snapshots are unaffected by question renames.', z.object({ ...itemRef, newName: z.string().trim().min(1).max(200), expectedRevision: revision }), async input => {
      if (input.kind === 'workspace') return workspaceResult((await workspaces.rename(input, input.newName, input.expectedRevision)).id);
      const kind = input.kind === 'question' ? 'questions' : 'sets';
      const saved = await library.rename(kind, input, input.newName, input.expectedRevision);
      return result({ kind: input.kind, item: publicDefinition(kind, saved) }, 'Item renamed.', { library: library.all() });
    }, { idempotent: true }),
    tool('delete_item', 'Delete a saved item or workspace', 'the user explicitly asks to delete a question, set, or workspace. Deleting a workspace removes its input files and results. Retrieve the exact item and revision first.', z.object({ ...itemRef, expectedRevision: revision }), async input => {
      const deleted = input.kind === 'workspace' ? await workspaces.remove(input, input.expectedRevision) : await library.remove(input.kind === 'question' ? 'questions' : 'sets', input, input.expectedRevision);
      return result(deleted, 'Item deleted.', { library: library.all() });
    }, { destructive: true }),
    tool('create_workspace', 'Create a decision workspace', 'you need a fresh workspace for input, files, and questions. This autosaves working data but does not save library definitions or protect the workspace from cleanup. Keep the returned UUID.', z.object({ ...evidence, ...selection, ...execution }), async input => workspaceResult((await workspaces.create(input)).id), { files: true, openWorld: true }),
    tool('list_workspaces', 'Find decision workspaces', 'you need to recall a saved workspace by friendly name or find recent temporary work.', z.object({ savedOnly: z.boolean().default(true), query: z.string().max(120).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(100) }), input => {
      const all = workspaces.list(input);
      return result({ workspaces: all.slice(input.offset, input.offset + input.limit).map(workspace => ({ ...workspace, ...services.links(workspace.id) })), total: all.length, nextOffset: input.offset + input.limit < all.length ? input.offset + input.limit : null }, 'Decision workspaces.');
    }, { readOnly: true }),
    tool('get_workspace', 'Read a decision workspace', 'you need current workspace state, file names, selected questions, and results. Input text stays out of model context unless includeInput is explicitly requested. This does not render a new widget.', z.object({ ...workspaceRef, includeInput: z.boolean().default(false) }), async input => {
      const output = await workspaceResult(input);
      if (input.includeInput) output.structuredContent.input = workspaces.read(input).input;
      return output;
    }, { readOnly: true }),
    tool('update_workspace', 'Edit a decision workspace', 'you need to change working input, files, selected questions, or its provider/model. Changes autosave here; library definitions remain unchanged. Always supply current expectedRevision.', z.object({ ...workspaceRef, ...evidence, ...selection, provider: providerSchema.nullable().optional(), model: z.string().max(300).nullable().optional(), removeAssetIds: z.array(z.string()).max(128).optional(), expectedRevision: revision }), async input => workspaceResult((await workspaces.update(input, input, input.expectedRevision)).id), { files: true, openWorld: true }),
    tool('save_workspace', 'Save and share a workspace', 'the user asks to save or share this workspace for reuse in their own chats or devices. A unique friendly name protects it from cleanup. Reopening edits the same workspace; use duplicate_workspace for an independent copy.', z.object({ ...workspaceRef, name: z.string().trim().min(1).max(120), expectedRevision: revision }), async input => workspaceResult((await workspaces.save({ workspaceId: input.workspaceId, workspaceName: input.workspaceName }, input.name, input.expectedRevision)).id)),
    tool('duplicate_workspace', 'Duplicate a workspace', 'the user wants an independent working copy. Copy current input, files, questions, and settings into a fresh temporary UUID without copying run history.', z.object(workspaceRef), async input => workspaceResult((await workspaces.duplicate(input)).id)),
    tool('evaluate', 'Run decision questions', 'the user asks to evaluate supplied evidence or run an existing workspace. Choose one of setName, questionNames, or inline questions. Omitted input/questions reuse the workspace. Model/provider overrides never change the server default. Files are downloaded directly; do not transcribe documents into input. A running result includes a runId: inspect it with get_run rather than starting another evaluation.', z.object({ ...workspaceRef, ...evidence, ...selection, ...execution, expectedRevision: revision.optional(), requestId: z.string().min(1).max(150).optional() }), async (input, context) => {
      const evaluation = await services.evaluate(input, { key: context?.key, waitMs: context?.waitMs });
      return workspaceResult(evaluation.workspace.id, undefined, evaluation.run);
    }, { files: true, openWorld: true }),
    tool('get_run', 'Decision run status and answers', 'you need an existing run’s status or results. This never starts inference. Summary keeps distributions out of context; choose full only when you need all probabilities.', z.object({ ...workspaceRef, runId: z.string().uuid().optional(), detail: z.enum(['summary', 'full']).default('summary') }), async input => {
      const workspace = workspaces.read(input);
      const runId = input.runId || workspace.runIds[0];
      if (!runId) throw new AppError('This workspace has no runs.', 404, 'RUN_NOT_FOUND');
      const run = await workspaces.readRun(workspace.id, runId);
      const output = await workspaceResult(workspace.id, undefined, run);
      output.structuredContent.run = summarizeRun(run, input.detail === 'full');
      return output;
    }, { readOnly: true }),
    tool('cancel_run', 'Cancel an active evaluation', 'the user asks to stop an active evaluation. Cancellation does not delete input or previous results.', z.object({ ...workspaceRef, runId: z.string().uuid().optional() }), async input => workspaceResult(input, undefined, await services.cancelRun(input, input.runId)), { idempotent: true }),
    tool('render_workspace', 'Open the Decisions widget', 'the user wants an interactive decision workspace or a linked prompt/questions/results card. First create or find a workspace; reuse its UUID to link cards. UI is optional and tools still work without it.', z.object({ ...workspaceRef, view: z.enum(['combined', 'prompt', 'questions', 'results']).default('combined') }), async input => {
      await workspaces.touch(input);
      return workspaceResult(input, input.view);
    }, { render: true }),
    tool('get_workspace_link', 'Open workspace in Decisions', 'the user wants a frontend link to the current workspace. This returns a link for their own device/network; it does not create public access.', z.object(workspaceRef), input => result(services.links(input), 'Open this workspace in Decisions.'), { readOnly: true }),
    tool('touch_workspace', 'Record workspace activity', 'a workspace is opened or directly interacted with. Idle refreshes must not call this.', z.object(workspaceRef), async input => workspaceResult((await workspaces.touch(input)).id), { appOnly: true }),
    tool('attach_inline_file', 'Attach a file from the widget', 'a widget host has no file-upload extension. Add a small file directly; prefer native file references when available.', z.object({ ...workspaceRef, expectedRevision: revision, name: z.string().max(200), mimeType: z.string().max(200), dataBase64: z.string().max(9 * 1024 * 1024).regex(/^[A-Za-z0-9+/=\r\n]+$/) }), async input => workspaceResult((await workspaces.update(input, { uploads: [{ buffer: Buffer.from(input.dataBase64, 'base64'), name: input.name, mimeType: input.mimeType }] }, input.expectedRevision)).id), { appOnly: true }),
  ];
  const byName = new Map(definitions.map(definition => [definition.name, definition]));
  return {
    definitions,
    async call(name, input = {}, context = {}) {
      const definition = byName.get(name);
      if (!definition) throw new AppError('Tool not found.', 404, 'TOOL_NOT_FOUND');
      return definition.run(definition.schema.parse(input), context);
    },
    async safeCall(name, input = {}, context = {}) {
      try { return await this.call(name, input, context); }
      catch (error) {
        const info = errorInfo(error);
        return { ...result({ error: info.error, code: info.code, ...(info.details ? { details: info.details } : {}) }, info.error), isError: true };
      }
    },
    workspaceResult,
  };
}
