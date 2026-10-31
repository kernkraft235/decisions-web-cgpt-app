import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const doctor = process.argv.includes('--doctor');
const secrets = ['OPENAI_TUNNEL_ID', 'CONTROL_PLANE_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'].map(name => process.env[name]?.trim()).filter(Boolean);
const redact = text => secrets.reduce((value, secret) => value.replaceAll(secret, '[redacted]'), String(text));

try {
  const tunnelId = process.env.OPENAI_TUNNEL_ID?.trim();
  const credential = process.env.CONTROL_PLANE_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!tunnelId) throw new Error('Set OPENAI_TUNNEL_ID in .env to your existing Secure MCP Tunnel ID.');
  if (!credential) throw new Error('Set CONTROL_PLANE_API_KEY or OPENAI_API_KEY in .env for the tunnel runtime.');
  const port = process.env.PORT?.trim() || '4379';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Use a fixed PORT from 1 to 65535 for the tunnel.');
  const host = process.env.HOST?.trim() || '127.0.0.1';
  const localHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
  const origin = `http://${localHost}:${port}`;
  let response;
  try { response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3000) }); }
  catch { throw new Error('Start Decisions with npm start first, using the same fixed PORT as the tunnel.'); }
  const health = await response.json();
  if (!response.ok || health.app !== 'jev-decisions' || health.mcp !== '/mcp') throw new Error('The configured port is not serving this version of Decisions. Restart the app or select a different fixed PORT.');
  const healthFile = path.join(root, 'data/tunnel-health-url');
  await mkdir(path.join(root, 'data'), { recursive: true, mode: 0o700 });
  if (!doctor) {
    try {
      const existing = (await readFile(healthFile, 'utf8')).trim();
      const url = new URL(existing);
      if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        const active = await fetch(`${url.origin}/healthz`, { signal: AbortSignal.timeout(1000) });
        if (active.ok && (await active.text()).trim() === 'live') throw Object.assign(new Error('A Decisions tunnel client is already running.'), { activeTunnel: true });
      }
    } catch (error) { if (error.activeTunnel) throw error; }
  }
  const env = {
    ...process.env,
    CONTROL_PLANE_API_KEY: credential,
    CONTROL_PLANE_TUNNEL_ID: tunnelId,
    CONTROL_PLANE_BASE_URL: 'https://api.openai.com',
    MCP_SERVER_URL: `${origin}/mcp`,
    TUNNEL_CLIENT_PROFILE: '', TUNNEL_CLIENT_PROFILE_FILE: '', TUNNEL_CLIENT_CONFIG: '',
    LOG_HTTP_RAW_UNSAFE: 'false', HARPOON_CAPTURE_PAYLOADS: 'false', LOG_LEVEL: 'warn', LOG_FORMAT: 'struct-text', LOG_FILE: '',
    ALLOW_REMOTE_UI: 'false', OPEN_WEB_UI: 'false', HEALTH_UNIX_SOCKET: '',
  };
  const args = [doctor ? 'doctor' : 'run',
    '--control-plane.api-key', 'env:CONTROL_PLANE_API_KEY',
    '--mcp.server-url', `${origin}/mcp`,
    '--health.listen-addr', '127.0.0.1:0',
    '--health.url-file', healthFile,
    '--log.level', 'warn', '--log.format', 'struct-text', '--log.file', '', '--log.http-raw-unsafe=false', '--harpoon.capture-payloads=false',
    ...(doctor ? ['--explain'] : ['--pid.file', path.join(root, 'data/tunnel.pid')]),
  ];
  const bundled = path.join(root, 'data/bin', process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client');
  const executable = process.env.TUNNEL_CLIENT_BIN?.trim() || (existsSync(bundled) ? bundled : 'tunnel-client');
  const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  function pipe(stream, destination) {
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) destination.write(`${redact(line)}\n`);
    });
    stream.on('end', () => { if (buffered) destination.write(redact(buffered)); });
  }
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  let readiness;
  if (!doctor) {
    console.log('Starting the Decisions tunnel with OPENAI_TUNNEL_ID from .env.');
    readiness = setInterval(async () => {
      try {
        const url = new URL((await readFile(healthFile, 'utf8')).trim());
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return;
        const ready = await fetch(`${url.origin}/readyz`, { signal: AbortSignal.timeout(1000) });
        if (ready.ok) { console.log('Decisions tunnel is ready. Select this existing tunnel when adding the custom MCP server in ChatGPT.'); clearInterval(readiness); }
      } catch {}
    }, 2000);
  }
  child.on('error', error => {
    if (readiness) clearInterval(readiness);
    console.error(error.code === 'ENOENT' ? 'Run npm run tunnel:install, or install OpenAI tunnel-client and set TUNNEL_CLIENT_BIN.' : 'The tunnel client could not start.');
    process.exitCode = 1;
  });
  child.on('exit', code => { if (readiness) clearInterval(readiness); process.exitCode = code || 0; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { if (readiness) clearInterval(readiness); child.kill(signal); });
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
}
