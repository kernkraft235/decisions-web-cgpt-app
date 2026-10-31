import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CircleDot, Copy, ExternalLink, FilePlus, FolderOpen, Library, LoaderCircle, Maximize2, Play, Plus, RefreshCw, Save, Share2, Trash2, X } from 'lucide-react';
import { Answer, Field, IconButton, LibraryDialog, Modal, Question, SaveDialog } from './components.jsx';
import { errorMessage, freshQuestion, instantiate, newId, TYPE_NAMES } from './shared.js';

const activeStatuses = new Set(['running', 'pending', 'cancelling']);
const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const emptyLibrary = { questions: [], sets: [] };
const draftOf = workspace => ({ input: workspace.input, questions: workspace.questions, provider: workspace.provider, model: workspace.model, setName: workspace.setName });

export function WorkspacePicker({ transport, onClose, onOpen, onUseCurrent }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [nextOffset, setNextOffset] = useState(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      transport.call('list_workspaces', { savedOnly, query }).then(output => {
        if (!cancelled) { setItems(output.structuredContent.workspaces); setNextOffset(output.structuredContent.nextOffset); }
      }).catch(error => { if (!cancelled) setError(errorMessage(error)); });
    }, query ? 200 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [transport, query, savedOnly, refresh]);
  async function create(current = false) {
    setBusy(true); setError('');
    try {
      const output = current ? await onUseCurrent() : await transport.call('create_workspace');
      onOpen(output._meta.workspace);
    } catch (error) { setError(errorMessage(error)); setBusy(false); }
  }
  return <Modal title="Workspaces" onClose={onClose}>
    <div className="workspace-picker-actions"><button onClick={() => create()} disabled={busy}><Plus size={14} />New workspace</button>{onUseCurrent && <button onClick={() => create(true)} disabled={busy}>Use current draft</button>}</div>
    <div className="workspace-search"><Field label="Find workspace"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name" /></Field><label className="check-label"><input type="checkbox" checked={savedOnly} onChange={event => setSavedOnly(event.target.checked)} />Saved only</label></div>
    {error && <p className="error" role="alert">{error}</p>}
    {confirming && <div className="inline-confirm"><p>Delete “{confirming.name || 'Untitled workspace'}”, including its files and results?</p><div><button onClick={() => setConfirming(null)} disabled={busy}>Cancel</button><button disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await transport.call('delete_item', { kind: 'workspace', id: confirming.id, expectedRevision: confirming.revision }); setConfirming(null); setRefresh(value => value + 1); }
      catch (error) { setError(errorMessage(error)); }
      finally { setBusy(false); }
    }}>Delete</button></div></div>}
    {!items.length && <p className="hint">No matching workspaces.</p>}
    {items.map(item => <div className="library-row" key={item.id}><div><strong>{item.name || 'Untitled workspace'}</strong><span>{item.saved ? 'Saved' : 'Temporary'} · {item.questionCount} questions · {item.fileCount} files</span></div><button disabled={busy} onClick={() => onOpen(item)}>Open</button><IconButton title={`Delete ${item.name || 'workspace'}`} disabled={busy} onClick={() => setConfirming(item)}><Trash2 size={14} /></IconButton></div>)}
    {nextOffset != null && <button className="quiet-button" onClick={async () => {
      try { const output = await transport.call('list_workspaces', { savedOnly, query, offset: nextOffset }); setItems(current => [...current, ...output.structuredContent.workspaces]); setNextOffset(output.structuredContent.nextOffset); }
      catch (error) { setError(errorMessage(error)); }
    }}>More workspaces</button>}
  </Modal>;
}

