import { useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import imageCompression from 'browser-image-compression';
import { ArrowDown, ArrowUp, Check, ChevronDown, CircleDot, ImagePlus, Library, LoaderCircle, Play, Plus, RefreshCw, Save, Settings, Trash2, X } from 'lucide-react';
import { evaluationSchema } from '../server/schema.js';

// Older sessions stored this default as if it were a browser override.
const LEGACY_DEFAULT_CUSTOM_BASE_URL = 'https://llama.ghost-morpho.ts.net/v1';
const TYPE_NAMES = { noul: 'Yes / no', choice: 'Choice', score: 'Scale' };
const SESSION_KEY = 'jev-session-v1';
const TEXT_KEY = 'jev-text-v1';
const IMAGES_KEY = 'jev-images-v1';
const DEFAULT_SETTINGS = { provider: 'llama', llamaBaseUrl: '', models: { llama: '', openrouter: '', openai: 'gpt-6-luna' }, keys: { openrouter: '', openai: '' } };

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; } catch { return {}; }
}
function readText() { try { return localStorage.getItem(TEXT_KEY) || ''; } catch { return ''; } }
function initialSettings() {
  const s = readSession().settings || {};
  return { ...DEFAULT_SETTINGS, ...s, llamaBaseUrl: s.llamaBaseUrl === LEGACY_DEFAULT_CUSTOM_BASE_URL ? '' : s.llamaBaseUrl || '', models: { ...DEFAULT_SETTINGS.models, ...s.models }, keys: { ...DEFAULT_SETTINGS.keys, ...s.keys } };
}
const newId = () => crypto.randomUUID();
const option = (label = '') => ({ id: newId(), label, description: '' });
const instantiate = q => ({ ...q, id: newId(), savedId: q.savedId || q.id, choices: q.choices?.map(c => ({ ...c })) || [], levels: q.levels?.map(l => ({ ...l })) || [] });
function freshQuestion(type, count) {
  return { id: newId(), type, name: `${TYPE_NAMES[type]} ${count + 1}`, instructions: '', trueDescription: '', falseDescription: '', choices: [option('A'), option('B')], levels: [option('Low'), option('Medium'), option('High')] };
}
function errorMessage(error) {
  return error.issues?.map(i => i.message).join(' ') || error.message || 'Something went wrong.';
}
async function api(url, { key, ...options } = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'X-Provider-Key': key } : {}) },
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The app server did not return JSON. Check that it is running.'); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
const pct = value => `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`;
function hostLabel(url) { try { return new URL(url).hostname; } catch { return url; } }

function Field({ label, children, className = '', multiline = false }) {
  return <label className={`field-label ${className}`}>
    {label && <span className="label-text">{label}</span>}
    <span className={`field ${multiline ? 'multiline' : ''}`}>{children}</span>
  </label>;
}
function IconButton({ title, children, ...props }) {
  return <button type="button" className="icon-button" title={title} aria-label={title} {...props}>{children}</button>;
}
function Modal({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <div className="modal-shell">
      <header className="modal-header"><h2>{title}</h2><IconButton title="Close" onClick={onClose}><X size={18} /></IconButton></header>
      {children}
    </div>
  </dialog>;
}

function SaveDialog({ target, onClose, onSave }) {
  const [name, setName] = useState(target.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save(copy = false) {
    setSaving(true); setError('');
    try { await onSave(name.trim(), copy); onClose(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setSaving(false); }
  }
  return <Modal title={target.kind === 'set' ? 'Save question set' : 'Save question'} onClose={() => { if (!saving) onClose(); }}>
    <form onSubmit={e => { e.preventDefault(); save(); }}>
      <Field label={target.kind === 'set' ? 'Set name' : 'Question name'}><input autoFocus required value={name} onChange={e => setName(e.target.value)} disabled={saving} /></Field>
      <p className="hint">{target.kind === 'set' ? 'Saves all current questions together. Input text and images stay in this browser.' : 'Reuse this question in any set. Its choices and definitions are saved with it.'}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        {target.savedId && <button type="button" onClick={() => save(true)} disabled={!name.trim() || saving}>Save a copy</button>}
        <button className="primary" disabled={!name.trim() || saving}>{saving ? 'Saving…' : target.savedId ? 'Update saved' : 'Save'}</button>
      </div>
    </form>
  </Modal>;
}

function SettingsDialog({ settings, serverConfig, onClose, onSave }) {
  const [draft, setDraft] = useState({ ...settings, keys: { ...settings.keys } });
  return <Modal title="Settings" onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); onSave({ ...draft, llamaBaseUrl: draft.llamaBaseUrl.trim(), keys: { openai: draft.keys.openai.trim(), openrouter: draft.keys.openrouter.trim() } }); onClose(); }}>
      <Field label="Custom base URL (llama.cpp)"><input type="url" value={draft.llamaBaseUrl} placeholder={serverConfig?.llamaBaseUrl} onChange={e => setDraft({ ...draft, llamaBaseUrl: e.target.value })} autoCapitalize="none" spellCheck={false} /></Field>
      <p className="hint">Include /v1. Leave blank to use the server’s CUSTOM_BASE_URL. No API key is sent to this endpoint.</p>
      {['openrouter', 'openai'].map(provider => <div className="setting-key" key={provider}>
        <Field label={`${provider === 'openai' ? 'OpenAI' : 'OpenRouter'} API key`}><input type="password" value={draft.keys[provider]} onChange={e => setDraft({ ...draft, keys: { ...draft.keys, [provider]: e.target.value } })} placeholder={serverConfig?.keys[provider] ? 'Using server .env key' : 'Enter a key'} autoCapitalize="none" autoComplete="off" spellCheck={false} /></Field>
        <p className="hint">{serverConfig?.keys[provider] ? 'A key is available from .env. Leave blank to use it.' : 'Optional until you use this provider.'}</p>
      </div>)}
      <p className="hint">Keys entered here are saved in this browser. Server .env keys are kept on the server.</p>
      <div className="modal-actions"><button className="primary">Save settings</button></div>
    </form>
  </Modal>;
}

