import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const platforms = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const architectures = { arm64: 'arm64', x64: 'amd64' };
const platform = platforms[process.platform];
const architecture = architectures[process.arch];
if (!platform || !architecture) throw new Error('Install an official OpenAI tunnel-client for this platform and set TUNNEL_CLIENT_BIN.');
const response = await fetch('https://api.github.com/repos/openai/tunnel-client/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error(`Official tunnel-client release lookup failed (HTTP ${response.status}).`);
const release = await response.json();
const asset = release.assets.find(item => item.name === `tunnel-client-${release.tag_name}-${platform}-${architecture}.zip`);
if (!asset || asset.size > 64 * 1024 * 1024 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') || !asset.browser_download_url.startsWith('https://github.com/openai/tunnel-client/releases/download/')) throw new Error('The official release has no supported, checksummed archive for this platform.');
console.log(`Downloading official tunnel-client ${release.tag_name} for ${platform}/${architecture} (${(asset.size / 1024 / 1024).toFixed(1)} MiB).`);
const downloaded = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(60000) });
if (!downloaded.ok) throw new Error(`Official tunnel-client download failed (HTTP ${downloaded.status}).`);
const bytes = Buffer.from(await downloaded.arrayBuffer());
const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
if (bytes.length !== asset.size || digest !== asset.digest) throw new Error('The tunnel-client archive checksum did not match. Nothing was installed.');
const directory = path.join(root, 'data/bin');
await mkdir(directory, { recursive: true, mode: 0o700 });
const stage = await mkdtemp(path.join(directory, '.tunnel-update-'));
const executable = process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client';
try {
  const archive = path.join(stage, 'client.zip');
  const binary = path.join(stage, executable);
  await writeFile(archive, bytes, { mode: 0o600 });
  const extract = `import os, pathlib, shutil, stat, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    entries = [item for item in archive.infolist() if pathlib.PurePosixPath(item.filename).name == sys.argv[3] and not item.is_dir()]
    if len(entries) != 1 or entries[0].file_size > 128 * 1024 * 1024:
        raise SystemExit('The official archive did not contain one supported client executable.')
    item = entries[0]
    mode = item.external_attr >> 16
    if stat.S_ISLNK(mode):
        raise SystemExit('The executable must not be a symlink.')
    with archive.open(item) as source, open(sys.argv[2], 'xb') as target:
        shutil.copyfileobj(source, target, 1024 * 1024)
    os.chmod(sys.argv[2], 0o700)
`;
  await promisify(execFile)('python3', ['-c', extract, archive, binary, executable], { timeout: 30000 });
  const version = await promisify(execFile)(binary, ['--version'], { timeout: 10000 });
  await rename(binary, path.join(directory, executable));
  await writeFile(path.join(directory, 'tunnel-client-release.json'), `${JSON.stringify({ version: release.tag_name, asset: asset.name, sha256: digest, source: asset.browser_download_url }, null, 2)}\n`, { mode: 0o600 });
  console.log(`Installed project-local ${version.stdout.trim()}.`);
} finally { await rm(stage, { recursive: true, force: true }); }
