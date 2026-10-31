import express from 'express';
import dotenv from 'dotenv';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { createServices } from './services.js';
import { createTools } from './tools.js';
import { createMcpHandler } from './mcp.js';
import { errorInfo } from './errors.js';
import { MAX_FILE_BYTES, readAssetFile } from './assets.js';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const dataDir = path.join(root, 'data');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const services = await createServices(dataDir);
const tools = createTools(services);
const app = express();
app.disable('x-powered-by');
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(['/api', '/mcp'], (req, res, next) => {
  const origin = req.get('Origin');
  const ownOrigin = `${req.protocol}://${req.get('Host')}`;
  if (origin && ![ownOrigin, services.config().frontendBaseUrl, 'https://chatgpt.com', 'https://chat.openai.com'].includes(origin)) return res.status(403).json({ error: 'This origin is not allowed.' });
  next();
});

app.post('/api/workspaces/:id/assets', express.raw({ type: () => true, limit: MAX_FILE_BYTES, inflate: false }), async (req, res) => {
  const expectedRevision = z.coerce.number().int().nonnegative().parse(req.get('X-Workspace-Revision'));
  const workspace = await services.workspaces.update(req.params.id, { uploads: [{ buffer: req.body, name: req.query.name, mimeType: req.get('X-File-Type') || '' }] }, expectedRevision);
  res.json(await tools.workspaceResult(workspace.id));
});
app.use(express.json({ limit: '48mb', inflate: false }));
app.all('/mcp', createMcpHandler(root, services, tools));

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'jev-decisions', mcp: '/mcp' }));
app.get('/api/config', (req, res) => res.json(services.config()));
app.post('/api/config/defaults', async (req, res) => { await services.library.saveDefaults(req.body); res.json(services.config()); });
app.get('/api/library', (req, res) => res.json(services.library.all()));

app.post('/api/questions', async (req, res) => {
  res.json(await services.library.saveQuestion(req.body));
});
app.post('/api/sets', async (req, res) => {
  res.json(await services.library.saveSet(req.body));
});
app.delete('/api/:kind/:id', async (req, res) => {
  const kind = z.enum(['questions', 'sets']).parse(req.params.kind);
  const expectedRevision = z.coerce.number().int().nonnegative().parse(req.query.revision);
  res.json(await services.library.remove(kind, { id: req.params.id }, expectedRevision));
});

app.post('/api/tools/:name', async (req, res) => {
  res.json(await tools.call(req.params.name, req.body || {}, { key: req.get('X-Provider-Key'), waitMs: req.params.name === 'evaluate' ? 0 : undefined }));
});
app.get('/api/workspaces/:id/assets/:assetId', async (req, res) => {
  const asset = await services.workspaces.asset(req.params.id, req.params.assetId);
  const preview = req.query.preview === '1';
  const buffer = await readAssetFile(services.workspaces.assetsDirectory(req.params.id), preview ? asset.previewFile : asset.originalFile);
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(preview ? 'image/jpeg' : 'application/octet-stream');
  res.set('Content-Disposition', preview ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`);
  res.send(buffer);
});

app.get('/api/models', async (req, res) => {
  const provider = z.enum(['llama', 'openrouter', 'openai']).parse(req.query.provider);
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const models = await services.models(provider, { baseUrl: req.query.baseUrl, key: req.get('X-Provider-Key'), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
  res.json({ models });
});
app.post('/api/evaluate', async (req, res) => {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  res.json(await services.directEvaluation(req.body, { key: req.get('X-Provider-Key'), signal: controller.signal }));
});
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use('/.well-known', (req, res) => res.status(404).json({ error: 'This private server does not use OAuth.' }));

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
  const { status, ...info } = errorInfo(error);
  res.status(status).json(info);
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
  services.setLocalBase(`http://${['0.0.0.0', '::'].includes(address.address) ? '127.0.0.1' : displayHost}:${address.port}`);
  console.log(`Decisions is running at http://${displayHost}:${address.port}`);
});
server.listen(Number(port || 4379), host);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  services.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
});