function CriteriaEditor({ items, onChange, scale, disabled }) {
  function move(index, offset) {
    const next = [...items];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  }
  return <div className="criteria-editor">
    <p className="editor-heading">{scale ? 'Levels · lowest to highest' : 'Choices'}</p>
    {items.map((item, index) => <div className="criterion" key={item.id || index}>
      {scale && <span className="level-index">{index}</span>}
      <div className="criterion-fields">
        <Field label={scale ? 'Level label' : 'Choice label'}><input value={item.label} onChange={e => onChange(items.map((c, i) => i === index ? { ...c, label: e.target.value } : c))} disabled={disabled} /></Field>
        <Field label="Definition (optional)"><input value={item.description} onChange={e => onChange(items.map((c, i) => i === index ? { ...c, description: e.target.value } : c))} disabled={disabled} placeholder="When this answer fits" /></Field>
      </div>
      <div className="criterion-actions">
        {scale && <><IconButton title="Move level up" disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></IconButton><IconButton title="Move level down" disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></IconButton></>}
        <IconButton title={scale ? 'Remove level' : 'Remove choice'} disabled={disabled || items.length <= 2} onClick={() => onChange(items.filter((_, i) => i !== index))}><X size={15} /></IconButton>
      </div>
    </div>)}
    <button type="button" className="quiet-button" onClick={() => onChange([...items, option()])} disabled={disabled || items.length >= (scale ? 10 : 255)}><Plus size={15} />{scale ? 'Add level' : 'Add choice'}</button>
  </div>;
}

function Answer({ answer }) {
  if (answer.error) return <div className="answer answer-error" role="status">{answer.error}</div>;
  if (answer.refused) return <div className="answer answer-error">The model declined to answer this question.</div>;
  const winner = answer.probabilities.reduce((best, item) => !best || item.probability > best.probability ? item : best, null);
  let value, detail;
  if (answer.type === 'noul') { value = answer.yes >= 0.5 ? 'Yes' : 'No'; detail = `${pct(answer.yes)} yes · ${pct(1 - answer.yes)} no`; }
  if (answer.type === 'choice') { value = answer.choice; const chosen = answer.probabilities.find(p => p.label === answer.choice); detail = chosen ? `${pct(chosen.probability)} probability` : ''; }
  if (answer.type === 'score') { value = `${answer.score.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} / ${answer.max}`; detail = winner ? `Most likely: ${winner.label} · ${pct(winner.probability)}` : `Ordered scale from 0 to ${answer.max}`; }
  return <div className={`answer answer-${answer.type}`}>
    <div className="answer-line"><strong>{value}</strong><span>{detail}</span></div>
    {answer.type === 'noul' ? <div className="probability-track" aria-label={`Yes probability ${pct(answer.yes)}`}><span style={{ width: pct(answer.yes) }} /></div> : <>
      {answer.type === 'score' && <div className="probability-track" aria-label={`Expected score ${answer.score} of ${answer.max}`}><span style={{ width: pct(answer.score / answer.max) }} /></div>}
      {(answer.probabilities.length > 0 || answer.confidence !== undefined) && <details className="distribution">
        <summary>Probabilities{answer.confidence !== undefined && <span>Confidence {pct(answer.confidence)}</span>}<ChevronDown size={13} /></summary>
        <div className="distribution-list">{answer.probabilities.map((item, i) => <div className="distribution-row" key={`${item.label}-${i}`}>
          <span>{answer.type === 'score' ? `${item.index} · ` : ''}{item.label}</span><span className="distribution-bar"><i style={{ width: pct(item.probability) }} /></span><b>{pct(item.probability)}</b>
        </div>)}</div>
      </details>}
    </>}
  </div>;
}

