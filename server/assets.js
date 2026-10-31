import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AppError } from './errors.js';

const runFile = promisify(execFile);
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const textExtensions = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.html', '.htm', '.yaml', '.yml', '.log', '.js', '.ts', '.jsx', '.tsx', '.py', '.swift', '.c', '.cpp', '.h', '.rs', '.go', '.sh', '.sql']);
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const privateNetworks = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['192.0.2.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) privateNetworks.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]]) privateNetworks.addSubnet(network, prefix, 'ipv6');

export function cleanFileName(value = 'attachment') {
  return String(value).split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200) || 'attachment';
}

function safeAssetPath(directory, filename) {
  if (!filename || path.basename(filename) !== filename || !/^[a-z]+-[a-f0-9]{64}\.[a-z0-9]+$/.test(filename)) throw new AppError('Invalid asset reference.');
  return path.join(directory, filename);
}

export const readAssetFile = (directory, filename) => readFile(safeAssetPath(directory, filename));

// Pin the connection to the public DNS answer we validated. Checking a hostname
// and then resolving it again during fetch would allow DNS rebinding.
export async function downloadFile(reference, redirects = 0) {
  let url;
  try { url = new URL(reference.download_url); } catch { throw new AppError('This file download link is invalid. Attach the file again.'); }
  if (url.protocol !== 'https:' || url.username || url.password || redirects > 3) throw new AppError('Use a temporary HTTPS file download link.');
  let addresses;
  try { addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true }); }
  catch { throw new AppError('The file host could not be reached. Attach the file again.', 502, 'FILE_DOWNLOAD_FAILED'); }
  if (!addresses.length || addresses.some(address => privateNetworks.check(address.address, address.family === 6 ? 'ipv6' : 'ipv4'))) {
    throw new AppError('Remote file links must resolve to a public address. Use the frontend to upload local files.');
  }
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: 'GET',
      signal: AbortSignal.timeout(30000),
      lookup: (_hostname, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
      headers: { Accept: '*/*' },
    }, async response => {
      try {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          return resolve(await downloadFile({ ...reference, download_url: new URL(response.headers.location, url).href }, redirects + 1));
        }
        if (response.statusCode !== 200) {
          response.resume();
          throw new AppError('This file link has expired or cannot be downloaded. Attach or select the file again.', 400, 'FILE_DOWNLOAD_FAILED');
        }
        if (Number(response.headers['content-length']) > MAX_FILE_BYTES) {
          response.destroy();
          throw new AppError('Files can be up to 32 MiB. Choose a smaller file.', 413, 'FILE_TOO_LARGE');
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of response) {
          bytes += chunk.length;
          if (bytes > MAX_FILE_BYTES) {
            response.destroy();
            throw new AppError('Files can be up to 32 MiB. Choose a smaller file.', 413, 'FILE_TOO_LARGE');
          }
          chunks.push(chunk);
        }
        resolve({ buffer: Buffer.concat(chunks), mimeType: reference.mime_type || String(response.headers['content-type'] || '').split(';')[0] });
      } catch (error) { reject(error instanceof AppError ? error : new AppError('The file download failed. Attach the file again.', 502, 'FILE_DOWNLOAD_FAILED')); }
    });
    request.on('error', () => reject(new AppError('The file download failed or timed out. Attach the file again.', 502, 'FILE_DOWNLOAD_FAILED')));
    request.end();
  });
}

