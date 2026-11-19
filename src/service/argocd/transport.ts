import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Connection } from '../auth/config.js';
import { ServiceError } from '../security/errors.js';

// Internal fixed endpoints, never taken from a panel-supplied URL or path.
export const READ_OPERATIONS = {
  identity: '/api/v1/session/userinfo',
  applications: '/api/v1/applications',
  application: '/api/v1/applications/{name}',
  resourceTree: '/api/v1/applications/{name}/resource-tree',
  resource: '/api/v1/applications/{name}/resource',
  events: '/api/v1/applications/{name}/events',
  orphanedMonitoring: '/api/v1/projects/{project}',
  manifests: '/api/v1/applications/{name}/manifests',
  managedResources: '/api/v1/applications/{name}/managed-resources',
  version: '/api/version',
  projects: '/api/v1/projects',
  project: '/api/v1/projects/{project}',
  projectWindows: '/api/v1/projects/{project}/syncwindows',
  repositories: '/api/v1/repositories',
  clusters: '/api/v1/clusters',
  applicationSets: '/api/v1/applicationsets',
  applicationSet: '/api/v1/applicationsets/{name}',
  applicationSetChildren: '/api/v1/applicationsets/{name}/resource-tree',
  applicationSetEvents: '/api/v1/applicationsets/{name}/events',
  applicationWindows: '/api/v1/applications/{name}/syncwindows',
  resourceActions: '/api/v1/applications/{name}/resource/actions',
  canI: '/api/v1/account/can-i/{resource}/{action}/{subresource}',
} as const;
export type ReadOperation = keyof typeof READ_OPERATIONS;

/**
 * Fixed write endpoints aligned with argoproj/argo-cd gRPC-gateway bindings:
 * https://github.com/argoproj/argo-cd (commit 232fa2d123c0cef71de9251860289ee9a150172e)
 * Never constructed from panel-supplied URLs or arbitrary methods.
 */
export const WRITE_OPERATIONS = {
  refreshApplication:     { method: 'GET',    path: '/api/v1/applications/{name}' },
  syncApplication:        { method: 'POST',   path: '/api/v1/applications/{name}/sync' },
  terminateOperation:     { method: 'DELETE', path: '/api/v1/applications/{name}/operation' },
  rollbackApplication:    { method: 'POST',   path: '/api/v1/applications/{name}/rollback' },
  createApplication:      { method: 'POST',   path: '/api/v1/applications' },
  updateApplication:      { method: 'PUT',    path: '/api/v1/applications/{name}' },
  patchApplication:       { method: 'PATCH',  path: '/api/v1/applications/{name}' },
  deleteApplication:      { method: 'DELETE', path: '/api/v1/applications/{name}' },
  runResourceActionV2:    { method: 'POST',   path: '/api/v1/applications/{name}/resource/actions/v2' },
  runResourceActionV1:    { method: 'POST',   path: '/api/v1/applications/{name}/resource/actions' },
  deleteResource:         { method: 'DELETE', path: '/api/v1/applications/{name}/resource' },
  patchResource:          { method: 'POST',   path: '/api/v1/applications/{name}/resource' },
  createApplicationSet:   { method: 'POST',   path: '/api/v1/applicationsets' },
  deleteApplicationSet:   { method: 'DELETE', path: '/api/v1/applicationsets/{name}' },
  createProject:          { method: 'POST',   path: '/api/v1/projects' },
  updateProject:          { method: 'PUT',    path: '/api/v1/projects/{project}' },
  deleteProject:          { method: 'DELETE', path: '/api/v1/projects/{project}' },
  validateRepository:     { method: 'POST',   path: '/api/v1/repositories/{repo}/validate' },
  deleteRepository:       { method: 'DELETE', path: '/api/v1/repositories/{repo}' },
  invalidateClusterCache: { method: 'GET',    path: '/api/v1/clusters/{server}' },
  deleteCluster:          { method: 'DELETE', path: '/api/v1/clusters/{server}' },
} as const;
export type WriteOperation = keyof typeof WRITE_OPERATIONS;

