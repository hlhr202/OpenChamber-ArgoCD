import { randomUUID } from 'node:crypto';
import { LIMITS, type QuerySnapshot } from '../../shared/contracts.js';
import type { TaskCommand, TaskSnapshot } from '../../shared/tasks.js';
import { publicError, ServiceError } from '../security/errors.js';
import { redactResult } from '../security/redact.js';
import { operationUrl } from '../argocd/transport.js';
import { labelSelector } from '../../shared/filters.js';
import { parseResourceInput } from './resource-input.js';
import { parseManifestSelection } from './manifest-input.js';
import { isManagement, parseManagementCommand } from './management-input.js';

interface TaskEntry {
  scope: string; command: TaskCommand; snapshot: TaskSnapshot; controller: AbortController;
  execute: (signal: AbortSignal) => Promise<QuerySnapshot<unknown>>;
  timer?: ReturnType<typeof setTimeout>;
}
export interface TaskOptions {
  concurrency?: number; maxQueued?: number; maxEntries?: number; timeoutMs?: number;
  retentionMs?: number; maxResultBytes?: number; now?: () => number;
}

export class TaskManager {
  private readonly entries = new Map<string, TaskEntry>();
  private readonly queue: TaskEntry[] = [];
  private active = 0;
  private closed = false;
  private readonly now: () => number;
  private readonly cleanup: ReturnType<typeof setInterval>;

  constructor(private readonly options: TaskOptions = {}) {
    for (const value of Object.values(options)) if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1)) throw new Error('Invalid task limit.');
    this.now = options.now ?? Date.now;
    this.cleanup = setInterval(() => this.sweep(), 1000); this.cleanup.unref();
  }

  create(scope: string, command: TaskCommand, execute: TaskEntry['execute']): TaskSnapshot {
    this.sweep();
    if (this.closed) throw new ServiceError('CANCELLED', 499);
    if (this.entries.size >= (this.options.maxEntries ?? 32) || this.queue.length >= (this.options.maxQueued ?? 8)) throw new ServiceError('BUSY', 429);
    const createdAt = this.now();
    const entry: TaskEntry = {
      scope, command: structuredClone(command), execute, controller: new AbortController(),
      snapshot: { id: randomUUID(), state: 'queued', createdAt: new Date(createdAt).toISOString(), expiresAt: new Date(createdAt + (this.options.timeoutMs ?? 30_000)).toISOString() },
    };
    entry.timer = setTimeout(() => this.finish(entry, new ServiceError('TIMEOUT', 504)), this.options.timeoutMs ?? 30_000); entry.timer.unref();
    this.entries.set(entry.snapshot.id, entry); this.queue.push(entry);
    this.pump();
    return this.copy(entry);
  }

  get(id: string, scope: string): TaskSnapshot {
    const entry = this.entries.get(id);
    if (!entry || entry.scope !== scope) throw new ServiceError('NOT_FOUND', 404);
    if (Date.parse(entry.snapshot.expiresAt) <= this.now()) {
      if (['running', 'queued'].includes(entry.snapshot.state)) this.finish(entry, new ServiceError('TIMEOUT', 504));
      else { this.entries.delete(id); throw new ServiceError('EXPIRED', 410); }
    }
    return this.copy(entry);
  }

  cancel(id: string, scope: string): TaskSnapshot {
    this.get(id, scope);
    const entry = this.entries.get(id);
    if (!entry || entry.scope !== scope) throw new ServiceError('NOT_FOUND', 404);
    if (entry.snapshot.state === 'queued' || entry.snapshot.state === 'running') {
      this.finish(entry, new ServiceError('CANCELLED', 499));
    }
    return this.copy(entry);
  }

  private copy(entry: TaskEntry): TaskSnapshot {
    const value = structuredClone(entry.snapshot);
    if (value.result) value.result.stale = Date.parse(value.result.expiresAt) <= this.now();
    return value;
  }

  private pump(): void {
    while (!this.closed && this.active < (this.options.concurrency ?? 2) && this.queue.length) {
      const entry = this.queue.shift()!;
      if (entry.controller.signal.aborted) continue;
      entry.snapshot.state = 'running'; this.active++;
      void Promise.resolve().then(() => {
        if (entry.controller.signal.aborted) throw new ServiceError('CANCELLED', 499);
        return entry.execute(entry.controller.signal);
      }).then((value) => {
        if (entry.controller.signal.aborted || this.closed) return;
        const redacted = redactResult(value);
        if (redacted.truncated || Buffer.byteLength(JSON.stringify(redacted.value)) > (this.options.maxResultBytes ?? LIMITS.taskResultBytes)) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
        entry.snapshot.state = 'succeeded'; entry.snapshot.result = structuredClone(redacted.value) as QuerySnapshot<unknown>;
        this.retain(entry);
      }).catch((error: unknown) => this.finish(entry, error)).finally(() => {
        // A cancelled task keeps its execution slot until the loader really
        // settles. This prevents an uncooperative loader bypassing limits.
        this.active--; this.pump();
      });
    }
  }

  private finish(entry: TaskEntry, error: unknown): void {
    if (!['queued', 'running'].includes(entry.snapshot.state)) return;
    const safe = publicError(error);
    entry.snapshot.state = safe.code === 'CANCELLED' ? 'cancelled' : 'failed';
    entry.snapshot.error = { code: safe.code, message: safe.message };
    delete entry.snapshot.result;
    this.retain(entry); entry.controller.abort();
    const index = this.queue.indexOf(entry); if (index >= 0) this.queue.splice(index, 1);
  }

  private retain(entry: TaskEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.snapshot.expiresAt = new Date(this.now() + (this.options.retentionMs ?? 60_000)).toISOString();
  }
  private sweep(): void {
    for (const [id, entry] of this.entries) if (Date.parse(entry.snapshot.expiresAt) <= this.now()) {
      if (entry.snapshot.state === 'running' || entry.snapshot.state === 'queued') this.finish(entry, new ServiceError('TIMEOUT', 504));
      else this.entries.delete(id);
    }
  }
  close(): void {
    this.closed = true; clearInterval(this.cleanup);
    for (const entry of this.entries.values()) { if (entry.timer) clearTimeout(entry.timer); entry.controller.abort(); }
    this.queue.length = 0; this.entries.clear();
  }
}

