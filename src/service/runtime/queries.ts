import { Buffer } from 'node:buffer';
import { LIMITS, type QuerySnapshot } from '../../shared/contracts.js';
import { ServiceError } from '../security/errors.js';

interface Entry {
  scope: string; key: string; controller: AbortController; waiters: number; started: boolean; settled: boolean;
  load: (signal: AbortSignal) => Promise<unknown>;
  promise: Promise<QuerySnapshot<unknown>>;
  resolve: (value: QuerySnapshot<unknown>) => void;
  reject: (error: unknown) => void;
}
interface CacheEntry { scope: string; bytes: number; snapshot: QuerySnapshot<unknown> }
interface Failure { scope: string; until: number; count: number; error: ServiceError }

export interface QueryOptions {
  concurrency?: number; maxQueued?: number; maxEntries?: number;
  maxEntryBytes?: number; maxCacheBytes?: number; ttlMs?: number; timeoutMs?: number;
  now?: () => number;
}

/** Bounded, per-scope cache and single-flight scheduler. No stale-on-error
 * fallback: permission/auth/network failures never become cached success. */
export class QueryCoordinator {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly failures = new Map<string, Failure>();
  private readonly inflight = new Map<string, Entry>();
  private readonly queue: Entry[] = [];
  private active = 0;
  private bytes = 0;
  private closed = false;
  readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: QueryOptions = {}) {
    for (const value of Object.values(options)) if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1)) throw new Error('Invalid query limit.');
    this.ttlMs = options.ttlMs ?? 15_000;
    this.now = options.now ?? Date.now;
  }

  async run<T>(scope: string, key: string, load: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<QuerySnapshot<T>> {
    if (this.closed || signal.aborted) throw new ServiceError('CANCELLED', 499);
    const id = JSON.stringify([scope, key]);
    this.sweep();
    const cached = this.cache.get(id);
    if (cached) {
      this.cache.delete(id); this.cache.set(id, cached);
      return structuredClone({ ...cached.snapshot, source: 'cache' }) as QuerySnapshot<T>;
    }
    const failure = this.failures.get(id);
    if (failure && this.now() < failure.until) throw failure.error;
    let entry = this.inflight.get(id);
    if (!entry || entry.controller.signal.aborted) {
      if (this.queue.filter((item) => !item.controller.signal.aborted).length >= (this.options.maxQueued ?? 16)) throw new ServiceError('BUSY', 429);
      let resolve!: Entry['resolve']; let reject!: Entry['reject'];
      const promise = new Promise<QuerySnapshot<unknown>>((done, fail) => { resolve = done; reject = fail; });
      entry = { scope, key: id, controller: new AbortController(), waiters: 0, started: false, settled: false, load, promise, resolve, reject };
      const created = entry;
      created.controller.signal.addEventListener('abort', () => {
        if (!created.started) {
          const index = this.queue.indexOf(created);
          if (index >= 0) this.queue.splice(index, 1);
        }
        this.settle(created, created.controller.signal.reason instanceof ServiceError ? created.controller.signal.reason : new ServiceError('CANCELLED', 499));
      }, { once: true });
      this.inflight.set(id, entry); this.queue.push(entry);
    }
    const result = this.subscribe(entry, signal) as Promise<QuerySnapshot<T>>;
    this.pump();
    return result;
  }

  private subscribe(entry: Entry, signal: AbortSignal): Promise<QuerySnapshot<unknown>> {
    entry.waiters++;
    return new Promise((resolve, reject) => {
      let complete = false;
      const finish = () => {
        if (complete) return false;
        complete = true; signal.removeEventListener('abort', abort); entry.waiters--;
        if (!entry.waiters && !entry.settled) entry.controller.abort();
        return true;
      };
      const abort = () => { if (finish()) reject(new ServiceError('CANCELLED', 499)); };
      signal.addEventListener('abort', abort, { once: true });
      entry.promise.then((value) => { if (finish()) resolve(structuredClone(value)); }, (error: unknown) => { if (finish()) reject(error); });
      if (signal.aborted) abort();
    });
  }

  private pump(): void {
    while (!this.closed && this.active < (this.options.concurrency ?? 4) && this.queue.length) {
      const entry = this.queue.shift()!;
      if (entry.controller.signal.aborted) { this.settle(entry, new ServiceError('CANCELLED', 499)); continue; }
      entry.started = true; this.active++;
      void this.execute(entry).finally(() => { this.active--; this.pump(); });
    }
  }

  private async execute(entry: Entry): Promise<void> {
    const timer = setTimeout(() => entry.controller.abort(new ServiceError('TIMEOUT', 504)), this.options.timeoutMs ?? 30_000);
    timer.unref();
    try {
      const data = await entry.load(entry.controller.signal);
      if (entry.controller.signal.aborted || this.closed) throw new ServiceError('CANCELLED', 499);
      const bytes = Buffer.byteLength(JSON.stringify(data));
      if (bytes > (this.options.maxEntryBytes ?? LIMITS.cacheEntryBytes)) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
      const sampledAt = this.now();
      const snapshot: QuerySnapshot<unknown> = {
        data, sampledAt: new Date(sampledAt).toISOString(), expiresAt: new Date(sampledAt + this.ttlMs).toISOString(), stale: false, source: 'argo-api',
      };
      this.failures.delete(entry.key);
      this.cache.set(entry.key, { scope: entry.scope, bytes, snapshot: structuredClone(snapshot) }); this.bytes += bytes;
      while (this.cache.size > (this.options.maxEntries ?? 32) || this.bytes > (this.options.maxCacheBytes ?? 4_000_000)) this.removeCache(this.cache.keys().next().value!);
      this.settle(entry, undefined, snapshot);
    } catch (error) {
      if (!entry.controller.signal.aborted && error instanceof ServiceError && ['UPSTREAM_UNAVAILABLE', 'TIMEOUT'].includes(error.code)) {
        const count = Math.min((this.failures.get(entry.key)?.count ?? 0) + 1, 5);
        if (this.failures.size >= 64) this.failures.delete(this.failures.keys().next().value!);
        this.failures.set(entry.key, { scope: entry.scope, count, until: this.now() + Math.min(500 * 2 ** (count - 1), 5000), error });
      }
      this.settle(entry, error ?? new ServiceError('INTERNAL', 500));
    } finally { clearTimeout(timer); }
  }

  private settle(entry: Entry, error?: unknown, value?: QuerySnapshot<unknown>): void {
    if (entry.settled) return;
    entry.settled = true;
    if (this.inflight.get(entry.key) === entry) this.inflight.delete(entry.key);
    if (error) entry.reject(error); else entry.resolve(value!);
  }
  private removeCache(key: string): void {
    const entry = this.cache.get(key);
    if (entry) { this.bytes -= entry.bytes; this.cache.delete(key); }
  }
  private sweep(): void {
    for (const [key, entry] of this.cache) if (Date.parse(entry.snapshot.expiresAt) <= this.now()) this.removeCache(key);
  }
  invalidateScope(scope: string): void {
    for (const [key, entry] of this.cache) if (entry.scope === scope) this.removeCache(key);
    for (const [key, entry] of this.failures) if (entry.scope === scope) this.failures.delete(key);
    // In-flight consumers recheck their identity snapshot before receiving
    // data. Do not cancel unrelated waiters or release active slots early.
  }
  expired(snapshot: Pick<QuerySnapshot<unknown>, 'expiresAt'>): boolean { return Date.parse(snapshot.expiresAt) <= this.now(); }
  close(): void {
    this.closed = true;
    for (const entry of this.inflight.values()) entry.controller.abort();
    for (const entry of this.queue.splice(0)) this.settle(entry, new ServiceError('CANCELLED', 499));
    this.cache.clear(); this.bytes = 0; this.failures.clear();
  }
}
