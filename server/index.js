import express from 'express';
import dotenv from 'dotenv';
import { JSONFilePreset } from 'lowdb/node';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { evaluationSchema, questionSchema, questionListSchema } from './schema.js';
import { llamaBaseUrl, OPENAI_MODEL, providerKey, listModels, buildRequest, fetchJson, normalizeAnswers } from './providers.js';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(root, '.env'), quiet: true });
await mkdir(path.join(root, 'data'), { recursive: true });
const db = await JSONFilePreset(path.join(root, 'data/library.json'), { questions: [], sets: [] });
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '48mb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/config', (req, res) => res.json({
  llamaBaseUrl: llamaBaseUrl(),
  openaiModel: OPENAI_MODEL,
  keys: { openai: Boolean(providerKey('openai')), openrouter: Boolean(providerKey('openrouter')) },
}));
app.get('/api/library', (req, res) => res.json(db.data));

app.post('/api/questions', async (req, res) => {
  const { id, question } = z.object({ id: z.string().optional(), question: questionSchema }).parse(req.body);
  const saved = { ...question, id: id || randomUUID(), updatedAt: new Date().toISOString() };
  delete saved.savedId;
  await db.update(data => {
    const index = data.questions.findIndex(q => q.id === saved.id);
    if (index < 0) data.questions.push(saved); else data.questions[index] = saved;
  });
  res.json(saved);
});
app.post('/api/sets', async (req, res) => {
  const input = z.object({ id: z.string().optional(), name: z.string().trim().min(1, 'Name this set.'), questions: questionListSchema }).parse(req.body);
  const saved = { ...input, id: input.id || randomUUID(), updatedAt: new Date().toISOString() };
  await db.update(data => {
    const index = data.sets.findIndex(s => s.id === saved.id);
    if (index < 0) data.sets.push(saved); else data.sets[index] = saved;
  });
  res.json(saved);
});
app.delete('/api/:kind/:id', async (req, res) => {
  const kind = z.enum(['questions', 'sets']).parse(req.params.kind);
  await db.update(data => { data[kind] = data[kind].filter(item => item.id !== req.params.id); });
  res.json({ ok: true });
});

app.get('/api/models', async (req, res) => {
  const provider = z.enum(['llama', 'openrouter', 'openai']).parse(req.query.provider);
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const models = await listModels(provider, req.query.baseUrl, providerKey(provider, req.get('X-Provider-Key')), AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]));
  res.json({ models });
});
app.post('/api/evaluate', async (req, res) => {
  const request = evaluationSchema.parse(req.body);
  const key = providerKey(request.provider, req.get('X-Provider-Key'));
  if (request.provider !== 'llama' && !key) return res.status(400).json({ error: 'Add an API key in Settings or .env first.' });
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const { url, body } = buildRequest(request);
  const started = performance.now();
  const data = await fetchJson(url, { method: 'POST', body: JSON.stringify(body), key, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]) });
  res.json({
    answers: normalizeAnswers(data, request.questions, request.provider),
    model: data.model || request.model,
    elapsedMs: Math.round(performance.now() - started),
    usage: data.usage,
    raw: data,
  });
});
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

if (process.argv.includes('--dev')) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(root, 'dist')));
  app.use((req, res) => res.sendFile(path.join(root, 'dist/index.html')));
}
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const message = error instanceof z.ZodError ? error.issues.map(i => i.message).join(' ') :
    error.name === 'TimeoutError' ? 'The provider timed out. Local models may need more time to load; try again.' :
    error.name === 'AbortError' ? 'Request cancelled.' : error.type === 'entity.too.large' ? 'The images are too large for one request.' : error.message || 'Request failed.';
  res.status(error instanceof z.ZodError ? 400 : (error.status >= 400 && error.status <= 599 ? error.status : 502)).json({ error: message });
});

const server = createServer(app);
const host = process.env.HOST?.trim() || '127.0.0.1';
const port = process.env.PORT?.trim();
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && !port) server.listen(0, host);
  else { console.error(`Could not start: ${error.message}`); process.exit(1); }
});
server.on('listening', () => {
  const address = server.address();
  const displayHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  console.log(`Decisions is running at http://${displayHost}:${address.port}`);
});
server.listen(Number(port || 4379), host);