function Question({ question: q, answer, expanded, onExpand, onChange, onSave, onRemove, disabled }) {
  return <article className={`question ${answer ? 'has-answer' : ''}`}>
    <div className="question-actions"><IconButton title="Save question" onClick={onSave} disabled={disabled}><Save size={15} /></IconButton><IconButton title="Remove from current set" onClick={onRemove} disabled={disabled}><X size={16} /></IconButton></div>
    <details className="question-details" open={expanded} onToggle={e => onExpand(e.currentTarget.open)}>
      <summary>
        <div className="summary-label"><ChevronDown size={15} /><span className="question-name">{q.name || 'Unnamed question'}</span><span className="type-label">{TYPE_NAMES[q.type]}</span></div>
        <p className={q.instructions ? '' : 'placeholder'}>{q.instructions || 'Write your question…'}</p>
      </summary>
      <div className="question-editor">
        <div className="editor-top-row"><Field label="Name"><input value={q.name} onChange={e => onChange({ name: e.target.value })} disabled={disabled} /></Field>
          <Field label="Type"><select value={q.type} onChange={e => onChange({ type: e.target.value })} disabled={disabled}>{Object.entries(TYPE_NAMES).map(([type, name]) => <option key={type} value={type}>{name}</option>)}</select></Field></div>
        <Field label="Question" multiline><textarea value={q.instructions} onChange={e => onChange({ instructions: e.target.value })} disabled={disabled} placeholder="What should the model evaluate?" /></Field>
        {q.type === 'noul' ? <div className="yes-no-definitions"><Field label="Yes means (optional)" multiline><textarea value={q.trueDescription} onChange={e => onChange({ trueDescription: e.target.value })} disabled={disabled} placeholder="When the condition is true" /></Field><Field label="No means (optional)" multiline><textarea value={q.falseDescription} onChange={e => onChange({ falseDescription: e.target.value })} disabled={disabled} placeholder="When the condition is false" /></Field></div>
          : <CriteriaEditor items={q.type === 'score' ? q.levels : q.choices} onChange={items => onChange({ [q.type === 'score' ? 'levels' : 'choices']: items })} scale={q.type === 'score'} disabled={disabled} />}
        <div className="editor-footer"><span>{q.type === 'noul' ? 'Returns the probability of yes.' : q.type === 'choice' ? 'Returns one choice and its probabilities.' : 'Returns an average position on this scale, starting at 0.'}</span><button type="button" className="quiet-button" onClick={() => onExpand(false)}><Check size={14} />Done</button></div>
      </div>
    </details>
    {answer && <Answer answer={answer} />}
  </article>;
}