export async function storeAsset(directory, { buffer, name, mimeType = '', fileId }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new AppError('This file is empty.');
  if (buffer.length > MAX_FILE_BYTES) throw new AppError('Files can be up to 32 MiB.', 413, 'FILE_TOO_LARGE');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const originalName = cleanFileName(name);
  let extension = path.extname(originalName).toLowerCase();
  const fallbackExtensions = { 'application/pdf': '.pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'text/plain': '.txt', 'text/markdown': '.md', 'application/json': '.json' };
  if (!extension) extension = fallbackExtensions[mimeType] || '';
  const isImage = imageTypes.has(mimeType) || ['.jpg', '.jpeg', '.png', '.webp'].includes(extension);
  const isDocument = ['.pdf', '.docx'].includes(extension);
  const isText = textExtensions.has(extension) || mimeType.startsWith('text/') || ['application/json', 'application/xml'].includes(mimeType);
  if (!isImage && !isDocument && !isText) throw new AppError('Choose a text file, PDF, DOCX, JPEG, PNG, or WebP image.', 400, 'UNSUPPORTED_FILE');
  if (!/^\.[a-z0-9]+$/.test(extension)) extension = isImage ? '.jpg' : '.txt';
  const originalFile = `original-${sha256}${extension}`;
  const asset = {
    id: sha256, name: originalName, mimeType, bytes: buffer.length, sha256,
    kind: isImage ? 'image' : 'document', originalFile, status: 'ready',
    ...(fileId ? { fileId } : {}),
  };
  if (isImage) {
    let image;
    let preview;
    try {
      const metadata = await sharp(buffer, { limitInputPixels: 100000000 }).metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Unsupported image');
      image = await sharp(buffer, { limitInputPixels: 100000000 }).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      preview = await sharp(image).resize(384, 384, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 65 }).toBuffer();
    } catch { throw new AppError('This image could not be read. Use a JPEG, PNG, or WebP image.', 400, 'INVALID_IMAGE'); }
    asset.imageFile = `image-${sha256}.jpg`;
    asset.previewFile = `preview-${sha256}.jpg`;
    asset.mimeType = 'image/jpeg';
    await Promise.all([writeFile(safeAssetPath(directory, originalFile), buffer), writeFile(safeAssetPath(directory, asset.imageFile), image), writeFile(safeAssetPath(directory, asset.previewFile), preview)]);
  } else {
    await writeFile(safeAssetPath(directory, originalFile), buffer);
    let text;
    if (isDocument) {
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (/(?:API_KEY|TOKEN|SECRET|PASSWORD|DOCINTEL|CONTENT_UNDERSTANDING)/i.test(key)) delete env[key];
      try {
        const result = await runFile('markitdown', [safeAssetPath(directory, originalFile)], { encoding: 'utf8', timeout: 60000, maxBuffer: MAX_TEXT_BYTES, env });
        text = result.stdout;
      } catch (error) {
        asset.status = 'error';
        asset.warning = error.code === 'ENOENT' ? 'PDF and DOCX conversion needs markitdown[pdf,docx] installed on the server.' : 'This document could not be converted locally. Try a text export or a smaller, unencrypted document.';
      }
    } else {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        if (text.includes('\0')) throw new Error('Binary data');
      } catch { throw new AppError('This text file is not UTF-8 text. Export it as UTF-8 and try again.', 400, 'INVALID_TEXT_FILE'); }
    }
    if (text != null) {
      if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new AppError('The extracted text is too large. Use a smaller document.', 413, 'TEXT_TOO_LARGE');
      asset.textFile = `text-${sha256}.md`;
      asset.textBytes = Buffer.byteLength(text);
      asset.previewText = text.slice(0, 2400);
      if (!text.trim()) {
        asset.status = 'empty';
        asset.warning = isDocument ? 'No text was extracted. Scanned documents need OCR; upload an image or a text export instead.' : 'This file contains no text.';
      }
      await writeFile(safeAssetPath(directory, asset.textFile), text);
    }
  }
  return asset;
}

export async function assetInput(directory, assets) {
  const textParts = [];
  const images = [];
  for (const asset of assets) {
    if (asset.status !== 'ready') throw new AppError(`${asset.name}: ${asset.warning || 'This file is not ready.'}`, 400, 'ASSET_NOT_READY');
    if (asset.kind === 'image') images.push(`data:image/jpeg;base64,${(await readAssetFile(directory, asset.imageFile)).toString('base64')}`);
    else textParts.push(`--- File: ${asset.name} ---\n${(await readAssetFile(directory, asset.textFile)).toString('utf8')}`);
  }
  return { text: textParts.join('\n\n'), images };
}

export function assetFiles(asset) {
  return [asset.originalFile, asset.imageFile, asset.previewFile, asset.textFile].filter(Boolean);
}