export interface ReadParameters {
  name?: string; appNamespace?: string; project?: string;
  resourceName?: string; namespace?: string; kind?: string; group?: string; version?: string; resourceUID?: string;
  revision?: string; sourcePositions?: number[]; revisions?: string[];
  appsetNamespace?: string;
  rbacResource?: string; rbacAction?: string; rbacSubresource?: string;
}

export interface WriteParameters {
  name?: string; appNamespace?: string; project?: string;
  refresh?: 'normal' | 'hard' | 'true';
  resourceName?: string; namespace?: string; kind?: string; group?: string; version?: string;
  force?: boolean; orphan?: boolean; patchType?: string;
  cascade?: boolean; propagationPolicy?: string;
  upsert?: boolean; validate?: boolean;
  appsetNamespace?: string;
  repo?: string; repoType?: string; appProject?: string;
  server?: string;
}

const K8S_NAME = /^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/;
const K8S_NAMESPACE = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const RESOURCE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,252}$/;
const KIND_RE = /^[A-Za-z][A-Za-z0-9]{0,127}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/;
const GROUP_RE = /^[a-z0-9][a-z0-9.-]{0,252}$/;

function validUrlLike(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function operationUrl(baseUrl: string, operation: ReadOperation, parameters: ReadParameters = {}): URL {
  if (!Object.hasOwn(READ_OPERATIONS, operation)) throw new ServiceError('BAD_REQUEST', 400);
  const allowed = operation === 'application' || operation === 'resourceTree' || operation === 'managedResources' || operation === 'applicationWindows' ? ['name', 'appNamespace']
    : operation === 'manifests' ? ['name', 'appNamespace', 'revision', 'sourcePositions', 'revisions']
    : operation === 'resource' || operation === 'resourceActions' ? ['name', 'appNamespace', 'resourceName', 'namespace', 'kind', 'group', 'version']
    : operation === 'events' ? ['name', 'appNamespace', 'resourceName', 'namespace', 'resourceUID']
    : ['orphanedMonitoring', 'project', 'projectWindows'].includes(operation) ? ['project']
    : operation === 'applicationSets' ? ['appsetNamespace']
    : ['applicationSet', 'applicationSetChildren', 'applicationSetEvents'].includes(operation) ? ['name', 'appsetNamespace']
    : operation === 'canI' ? ['rbacResource', 'rbacAction', 'rbacSubresource']
    : operation === 'applications' ? ['appNamespace'] : [];
  if (Object.keys(parameters).some((key) => !allowed.includes(key))) throw new ServiceError('BAD_REQUEST', 400);
  const name = parameters.name ?? '';
  const namespace = parameters.appNamespace ?? '';
  if (['application', 'resourceTree', 'resource', 'resourceActions', 'events', 'manifests', 'managedResources', 'applicationWindows'].includes(operation) && (!K8S_NAME.test(name) || !namespace)) throw new ServiceError('BAD_REQUEST', 400);
  if (namespace && !K8S_NAMESPACE.test(namespace)) throw new ServiceError('BAD_REQUEST', 400);
  if (['orphanedMonitoring', 'project', 'projectWindows'].includes(operation) && !K8S_NAME.test(parameters.project ?? '')) throw new ServiceError('BAD_REQUEST', 400);
  if (parameters.appsetNamespace && !K8S_NAMESPACE.test(parameters.appsetNamespace)) throw new ServiceError('BAD_REQUEST', 400);
  if (['applicationSet', 'applicationSetChildren', 'applicationSetEvents'].includes(operation) && (!K8S_NAME.test(name) || !parameters.appsetNamespace)) throw new ServiceError('BAD_REQUEST', 400);
  if (operation === 'resource' || operation === 'resourceActions' || (operation === 'events' && parameters.resourceName !== undefined)) {
    if (!RESOURCE_NAME.test(parameters.resourceName ?? '') || (parameters.namespace && !K8S_NAMESPACE.test(parameters.namespace))) throw new ServiceError('BAD_REQUEST', 400);
    if ((operation === 'resource' || operation === 'resourceActions') && (!KIND_RE.test(parameters.kind ?? '') || !VERSION_RE.test(parameters.version ?? '') || (parameters.group && !GROUP_RE.test(parameters.group)))) throw new ServiceError('BAD_REQUEST', 400);
    if (operation === 'events' && !/^[A-Za-z0-9_.:-]{1,128}$/.test(parameters.resourceUID ?? '')) throw new ServiceError('BAD_REQUEST', 400);
  }
  if (operation === 'events' && !parameters.resourceName && (parameters.resourceUID || parameters.namespace)) throw new ServiceError('BAD_REQUEST', 400);
  if (operation === 'canI') {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(parameters.rbacResource ?? '') || !/^[a-z][a-z0-9/_-]{0,127}$/.test(parameters.rbacAction ?? '')) throw new ServiceError('BAD_REQUEST', 400);
    const sub = parameters.rbacSubresource ?? '';
    if (!sub || sub.length > 512 || /[\u0000-\u001f\u007f]/.test(sub) || sub.split('/').some((part) => !part || part === '.' || part === '..')) throw new ServiceError('BAD_REQUEST', 400);
  }
  const validRevision = (value: unknown) => typeof value === 'string' && Boolean(value.trim()) && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
  if (parameters.revision !== undefined && !validRevision(parameters.revision)) throw new ServiceError('BAD_REQUEST', 400);
  if (parameters.sourcePositions !== undefined || parameters.revisions !== undefined) {
    const positions = parameters.sourcePositions; const revisions = parameters.revisions;
    if (parameters.revision !== undefined || !Array.isArray(positions) || !Array.isArray(revisions) || !positions.length || positions.length > 20 || positions.length !== revisions.length || new Set(positions).size !== positions.length || positions.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 20) || revisions.some((value) => !validRevision(value))) throw new ServiceError('BAD_REQUEST', 400);
  }
  const encodedSubresource = (parameters.rbacSubresource ?? '').split('/').map((part) => encodeURIComponent(part)).join('/');
  const path = READ_OPERATIONS[operation]
    .replace('{name}', encodeURIComponent(name))
    .replace('{project}', encodeURIComponent(parameters.project ?? ''))
    .replace('{resource}', encodeURIComponent(parameters.rbacResource ?? ''))
    .replace('{action}', encodeURIComponent(parameters.rbacAction ?? ''))
    .replace('{subresource}', encodedSubresource);
  const url = new URL(baseUrl + path);
  if (namespace) url.searchParams.set('appNamespace', namespace);
  if (parameters.appsetNamespace) url.searchParams.set('appsetNamespace', parameters.appsetNamespace);
  for (const key of ['resourceName', 'namespace', 'kind', 'group', 'version', 'resourceUID'] as const) {
    const value = parameters[key];
    if (value !== undefined && value !== '') url.searchParams.set(operation === 'events' && key === 'namespace' ? 'resourceNamespace' : key, value);
  }
  if (parameters.revision !== undefined) url.searchParams.set('revision', parameters.revision);
  for (const position of parameters.sourcePositions ?? []) url.searchParams.append('sourcePositions', String(position));
  for (const revision of parameters.revisions ?? []) url.searchParams.append('revisions', revision);
  return url;
}