function LibraryDialog({ library, onClose, onAdd, onLoad, onDelete, disabled }) {
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  async function remove(kind, item) {
    if (!confirm(`Delete saved ${kind === 'sets' ? 'set' : 'question'} “${item.name}”?${kind === 'questions' ? ' Existing sets keep their copies.' : ''}`)) return;
    setDeleting(item.id); setError('');
    try { await onDelete(kind, item); } catch (error) { setError(errorMessage(error)); }
    finally { setDeleting(''); }
  }
  return <Modal title="Saved library" onClose={onClose}>
    {error && <p className="error" role="alert">{error}</p>}
    <h3>Question sets <span>{library.sets.length}</span></h3>
    {library.sets.length === 0 && <p className="hint library-empty">Save a set to load all its questions together.</p>}
    {library.sets.map(item => <div className="library-row" key={item.id}><div><strong>{item.name}</strong><span>{item.questions.length} questions</span></div><button disabled={disabled || !!deleting} onClick={() => { onLoad(item); onClose(); }}>Load</button><IconButton title={`Delete ${item.name}`} disabled={disabled || !!deleting} onClick={() => remove('sets', item)}><Trash2 size={15} /></IconButton></div>)}
    <h3>Individual questions <span>{library.questions.length}</span></h3>
    {library.questions.length === 0 && <p className="hint library-empty">Use the save icon beside a question to reuse it on its own.</p>}
    {library.questions.map(item => <div className="library-row" key={item.id}><div><strong>{item.name}</strong><span>{TYPE_NAMES[item.type]} · {item.instructions}</span></div><button disabled={disabled || !!deleting} onClick={() => onAdd(item)}>Add</button><IconButton title={`Delete ${item.name}`} disabled={disabled || !!deleting} onClick={() => remove('questions', item)}><Trash2 size={15} /></IconButton></div>)}
  </Modal>;
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
  const provider = settings.provider;
  const baseUrl = settings.llamaBaseUrl || serverConfig?.llamaBaseUrl || '';
  const modelId = settings.models[provider];
  const selectedModel = models.find(m => m.id === modelId);
  const keyAvailable = provider === 'llama' || !!settings.keys[provider] || !!serverConfig?.keys[provider];
  const imagesUnsupported = images.length > 0 && selectedModel?.supportsImages === false;

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api('/api/library', { signal: controller.signal }), api('/api/config', { signal: controller.signal })])
      .then(([library, config]) => { setLibrary(library); setServerConfig(config); })
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
          const preferred = models.find(m => m.id === 'clef-flash') || models.find(m => m.nativeDecision) || models[0];
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
      const saved = await api('/api/sets', { method: 'POST', body: JSON.stringify({ id: copy ? undefined : modal.savedId, name, questions }) });
      setLibrary(old => ({ ...old, sets: [...old.sets.filter(s => s.id !== saved.id), saved] }));
      setSetInfo({ id: saved.id, name: saved.name, dirty: false });
    } else {
      const q = questions.find(q => q.id === modal.questionId);
      if (!q) throw new Error('This question is no longer in the current set.');
      const saved = await api('/api/questions', { method: 'POST', body: JSON.stringify({ id: copy ? undefined : modal.savedId, question: { ...q, name } }) });
      setLibrary(old => ({ ...old, questions: [...old.questions.filter(q => q.id !== saved.id), saved] }));
      setQuestions(qs => qs.map(current => current.id === q.id ? { ...current, name, savedId: saved.id } : current));
      setSetInfo(info => ({ ...info, dirty: true }));
    }
    setNotice(`Saved “${name}”.`);
  }
  async function deleteSaved(kind, item) {
    await api(`/api/${kind}/${item.id}`, { method: 'DELETE' });
    setLibrary(old => ({ ...old, [kind]: old[kind].filter(i => i.id !== item.id) }));
    if (kind === 'sets' && setInfo.id === item.id) setSetInfo(info => ({ ...info, id: '', dirty: true }));
    if (kind === 'questions') setQuestions(qs => qs.map(q => q.savedId === item.id ? { ...q, savedId: undefined } : q));
    if (addTemplate === item.id) setAddTemplate('new');
    setNotice(`Deleted “${item.name}”.`);
  }

  const sortedSets = [...library.sets].sort((a, b) => a.name.localeCompare(b.name));
  const templates = library.questions.filter(q => q.type === addType).sort((a, b) => a.name.localeCompare(b.name));
  const selectedSetExists = library.sets.some(s => s.id === setInfo.id);
  const setValue = selectedSetExists ? setInfo.id : questions.length ? 'draft' : '';
  const answerMap = new Map(result?.answers.map(a => [a.id, a]) || []);

  return <div className="app-shell">
    <header className="app-header"><a className="wordmark" href="/" aria-label="Decisions home"><CircleDot size={21} /><span>Decisions</span></a><div className="header-actions"><button disabled={busy} onClick={() => setModal({ kind: 'library' })}><Library size={16} /><span>Library</span></button><IconButton title="Settings" disabled={busy} onClick={() => setModal({ kind: 'settings' })}><Settings size={18} /></IconButton></div></header>
    <main>
      <section className="connection" aria-label="Provider and model">
        <div className="provider-tabs" role="group" aria-label="Provider">{[['llama', 'Local · llama.cpp'], ['openrouter', 'OpenRouter'], ['openai', 'OpenAI']].map(([id, label]) => <button type="button" className={provider === id ? 'active' : ''} aria-pressed={provider === id} key={id} disabled={busy} onClick={() => { setSettings(s => ({ ...s, provider: id })); setResult(null); setError(''); }}>{label}</button>)}</div>
        <div className="model-row"><Field label="Model"><select aria-label="Model" value={models.some(m => m.id === modelId) ? modelId : ''} onChange={e => { setSettings(s => ({ ...s, models: { ...s.models, [provider]: e.target.value } })); setResult(null); setError(''); }} disabled={busy || loadingModels || models.length === 0}>
          {(loadingModels || models.length === 0) && <option value="">{loadingModels ? 'Loading models…' : 'No models available'}</option>}
          {models.map(m => <option key={m.id} value={m.id}>{m.name}{m.supportsImages === true ? ' · images' : m.supportsImages === false ? ' · text' : ''}</option>)}
        </select></Field><IconButton title="Refresh models" disabled={busy || loadingModels} onClick={() => setRefreshNonce(n => n + 1)}><RefreshCw size={16} className={loadingModels ? 'spin' : ''} /></IconButton></div>
        <div className="model-caption">{selectedModel ? <><span>{selectedModel.supportsImages === true ? 'Text + images' : selectedModel.supportsImages === false ? 'Text only' : 'Image support not advertised'}</span>{provider === 'llama' && <span title={settings.llamaBaseUrl}>{hostLabel(settings.llamaBaseUrl)}</span>}</> : <span>{provider === 'llama' ? 'Your Tailscale models' : 'Decision models'}</span>}</div>
        {modelError && <p className="error" role="alert">{modelError} <button className="text-button" onClick={() => setModal({ kind: 'settings' })}>Settings</button></p>}
        {!keyAvailable && <p className="hint">This provider needs a key. <button className="text-button" onClick={() => setModal({ kind: 'settings' })}>Add in Settings</button></p>}
      </section>

      <div className="workspace">
        <section className="input-section" aria-labelledby="input-title">
          <div className="section-heading"><h2 id="input-title">Input</h2><button className="quiet-button" onClick={clearInput} disabled={busy || imageBusy || !imagesReady || (!text && !images.length)}><X size={14} />Clear input</button></div>
          <Field multiline className="prompt-field"><textarea aria-label="Input text to evaluate" value={text} onChange={e => changeInput(e.target.value)} placeholder="Paste the text you want the questions to evaluate. Or add images below." disabled={busy} onPaste={e => { const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); addImages(files); } }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addImages(Array.from(e.dataTransfer.files)); }} /></Field>
          <div className="input-toolbar"><button onClick={() => fileRef.current?.click()} disabled={busy || imageBusy || !imagesReady}>{imageBusy ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />}{imageBusy ? 'Preparing…' : 'Add images'}</button><span>{images.length ? `${images.length} image${images.length === 1 ? '' : 's'}` : 'Text, images, or both'}</span><input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => addImages(Array.from(e.target.files))} /></div>
          {images.length > 0 && <div className="image-list">{images.map(image => <figure key={image.id}><img src={image.dataUrl} alt={image.name} /><IconButton title={`Remove ${image.name}`} disabled={busy || imageBusy} onClick={() => removeImage(image.id)}><X size={14} /></IconButton><figcaption title={image.name}>{image.name}</figcaption></figure>)}</div>}
          {imagesUnsupported && <p className="error">This model is text-only. Choose a model with images or remove the images.</p>}
          <div className="run-panel"><button className={`run-button ${busy ? 'cancel-button' : 'primary'}`} onClick={busy ? () => abortRef.current?.abort() : run} disabled={!busy && (loadingModels || !modelId || imageBusy || !imagesReady || !questions.length || (!text.trim() && !images.length) || imagesUnsupported || !keyAvailable)}>{busy ? <LoaderCircle size={16} className="spin" /> : <Play size={15} fill="currentColor" />}{busy ? 'Cancel evaluation' : `Evaluate${questions.length ? ` ${questions.length} question${questions.length === 1 ? '' : 's'}` : ''}`}</button>
            <p className="hint">{busy ? 'Waiting for the model. A local model may need time to load.' : 'Answers appear with their questions.'}</p>
          </div>
          {error && <div className="error-block" role="alert"><p>{error}</p><IconButton title="Dismiss error" onClick={() => setError('')}><X size={15} /></IconButton></div>}
          {result && <div className="run-info"><span>{(result.elapsedMs / 1000).toFixed(2)}s · {result.model}</span>{typeof result.usage?.input_tokens === 'number' && <span>{result.usage.input_tokens.toLocaleString()} input tokens{typeof result.usage.cost === 'number' ? ` · $${result.usage.cost.toFixed(6)}` : ''}</span>}<details className="raw-response"><summary>Raw response <ChevronDown size={13} /></summary><pre>{JSON.stringify(result.raw, null, 2)}</pre></details></div>}
        </section>

        <section className="questions-section" aria-labelledby="questions-title">
          <div className="section-heading"><h2 id="questions-title">Questions <span>{questions.length}</span></h2><button className="quiet-button" disabled={busy || !questions.length} onClick={() => setModal({ kind: 'set', name: setInfo.name || '', savedId: selectedSetExists ? setInfo.id : undefined })}><Save size={14} />Save set</button></div>
          <div className="set-toolbar"><Field><select aria-label="Load question set" value={setValue} disabled={busy} onChange={e => { if (e.target.value === 'draft') return; loadSet(library.sets.find(s => s.id === e.target.value)); }}><option value="">None — empty set</option>{questions.length > 0 && !selectedSetExists && <option value="draft">{setInfo.name ? `${setInfo.name} · unsaved` : 'Unsaved set'}</option>}{sortedSets.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></Field>{setInfo.dirty && selectedSetExists && <span className="edited-label">Edited</span>}</div>
          {questions.length === 0 && <div className="empty-questions"><CircleDot size={23} /><p>Add the questions you want to ask.</p><span>Mix yes/no checks, choices, and ordered scales.</span></div>}
          <div className="question-list">{questions.map(q => <Question key={q.id} question={q} answer={answerMap.get(q.id)} expanded={!!expanded[q.id]} onExpand={open => setExpanded(state => state[q.id] === open ? state : { ...state, [q.id]: open })} onChange={patch => changeQuestion(q.id, patch)} onSave={() => setModal({ kind: 'question', questionId: q.id, name: q.name, savedId: library.questions.some(s => s.id === q.savedId) ? q.savedId : undefined })} onRemove={() => { setQuestions(qs => qs.filter(item => item.id !== q.id)); edited(); }} disabled={busy} />)}</div>
          <div className="add-question"><Field label="Question type"><select value={addType} onChange={e => { setAddType(e.target.value); setAddTemplate('new'); }} disabled={busy}>{Object.entries(TYPE_NAMES).map(([type, name]) => <option value={type} key={type}>{name}</option>)}</select></Field><Field label="Start with"><select value={templates.some(t => t.id === addTemplate) ? addTemplate : 'new'} onChange={e => setAddTemplate(e.target.value)} disabled={busy}><option value="new">Create new</option>{templates.map(q => <option value={q.id} key={q.id}>{q.name}</option>)}</select></Field><button className="add-button" disabled={busy || questions.length >= 200} onClick={() => addQuestion(templates.find(q => q.id === addTemplate))}><Plus size={17} /><span>Add</span></button></div>
        </section>
      </div>
    </main>
    <footer className="app-footer"><span>Questions are reusable. Input is yours.</span><span>Saved library on server · Last input in browser</span></footer>
    {notice && <div className="toast" role="status"><Check size={15} />{notice}</div>}
    {modal?.kind === 'settings' && <SettingsDialog settings={settings} serverConfig={serverConfig} onClose={() => setModal(null)} onSave={value => { setSettings(value); setResult(null); setNotice('Settings saved in this browser.'); }} />}
    {modal?.kind === 'library' && <LibraryDialog library={library} disabled={busy} onClose={() => setModal(null)} onAdd={addQuestion} onLoad={loadSet} onDelete={deleteSaved} />}
    {['question', 'set'].includes(modal?.kind) && <SaveDialog target={modal} onClose={() => setModal(null)} onSave={saveTarget} />}
  </div>;
}
