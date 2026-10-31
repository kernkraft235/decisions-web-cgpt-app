import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { JSONFilePreset } from 'lowdb/node';
import { z } from 'zod';
import { questionSchema, questionListSchema, draftQuestionListSchema } from './schema.js';
import { OPENAI_MODEL } from './providers.js';
import { AppError, checkRevision, nameKey, serialQueue } from './errors.js';

export const providerSchema = z.enum(['llama', 'openrouter', 'openai']);
export const defaultsSchema = z.object({ provider: providerSchema, model: z.string().trim().min(1, 'Choose a model first.') });
const clone = value => structuredClone(value);
const itemSummary = item => ({
  id: item.id, name: item.name, revision: item.revision || 0, updatedAt: item.updatedAt,
  ...(item.questions ? { questionCount: item.questions.length } : { type: item.type === 'noul' ? 'predicate' : item.type }),
});

export function normalizeQuestions(questions, { draft = false, instantiate = false } = {}) {
  const normalized = questions.map((question, index) => {
    const q = {
      ...question,
      id: instantiate ? randomUUID() : question.id || randomUUID(),
      name: draft ? question.name ?? `Question ${index + 1}` : question.name || `Question ${index + 1}`,
      type: question.type === 'predicate' ? 'noul' : question.type,
      instructions: question.instructions ?? question.question ?? '',
      choices: (question.choices || []).map(choice => typeof choice === 'string' ? { label: choice, description: '' } : { ...choice, label: choice.label ?? choice.value ?? '' }),
      levels: (question.levels || []).map(level => typeof level === 'string' ? { label: level, description: '' } : level),
    };
    if (instantiate) q.savedId = question.savedId || question.id;
    return q;
  });
  return (draft ? draftQuestionListSchema : questionListSchema).parse(normalized);
}

export async function createLibrary(dataDir) {
  const db = await JSONFilePreset(path.join(dataDir, 'library.json'), { questions: [], sets: [] });
  const enqueue = serialQueue();
  const defaults = () => clone(db.data.defaults || { provider: 'llama', model: '' });
  const collection = kind => {
    if (!['questions', 'sets'].includes(kind)) throw new AppError('Choose questions or sets.');
    return db.data[kind];
  };
  function find(kind, { id, name } = {}) {
    const items = collection(kind);
    if (!id && !name) throw new AppError('Provide an ID or name.');
    if (id && name) throw new AppError('Provide an ID or name, not both.');
    const matches = items.filter(item => id ? item.id === id : nameKey(item.name) === nameKey(name));
    if (!matches.length) throw new AppError('No saved item has that ID or name.', 404, 'NOT_FOUND');
    if (matches.length > 1) throw new AppError('More than one item has that name. Use an ID.', 409, 'AMBIGUOUS_NAME');
    return clone({ ...matches[0], revision: matches[0].revision || 0 });
  }
  function unique(kind, name, exceptId) {
    if (collection(kind).some(item => item.id !== exceptId && nameKey(item.name) === nameKey(name))) {
      throw new AppError('That name is already in use. Choose another name or explicitly update the existing item.', 409, 'NAME_CONFLICT');
    }
  }
  async function put(kind, item, { id, expectedRevision } = {}) {
    return enqueue(async () => {
      const previous = id ? find(kind, { id }) : null;
      if (previous) checkRevision(previous, expectedRevision);
      unique(kind, item.name, id);
      const saved = { ...clone(item), id: previous?.id || randomUUID(), revision: (previous?.revision || 0) + 1, updatedAt: new Date().toISOString() };
      delete saved.savedId;
      await db.update(data => {
        const index = data[kind].findIndex(entry => entry.id === saved.id);
        if (index < 0) data[kind].push(saved); else data[kind][index] = saved;
      });
      return clone(saved);
    });
  }
  const library = {
    all: () => ({ questions: db.data.questions.map(item => ({ ...clone(item), revision: item.revision || 0 })), sets: db.data.sets.map(item => ({ ...clone(item), revision: item.revision || 0 })) }),
    list: ({ kind, query = '' } = {}) => Object.fromEntries((kind ? [kind] : ['questions', 'sets']).map(key => [key,
      collection(key).filter(item => !query || nameKey(item.name).includes(nameKey(query))).map(itemSummary).sort((a, b) => a.name.localeCompare(b.name)),
    ])),
    find,
    defaults,
    async saveDefaults(input) {
      const saved = defaultsSchema.parse(input);
      if (saved.provider === 'openai' && saved.model !== OPENAI_MODEL) throw new AppError(`OpenAI Decisions uses ${OPENAI_MODEL}.`);
      return enqueue(async () => { await db.update(data => { data.defaults = saved; }); return clone(saved); });
    },
    async saveQuestion({ id, question, expectedRevision }) {
      const normalized = normalizeQuestions([question])[0];
      questionSchema.parse(normalized);
      return put('questions', normalized, { id, expectedRevision });
    },
    async saveSet({ id, name, questions, questionNames, expectedRevision }) {
      const parsedName = z.string().trim().min(1, 'Name this set.').max(200).parse(name);
      if (questions && questionNames) throw new AppError('Use inline questions or saved question names, not both.');
      const snapshots = questionNames ? questionNames.map(questionName => find('questions', { name: questionName })) : questions;
      if (!snapshots) throw new AppError('Supply the questions for this set.');
      return put('sets', { name: parsedName, questions: normalizeQuestions(snapshots, { instantiate: true }) }, { id, expectedRevision });
    },
    async rename(kind, ref, newName, expectedRevision) {
      const name = z.string().trim().min(1, 'Enter a name.').max(200).parse(newName);
      return enqueue(async () => {
        const item = find(kind, ref);
        checkRevision(item, expectedRevision);
        unique(kind, name, item.id);
        const saved = { ...item, name, revision: item.revision + 1, updatedAt: new Date().toISOString() };
        await db.update(data => { data[kind][data[kind].findIndex(entry => entry.id === item.id)] = saved; });
        return clone(saved);
      });
    },
    async remove(kind, ref, expectedRevision) {
      return enqueue(async () => {
        const item = find(kind, ref);
        checkRevision(item, expectedRevision);
        await db.update(data => { data[kind] = data[kind].filter(entry => entry.id !== item.id); });
        return { id: item.id, name: item.name, deleted: true };
      });
    },
    select(input, { draft = false } = {}) {
      const selectors = ['setName', 'questionNames', 'questions'].filter(key => input[key] != null);
      if (selectors.length > 1) throw new AppError('Choose one of setName, questionNames, or questions.');
      if (!selectors.length) return undefined;
      let source;
      if (input.setName != null) source = find('sets', { name: input.setName }).questions;
      else if (input.questionNames != null) {
        z.array(z.string().trim().min(1)).min(1).max(200).parse(input.questionNames);
        if (new Set(input.questionNames.map(nameKey)).size !== input.questionNames.length) throw new AppError('List each saved question once.');
        source = input.questionNames.map(name => find('questions', { name }));
      } else source = input.questions;
      return normalizeQuestions(source, { draft, instantiate: input.questions == null });
    },
  };
  return library;
}
