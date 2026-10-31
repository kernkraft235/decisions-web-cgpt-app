export const TYPE_NAMES = { noul: 'Yes / no', choice: 'Choice', score: 'Scale' };
export const newId = () => crypto.randomUUID();
export const option = (label = '') => ({ id: newId(), label, description: '' });
export const instantiate = q => ({ ...q, id: newId(), savedId: q.savedId || q.id, choices: q.choices?.map(c => ({ ...c })) || [], levels: q.levels?.map(l => ({ ...l })) || [] });
export function freshQuestion(type, count) {
  return { id: newId(), type, name: `${TYPE_NAMES[type]} ${count + 1}`, instructions: '', trueDescription: '', falseDescription: '', choices: [option('A'), option('B')], levels: [option('Low'), option('Medium'), option('High')] };
}
export function errorMessage(error) {
  return error.issues?.map(i => i.message).join(' ') || error.message || 'Something went wrong.';
}
export async function api(url, { key, ...options } = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'X-Provider-Key': key } : {}) },
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The app server did not return JSON. Check that it is running.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { code: data.code, details: data.details, status: response.status });
  return data;
}
export const pct = value => `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`;
export function hostLabel(url) { try { return new URL(url).hostname; } catch { return url; } }