export function writeOperationUrl(baseUrl: string, operation: WriteOperation, parameters: WriteParameters = {}): URL {
  if (!Object.hasOwn(WRITE_OPERATIONS, operation)) throw new ServiceError('BAD_REQUEST', 400);
  const spec = WRITE_OPERATIONS[operation];
  const name = parameters.name ?? '';
  const appNamespace = parameters.appNamespace ?? '';
  if (['refreshApplication', 'syncApplication', 'terminateOperation', 'rollbackApplication', 'updateApplication', 'patchApplication', 'deleteApplication', 'runResourceActionV2', 'runResourceActionV1', 'deleteResource', 'patchResource'].includes(operation)) {
    if (!K8S_NAME.test(name) || !appNamespace || !K8S_NAMESPACE.test(appNamespace)) throw new ServiceError('BAD_REQUEST', 400);
  }
  if (['runResourceActionV1', 'deleteResource', 'patchResource'].includes(operation)) {
    if (!RESOURCE_NAME.test(parameters.resourceName ?? '') || (parameters.namespace && !K8S_NAMESPACE.test(parameters.namespace)) || !KIND_RE.test(parameters.kind ?? '') || !VERSION_RE.test(parameters.version ?? '') || (parameters.group && !GROUP_RE.test(parameters.group))) throw new ServiceError('BAD_REQUEST', 400);
  }
  if (operation === 'refreshApplication' && parameters.refresh !== 'normal' && parameters.refresh !== 'hard') throw new ServiceError('BAD_REQUEST', 400);
  if (operation === 'deleteApplicationSet' && (!K8S_NAME.test(name) || !parameters.appsetNamespace || !K8S_NAMESPACE.test(parameters.appsetNamespace))) throw new ServiceError('BAD_REQUEST', 400);
  if (['updateProject', 'deleteProject'].includes(operation) && !K8S_NAME.test(parameters.project ?? '')) throw new ServiceError('BAD_REQUEST', 400);
  if (['validateRepository', 'deleteRepository'].includes(operation) && !validUrlLike(parameters.repo)) throw new ServiceError('BAD_REQUEST', 400);
  if (['invalidateClusterCache', 'deleteCluster'].includes(operation) && !validUrlLike(parameters.server)) throw new ServiceError('BAD_REQUEST', 400);
  const path = spec.path
    .replace('{name}', encodeURIComponent(name))
    .replace('{project}', encodeURIComponent(parameters.project ?? ''))
    .replace('{repo}', encodeURIComponent(parameters.repo ?? ''))
    .replace('{server}', encodeURIComponent(parameters.server ?? ''));
  const url = new URL(baseUrl + path);
  if (appNamespace && ['refreshApplication', 'terminateOperation', 'updateApplication', 'deleteApplication', 'runResourceActionV1', 'deleteResource', 'patchResource'].includes(operation)) {
    url.searchParams.set('appNamespace', appNamespace);
  }
  if (operation === 'refreshApplication' && parameters.refresh) url.searchParams.set('refresh', parameters.refresh);
  if (operation === 'invalidateClusterCache') url.searchParams.set('refresh', 'true');
  if (['runResourceActionV1', 'deleteResource', 'patchResource'].includes(operation)) {
    for (const key of ['resourceName', 'namespace', 'kind', 'group', 'version'] as const) {
      const value = parameters[key];
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
  }
  if (operation === 'patchResource' && parameters.patchType) url.searchParams.set('patchType', parameters.patchType);
  if (operation === 'deleteResource') {
    if (parameters.force !== undefined) url.searchParams.set('force', String(parameters.force));
    if (parameters.orphan !== undefined) url.searchParams.set('orphan', String(parameters.orphan));
  }
  if (operation === 'deleteApplication') {
    if (parameters.cascade !== undefined) url.searchParams.set('cascade', String(parameters.cascade));
    if (parameters.propagationPolicy) url.searchParams.set('propagationPolicy', parameters.propagationPolicy);
  }
  if (['createApplication', 'createApplicationSet', 'createProject'].includes(operation) && parameters.upsert !== undefined) url.searchParams.set('upsert', String(parameters.upsert));
  if (['createApplication', 'updateApplication'].includes(operation) && parameters.validate !== undefined) url.searchParams.set('validate', String(parameters.validate));
  if (operation === 'deleteApplicationSet' && parameters.appsetNamespace) url.searchParams.set('appsetNamespace', parameters.appsetNamespace);
  if (operation === 'validateRepository') {
    if (parameters.repoType) url.searchParams.set('type', parameters.repoType);
    if (parameters.project) url.searchParams.set('project', parameters.project);
  }
  if (operation === 'deleteRepository' && parameters.appProject) url.searchParams.set('appProject', parameters.appProject);
  return url;
}

export function requestJson(connection: Connection, operation: ReadOperation, signal: AbortSignal, parameters: ReadParameters = {}): Promise<unknown> {
  if (!Object.hasOwn(READ_OPERATIONS, operation)) return Promise.reject(new ServiceError('BAD_REQUEST', 400));
  if (!connection.token) return Promise.reject(new ServiceError('AUTH_REQUIRED', 401));
  const url = operationUrl(connection.baseUrl, operation, parameters);
  // The host's ordinary request deadline still cancels its own waiter. A
  // background task can allow a slow read without holding an SDK call open.
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(operation === 'identity' ? 3500 : 25_000)]);
  return executeHttpJson(connection, url, 'GET', deadline);
}

