import type { IncomingMessage } from 'node:http';
import { ServiceError } from '../security/errors.js';

export function readJsonBody(req: IncomingMessage, signal: AbortSignal, maxBytes = 8000): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new ServiceError('BAD_REQUEST', 400);
  if (Number(req.headers['content-length'] ?? 0) > maxBytes) throw new ServiceError('BAD_REQUEST', 413);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    const clean = () => {
      req.removeListener('data', data); req.removeListener('end', end); req.removeListener('aborted', aborted); req.removeListener('error', aborted);
      signal.removeEventListener('abort', aborted);
    };
    const aborted = () => { clean(); reject(new ServiceError('CANCELLED', 499)); };
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { req.pause(); clean(); reject(new ServiceError('BAD_REQUEST', 413)); }
      else chunks.push(chunk);
    };
    const end = () => {
      clean();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
      catch { reject(new ServiceError('BAD_REQUEST', 400)); }
    };
    req.on('data', data); req.once('end', end); req.once('aborted', aborted); req.once('error', aborted);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}
