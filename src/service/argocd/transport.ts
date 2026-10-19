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
} as const;
export type ReadOperation = keyof typeof READ_OPERATIONS;

export interface ReadParameters {
  name?: string; appNamespace?: string; project?: string;
  resourceName?: string; namespace?: string; kind?: string; group?: string; version?: string; resourceUID?: string;
  revision?: string; sourcePositions?: number[]; revisions?: string[];
  appsetNamespace?: string;
}

export function operationUrl(baseUrl: string, operation: ReadOperation, parameters: ReadParameters = {}): URL {
  if (!Object.hasOwn(READ_OPERATIONS, operation)) throw new ServiceError('BAD_REQUEST', 400);
  const allowed = operation === 'application' || operation === 'resourceTree' || operation === 'managedResources' || operation === 'applicationWindows' ? ['name', 'appNamespace']
    : operation === 'manifests' ? ['name', 'appNamespace', 'revision', 'sourcePositions', 'revisions']
    : operation === 'resource' ? ['name', 'appNamespace', 'resourceName', 'namespace', 'kind', 'group', 'version']
    : operation === 'events' ? ['name', 'appNamespace', 'resourceName', 'namespace', 'resourceUID']
    : ['orphanedMonitoring', 'project', 'projectWindows'].includes(operation) ? ['project']
    : operation === 'applicationSets' ? ['appsetNamespace']
    : ['applicationSet', 'applicationSetChildren', 'applicationSetEvents'].includes(operation) ? ['name', 'appsetNamespace']
    : operation === 'applications' ? ['appNamespace'] : [];
  if (Object.keys(parameters).some((key) => !allowed.includes(key))) throw new ServiceError('BAD_REQUEST', 400);
  const name = parameters.name ?? '';
  const namespace = parameters.appNamespace ?? '';
  if (['application', 'resourceTree', 'resource', 'events', 'manifests', 'managedResources', 'applicationWindows'].includes(operation) && (!/^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/.test(name) || !namespace)) throw new ServiceError('BAD_REQUEST', 400);
  if (namespace && !/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(namespace)) throw new ServiceError('BAD_REQUEST', 400);
  if (['orphanedMonitoring', 'project', 'projectWindows'].includes(operation) && !/^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/.test(parameters.project ?? '')) throw new ServiceError('BAD_REQUEST', 400);
  if (parameters.appsetNamespace && !/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(parameters.appsetNamespace)) throw new ServiceError('BAD_REQUEST', 400);
  if (['applicationSet', 'applicationSetChildren', 'applicationSetEvents'].includes(operation) && (!/^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/.test(name) || !parameters.appsetNamespace)) throw new ServiceError('BAD_REQUEST', 400);
  if (operation === 'resource' || (operation === 'events' && parameters.resourceName !== undefined)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,252}$/.test(parameters.resourceName ?? '') || (parameters.namespace && !/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(parameters.namespace))) throw new ServiceError('BAD_REQUEST', 400);
    if (operation === 'resource' && (!/^[A-Za-z][A-Za-z0-9]{0,127}$/.test(parameters.kind ?? '') || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/.test(parameters.version ?? '') || (parameters.group && !/^[a-z0-9][a-z0-9.-]{0,252}$/.test(parameters.group)))) throw new ServiceError('BAD_REQUEST', 400);
    if (operation === 'events' && !/^[A-Za-z0-9_.:-]{1,128}$/.test(parameters.resourceUID ?? '')) throw new ServiceError('BAD_REQUEST', 400);
  }
  if (operation === 'events' && !parameters.resourceName && (parameters.resourceUID || parameters.namespace)) throw new ServiceError('BAD_REQUEST', 400);
  const validRevision = (value: unknown) => typeof value === 'string' && Boolean(value.trim()) && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
  if (parameters.revision !== undefined && !validRevision(parameters.revision)) throw new ServiceError('BAD_REQUEST', 400);
  if (parameters.sourcePositions !== undefined || parameters.revisions !== undefined) {
    const positions = parameters.sourcePositions; const revisions = parameters.revisions;
    if (parameters.revision !== undefined || !Array.isArray(positions) || !Array.isArray(revisions) || !positions.length || positions.length > 20 || positions.length !== revisions.length || new Set(positions).size !== positions.length || positions.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 20) || revisions.some((value) => !validRevision(value))) throw new ServiceError('BAD_REQUEST', 400);
  }
  const path = READ_OPERATIONS[operation].replace('{name}', encodeURIComponent(name)).replace('{project}', encodeURIComponent(parameters.project ?? ''));
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

export function requestJson(connection: Connection, operation: ReadOperation, signal: AbortSignal, parameters: ReadParameters = {}): Promise<unknown> {
  if (!Object.hasOwn(READ_OPERATIONS, operation)) return Promise.reject(new ServiceError('BAD_REQUEST', 400));
  if (!connection.token) return Promise.reject(new ServiceError('AUTH_REQUIRED', 401));
  const url = operationUrl(connection.baseUrl, operation, parameters);
  // The host's ordinary request deadline still cancels its own waiter. A
  // background task can allow a slow read without holding an SDK call open.
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(operation === 'identity' ? 3500 : 25_000)]);
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(url, {
      method: 'GET', agent: false, signal: deadline,
      headers: { Authorization: `Bearer ${connection.token}`, Accept: 'application/json', 'Accept-Encoding': 'identity' },
      rejectUnauthorized: !connection.insecure,
      ...(connection.ca ? { ca: connection.ca } : {}),
      ...(connection.cert ? { cert: connection.cert } : {}),
      ...(connection.key ? { key: connection.key } : {}),
    }, (res) => {
      const status = res.statusCode ?? 0;
      const fail = (code: 'AUTH_REQUIRED' | 'FORBIDDEN' | 'UPSTREAM_INVALID' | 'UPSTREAM_UNAVAILABLE' | 'RESPONSE_TOO_LARGE', httpStatus: number) => {
        reject(new ServiceError(code, httpStatus));
        res.destroy();
      };
      if (status === 401) { fail('AUTH_REQUIRED', 401); return; }
      if (status === 403) { fail('FORBIDDEN', 403); return; }
      if (status === 404) { reject(new ServiceError('NOT_FOUND', 404)); res.destroy(); return; }
      if (status >= 300 && status < 400) { fail('UPSTREAM_INVALID', 502); return; }
      if (status !== 200) { fail('UPSTREAM_UNAVAILABLE', 502); return; }
      const type = res.headers['content-type'] ?? '';
      if (!/^application\/(?:[a-zA-Z0-9.+-]+\+)?json(?:\s*;|$)/.test(type) || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
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
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
        catch { reject(new ServiceError('UPSTREAM_INVALID', 502)); }
      });
      res.on('error', () => reject(new ServiceError(deadline.aborted ? 'TIMEOUT' : 'UPSTREAM_UNAVAILABLE', deadline.aborted ? 504 : 502)));
    });
    req.on('error', () => reject(new ServiceError(deadline.aborted ? 'TIMEOUT' : 'UPSTREAM_UNAVAILABLE', deadline.aborted ? 504 : 502)));
    req.end();
  });
}