export function mutateJson(connection: Connection, operation: WriteOperation, signal: AbortSignal, parameters: WriteParameters = {}, body?: unknown): Promise<unknown> {
  if (!Object.hasOwn(WRITE_OPERATIONS, operation)) return Promise.reject(new ServiceError('BAD_REQUEST', 400));
  if (!connection.token) return Promise.reject(new ServiceError('AUTH_REQUIRED', 401));
  const url = writeOperationUrl(connection.baseUrl, operation, parameters);
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  if (payload !== undefined && Buffer.byteLength(payload) > 2_000_000) return Promise.reject(new ServiceError('BAD_REQUEST', 413));
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  return executeHttpJson(connection, url, WRITE_OPERATIONS[operation].method, deadline, payload, true);
}

function executeHttpJson(connection: Connection, url: URL, method: string, deadline: AbortSignal, payload?: string, isMutation = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers: Record<string, string | number> = {
      Authorization: `Bearer ${connection.token}`,
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
    };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = request(url, {
      method, agent: false, signal: deadline, headers,
      rejectUnauthorized: !connection.insecure,
      ...(connection.ca ? { ca: connection.ca } : {}),
      ...(connection.cert ? { cert: connection.cert } : {}),
      ...(connection.key ? { key: connection.key } : {}),
    }, (res) => {
      const status = res.statusCode ?? 0;
      const fail = (code: 'AUTH_REQUIRED' | 'FORBIDDEN' | 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'CAPABILITY_UNAVAILABLE' | 'UPSTREAM_INVALID' | 'UPSTREAM_UNAVAILABLE' | 'RESPONSE_TOO_LARGE', httpStatus: number) => {
        reject(new ServiceError(code, httpStatus));
        res.destroy();
      };
      if (status === 401) { fail('AUTH_REQUIRED', 401); return; }
      if (status === 403) { fail('FORBIDDEN', 403); return; }
      if (status === 404) { fail('NOT_FOUND', 404); return; }
      if (status >= 300 && status < 400) { fail('UPSTREAM_INVALID', 502); return; }
      if (isMutation) {
        if (status === 400 || status === 412 || status === 422) { fail('BAD_REQUEST', 400); return; }
        if (status === 409) { fail('CONFLICT', 409); return; }
        if (status === 501) { fail('CAPABILITY_UNAVAILABLE', 501); return; }
        if (status < 200 || status >= 300) { fail('UPSTREAM_UNAVAILABLE', 502); return; }
      } else if (status !== 200) {
        fail('UPSTREAM_UNAVAILABLE', 502); return;
      }
      if (isMutation && status === 204) { res.resume(); resolve({}); return; }
      const type = res.headers['content-type'] ?? '';
      if ((type || !isMutation) && (!/^application\/(?:[a-zA-Z0-9.+-]+\+)?json(?:\s*;|$)/.test(type) || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity'))) {
        fail('UPSTREAM_INVALID', 502); return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2_000_000) { fail('RESPONSE_TOO_LARGE', 413); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (isMutation && !text.trim()) { resolve({}); return; }
        try { resolve(JSON.parse(text) as unknown); }
        catch { reject(new ServiceError('UPSTREAM_INVALID', 502)); }
      });
      res.on('error', () => reject(new ServiceError(deadline.aborted ? 'TIMEOUT' : 'UPSTREAM_UNAVAILABLE', deadline.aborted ? 504 : 502)));
    });
    req.on('error', () => reject(new ServiceError(deadline.aborted ? 'TIMEOUT' : 'UPSTREAM_UNAVAILABLE', deadline.aborted ? 504 : 502)));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
