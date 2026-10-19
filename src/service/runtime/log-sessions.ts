import { randomUUID } from 'node:crypto';
import type { LogLine, LogPage } from '../../shared/logs.js';
import { publicError, ServiceError } from '../security/errors.js';

export type NewLogLine = Omit<LogLine, 'cursor'>;
export interface LogSource {
  run: (signal: AbortSignal, push: (line: NewLogLine) => void, opened: () => void) => Promise<'last' | 'eof'>;
  validate: (signal: AbortSignal) => Promise<void>;
}
interface Entry {
  scope: string; controller: AbortController; source: LogSource;
  page: Omit<LogPage, 'lines' | 'nextCursor' | 'headCursor' | 'oldestCursor' | 'gap'>;
  lines: Array<{ value: LogLine; bytes: number }>; bytes: number; cursor: number;
  lease: number; deadline: number; retire: number; checked: number; checking: boolean;
}
export interface LogSessionOptions {
  maxActive?: number; maxEntries?: number; maxLines?: number; maxBytes?: number;
  pageBytes?: number; leaseMs?: number; lifetimeMs?: number; retentionMs?: number;
  checkMs?: number; tickMs?: number; now?: () => number;
}
const active = (entry: Entry) => entry.page.state === 'starting' || entry.page.state === 'streaming';

/** No durable storage, unbounded queue or SDK long-poll. Execution slots are
 * held until loaders actually settle, even if they ignore cancellation. */
