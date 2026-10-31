import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Pencil, Save, Trash2, X } from 'lucide-react';
import { pct, TYPE_NAMES, option, errorMessage } from './shared.js';

export function Field({ label, children, className = '', multiline = false }) {
  return <label className={`field-label ${className}`}>
    {label && <span className="label-text">{label}</span>}
    <span className={`field ${multiline ? 'multiline' : ''}`}>{children}</span>
  </label>;
}
export function IconButton({ title, children, ...props }) {
  return <button type="button" className="icon-button" title={title} aria-label={title} {...props}>{children}</button>;
}
export function Modal({ title, children, onClose }) {
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

export function SaveDialog({ target, onClose, onSave }) {
  const [name, setName] = useState(target.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save(copy = false) {
    setSaving(true); setError('');
    try { await onSave(name.trim(), copy); onClose(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setSaving(false); }
  }
  const workspace = target.kind === 'workspace';
  return <Modal title={workspace ? 'Save / Share workspace' : target.kind === 'set' ? 'Save question set' : 'Save question'} onClose={() => { if (!saving) onClose(); }}>
    <form onSubmit={e => { e.preventDefault(); save(); }}>
      <Field label={workspace ? 'Workspace name' : target.kind === 'set' ? 'Set name' : 'Question name'}><input autoFocus required value={name} onChange={e => setName(e.target.value)} disabled={saving} /></Field>
      <p className="hint">{workspace ? 'Protects this workspace from cleanup. Reopen it by name or link in your other chats and devices.' : target.kind === 'set' ? 'Saves the current questions as a reusable set.' : 'Reuse this question in any set.'}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        {target.savedId && !workspace && <button type="button" onClick={() => save(true)} disabled={!name.trim() || saving}>Save a copy</button>}
        <button className="primary" disabled={!name.trim() || saving}>{saving ? 'Saving…' : target.savedId ? 'Update saved' : 'Save'}</button>
      </div>
    </form>
  </Modal>;
}

export function SettingsDialog({ settings, serverConfig, onClose, onSave, onSaveDefault }) {
  const [draft, setDraft] = useState({ ...settings, keys: { ...settings.keys } });
  const [defaultStatus, setDefaultStatus] = useState('');
  const [savingDefault, setSavingDefault] = useState(false);
  return <Modal title="Settings" onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); onSave({ ...draft, llamaBaseUrl: draft.llamaBaseUrl.trim(), keys: { openai: draft.keys.openai.trim(), openrouter: draft.keys.openrouter.trim() } }); onClose(); }}>
      <Field label="Custom base URL (llama.cpp)"><input type="url" value={draft.llamaBaseUrl} placeholder={serverConfig?.llamaBaseUrl} onChange={e => setDraft({ ...draft, llamaBaseUrl: e.target.value })} autoCapitalize="none" spellCheck={false} /></Field>
      <p className="hint">Include /v1. Leave blank to use the server’s CUSTOM_BASE_URL. No API key is sent to this endpoint.</p>
      {['openrouter', 'openai'].map(provider => <div className="setting-key" key={provider}>
        <Field label={`${provider === 'openai' ? 'OpenAI' : 'OpenRouter'} API key`}><input type="password" value={draft.keys[provider]} onChange={e => setDraft({ ...draft, keys: { ...draft.keys, [provider]: e.target.value } })} placeholder={serverConfig?.keys[provider] ? 'Using server .env key' : 'Enter a key'} autoCapitalize="none" autoComplete="off" spellCheck={false} /></Field>
        <p className="hint">{serverConfig?.keys[provider] ? 'A key is available from .env. Leave blank to use it.' : 'Optional until you use this provider.'}</p>
      </div>)}
      <p className="hint">Keys entered here are saved in this browser. Server .env keys are kept on the server.</p>
      {onSaveDefault && <div className="server-default-setting">
        <p className="hint">Server default: {serverConfig?.defaults?.model || 'Not set'}</p>
        <button type="button" disabled={savingDefault || !settings.models[settings.provider]} onClick={async () => {
          setSavingDefault(true); setDefaultStatus('');
          try { await onSaveDefault({ provider: settings.provider, model: settings.models[settings.provider] }); setDefaultStatus('Server default saved.'); }
          catch (error) { setDefaultStatus(errorMessage(error)); }
          finally { setSavingDefault(false); }
        }}>{savingDefault ? 'Saving…' : 'Use current model as server default'}</button>
        {defaultStatus && <p className="hint" role="status">{defaultStatus}</p>}
      </div>}
      <div className="modal-actions"><button className="primary">Save settings</button></div>
    </form>
  </Modal>;
}

