import { useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import imageCompression from 'browser-image-compression';
import { Check, ChevronDown, CircleDot, FolderOpen, ImagePlus, Library, LoaderCircle, Play, Plus, RefreshCw, Save, Settings, X } from 'lucide-react';
import { evaluationSchema } from '../server/schema.js';
import { Field, IconButton, SaveDialog, SettingsDialog, Question, LibraryDialog } from './components.jsx';
import { TYPE_NAMES, newId, instantiate, freshQuestion, errorMessage, api } from './shared.js';
import { WorkspacePicker } from './WorkspaceApp.jsx';
import { createHttpTransport } from './transports.js';

// Older sessions stored this default as if it were a browser override.
const LEGACY_DEFAULT_CUSTOM_BASE_URL = 'https://llama.ghost-morpho.ts.net/v1';
const SESSION_KEY = 'jev-session-v1';
const TEXT_KEY = 'jev-text-v1';
const IMAGES_KEY = 'jev-images-v1';
const DEFAULT_SETTINGS = { provider: 'llama', llamaBaseUrl: '', models: { llama: '', openrouter: '', openai: 'gpt-6-luna' }, keys: { openrouter: '', openai: '' } };
const workspaceTransport = createHttpTransport();

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; } catch { return {}; }
}
function readText() { try { return localStorage.getItem(TEXT_KEY) || ''; } catch { return ''; } }
function initialSettings() {
  const s = readSession().settings || {};
  return { ...DEFAULT_SETTINGS, ...s, llamaBaseUrl: s.llamaBaseUrl === LEGACY_DEFAULT_CUSTOM_BASE_URL ? '' : s.llamaBaseUrl || '', models: { ...DEFAULT_SETTINGS.models, ...s.models }, keys: { ...DEFAULT_SETTINGS.keys, ...s.keys } };
}
export default function App() {
  const [settings, setSettings] = useState(initialSettings);
  const [questions, setQuestions] = useState(() => readSession().questions || []);
  const [setInfo, setSetInfo] = useState(() => readSession().setInfo || { id: '', name: '', dirty: false });
  const [text, setText] = useState(readText);
  const [images, setImages] = useState([]);
  const [imagesReady, setImagesReady] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [library, setLibrary] = useState({ questions: [], sets: [] });
  const [serverConfig, setServerConfig] = useState(null);
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelError, setModelError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [expanded, setExpanded] = useState({});
  const [addType, setAddType] = useState('noul');
  const [addTemplate, setAddTemplate] = useState('new');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const abortRef = useRef(null);
  const fileRef = useRef(null);
  const hadBrowserSettings = useRef(Boolean(readSession().settings));
  const provider = settings.provider;
  const baseUrl = settings.llamaBaseUrl || serverConfig?.llamaBaseUrl || '';
  const modelId = settings.models[provider];
  const selectedModel = models.find(m => m.id === modelId);
  const keyAvailable = provider === 'llama' || !!settings.keys[provider] || !!serverConfig?.keys[provider];
  const imagesUnsupported = images.length > 0 && selectedModel?.supportsImages === false;

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api('/api/library', { signal: controller.signal }), api('/api/config', { signal: controller.signal })])
      .then(([library, config]) => {
        setLibrary(library); setServerConfig(config);
        if (!hadBrowserSettings.current && config.defaults?.model) setSettings(previous => ({ ...previous, provider: config.defaults.provider, models: { ...previous.models, [config.defaults.provider]: config.defaults.model } }));
      })
      .catch(error => { if (error.name !== 'AbortError') setError(errorMessage(error)); });
    let active = true;
    get(IMAGES_KEY).then(saved => { if (active && Array.isArray(saved)) setImages(saved); })
      .catch(() => { if (active) setError('This browser could not restore saved images. Text and questions are still available.'); })
      .finally(() => { if (active) setImagesReady(true); });
    return () => { active = false; controller.abort(); abortRef.current?.abort(); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ settings, questions, setInfo })); }
    catch { setError('Browser storage is full or unavailable. Current questions and settings could not be remembered.'); }
  }, [settings, questions, setInfo]);
  useEffect(() => {
    try { localStorage.setItem(TEXT_KEY, text); }
    catch { setError('Browser storage is full or unavailable. This text could not be remembered.'); }
  }, [text]);
  useEffect(() => {
    if (imagesReady) set(IMAGES_KEY, images).catch(() => setError('Browser storage is full or unavailable. These images could not be remembered.'));
  }, [images, imagesReady]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!serverConfig) return;
    const controller = new AbortController();
    setLoadingModels(true); setModelError(''); setModels([]);
    const query = new URLSearchParams({ provider, baseUrl });
    api(`/api/models?${query}`, { key: settings.keys[provider], signal: controller.signal })
      .then(({ models }) => {
        setModels(models);
        setSettings(previous => {
          if (previous.provider !== provider) return previous;
          const current = previous.models[provider];
          if (models.some(m => m.id === current)) return previous;
          const preferred = models.find(m => serverConfig.defaults?.provider === provider && m.id === serverConfig.defaults.model) || models.find(m => m.id === 'clef-flash') || models.find(m => m.nativeDecision) || models[0];
          return { ...previous, models: { ...previous.models, [provider]: preferred?.id || '' } };
        });
      })
      .catch(error => { if (error.name !== 'AbortError') setModelError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingModels(false); });
    return () => controller.abort();
  }, [provider, baseUrl, serverConfig, settings.keys[provider], refreshNonce]);

  function edited() { setResult(null); setError(''); setSetInfo(info => ({ ...info, dirty: true })); }
  function changeQuestion(id, patch) { setQuestions(qs => qs.map(q => q.id === id ? { ...q, ...patch } : q)); edited(); }
  function addQuestion(template) {
    const q = template ? instantiate(template) : freshQuestion(addType, questions.filter(q => q.type === addType).length);
    setQuestions(qs => [...qs, q]);
    setExpanded(state => ({ ...state, [q.id]: !template }));
    edited();
    if (template) setNotice(`Added “${template.name}”.`);
  }
  function loadSet(saved) {
    setQuestions(saved ? saved.questions.map(instantiate) : []);
    setSetInfo(saved ? { id: saved.id, name: saved.name, dirty: false } : { id: '', name: '', dirty: false });
    setExpanded({}); setResult(null); setError('');
  }
  function changeInput(value) { setText(value); setResult(null); setError(''); }
  function removeImage(id) { setImages(list => list.filter(image => image.id !== id)); setResult(null); setError(''); }
  function clearInput() { setText(''); setImages([]); setResult(null); setError(''); }

  async function addImages(files) {
    if (!files.length || busy || imageBusy) return;
    setImageBusy(true); setError(''); setResult(null);
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) throw new Error('Choose image files (JPEG, PNG, or WebP).');
        const compressed = await imageCompression(file, { maxSizeMB: 2, maxWidthOrHeight: 2048, initialQuality: 0.9, fileType: 'image/jpeg', useWebWorker: false });
        const dataUrl = await imageCompression.getDataUrlFromFile(compressed);
        setImages(list => [...list, { id: newId(), name: file.name, dataUrl, size: compressed.size }]);
      }
    } catch (error) { setError(`Could not add an image: ${errorMessage(error)} Try a JPEG, PNG, or WebP file.`); }
    finally { setImageBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function run() {
    setError(''); setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const request = { provider, model: modelId, baseUrl, text, images: images.map(i => i.dataUrl), questions };
      evaluationSchema.parse(request);
      if (!keyAvailable) throw new Error('Add a key in Settings to use this provider.');
      if (imagesUnsupported) throw new Error('This model is text-only. Choose a model with images or remove the images.');
      if (provider === 'openrouter' && /(?:^|\/)clef(?:-|$)/.test(modelId)) {
        if (images.length > 4) throw new Error('This OpenRouter model accepts up to 4 images. Remove some images or choose another model.');
        setBusy(true);
        request.images = [];
        for (const image of images) {
          if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          const file = await imageCompression.getFilefromDataUrl(image.dataUrl, image.name);
          const compact = await imageCompression(file, { maxSizeMB: 0.15 / images.length, maxWidthOrHeight: 1600, useWebWorker: false, fileType: 'image/jpeg', signal: controller.signal });
          request.images.push(await imageCompression.getDataUrlFromFile(compact));
        }
      }
      if (provider === 'openrouter' && /mercury-decide/.test(modelId) && images.length > 16) throw new Error('This OpenRouter model accepts up to 16 images. Remove some images first.');
      setBusy(true);
      const data = await api('/api/evaluate', { method: 'POST', body: JSON.stringify(request), key: settings.keys[provider], signal: controller.signal });
      setResult(data);
      setExpanded({});
    } catch (error) {
      if (controller.signal.aborted) setNotice('Evaluation cancelled.'); else setError(errorMessage(error));
    } finally { setBusy(false); abortRef.current = null; }
  }

  async function saveTarget(name, copy) {
    if (!name) throw new Error('Enter a name.');
    if (modal.kind === 'set') {
      const existing = !copy && library.sets.find(item => item.id === modal.savedId);
      const saved = await api('/api/sets', { method: 'POST', body: JSON.stringify({ id: existing?.id, expectedRevision: existing?.revision, name, questions }) });
      setLibrary(old => ({ ...old, sets: [...old.sets.filter(s => s.id !== saved.id), saved] }));
      setSetInfo({ id: saved.id, name: saved.name, dirty: false });
    } else {
      const q = questions.find(q => q.id === modal.questionId);
      if (!q) throw new Error('This question is no longer in the current set.');
      const existing = !copy && library.questions.find(item => item.id === modal.savedId);
      const saved = await api('/api/questions', { method: 'POST', body: JSON.stringify({ id: existing?.id, expectedRevision: existing?.revision, question: { ...q, name } }) });
      setLibrary(old => ({ ...old, questions: [...old.questions.filter(q => q.id !== saved.id), saved] }));
      setQuestions(qs => qs.map(current => current.id === q.id ? { ...current, name, savedId: saved.id } : current));
      setSetInfo(info => ({ ...info, dirty: true }));
    }
    setNotice(`Saved “${name}”.`);
  }
  async function deleteSaved(kind, item) {
    await api(`/api/${kind}/${item.id}?revision=${item.revision || 0}`, { method: 'DELETE' });
    setLibrary(old => ({ ...old, [kind]: old[kind].filter(i => i.id !== item.id) }));
    if (kind === 'sets' && setInfo.id === item.id) setSetInfo(info => ({ ...info, id: '', dirty: true }));
    if (kind === 'questions') setQuestions(qs => qs.map(q => q.savedId === item.id ? { ...q, savedId: undefined } : q));
    if (addTemplate === item.id) setAddTemplate('new');
    setNotice(`Deleted “${item.name}”.`);
  }
  async function renameSaved(kind, item, name) {
    const output = await workspaceTransport.call('rename_item', { kind: kind === 'sets' ? 'set' : 'question', id: item.id, expectedRevision: item.revision, newName: name });
    setLibrary(output._meta.library);
    if (kind === 'sets' && setInfo.id === item.id) setSetInfo(previous => ({ ...previous, name }));
  }

  const sortedSets = [...library.sets].sort((a, b) => a.name.localeCompare(b.name));
  const templates = library.questions.filter(q => q.type === addType).sort((a, b) => a.name.localeCompare(b.name));
  const selectedSetExists = library.sets.some(s => s.id === setInfo.id);
  const setValue = selectedSetExists ? setInfo.id : questions.length ? 'draft' : '';
  const answerMap = new Map(result?.answers.map(a => [a.id, a]) || []);

  return <div className="app-shell">
    <header className="app-header"><a className="wordmark" href="/" aria-label="Decisions home"><CircleDot size={21} /><span>Decisions</span></a><div className="header-actions"><IconButton title="Workspaces" disabled={busy || imageBusy} onClick={() => setModal({ kind: 'workspaces' })}><FolderOpen size={17} /></IconButton><button disabled={busy} onClick={async () => { try { setLibrary(await api('/api/library')); setModal({ kind: 'library' }); } catch (error) { setError(errorMessage(error)); } }}><Library size={16} /><span>Library</span></button><IconButton title="Settings" disabled={busy} onClick={() => setModal({ kind: 'settings' })}><Settings size={18} /></IconButton></div></header>
    <main>
      <section className="connection" aria-label="Provider and model">
        <div className="provider-tabs" role="group" aria-label="Provider">{[['llama', 'Custom'], ['openrouter', 'OpenRouter'], ['openai', 'OpenAI']].map(([id, label]) => <button type="button" className={provider === id ? 'active' : ''} aria-pressed={provider === id} key={id} disabled={busy} onClick={() => { setSettings(s => ({ ...s, provider: id })); setResult(null); setError(''); }}>{label}</button>)}</div>
        <div className="model-row"><Field label="Model"><select aria-label="Model" value={models.some(m => m.id === modelId) ? modelId : ''} onChange={e => { setSettings(s => ({ ...s, models: { ...s.models, [provider]: e.target.value } })); setResult(null); setError(''); }} disabled={busy || loadingModels || models.length === 0}>
          {(loadingModels || models.length === 0) && <option value="">{loadingModels ? 'Loading models…' : 'No models available'}</option>}
          {models.map(m => <option key={m.id} value={m.id}>{m.name}{m.supportsImages === true ? ' · images' : m.supportsImages === false ? ' · text' : ''}</option>)}
        </select></Field><IconButton title="Refresh models" disabled={busy || loadingModels} onClick={() => setRefreshNonce(n => n + 1)}><RefreshCw size={16} className={loadingModels ? 'spin' : ''} /></IconButton></div>
        <div className="model-caption">{selectedModel && <span>{selectedModel.supportsImages === true ? 'Text + images' : selectedModel.supportsImages === false ? 'Text only' : 'Image support not advertised'}</span>}</div>
        {modelError && <p className="error" role="alert">{modelError} <button className="text-button" onClick={() => setModal({ kind: 'settings' })}>Settings</button></p>}
        {!keyAvailable && <p className="hint">This provider needs a key. <button className="text-button" onClick={() => setModal({ kind: 'settings' })}>Add in Settings</button></p>}
      </section>

      <div className="workspace">
        <section className="input-section" aria-labelledby="input-title">
          <div className="section-heading"><h2 id="input-title">Input to Evaluate</h2><button className="quiet-button" onClick={clearInput} disabled={busy || imageBusy || !imagesReady || (!text && !images.length)}><X size={14} />Clear input</button></div>
          <Field multiline className="prompt-field"><textarea aria-label="Input text to evaluate" value={text} onChange={e => changeInput(e.target.value)} placeholder="Paste the text you want the questions to evaluate. Or add images below." disabled={busy} onPaste={e => { const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); addImages(files); } }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addImages(Array.from(e.dataTransfer.files)); }} /></Field>
          <div className="input-toolbar"><button onClick={() => fileRef.current?.click()} disabled={busy || imageBusy || !imagesReady}>{imageBusy ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />}{imageBusy ? 'Preparing…' : 'Add images'}</button><input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => addImages(Array.from(e.target.files))} /></div>
          {images.length > 0 && <div className="image-list">{images.map(image => <figure key={image.id}><img src={image.dataUrl} alt={image.name} /><IconButton title={`Remove ${image.name}`} disabled={busy || imageBusy} onClick={() => removeImage(image.id)}><X size={14} /></IconButton><figcaption title={image.name}>{image.name}</figcaption></figure>)}</div>}
          {imagesUnsupported && <p className="error">This model is text-only. Choose a model with images or remove the images.</p>}
          <div className="run-panel"><button className={`run-button ${busy ? 'cancel-button' : 'primary'}`} onClick={busy ? () => abortRef.current?.abort() : run} disabled={!busy && (loadingModels || !modelId || imageBusy || !imagesReady || !questions.length || (!text.trim() && !images.length) || imagesUnsupported || !keyAvailable)}>{busy ? <LoaderCircle size={16} className="spin" /> : <Play size={15} fill="currentColor" />}{busy ? 'Cancel evaluation' : `Evaluate${questions.length ? ` ${questions.length} question${questions.length === 1 ? '' : 's'}` : ''}`}</button>
          </div>
          {error && <div className="error-block" role="alert"><p>{error}</p><IconButton title="Dismiss error" onClick={() => setError('')}><X size={15} /></IconButton></div>}
          {result && <div className="run-info"><span>{(result.elapsedMs / 1000).toFixed(2)}s · {result.model}</span>{typeof result.usage?.input_tokens === 'number' && <span>{result.usage.input_tokens.toLocaleString()} input tokens{typeof result.usage.cost === 'number' ? ` · $${result.usage.cost.toFixed(6)}` : ''}</span>}<details className="raw-response"><summary>Raw response <ChevronDown size={13} /></summary><pre>{JSON.stringify(result.raw, null, 2)}</pre></details></div>}
        </section>

        <section className="questions-section" aria-labelledby="questions-title">
          <div className="section-heading"><h2 id="questions-title">Questions <span>{questions.length}</span></h2><button className="quiet-button" disabled={busy || !questions.length} onClick={() => setModal({ kind: 'set', name: setInfo.name || '', savedId: selectedSetExists ? setInfo.id : undefined })}><Save size={14} />Save set</button></div>
          <div className="set-toolbar"><Field><select aria-label="Load question set" value={setValue} disabled={busy} onChange={e => { if (e.target.value === 'draft') return; loadSet(library.sets.find(s => s.id === e.target.value)); }}><option value="">None — empty set</option>{questions.length > 0 && !selectedSetExists && <option value="draft">{setInfo.name ? `${setInfo.name} · unsaved` : 'Unsaved set'}</option>}{sortedSets.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></Field>{setInfo.dirty && selectedSetExists && <span className="edited-label">Edited</span>}</div>
          {questions.length === 0 && <div className="empty-questions"><CircleDot size={23} /><p>Add the questions you want to ask.</p></div>}
          <div className="question-list">{questions.map(q => <Question key={q.id} question={q} answer={answerMap.get(q.id)} expanded={!!expanded[q.id]} onExpand={open => setExpanded(state => state[q.id] === open ? state : { ...state, [q.id]: open })} onChange={patch => changeQuestion(q.id, patch)} onSave={() => setModal({ kind: 'question', questionId: q.id, name: q.name, savedId: library.questions.some(s => s.id === q.savedId) ? q.savedId : undefined })} onRemove={() => { setQuestions(qs => qs.filter(item => item.id !== q.id)); edited(); }} disabled={busy} />)}</div>
          <div className="add-question"><Field label="Question type"><select value={addType} onChange={e => { setAddType(e.target.value); setAddTemplate('new'); }} disabled={busy}>{Object.entries(TYPE_NAMES).map(([type, name]) => <option value={type} key={type}>{name}</option>)}</select></Field><Field label="Start with"><select value={templates.some(t => t.id === addTemplate) ? addTemplate : 'new'} onChange={e => setAddTemplate(e.target.value)} disabled={busy}><option value="new">Create new</option>{templates.map(q => <option value={q.id} key={q.id}>{q.name}</option>)}</select></Field><button className="add-button" disabled={busy || questions.length >= 200} onClick={() => addQuestion(templates.find(q => q.id === addTemplate))}><Plus size={17} /><span>Add</span></button></div>
        </section>
      </div>
    </main>
    <footer className="app-footer"></footer>
    {notice && <div className="toast" role="status"><Check size={15} />{notice}</div>}
    {modal?.kind === 'settings' && <SettingsDialog settings={settings} serverConfig={serverConfig} onClose={() => setModal(null)} onSave={value => { setSettings(value); setResult(null); setNotice('Settings saved in this browser.'); }} onSaveDefault={async input => setServerConfig(await api('/api/config/defaults', { method: 'POST', body: JSON.stringify(input) }))} />}
    {modal?.kind === 'library' && <LibraryDialog library={library} disabled={busy} onClose={() => setModal(null)} onAdd={addQuestion} onLoad={loadSet} onDelete={deleteSaved} onRename={renameSaved} />}
    {modal?.kind === 'workspaces' && <WorkspacePicker transport={workspaceTransport} onClose={() => setModal(null)} onOpen={item => window.location.assign(`/workspace/by-id/${item.id}`)} onUseCurrent={() => workspaceTransport.call('create_workspace', { input: text, images: images.map(image => image.dataUrl), questions, provider, ...(modelId ? { model: modelId } : {}) })} />}
    {['question', 'set'].includes(modal?.kind) && <SaveDialog target={modal} onClose={() => setModal(null)} onSave={saveTarget} />}
  </div>;
}