export class LogSessions {
  private readonly entries = new Map<string, Entry>();
  private readonly executing = new Set<Entry>();
  private readonly now: () => number;
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(private readonly options: LogSessionOptions = {}) {
    for (const value of Object.values(options)) if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1)) throw new Error('Invalid log limit.');
    this.now = options.now ?? Date.now;
    this.timer = setInterval(() => this.sweep(), options.tickMs ?? 1000); this.timer.unref();
  }
  create(scope: string, source: LogSource): LogPage {
    this.sweep();
    if (this.closed) throw new ServiceError('CANCELLED', 499);
    if (this.entries.size >= (this.options.maxEntries ?? 8) || this.executing.size >= (this.options.maxActive ?? 4)) throw new ServiceError('BUSY', 429);
    const now = this.now(); const lease = now + (this.options.leaseMs ?? 15_000);
    const entry: Entry = { scope, source, controller: new AbortController(), lines: [], bytes: 0, cursor: 0, lease, deadline: now + (this.options.lifetimeMs ?? 600_000), retire: Infinity, checked: now, checking: false,
      page: { id: randomUUID(), state: 'starting', createdAt: new Date(now).toISOString(), expiresAt: new Date(lease).toISOString(), lastReceivedAt: '', droppedLines: 0, truncatedLines: 0, continuity: 'not-guaranteed' } };
    this.entries.set(entry.page.id, entry); this.executing.add(entry);
    void Promise.resolve().then(() => {
      if (entry.controller.signal.aborted) throw new ServiceError('CANCELLED', 499);
      return source.run(entry.controller.signal, (line) => this.push(entry, line), () => { if (active(entry)) entry.page.state = 'streaming'; });
    }).then((end) => {
      if (!active(entry)) return;
      if (end === 'last') this.finish(entry, 'completed');
      else this.finish(entry, 'disconnected', new ServiceError('UPSTREAM_UNAVAILABLE', 502));
    }).catch((error: unknown) => { if (active(entry)) this.finish(entry, 'failed', error); }).finally(() => this.executing.delete(entry));
    return this.copy(entry, 0);
  }
  get(id: string, scope: string, after: number): LogPage {
    this.sweep(); const entry = this.lookup(id, scope);
    if (!Number.isSafeInteger(after) || after < 0 || after > entry.cursor) throw new ServiceError('BAD_REQUEST', 400);
    if (active(entry)) { entry.lease = this.now() + (this.options.leaseMs ?? 15_000); entry.page.expiresAt = new Date(Math.min(entry.lease, entry.deadline)).toISOString(); }
    return this.copy(entry, after);
  }
  stop(id: string, scope: string): LogPage {
    this.sweep(); const entry = this.lookup(id, scope);
    if (active(entry)) this.finish(entry, 'stopped');
    return this.copy(entry, 0);
  }
  private lookup(id: string, scope: string): Entry {
    const entry = this.entries.get(id);
    if (!entry || entry.scope !== scope) throw new ServiceError('NOT_FOUND', 404);
    return entry;
  }
  private push(entry: Entry, line: NewLogLine): void {
    if (!active(entry) || entry.controller.signal.aborted || this.closed || !this.entries.has(entry.page.id)) return;
    const value = { ...line, cursor: ++entry.cursor }; const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > Math.min(this.options.maxBytes ?? 256_000, this.options.pageBytes ?? 64_000)) { this.finish(entry, 'failed', new ServiceError('RESPONSE_TOO_LARGE', 413)); return; }
    entry.page.lastReceivedAt = new Date(this.now()).toISOString();
    if (line.truncated) entry.page.truncatedLines++;
    entry.lines.push({ value, bytes }); entry.bytes += bytes;
    while (entry.lines.length > (this.options.maxLines ?? 1000) || entry.bytes > (this.options.maxBytes ?? 256_000)) {
      entry.bytes -= entry.lines.shift()!.bytes; entry.page.droppedLines++;
    }
  }
  private copy(entry: Entry, after: number): LogPage {
    const oldestCursor = entry.lines[0]?.value.cursor ?? entry.cursor + 1;
    const selected: LogLine[] = []; let bytes = 0;
    for (const line of entry.lines) if (line.value.cursor > after) {
      if (selected.length >= 100 || bytes + line.bytes > (this.options.pageBytes ?? 64_000)) break;
      selected.push(line.value); bytes += line.bytes;
    }
    return structuredClone({ ...entry.page, lines: selected, nextCursor: selected.at(-1)?.cursor ?? Math.max(after, oldestCursor - 1), headCursor: entry.cursor, oldestCursor, gap: after < oldestCursor - 1 });
  }
  private finish(entry: Entry, state: LogPage['state'], error?: unknown): void {
    if (!active(entry)) return;
    entry.page.state = state;
    if (error) { const safe = publicError(error); entry.page.error = { code: safe.code, message: safe.message }; }
    entry.retire = this.now() + (this.options.retentionMs ?? 60_000); entry.page.expiresAt = new Date(entry.retire).toISOString();
    entry.controller.abort();
  }
  private remove(entry: Entry): void { entry.controller.abort(); entry.lines.length = 0; entry.bytes = 0; this.entries.delete(entry.page.id); }
  private sweep(): void {
    const now = this.now();
    for (const entry of this.entries.values()) {
      if (active(entry) && entry.lease <= now) { this.remove(entry); continue; }
      if (active(entry) && entry.deadline <= now) this.finish(entry, 'failed', new ServiceError('TIMEOUT', 504));
      if (!active(entry) && entry.retire <= now) { this.remove(entry); continue; }
      if (active(entry) && !entry.checking && now - entry.checked >= (this.options.checkMs ?? 5000)) {
        entry.checking = true; entry.checked = now;
        void Promise.resolve().then(() => entry.source.validate(AbortSignal.any([entry.controller.signal, AbortSignal.timeout(3500)]))).catch((error: unknown) => {
          if (!active(entry) || !this.entries.has(entry.page.id)) return;
          const safe = publicError(error);
          if (['AUTH_REQUIRED', 'FORBIDDEN', 'CONFIG_INVALID', 'CONFIG_MISSING', 'CONTEXT_NOT_FOUND', 'NETWORK_DISABLED'].includes(safe.code)) { this.remove(entry); return; }
          this.finish(entry, 'failed', error);
        }).finally(() => { entry.checking = false; });
      }
    }
  }
  close(): void { this.closed = true; clearInterval(this.timer); for (const entry of this.entries.values()) this.remove(entry); }
}