export function CriteriaEditor({ items, onChange, scale, disabled }) {
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

export function Answer({ answer, showDistribution = false }) {
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
      {(answer.probabilities.length > 0 || answer.confidence !== undefined) && <details className="distribution" open={showDistribution || undefined}>
        <summary>Probabilities{answer.confidence !== undefined && <span>Confidence {pct(answer.confidence)}</span>}<ChevronDown size={13} /></summary>
        <div className="distribution-list">{answer.probabilities.map((item, i) => <div className="distribution-row" key={`${item.label}-${i}`}>
          <span>{answer.type === 'score' ? `${item.index} · ` : ''}{item.label}</span><span className="distribution-bar"><i style={{ width: pct(item.probability) }} /></span><b>{pct(item.probability)}</b>
        </div>)}</div>
      </details>}
    </>}
  </div>;
}

export function Question({ question: q, answer, expanded, onExpand, onChange, onSave, onRemove, disabled }) {
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

export function LibraryDialog({ library, onClose, onAdd, onLoad, onDelete, onRename, disabled }) {
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [renaming, setRenaming] = useState(null);
  async function remove(kind, item) {
    setDeleting(item.id); setError('');
    try { await onDelete(kind, item); setConfirmation(null); } catch (error) { setError(errorMessage(error)); }
    finally { setDeleting(''); }
  }
  return <Modal title="Saved library" onClose={onClose}>
    {error && <p className="error" role="alert">{error}</p>}
    {confirmation && <div className="inline-confirm"><p>Delete “{confirmation.item.name}”?{confirmation.kind === 'questions' ? ' Sets keep their copies.' : ''}</p><div><button disabled={!!deleting} onClick={() => setConfirmation(null)}>Cancel</button><button disabled={!!deleting} onClick={() => remove(confirmation.kind, confirmation.item)}>Delete</button></div></div>}
    {renaming && <form className="inline-rename" onSubmit={async event => {
      event.preventDefault(); setError(''); setDeleting(renaming.item.id);
      try { await onRename(renaming.kind, renaming.item, renaming.name); setRenaming(null); }
      catch (error) { setError(errorMessage(error)); }
      finally { setDeleting(''); }
    }}><Field label="New name"><input autoFocus required value={renaming.name} onChange={event => setRenaming(current => ({ ...current, name: event.target.value }))} /></Field><button type="button" onClick={() => setRenaming(null)} disabled={!!deleting}>Cancel</button><button disabled={!!deleting}>Rename</button></form>}
    <h3>Question sets <span>{library.sets.length}</span></h3>
    {library.sets.length === 0 && <p className="hint library-empty">Save a set to load all its questions together.</p>}
    {library.sets.map(item => <div className="library-row" key={item.id}><div><strong>{item.name}</strong><span>{item.questions.length} questions</span></div><button disabled={disabled || !!deleting} onClick={() => { onLoad(item); onClose(); }}>Load</button>{onRename && <IconButton title={`Rename ${item.name}`} disabled={disabled || !!deleting} onClick={() => { setConfirmation(null); setRenaming({ kind: 'sets', item, name: item.name }); }}><Pencil size={14} /></IconButton>}<IconButton title={`Delete ${item.name}`} disabled={disabled || !!deleting} onClick={() => { setRenaming(null); setConfirmation({ kind: 'sets', item }); }}><Trash2 size={15} /></IconButton></div>)}
    <h3>Individual questions <span>{library.questions.length}</span></h3>
    {library.questions.length === 0 && <p className="hint library-empty">Use the save icon beside a question to reuse it on its own.</p>}
    {library.questions.map(item => <div className="library-row" key={item.id}><div><strong>{item.name}</strong><span>{TYPE_NAMES[item.type]} · {item.instructions}</span></div><button disabled={disabled || !!deleting} onClick={() => onAdd(item)}>Add</button>{onRename && <IconButton title={`Rename ${item.name}`} disabled={disabled || !!deleting} onClick={() => { setConfirmation(null); setRenaming({ kind: 'questions', item, name: item.name }); }}><Pencil size={14} /></IconButton>}<IconButton title={`Delete ${item.name}`} disabled={disabled || !!deleting} onClick={() => { setRenaming(null); setConfirmation({ kind: 'questions', item }); }}><Trash2 size={15} /></IconButton></div>)}
  </Modal>;
}
