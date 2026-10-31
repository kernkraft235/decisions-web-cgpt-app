import { z } from 'zod';

export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorInfo(error) {
  let message = error instanceof z.ZodError ? error.issues.map(issue => issue.message).join(' ') :
    error.name === 'TimeoutError' ? 'The operation timed out. Try again when the provider is ready.' :
    error.name === 'AbortError' ? 'Operation cancelled.' :
    error.type === 'entity.too.large' ? 'This request is too large. Use a smaller file or fewer images.' :
    error.message || 'The operation failed.';
  for (const name of ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'CONTROL_PLANE_API_KEY', 'OPENAI_TUNNEL_ID']) {
    const secret = process.env[name]?.trim();
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  message = message.replace(/sk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, '[redacted]');
  return {
    error: message.slice(0, 1200),
    code: error.code && typeof error.code === 'string' ? error.code : error instanceof z.ZodError ? 'VALIDATION_ERROR' : 'REQUEST_FAILED',
    status: error instanceof z.ZodError ? 400 : error.status >= 400 && error.status <= 599 ? error.status : 502,
    ...(error.details ? { details: error.details } : {}),
  };
}

export function serialQueue() {
  let previous = Promise.resolve();
  return task => {
    const result = previous.then(task);
    previous = result.catch(() => {});
    return result;
  };
}

export const nameKey = value => String(value || '').trim().normalize('NFKC').toLowerCase();

export function checkRevision(item, expectedRevision, required = true) {
  if (expectedRevision == null && !required) return;
  if (expectedRevision == null || expectedRevision !== (item.revision || 0)) {
    throw new AppError('This item changed. Reload it before saving your edits.', 409, 'REVISION_CONFLICT', {
      id: item.id, revision: item.revision || 0,
    });
  }
}
