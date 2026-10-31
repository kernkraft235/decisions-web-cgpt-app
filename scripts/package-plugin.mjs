import dotenv from 'dotenv';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const tunnelId = process.env.OPENAI_TUNNEL_ID?.trim();
if (!/^tunnel_[a-z0-9]{32}$/.test(tunnelId || '')) throw new Error('Set a valid OPENAI_TUNNEL_ID in .env before packaging the private plugin.');
const data = path.join(root, 'data');
await mkdir(data, { recursive: true, mode: 0o700 });
const stage = await mkdtemp(path.join(data, '.plugin-package-'));
const archive = path.join(data, 'jev-decisions-plugin.tar.gz');
try {
  await cp(path.join(root, 'plugins/jev-decisions'), stage, { recursive: true });
  const mcp = JSON.parse(await readFile(path.join(stage, 'mcp.json'), 'utf8'));
  mcp.mcpServers['jev-decisions'] = {
    type: 'streamable-http',
    extensions: { 'com.openai': { tunnelId, auth: { type: 'none' } } },
  };
  await writeFile(path.join(stage, 'mcp.json'), `${JSON.stringify(mcp, null, 2)}\n`, { mode: 0o600 });
  await promisify(execFile)('tar', ['--exclude=._*', '--exclude=*/._*', '-czf', archive, '-C', stage, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  await chmod(archive, 0o600);
  console.log(`Private plugin package: ${archive}`);
} finally { await rm(stage, { recursive: true, force: true }); }
