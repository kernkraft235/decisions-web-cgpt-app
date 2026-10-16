export const DEFAULT_CUSTOM_BASE_URL = 'https://llama.ghost-morpho.ts.net/v1';
export const OPENAI_MODEL = 'gpt-6-luna';

export function llamaBaseUrl(value) {
  const url = new URL(value?.trim() || process.env.CUSTOM_BASE_URL?.trim() || DEFAULT_CUSTOM_BASE_URL);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS base URL.');
  return url.href.replace(/\/+$/, '');
}

export function providerKey(provider, browserKey) {
  if (provider === 'llama') return '';
  return browserKey?.trim() || process.env[provider === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY']?.trim() || '';
}

export async function fetchJson(url, { key, signal, ...options } = {}) {
  const response = await fetch(url, {
    ...options,
    signal: signal || AbortSignal.timeout(30000),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw Object.assign(new Error(`The provider returned a non-JSON response (HTTP ${response.status}). Check the endpoint.`), { status: 502 }); }
  if (!response.ok || data.error) {
    const message = data.error?.message || data.error || data.message || `Provider request failed (HTTP ${response.status}).`;
    throw Object.assign(new Error(typeof message === 'string' ? message : JSON.stringify(message)), { status: response.ok ? 502 : response.status });
  }
  return data;
}

export async function listModels(provider, baseUrl, key, signal) {
  if (provider === 'openai') return [{ id: OPENAI_MODEL, name: OPENAI_MODEL, supportsImages: true, nativeDecision: true }];
  const url = provider === 'llama'
    ? `${llamaBaseUrl(baseUrl)}/models`
    : 'https://openrouter.ai/api/v1/models?output_modalities=decisions';
  const data = await fetchJson(url, { key, signal });
  if (!Array.isArray(data.data)) throw new Error('The models endpoint did not return a model list.');
  return data.data
    .filter(m => provider === 'llama' || m.architecture?.output_modalities?.includes('decisions'))
    .map(m => ({
      id: m.id,
      name: provider === 'llama' ? m.id : m.name || m.id,
      supportsImages: m.architecture?.input_modalities ? m.architecture.input_modalities.includes('image') : null,
      nativeDecision: m.architecture?.output_modalities ? m.architecture.output_modalities.includes('decisions') : null,
      contextLength: m.context_length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const questionKey = q => `q_${q.id.replace(/-/g, '')}`;
const levelText = level => level.description ? `${level.label}: ${level.description}` : level.label;

function systemQuestion(q) {
  const result = { type: q.type, instructions: q.instructions };
  if (q.type === 'choice') result.criteria = Object.fromEntries(q.choices.map(c => [c.label, c.description || null]));
  if (q.type === 'score') result.criteria = q.levels.map(levelText);
  if (q.type === 'noul' && (q.trueDescription || q.falseDescription)) {
    result.criteria = { true: q.trueDescription || 'The condition in the question is true.', false: q.falseDescription || 'The condition in the question is false.' };
  }
  return result;
}

function openaiQuestion(q) {
  let instructions = q.instructions;
  if (q.type === 'noul') {
    if (q.trueDescription) instructions += `\nYes means: ${q.trueDescription}`;
    if (q.falseDescription) instructions += `\nNo means: ${q.falseDescription}`;
  }
  const result = { name: questionKey(q), type: q.type === 'noul' ? 'predicate' : q.type, instructions };
  if (q.type === 'choice') result.choices = q.choices.map(c => ({ value: c.label, description: c.description || c.label }));
  if (q.type === 'score') result.levels = q.levels.map(l => ({ label: l.label, description: l.description || l.label }));
  return result;
}

export function buildRequest(request) {
  const { provider, model, text, images, questions } = request;
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/decisions',
      body: {
        model: OPENAI_MODEL,
        input: images.length ? [{ role: 'user', content: [
          ...(text ? [{ type: 'input_text', text }] : []),
          ...images.map(image_url => ({ type: 'input_image', image_url })),
        ] }] : text,
        questions: questions.map(openaiQuestion),
      },
    };
  }
  const body = {
    model,
    state: text,
    questions: Object.fromEntries(questions.map(q => [questionKey(q), systemQuestion(q)])),
  };
  if (images.length) {
    if (provider === 'llama') body.images = images;
    else body.state = [
      ...(text ? [text] : []),
      ...images.map(url => ({ type: 'image_url', image_url: { url } })),
    ];
  }
  return { url: provider === 'llama' ? `${llamaBaseUrl(request.baseUrl)}/systemone` : 'https://openrouter.ai/api/alpha/decisions', body };
}

function probability(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }

export function normalizeAnswers(data, questions, provider) {
  return questions.map((q, index) => {
    const key = questionKey(q);
    const answer = Array.isArray(data.answers)
      ? data.answers.find(a => a.name === key) || (data.answers[index]?.name == null ? data.answers[index] : null)
      : data.answers?.[key];
    const result = { id: q.id, type: q.type };
    if (!answer) return { ...result, error: 'No answer was returned for this question.' };
    if (answer.type === 'refusal') return { ...result, refused: true };
    const expectedType = provider === 'openai' && q.type === 'noul' ? 'predicate' : q.type;
    if (answer.type !== expectedType) return { ...result, error: `Unexpected answer type: ${answer.type || 'missing'}.` };
    if (q.type === 'noul') {
      const yes = provider === 'openai' ? answer.probability : answer.noul;
      return probability(yes) ? { ...result, yes, probabilities: [{ label: 'Yes', probability: yes }, { label: 'No', probability: 1 - yes }] }
        : { ...result, error: 'The provider did not return a valid yes probability.' };
    }
    let distributions = [];
    if (Array.isArray(answer.probabilities)) {
      distributions = answer.probabilities.map(p => ({ label: q.type === 'score' ? q.levels[p.value]?.label || p.label || String(p.value) : String(p.value), index: p.value, probability: p.probability }));
    } else if (answer.probabilities && typeof answer.probabilities === 'object') {
      distributions = Object.entries(answer.probabilities).map(([value, p]) => ({ label: q.type === 'score' ? q.levels[Number(value)]?.label || String(value) : value, index: q.type === 'score' ? Number(value) : value, probability: p }));
    }
    if (distributions.some(p => !probability(p.probability))) return { ...result, error: 'The provider returned an invalid probability distribution.' };
    if (q.type === 'choice' && !q.choices.some(c => c.label === answer.choice)) return { ...result, error: 'The provider returned a choice outside this question’s options.' };
    if (q.type === 'score' && (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > q.levels.length - 1)) return { ...result, error: 'The provider returned an invalid scale score.' };
    return {
      ...result,
      ...(q.type === 'choice' ? { choice: answer.choice } : { score: answer.score, max: q.levels.length - 1 }),
      ...(probability(answer.confidence) ? { confidence: answer.confidence } : {}),
      probabilities: distributions,
    };
  });
}
