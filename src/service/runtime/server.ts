import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { LIMITS, type Diagnostics, type Envelope, type QuerySnapshot } from '../../shared/contracts.js';
import { publicError, ServiceError } from '../security/errors.js';
import { redactResult } from '../security/redact.js';
import type { ArgoClient } from '../argocd/client.js';
import type { ApplicationFilters } from '../../shared/applications.js';
import { parseTaskCommand, TaskManager } from './tasks.js';
import { readJsonBody } from './body.js';
import { executeTask } from './commands.js';
import { parseResourceInput } from './resource-input.js';
import { parseManifestSelection } from './manifest-input.js';
import { parseLogCommand } from './log-input.js';
import { LogSessions } from './log-sessions.js';
import { parseManagementCommand } from './management-input.js';
import { isLanguage } from '../../shared/language.js';

export interface ServiceOptions {
  token: string;
  diagnostics?: (signal: AbortSignal) => Promise<Diagnostics>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxConcurrent?: number;
  client?: () => Promise<ArgoClient>;
  tasks?: TaskManager;
  logs?: LogSessions;
}

export function createService(options: ServiceOptions) {
  if (!options.token || options.token.length > 4096) throw new Error('Invalid service credentials.');
  const expected = Buffer.from(`Bearer ${options.token}`);
  const serviceInstance = randomUUID();
  const controllers = new Set<AbortController>();
  const timeoutMs = options.timeoutMs ?? LIMITS.operationTimeoutMs;
  const maxBytes = options.maxResponseBytes ?? LIMITS.responseBytes;
  const maxConcurrent = options.maxConcurrent ?? LIMITS.concurrentRequests;
  let stopping = false;
  let client: Promise<ArgoClient> | undefined;
  const tasks = options.tasks ?? new TaskManager();
  const logs = options.logs ?? new LogSessions();

  async function argo(): Promise<ArgoClient> {
    if (!options.client) throw new ServiceError('CONFIG_MISSING', 400);
    if (!client) client = options.client().catch((error: unknown) => { client = undefined; throw error; });
    return client;
  }

  function send(res: ServerResponse, status: number, body: Envelope<unknown>): void {
    if (res.destroyed || res.writableEnded) return;
    const redacted = redactResult({ ...body, serviceInstance }, [options.token]);
    let text = JSON.stringify(redacted.value);
    if (redacted.truncated || Buffer.byteLength(text) > maxBytes) {
      status = 413;
      text = JSON.stringify({ ok: false, error: { code: 'RESPONSE_TOO_LARGE', message: 'Result exceeds the response limit.' }, sampledAt: new Date().toISOString(), serviceInstance });
    }
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(text);
  }

  const server = createServer({ maxHeaderSize: 16_384 }, async (req, res) => {
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abandon: (() => void) | undefined;
    let identityEpoch: string | undefined;
    req.on('error', () => controller?.abort());
    if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) > 0) {
      res.shouldKeepAlive = false;
      res.once('finish', () => req.destroy());
    }
    try {
      const authorization = Buffer.from(req.headers.authorization ?? '');
      if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
        throw new ServiceError('UNAUTHORIZED', 401);
      }
      if (stopping) throw new ServiceError('BUSY', 503);
      const target = req.url ?? '';
      if (Buffer.byteLength(target) > LIMITS.requestTargetBytes || !/^\/[a-zA-Z0-9/_-]*(?:\?[^#\u0000-\u0020]*)?$/.test(target)) {
        throw new ServiceError('BAD_REQUEST', 400);
      }
      const url = new URL(target, 'http://127.0.0.1');
      const resourcePaths = ['/v1/resource-tree', '/v1/resource', '/v1/events'];
      if (!['/health', '/v1/diagnostics', '/v1/contexts', '/v1/identity', '/v1/applications', '/v1/application', '/v1/tasks', '/v1/logs', '/v1/summary', '/v1/management', '/v1/orphaned-monitoring', '/v1/manifests', '/v1/comparison', ...resourcePaths].includes(url.pathname)) throw new ServiceError('NOT_FOUND', 404);
      if (url.pathname === '/v1/summary' ? req.method !== 'POST' : ['/v1/tasks', '/v1/logs'].includes(url.pathname) ? !['GET', 'POST', 'DELETE'].includes(req.method ?? '') : req.method !== 'GET') throw new ServiceError('METHOD_NOT_ALLOWED', 405);
      const isTaskStart = url.pathname === '/v1/tasks' && req.method === 'POST';
      const isLogStart = url.pathname === '/v1/logs' && req.method === 'POST';
      const isSummary = url.pathname === '/v1/summary';
      if (!isTaskStart && !isLogStart && !isSummary && (req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) !== 0)) throw new ServiceError('BAD_REQUEST', 400);
      const filterKeys = ['name', 'appNamespace', 'project', 'cluster', 'destinationNamespace', 'repo', 'selector', 'sync', 'health'] as const;
      const allowed = url.pathname === '/v1/identity' ? ['context']
        : url.pathname === '/v1/applications' ? ['context', ...filterKeys]
        : url.pathname === '/v1/application' ? ['context', 'name', 'appNamespace']
        : url.pathname === '/v1/comparison' ? ['context', 'name', 'appNamespace']
        : url.pathname === '/v1/manifests' ? ['context', 'name', 'appNamespace', 'revision']
        : url.pathname === '/v1/orphaned-monitoring' ? ['context', 'project']
        : url.pathname === '/v1/management' ? ['context', 'operation', 'project', 'name', 'appNamespace', 'appsetNamespace']
        : resourcePaths.includes(url.pathname) ? ['context', 'name', 'appNamespace', ...(url.pathname === '/v1/resource-tree' ? [] : ['group', 'kind', 'version', 'namespace', 'resourceName', 'uid'])]
        : url.pathname === '/v1/tasks' && !isTaskStart ? ['context', 'id']
        : url.pathname === '/v1/logs' && !isLogStart ? ['context', 'id', ...(req.method === 'GET' ? ['after'] : [])] : [];
      if ([...url.searchParams.keys()].some((key) => !allowed.includes(key)) || [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)) throw new ServiceError('BAD_REQUEST', 400);
      const context = url.searchParams.get('context') ?? '';
      if (allowed.includes('context') && (!context || context.length > 512 || /[\u0000-\u001f\u007f]/.test(context))) throw new ServiceError('BAD_REQUEST', 400);
      const taskId = url.searchParams.get('id') ?? '';
      if ((url.pathname === '/v1/tasks' && !isTaskStart || url.pathname === '/v1/logs' && !isLogStart) && !/^[a-f0-9-]{36}$/.test(taskId)) throw new ServiceError('BAD_REQUEST', 400);
      const after = url.searchParams.get('after') ?? '0';
      if (url.pathname === '/v1/logs' && (!/^\d{1,16}$/.test(after) || !Number.isSafeInteger(Number(after)))) throw new ServiceError('BAD_REQUEST', 400);
      const filters: ApplicationFilters = {};
      for (const key of filterKeys) {
        const value = url.searchParams.get(key);
        if (value !== null) {
          if (value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw new ServiceError('BAD_REQUEST', 400);
          filters[key] = value;
        }
      }
      // Health must not wait for remote queries or an occupied query slot.
      if (url.pathname === '/health') {
        send(res, 200, { ok: true, data: { service: 'ready' }, sampledAt: new Date().toISOString(), stale: false, truncated: false });
        return;
      }
      if (controllers.size >= maxConcurrent) throw new ServiceError('BUSY', 429);
      controller = new AbortController();
      controllers.add(controller);
      const signal = controller.signal;
      const aborted = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new ServiceError('TIMEOUT', 504)), { once: true });
      });
      timer = setTimeout(() => controller?.abort(), timeoutMs);
      res.once('close', () => { if (!res.writableEnded) controller?.abort(); });
      let snapshot: QuerySnapshot<unknown> | undefined;
      let initialScope: string | undefined; let identityContext = context;
      async function operation(): Promise<unknown> {
        if (isSummary) {
          const value = await readJsonBody(req, signal, 24000);
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('BAD_REQUEST', 400);
          const body = value as Record<string, unknown>;
          if (Object.keys(body).some((key) => !['context', 'identityEpoch', 'evidence', 'language'].includes(key)) || (body.language !== undefined && !isLanguage(body.language)) || typeof body.context !== 'string' || !body.context || body.context.length > 512 || /[\u0000-\u001f\u007f]/.test(body.context) || typeof body.identityEpoch !== 'string' || !/^[\w-]{43}$/.test(body.identityEpoch)) throw new ServiceError('BAD_REQUEST', 400);
          identityContext = body.context; const api = await argo(); initialScope = await api.scope(identityContext); identityEpoch = api.publicEpoch(initialScope);
          return api.summary(identityContext, body.identityEpoch, body.evidence, isLanguage(body.language) ? body.language : undefined);
        }
        if (url.pathname === '/v1/management') {
          const command = parseManagementCommand(Object.fromEntries(url.searchParams));
          snapshot = await (await argo()).managementSnapshot(command, signal); return snapshot.data;
        }
        if (url.pathname === '/v1/logs') {
          const api = await argo();
          if (isLogStart) {
            const command = parseLogCommand(await readJsonBody(req, signal));
            const scope = await api.scope(command.context);
            identityContext = command.context; initialScope = scope; identityEpoch = api.publicEpoch(scope);
            if (signal.aborted) throw new ServiceError('CANCELLED', 499);
            const result = logs.create(scope, api.logSource(command, scope)); abandon = () => { logs.stop(result.id, scope); }; return result;
          }
          const scope = await api.scope(context);
          return req.method === 'DELETE' ? logs.stop(taskId, scope) : logs.get(taskId, scope, Number(after));
        }
        if (url.pathname === '/v1/contexts') return (await argo()).contexts();
        if (url.pathname === '/v1/identity') return (await argo()).identity(context, signal);
        if (url.pathname === '/v1/applications') { snapshot = await (await argo()).applicationsSnapshot(context, filters, signal); return snapshot.data; }
        if (url.pathname === '/v1/application') { snapshot = await (await argo()).applicationSnapshot(context, filters.name ?? '', filters.appNamespace ?? '', signal); return snapshot.data; }
        if (url.pathname === '/v1/manifests') {
          const revision = url.searchParams.get('revision');
          const selection = parseManifestSelection(revision !== null ? { revision } : {});
          snapshot = await (await argo()).manifestsSnapshot(context, { name: filters.name ?? '', appNamespace: filters.appNamespace ?? '' }, selection, signal); return snapshot.data;
        }
        if (url.pathname === '/v1/comparison') { snapshot = await (await argo()).comparisonSnapshot(context, { name: filters.name ?? '', appNamespace: filters.appNamespace ?? '' }, signal); return snapshot.data; }
        if (url.pathname === '/v1/orphaned-monitoring') { snapshot = await (await argo()).orphanedMonitoringSnapshot(context, filters.project ?? '', signal); return snapshot.data; }
        if (resourcePaths.includes(url.pathname)) {
          const app = { name: filters.name ?? '', appNamespace: filters.appNamespace ?? '' };
          const hasResource = ['group', 'kind', 'version', 'namespace', 'resourceName', 'uid'].some((key) => url.searchParams.has(key));
          const resource = hasResource ? parseResourceInput({ group: url.searchParams.get('group') ?? '', kind: url.searchParams.get('kind') ?? '', version: url.searchParams.get('version') ?? '', namespace: url.searchParams.get('namespace') ?? '', name: url.searchParams.get('resourceName') ?? '', uid: url.searchParams.get('uid') ?? '' }, url.pathname === '/v1/events' ? 'events' : 'resource') : undefined;
          const api = await argo();
          if (url.pathname === '/v1/resource-tree') snapshot = await api.resourceTreeSnapshot(context, app, signal);
          else if (url.pathname === '/v1/events') snapshot = await api.eventsSnapshot(context, app, signal, resource);
          else {
            if (!resource) throw new ServiceError('BAD_REQUEST', 400);
            snapshot = await api.resourceSnapshot(context, app, resource, signal);
          }
          return snapshot.data;
        }
        if (url.pathname === '/v1/tasks') {
          const api = await argo();
          if (isTaskStart) {
            const command = parseTaskCommand(await readJsonBody(req, signal));
            const scope = await api.scope(command.context);
            identityContext = command.context; initialScope = scope; identityEpoch = api.publicEpoch(scope);
            if (signal.aborted) throw new ServiceError('CANCELLED', 499);
            const result = tasks.create(scope, command, async (taskSignal) => {
              if (await api.scope(command.context) !== scope) throw new ServiceError('AUTH_REQUIRED', 401);
              const result = await executeTask(api, command, taskSignal);
              if (await api.scope(command.context) !== scope) throw new ServiceError('AUTH_REQUIRED', 401);
              return result;
            });
            abandon = () => { tasks.cancel(result.id, scope); }; return result;
          }
          const scope = await api.scope(context);
          return req.method === 'DELETE' ? tasks.cancel(taskId, scope) : tasks.get(taskId, scope);
        }
        return options.diagnostics ? options.diagnostics(signal) : {
          service: 'ready', readOnly: true, runtime: process.version,
          platform: process.platform, argoConnection: 'not-attempted',
        };
      }
      async function execute(): Promise<unknown> {
        if (context) { const api = await argo(); initialScope = await api.scope(context); identityEpoch = api.publicEpoch(initialScope); }
        const data = await operation();
        if (identityContext && initialScope) {
          const api = await argo();
          if (signal.aborted || initialScope !== await api.scope(identityContext)) throw new ServiceError('AUTH_REQUIRED', 401);
          identityEpoch = api.publicEpoch(initialScope);
        }
        return data;
      }
      const data = await Promise.race([
        execute().catch((error: unknown) => { try { abandon?.(); } catch { /* already expired */ } throw error; }),
        aborted,
      ]);
      send(res, 200, { ok: true, data, sampledAt: snapshot?.sampledAt ?? new Date().toISOString(), stale: snapshot?.stale ?? false, truncated: false,
        ...(snapshot ? { expiresAt: snapshot.expiresAt, source: snapshot.source } : { source: 'service' }), ...(identityEpoch ? { identityEpoch } : {}) });
    } catch (error) {
      try { abandon?.(); } catch { /* already expired */ }
      const safe = publicError(error);
      send(res, safe.status, { ok: false, error: { code: safe.code, message: safe.message }, sampledAt: new Date().toISOString(), ...(identityEpoch ? { identityEpoch } : {}) });
    } finally {
      if (timer) clearTimeout(timer);
      if (controller) controllers.delete(controller);
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;

  return {
    server,
    async close(): Promise<void> {
      stopping = true;
      tasks.close();
      logs.close();
      for (const controller of controllers) controller.abort();
      if (client) void client.then((api) => api.close()).catch(() => {});
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}