export default function WorkspaceApp({ transport, initialRef, initialView = 'combined' }) {
  const [workspace, setWorkspace] = useState(null);
  const [draft, setDraft] = useState(null);
  const [run, setRun] = useState(null);
  const [history, setHistory] = useState([]);
  const [library, setLibrary] = useState(emptyLibrary);
  const [config, setConfig] = useState(null);
  const [links, setLinks] = useState(null);
  const [view, setView] = useState(initialView);
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');
  const [modelRefresh, setModelRefresh] = useState(0);
  const [expanded, setExpanded] = useState({});
  const [addType, setAddType] = useState('noul');
  const [addTemplate, setAddTemplate] = useState('');
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [starting, setStarting] = useState(false);
  const [addingFiles, setAddingFiles] = useState(false);
  const [sharedUrl, setSharedUrl] = useState('');
  const [mention, setMention] = useState('');
  const [selectedRun, setSelectedRun] = useState('');
  const workspaceRef = useRef(null);
  const draftRef = useRef(null);
  const runRef = useRef(null);
  const pending = useRef({});
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const conflictRef = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const saveTimer = useRef(null);
  const viewRef = useRef(initialView);
  const selectedRunRef = useRef('');
  const alive = useRef(true);
  const fileInput = useRef(null);
  const promptInput = useRef(null);
  const resolvedProvider = draft?.provider || config?.defaults?.provider || 'llama';
  const modelId = draft?.model || (resolvedProvider === config?.defaults?.provider ? config?.defaults?.model : '') || '';
  const busy = starting || activeStatuses.has(run?.status);
  const hasPrompt = Boolean(draft?.input?.trim() || workspace?.assets.length);
  const invalidAsset = workspace?.assets.some(asset => asset.status !== 'ready');
  const stale = Boolean(run && workspace && (run.contentRevision ?? run.workspaceRevision) !== (workspace.contentRevision ?? workspace.revision));
  const templates = library.questions.filter(question => question.type === addType).sort((a, b) => a.name.localeCompare(b.name));
  const sortedSets = [...library.sets].sort((a, b) => a.name.localeCompare(b.name));
  const currentSet = sortedSets.find(set => set.name === draft?.setName);
  const answerMap = new Map(!stale ? (run?.answers || []).map(answer => [answer.id, answer]) : []);
  const showPrompt = view === 'combined' || view === 'prompt';
  const showQuestions = view === 'combined' || view === 'questions';

  function accept(output, { own = false, force = false, preserveDraft = false, render = false } = {}) {
    const meta = output?._meta;
    if (!meta || !alive.current) return;
    if (meta.library) setLibrary(meta.library);
    if (meta.config) setConfig(meta.config);
    const incoming = meta.workspace;
    if (!incoming) return;
    const previous = workspaceRef.current;
    if (previous && incoming.id !== previous.id && !force) return;
    if (previous && incoming.id === previous.id && incoming.revision < previous.revision) return;
    if (previous && incoming.id === previous.id && incoming.revision > previous.revision && dirtyRef.current && !own) {
      conflictRef.current = true; setConflict(true);
      return;
    }
    const changedWorkspace = !previous || incoming.id !== previous.id;
    if (changedWorkspace) {
      clearTimeout(saveTimer.current);
      pending.current = {}; dirtyRef.current = false; conflictRef.current = false;
      setDirty(false); setConflict(false); setExpanded({}); setSharedUrl('');
      selectedRunRef.current = ''; setSelectedRun('');
    }
    workspaceRef.current = incoming;
    setWorkspace(incoming);
    transport.setProvider(incoming.provider || meta.config?.defaults?.provider || resolvedProvider);
    if (!preserveDraft && !Object.keys(pending.current).length) {
      draftRef.current = draftOf(incoming);
      setDraft(draftRef.current);
    }
    const nextRun = meta.run;
    const currentRun = runRef.current;
    const regressesRun = !own && !changedWorkspace && currentRun && nextRun && (
      nextRun.startedAt < currentRun.startedAt ||
      (nextRun.id === currentRun.id && terminalStatuses.has(currentRun.status) && activeStatuses.has(nextRun.status))
    );
    if (!regressesRun) { runRef.current = nextRun; setRun(nextRun); }
    if (meta.history) setHistory(meta.history);
    const linkData = output.structuredContent?.workspace;
    if (linkData?.url) setLinks({ url: linkData.url, canonicalUrl: linkData.canonicalUrl });
    if (render && meta.view) { viewRef.current = meta.view; setView(meta.view); }
    transport.persist(incoming, render && meta.view ? meta.view : viewRef.current);
  }

  async function flush() {
    clearTimeout(saveTimer.current);
    const task = saveQueue.current.catch(() => {}).then(async () => {
      if (conflictRef.current) throw new Error('Resolve the workspace conflict before saving or running.');
      while (Object.keys(pending.current).length) {
        const patch = pending.current;
        pending.current = {};
        const current = workspaceRef.current;
        savingRef.current = true; setSaving(true);
        try {
          const output = await transport.call('update_workspace', { workspaceId: current.id, expectedRevision: current.revision, ...patch });
          if (workspaceRef.current?.id !== current.id) return;
          savingRef.current = false;
          accept(output, { own: true, preserveDraft: Boolean(Object.keys(pending.current).length) });
          dirtyRef.current = Boolean(Object.keys(pending.current).length); setDirty(dirtyRef.current);
        } catch (error) {
          pending.current = { ...patch, ...pending.current };
          dirtyRef.current = true; setDirty(true);
          if (error.code === 'REVISION_CONFLICT') { conflictRef.current = true; setConflict(true); }
          throw error;
        } finally { savingRef.current = false; if (alive.current) setSaving(false); }
      }
    });
    saveQueue.current = task;
    return task;
  }

  function change(patch) {
    const next = { ...draftRef.current, ...patch };
    if (patch.questions) next.setName = null;
    draftRef.current = next; setDraft(next);
    pending.current = { ...pending.current, ...patch };
    dirtyRef.current = true; setDirty(true); setError('');
    clearTimeout(saveTimer.current);
    if (!conflictRef.current) saveTimer.current = setTimeout(() => flush().catch(error => { if (alive.current) setError(errorMessage(error)); }), 350);
  }

  function guard(action) {
    setError('');
    return Promise.resolve().then(action).catch(error => {
      if (!alive.current) return;
      if (error.code === 'REVISION_CONFLICT') { conflictRef.current = true; setConflict(true); }
      setError(errorMessage(error));
    });
  }

  async function load(ref) {
    await flush();
    const output = await transport.call('get_workspace', ref);
    accept(output, { force: true });
    setModal(null);
  }

  useEffect(() => {
    alive.current = true;
    const unsubscribe = transport.subscribe(output => accept(output, { force: true, render: true }));
    const initial = transport.initial();
    if (initial) accept(initial, { force: true, render: true });
    transport.ready().then(async () => {
      if (!alive.current) return;
      const latest = transport.initial();
      if (latest) accept(latest, { force: true, render: true });
      if (initialRef) accept(await transport.call('touch_workspace', initialRef), { force: true });
      else if (workspaceRef.current) accept(await transport.call('touch_workspace', { workspaceId: workspaceRef.current.id }), { own: true });
    }).catch(error => { if (alive.current) setError(errorMessage(error)); });
    return () => { alive.current = false; unsubscribe(); clearTimeout(saveTimer.current); };
  }, [transport]);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    let polling = false;
    const id = workspace.id;
    async function refresh() {
      if (document.hidden || polling || savingRef.current) return;
      polling = true;
      try {
        const output = selectedRunRef.current ? await transport.call('get_run', { workspaceId: id, runId: selectedRunRef.current }) : await transport.call('get_workspace', { workspaceId: id });
        if (!cancelled && workspaceRef.current?.id === id) accept(output, { preserveDraft: dirtyRef.current });
      } catch (error) { if (!cancelled && error.code === 'WORKSPACE_NOT_FOUND') setError(errorMessage(error)); }
      finally { polling = false; }
    }
    const interval = setInterval(refresh, activeStatuses.has(run?.status) || starting ? 2000 : 5000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [transport, workspace?.id, run?.status, starting]);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    setLoadingModels(true); setModelError('');
    transport.call('list_models', { provider: resolvedProvider, refresh: modelRefresh > 0 }).then(output => {
      if (!cancelled) setModels(output.structuredContent.models);
    }).catch(error => { if (!cancelled) { setModels([]); setModelError(errorMessage(error)); } }).finally(() => { if (!cancelled) setLoadingModels(false); });
    return () => { cancelled = true; };
  }, [transport, resolvedProvider, Boolean(config), modelRefresh]);

  useEffect(() => {
    if (!workspace || !run) return;
    transport.updateContext({ workspaceId: workspace.id, workspaceName: workspace.name, runId: run.id, status: run.status, provider: run.provider, model: run.model, questionNames: run.snapshot.questions.map(question => question.name) });
    if (run.status === 'completed') setExpanded({});
  }, [transport, workspace?.id, run?.id, run?.status]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timeout);
  }, [notice]);

  async function upload(files) {
    if (!files.length) return;
    setAddingFiles(true);
    try { await flush(); accept(await transport.attachFiles(workspaceRef.current, files), { own: true }); }
    finally { setAddingFiles(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function selectSet(input) {
    await flush();
    const current = workspaceRef.current;
    accept(await transport.call('update_workspace', { workspaceId: current.id, expectedRevision: current.revision, ...input }), { own: true });
    setExpanded({});
  }

  async function saveTarget(name, copy) {
    await flush();
    const current = workspaceRef.current;
    if (modal.kind === 'workspace') {
      const output = await transport.call('save_workspace', { workspaceId: current.id, expectedRevision: current.revision, name });
      accept(output, { own: true });
      setSharedUrl(output.structuredContent.workspace.canonicalUrl);
      setNotice(`Saved “${name}”.`);
    } else if (modal.kind === 'set') {
      const existing = !copy && library.sets.find(set => set.id === modal.savedId);
      const output = await transport.call('save_set', { name, questions: draftRef.current.questions, ...(existing ? { id: existing.id, expectedRevision: existing.revision } : {}) });
      accept(output);
      await selectSet({ setName: name });
      setNotice(`Saved set “${name}”.`);
    } else {
      const selected = draftRef.current.questions.find(question => question.id === modal.questionId);
      const existing = !copy && library.questions.find(question => question.id === modal.savedId);
      const output = await transport.call('save_question', { question: { ...selected, name }, ...(existing ? { id: existing.id, expectedRevision: existing.revision } : {}) });
      accept(output);
      const saved = output.structuredContent.question;
      change({ questions: draftRef.current.questions.map(question => question.id === selected.id ? { ...question, name, savedId: saved.id } : question) });
      await flush();
      setNotice(`Saved question “${name}”.`);
    }
  }

  async function evaluate() {
    setStarting(true); setSelectedRun(''); selectedRunRef.current = '';
    try {
      await flush();
      const current = workspaceRef.current;
      accept(await transport.call('evaluate', { workspaceId: current.id, expectedRevision: current.revision, requestId: newId() }), { own: true });
    } finally { setStarting(false); }
  }

  function addQuestion(template) {
    const question = template ? instantiate(template) : freshQuestion(addType, draftRef.current.questions.filter(question => question.type === addType).length);
    change({ questions: [...draftRef.current.questions, question] });
    setExpanded(current => ({ ...current, [question.id]: !template }));
  }

  function insertMention(asset) {
    const textarea = promptInput.current;
    const position = textarea?.selectionStart ?? draftRef.current.input.length;
    const before = draftRef.current.input.slice(0, position).replace(/@[^\s@]*$/, `@${asset.name} `);
    const input = before + draftRef.current.input.slice(position);
    change({ input }); setMention('');
    requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(before.length, before.length); });
  }

  const runButton = <button className={`run-button ${busy ? 'cancel-button' : 'primary'}`} disabled={!busy && (addingFiles || conflict || !draft?.questions.length || !hasPrompt || !modelId || invalidAsset)} onClick={() => guard(busy ? async () => {
    accept(await transport.call('cancel_run', { workspaceId: workspaceRef.current.id }), { own: true });
  } : evaluate)}>{busy ? <LoaderCircle size={16} className="spin" /> : <Play size={15} fill="currentColor" />}{busy ? 'Cancel evaluation' : `Run${draft?.questions.length ? ` ${draft.questions.length} question${draft.questions.length === 1 ? '' : 's'}` : ''}`}</button>;

  if (!workspace || !draft) return <div className="app-shell workspace-app loading-workspace"><CircleDot size={22} /><p>{error || 'Opening workspace…'}</p><button onClick={() => setModal({ kind: 'workspaces' })}>Workspaces</button>{modal?.kind === 'workspaces' && <WorkspacePicker transport={transport} onClose={() => setModal(null)} onOpen={item => guard(() => load({ workspaceId: item.id }))} />}</div>;

  return <div className={`app-shell workspace-app view-${view}${transport.kind === 'mcp' ? ' embedded-workspace' : ''}`}>
    <header className="app-header workspace-header"><div className="workspace-heading"><a className="wordmark" href={transport.kind === 'http' ? '/' : links?.url} onClick={transport.kind === 'mcp' ? event => { event.preventDefault(); guard(() => transport.openLink(links.url)); } : undefined}><CircleDot size={20} /><span>{workspace.name || 'Decisions'}</span></a><span className="workspace-state">{conflict ? 'Conflict' : saving ? 'Saving…' : dirty ? 'Unsaved edit' : workspace.saved ? 'Saved workspace' : 'Temporary workspace'}</span></div><div className="header-actions">
      <IconButton title="Workspaces" disabled={starting || addingFiles} onClick={() => guard(async () => { await flush(); setModal({ kind: 'workspaces' }); })}><FolderOpen size={17} /></IconButton>
      <IconButton title="Saved questions and sets" onClick={() => guard(async () => { accept(await transport.call('list_library')); setModal({ kind: 'library' }); })}><Library size={17} /></IconButton>
      <button className="share-button" onClick={() => setModal({ kind: 'workspace', name: workspace.name || '' })}><Share2 size={15} /><span>Save / Share</span></button>
      {transport.expand && <IconButton title="Expand workspace" onClick={() => guard(() => transport.expand())}><Maximize2 size={15} /></IconButton>}
    </div></header>

    <div className="workspace-toolbar"><Field><select aria-label="Workspace view" value={view} onChange={event => { const next = event.target.value; viewRef.current = next; setView(next); transport.persist(workspaceRef.current, next); }}><option value="combined">Input + Questions</option><option value="prompt">Input</option><option value="questions">Questions</option><option value="results">Results</option></select></Field><button className="quiet-button" disabled={busy || addingFiles} onClick={() => guard(async () => { await flush(); const output = await transport.call('duplicate_workspace', { workspaceId: workspaceRef.current.id }); accept(output, { force: true }); setNotice('Independent copy created.'); })}><Copy size={13} />Duplicate</button>{links && <a className="frontend-link" href={links.url} onClick={event => { event.preventDefault(); guard(() => transport.openLink(links.url)); }}><ExternalLink size={13} /><span>Open in Decisions</span></a>}</div>

    {sharedUrl && <div className="workspace-share-link"><Field label="Reusable workspace link"><input readOnly value={sharedUrl} onFocus={event => event.target.select()} /></Field><IconButton title="Copy workspace link" onClick={() => guard(async () => { await navigator.clipboard.writeText(sharedUrl); setNotice('Link copied.'); })}><Copy size={15} /></IconButton><IconButton title="Close link" onClick={() => setSharedUrl('')}><X size={14} /></IconButton></div>}
    {conflict && <div className="conflict-panel" role="alert"><p>Another view changed this workspace. Your local edits are still here.</p><div><button onClick={() => guard(async () => {
      const output = await transport.call('get_workspace', { workspaceId: workspaceRef.current.id }); pending.current = {}; dirtyRef.current = false; conflictRef.current = false; setDirty(false); setConflict(false); accept(output, { force: true, own: true });
    })}>Reload server version</button><button onClick={() => guard(async () => {
      const edits = draftRef.current;
      const output = await transport.call('get_workspace', { workspaceId: workspaceRef.current.id });
      conflictRef.current = false; setConflict(false); accept(output, { own: true, preserveDraft: true });
      pending.current = { input: edits.input, questions: edits.questions, provider: edits.provider, model: edits.model }; dirtyRef.current = true; setDirty(true); await flush();
    })}>Reapply my edits</button></div></div>}
    {error && <div className="error-block" role="alert"><p>{error}</p><IconButton title="Dismiss error" onClick={() => setError('')}><X size={14} /></IconButton></div>}

    <section className="connection workspace-connection" aria-label="Evaluation model"><div className="workspace-model-fields"><Field label="Provider"><select value={draft.provider || ''} onChange={event => change({ provider: event.target.value || null, model: null })}><option value="">Server default</option><option value="llama">Custom</option><option value="openrouter">OpenRouter</option><option value="openai">OpenAI</option></select></Field><Field label="Model"><select value={draft.model || ''} disabled={loadingModels} onChange={event => change({ provider: event.target.value ? resolvedProvider : draft.provider, model: event.target.value || null })}><option value="">{resolvedProvider === config?.defaults?.provider && config?.defaults?.model ? `Default · ${config.defaults.model}` : 'Choose a model'}</option>{draft.model && !models.some(model => model.id === draft.model) && <option value={draft.model}>{draft.model} · unavailable</option>}{models.map(model => <option key={model.id} value={model.id}>{model.name}{model.supportsImages === true ? ' · images' : model.supportsImages === false ? ' · text' : ''}</option>)}</select></Field><IconButton title="Refresh models" disabled={loadingModels} onClick={() => setModelRefresh(value => value + 1)}><RefreshCw size={15} className={loadingModels ? 'spin' : ''} /></IconButton></div>{modelError && <p className="error" role="alert">{modelError}</p>}</section>

    <div className="workspace">
      {showPrompt && <section className="input-section" aria-labelledby="workspace-input"><div className="section-heading"><h2 id="workspace-input">Input to Evaluate</h2><button className="quiet-button" disabled={addingFiles || (!draft.input && !workspace.assets.length)} onClick={() => guard(async () => { change({ input: '' }); await flush(); const current = workspaceRef.current; accept(await transport.call('update_workspace', { workspaceId: current.id, expectedRevision: current.revision, removeAssetIds: current.assets.map(asset => asset.id) }), { own: true }); })}><X size={13} />Clear</button></div>
        <div className="prompt-composer"><Field multiline className="prompt-field"><textarea ref={promptInput} aria-label="Input text to evaluate" value={draft.input} onChange={event => { change({ input: event.target.value }); const match = /@([^\s@]*)$/.exec(event.target.value.slice(0, event.target.selectionStart)); setMention(match ? `@${match[1]}` : ''); }} placeholder="Type or paste input, or add a file." onPaste={event => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); guard(() => upload(files)); } }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); guard(() => upload([...event.dataTransfer.files])); }} /></Field>{mention && workspace.assets.length > 0 && <div className="file-mentions" role="listbox" aria-label="Attached files">{workspace.assets.filter(asset => asset.name.toLowerCase().includes(mention.slice(1).toLowerCase())).slice(0, 8).map(asset => <button type="button" role="option" key={asset.id} onMouseDown={event => event.preventDefault()} onClick={() => insertMention(asset)}>{asset.name}</button>)}</div>}</div>
        <div className="input-toolbar"><button onClick={() => fileInput.current?.click()} disabled={addingFiles}>{addingFiles ? <LoaderCircle size={14} className="spin" /> : <FilePlus size={14} />}{addingFiles ? 'Preparing files…' : 'Add files'}</button>{transport.canSelectLibrary() && <button disabled={addingFiles} onClick={() => guard(async () => { setAddingFiles(true); try { await flush(); const output = await transport.selectLibrary(workspaceRef.current); if (output) accept(output, { own: true }); } finally { setAddingFiles(false); } })}><Library size={14} />ChatGPT Library</button>}<input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp,.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.html,.yaml,.yml,.log,.pdf,.docx" hidden onChange={event => guard(() => upload([...event.target.files]))} /></div>
        {workspace.assets.length > 0 && <div className="workspace-files">{workspace.assets.map(asset => <article key={asset.id} className={`workspace-file ${asset.kind}`}>
          {asset.previewUrl && <img src={asset.previewUrl} alt={asset.name} />}
          <div><strong>{asset.name}</strong><span>{Math.max(1, Math.round(asset.bytes / 1024))} KiB{asset.kind === 'document' ? ' · text' : ''}</span>{asset.warning && <p className="error">{asset.warning}</p>}{asset.previewText && <details><summary>Extracted text <ChevronDown size={12} /></summary><pre>{asset.previewText}{asset.textBytes > new TextEncoder().encode(asset.previewText).length ? '\n…' : ''}</pre></details>}</div>
          <IconButton title={`Remove ${asset.name}`} disabled={addingFiles} onClick={() => guard(async () => { await flush(); const current = workspaceRef.current; accept(await transport.call('update_workspace', { workspaceId: current.id, expectedRevision: current.revision, removeAssetIds: [asset.id] }), { own: true }); })}><X size={14} /></IconButton>
        </article>)}</div>}
        <div className="run-panel">{runButton}</div>
      </section>}

      {showQuestions && <section className="questions-section" aria-labelledby="workspace-questions"><div className="section-heading"><h2 id="workspace-questions">Questions <span>{draft.questions.length}</span></h2><button className="quiet-button" disabled={!draft.questions.length} onClick={() => setModal({ kind: 'set', name: draft.setName || '', savedId: currentSet?.id })}><Save size={14} />Save set</button></div>
        <div className="set-toolbar"><Field><select aria-label="Load a question set" value={currentSet?.id || (draft.questions.length ? 'draft' : '')} onChange={event => { if (event.target.value === 'draft') return; const set = library.sets.find(item => item.id === event.target.value); guard(() => selectSet(set ? { setName: set.name } : { questions: [] })); }}><option value="">None — empty set</option>{draft.questions.length > 0 && !currentSet && <option value="draft">Current questions</option>}{sortedSets.map(set => <option value={set.id} key={set.id}>{set.name}</option>)}</select></Field></div>
        {!draft.questions.length && <div className="empty-questions"><CircleDot size={22} /><p>Add the questions you want to ask.</p></div>}
        <div className="question-list">{draft.questions.map(question => <Question key={question.id} question={question} answer={answerMap.get(question.id)} expanded={!!expanded[question.id]} onExpand={open => setExpanded(current => current[question.id] === open ? current : { ...current, [question.id]: open })} onChange={patch => change({ questions: draftRef.current.questions.map(item => item.id === question.id ? { ...item, ...patch } : item) })} onSave={() => setModal({ kind: 'question', questionId: question.id, name: question.name, savedId: library.questions.find(item => item.id === question.savedId)?.id })} onRemove={() => change({ questions: draftRef.current.questions.filter(item => item.id !== question.id) })} disabled={false} />)}</div>
        <div className="add-question"><Field label="Question type"><select value={addType} onChange={event => { setAddType(event.target.value); setAddTemplate(''); }}>{Object.entries(TYPE_NAMES).map(([type, name]) => <option key={type} value={type}>{name}</option>)}</select></Field><Field label="Start with"><select value={addTemplate} onChange={event => setAddTemplate(event.target.value)}><option value="">Create new</option>{templates.map(question => <option key={question.id} value={question.id}>{question.name}</option>)}</select></Field><button className="add-button" disabled={draft.questions.length >= 200} onClick={() => addQuestion(templates.find(question => question.id === addTemplate))}><Plus size={15} /><span>Add</span></button></div>
        {!showPrompt && <div className="run-panel"><p className="workspace-input-summary">{draft.input.length.toLocaleString()} characters · {workspace.assets.length} files</p>{runButton}</div>}
      </section>}
    </div>

    {(view === 'results' || (showQuestions && (stale || run?.error))) && run && <section className="workspace-results"><div className="section-heading"><h2>{stale ? 'Previous results' : 'Results'}</h2>{history.length > 1 && <Field><select aria-label="Run history" value={selectedRun} onChange={event => guard(async () => { const id = event.target.value; selectedRunRef.current = id; setSelectedRun(id); const output = await transport.call('get_run', { workspaceId: workspaceRef.current.id, ...(id ? { runId: id } : {}) }); accept(output, { own: true }); })}><option value="">Latest run</option>{history.slice(1).map(item => <option key={item.id} value={item.id}>{new Date(item.startedAt).toLocaleString()} · {item.model}</option>)}</select></Field>}</div>{stale && <p className="hint">Input, questions, or model settings changed since this run.</p>}{run.error && <p className="error" role="status">{run.error}</p>}<div className="question-list">{run.snapshot.questions.map(question => {
      const answer = run.answers?.find(answer => answer.id === question.id);
      return answer ? <article className="question result-question" key={question.id}><div className="result-question-heading"><strong>{question.name}</strong><p>{question.instructions}</p></div><Answer answer={answer} showDistribution /></article> : null;
    })}</div></section>}
    {run && <div className="run-info"><span>{run.status} · {run.model}{typeof run.elapsedMs === 'number' ? ` · ${(run.elapsedMs / 1000).toFixed(2)}s` : ''}</span>{typeof run.usage?.input_tokens === 'number' && <span>{run.usage.input_tokens.toLocaleString()} input tokens{typeof run.usage.cost === 'number' ? ` · $${run.usage.cost.toFixed(6)}` : ''}</span>}</div>}
    {view === 'results' && <div className="run-panel results-run">{!run && <p className="hint">Run the current questions to see results.</p>}{runButton}</div>}

    {notice && <div className="toast" role="status"><Check size={14} />{notice}</div>}
    {modal?.kind === 'workspaces' && <WorkspacePicker transport={transport} onClose={() => setModal(null)} onOpen={item => guard(() => load({ workspaceId: item.id }))} />}
    {modal?.kind === 'library' && <LibraryDialog library={library} onClose={() => setModal(null)} onAdd={question => addQuestion(question)} onLoad={set => guard(() => selectSet({ setName: set.name }))} onDelete={async (kind, item) => accept(await transport.call('delete_item', { kind: kind === 'sets' ? 'set' : 'question', id: item.id, expectedRevision: item.revision }))} onRename={async (kind, item, name) => accept(await transport.call('rename_item', { kind: kind === 'sets' ? 'set' : 'question', id: item.id, expectedRevision: item.revision, newName: name }))} />}
    {['question', 'set', 'workspace'].includes(modal?.kind) && <SaveDialog target={modal} onClose={() => setModal(null)} onSave={saveTarget} />}
  </div>;
}
