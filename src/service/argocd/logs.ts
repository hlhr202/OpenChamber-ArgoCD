import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { StringDecoder } from 'node:string_decoder';
import type { IncomingMessage } from 'node:http';
import type { Connection } from '../auth/config.js';
import type { LogCommand } from '../../shared/logs.js';
import { logTimestamp } from '../../shared/logs.js';
import { operationUrl } from './transport.js';
import { ServiceError } from '../security/errors.js';

export interface RawLogLine { content: string; timestamp: string; pod: string }
export function logUrl(baseUrl: string, command: LogCommand): URL {
  const app = operationUrl(baseUrl, 'application', { name: command.name, appNamespace: command.appNamespace });
  app.pathname += '/logs';
  for (const [key, value] of Object.entries({ namespace: command.resource.namespace, podName: command.resource.name, container: command.container, tailLines: command.tailLines, follow: command.follow, previous: command.previous, sinceSeconds: command.sinceSeconds, untilTime: command.untilTime })) if (value !== undefined) app.searchParams.set(key, String(value));
  if (command.sinceTime) {
    const seconds = Math.floor(Date.parse(command.sinceTime) / 1000);
    const nanos = Number((command.sinceTime.split('.')[1]?.replace('Z', '') ?? '').padEnd(9, '0'));
    app.searchParams.set('sinceTime.seconds', String(seconds)); app.searchParams.set('sinceTime.nanos', String(nanos));
  }
  return app;
}
function streamError(value: unknown): ServiceError {
  const code = value && typeof value === 'object' ? (value as Record<string, unknown>).code : undefined;
  return code === 7 ? new ServiceError('FORBIDDEN', 403) : code === 16 ? new ServiceError('AUTH_REQUIRED', 401) : code === 5 ? new ServiceError('NOT_FOUND', 404) : code === 4 ? new ServiceError('TIMEOUT', 504) : new ServiceError('UPSTREAM_UNAVAILABLE', 502);
}
/** gRPC gateway newline-delimited {result: LogEntry}/{error: ...}.
 * Never buffers the full response or follows token-bearing redirects. */
export async function consumeLogs(connection: Connection, command: LogCommand, signal: AbortSignal, push: (line: RawLogLine) => void, opened: () => void, limits: { frameBytes?: number; totalBytes?: number } = {}): Promise<'last' | 'eof'> {
  if (!connection.token) throw new ServiceError('AUTH_REQUIRED', 401);
  const url = logUrl(connection.baseUrl, command);
  let response: IncomingMessage | undefined;
  const controller = new AbortController(); const combined = AbortSignal.any([signal, controller.signal]);
  const timeout = setTimeout(() => response ? undefined : controller.abort(new ServiceError('TIMEOUT', 504)), 3500);
  try {
    response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = request(url, { method: 'GET', agent: false, signal: combined, headers: { Authorization: `Bearer ${connection.token}`, Accept: 'application/json', 'Accept-Encoding': 'identity' },
        rejectUnauthorized: !connection.insecure, ...(connection.ca ? { ca: connection.ca } : {}), ...(connection.cert ? { cert: connection.cert } : {}), ...(connection.key ? { key: connection.key } : {}),
      }, resolve);
      req.once('error', () => reject(new ServiceError(combined.aborted ? 'CANCELLED' : 'UPSTREAM_UNAVAILABLE', combined.aborted ? 499 : 502))); req.end();
    });
    clearTimeout(timeout);
    const status = response.statusCode ?? 0;
    if (status !== 200) throw status === 401 ? new ServiceError('AUTH_REQUIRED', 401) : status === 403 ? new ServiceError('FORBIDDEN', 403) : status === 404 ? new ServiceError('NOT_FOUND', 404) : status >= 300 && status < 400 ? new ServiceError('UPSTREAM_INVALID', 502) : new ServiceError('UPSTREAM_UNAVAILABLE', 502);
    if (!/^application\/(?:json|x-ndjson)(?:\s*;|$)/i.test(response.headers['content-type'] ?? '') || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) throw new ServiceError('UPSTREAM_INVALID', 502);
    opened();
    const decoder = new StringDecoder('utf8'); let pending = ''; let bytes = 0;
    const frameBytes = limits.frameBytes ?? 32_768;
    const frame = (text: string): boolean => {
      if (!text.trim()) return false;
      if (Buffer.byteLength(text) > frameBytes) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new ServiceError('UPSTREAM_INVALID', 502); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('UPSTREAM_INVALID', 502);
      const packet = value as Record<string, unknown>;
      if (packet.error !== undefined) throw streamError(packet.error);
      if (!packet.result || typeof packet.result !== 'object' || Array.isArray(packet.result)) throw new ServiceError('UPSTREAM_INVALID', 502);
      const result = packet.result as Record<string, unknown>;
      if (result.last != null && typeof result.last !== 'boolean') throw new ServiceError('UPSTREAM_INVALID', 502);
      if (result.last === true) return true;
      const content = result.content ?? ''; const pod = result.podName ?? ''; const timestamp = result.timeStampStr ?? result.timeStamp ?? '';
      if (typeof content !== 'string' || typeof pod !== 'string' || typeof timestamp !== 'string' || timestamp.length > 64) throw new ServiceError('UPSTREAM_INVALID', 502);
      const at = logTimestamp(timestamp);
      if (pod !== command.resource.name || at === null) throw new ServiceError('UPSTREAM_INVALID', 502);
      if (command.untilTime && at > logTimestamp(command.untilTime)!) return true;
      for (const part of content.split(/\r?\n/)) push({ content: part, timestamp, pod });
      return false;
    };
    for await (const chunk of response) {
      bytes += (chunk as Buffer).length;
      if (bytes > (limits.totalBytes ?? 8_000_000)) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
      pending += decoder.write(chunk as Buffer);
      let end = pending.indexOf('\n');
      while (end >= 0) { const line = pending.slice(0, end); pending = pending.slice(end + 1); if (frame(line)) return 'last'; end = pending.indexOf('\n'); }
      if (Buffer.byteLength(pending) > frameBytes) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
    }
    pending += decoder.end();
    if (pending.trim() && frame(pending)) return 'last';
    return 'eof';
  } catch (error) {
    if (controller.signal.reason instanceof ServiceError) throw controller.signal.reason;
    if (signal.aborted) throw new ServiceError('CANCELLED', 499);
    throw error instanceof ServiceError ? error : new ServiceError('UPSTREAM_UNAVAILABLE', 502);
  } finally { clearTimeout(timeout); response?.destroy(); }
}