export function parseTaskCommand(value: unknown): TaskCommand {
  const bad = () => new ServiceError('BAD_REQUEST', 400);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad();
  const input = value as Record<string, unknown>;
  if (typeof input.operation === 'string' && isManagement({ operation: input.operation })) return parseManagementCommand(input);
  const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
  if (!valid(input.context)) throw bad();
  if (typeof input.operation === 'string' && ['application', 'resourceTree', 'resource', 'events', 'relatedEvents', 'manifests', 'comparison'].includes(input.operation)) {
    const operation = input.operation as 'application' | 'resourceTree' | 'resource' | 'events' | 'relatedEvents' | 'manifests' | 'comparison';
    const allowed = ['context', 'operation', 'name', 'appNamespace', ...(['resource', 'events', 'relatedEvents'].includes(operation) ? ['resource'] : []), ...(operation === 'manifests' ? ['selection'] : [])];
    if (Object.keys(input).some((key) => !allowed.includes(key)) || !valid(input.name) || !valid(input.appNamespace)) throw bad();
    operationUrl('https://validation.invalid', 'application', { name: input.name, appNamespace: input.appNamespace });
    const base = { context: input.context, name: input.name, appNamespace: input.appNamespace };
    if (operation === 'resource') return { ...base, operation, resource: parseResourceInput(input.resource, 'resource') };
    if (operation === 'events') return { ...base, operation, ...(input.resource !== undefined ? { resource: parseResourceInput(input.resource, 'events') } : {}) };
    if (operation === 'relatedEvents') {
      const resource = parseResourceInput(input.resource, 'events');
      if (resource.group !== 'apps' || resource.kind !== 'Deployment') throw bad();
      return { ...base, operation, resource };
    }
    if (operation === 'manifests') return { ...base, operation, selection: parseManifestSelection(input.selection ?? {}) };
    return { ...base, operation };
  }
  if (input.operation === 'applications') {
    if (Object.keys(input).some((key) => !['context', 'operation', 'filters'].includes(key))) throw bad();
    const filters = input.filters ?? {};
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw bad();
    const keys = ['name', 'appNamespace', 'project', 'cluster', 'destinationNamespace', 'repo', 'selector', 'sync', 'health'];
    if (Object.entries(filters).some(([key, value]) => !keys.includes(key) || (value !== '' && !valid(value)))) throw bad();
    try { labelSelector((filters as Record<string, string>).selector ?? ''); } catch { throw bad(); }
    return { operation: 'applications', context: input.context, filters: structuredClone(filters) } as TaskCommand;
  }
  throw bad();
}
