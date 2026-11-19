/**
 * High-fidelity, stateful in-repo Mock Argo CD API Server fixture.
 *
 * Modeled directly after upstream argoproj/argo-cd gRPC-gateway handlers:
 * - https://github.com/argoproj/argo-cd (commit 232fa2d123c0cef71de9251860289ee9a150172e)
 * - server/application/application.go & application.proto
 * - server/account/account.go & account.proto
 * - server/applicationset/applicationset.proto
 * - server/project/project.proto, server/repository/repository.proto, server/cluster/cluster.proto
 *
 * HARD ISOLATION RULE:
 * - Binds strictly to 127.0.0.1:0 (ephemeral loopback port).
 * - Creates synthetic CLI config & synthetic bearer token inside an isolated mkdtemp directory.
 * - Never reads host HOME, ~/.kube/config, ~/.config/argocd/config, or host ARGOCD_* variables.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { stringify as stringifyYaml } from 'yaml';
import { CredentialProvider } from '../src/service/auth/config.js';
import { ArgoClient } from '../src/service/argocd/client.js';
import { createService } from '../src/service/runtime/server.js';

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string[]>;
  body: unknown;
}

export interface MockArgoServerOptions {
  token?: string;
  defaultNamespace?: string;
  rollbackEnforceEnable?: boolean;
  legacyActionsOnly?: boolean;
  syncWindowBlocked?: boolean;
  deny?: Array<{ resource: string; action: string; subresource?: string }>;
  failStatusOnWrite?: { operationPath: string; status: number; code?: number; message?: string };
}

export interface MockArgoServer {
  baseUrl: string;
  token: string;
  configPath: string;
  requests: RecordedRequest[];
  options: MockArgoServerOptions;
  state: {
    applications: Map<string, Record<string, unknown>>;
    trees: Map<string, Array<Record<string, unknown>>>;
    liveResources: Map<string, Record<string, unknown>>;
    resourceActions: Map<string, Array<Record<string, unknown>>>;
    applicationSets: Map<string, Record<string, unknown>>;
    projects: Map<string, Record<string, unknown>>;
    repositories: Map<string, Record<string, unknown>>;
    clusters: Map<string, Record<string, unknown>>;
  };
  createClient(): ArgoClient;
  createHostService(serviceToken?: string): Promise<{
    baseUrl: string;
    token: string;
    request<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: T }>;
  }>;
  close(): Promise<void>;
}

function grpcError(res: ServerResponse, httpStatus: number, grpcCode: number, message: string): void {
  res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message, code: grpcCode, message, details: [] }));
}

function jsonOk(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    const existing = result[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && existing && typeof existing === 'object' && !Array.isArray(existing)) {
      result[key] = deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return text; }
}

function defaultApplication(name = 'demo', appNamespace = 'argocd'): Record<string, unknown> {
  return {
    metadata: { name, namespace: appNamespace, uid: `uid-${appNamespace}-${name}`, creationTimestamp: '2026-10-18T00:00:00Z' },
    spec: {
      project: 'default',
      source: { repoURL: 'https://git.example.test/platform/demo.git', path: 'deploy', targetRevision: 'HEAD' },
      destination: { server: 'https://kubernetes.default.svc', namespace: 'workloads' },
    },
    status: {
      sync: { status: 'OutOfSync', revision: 'rev-current-1' },
      health: { status: 'Healthy' },
      reconciledAt: '2026-10-18T00:00:00Z',
      operationState: {
        phase: 'Succeeded',
        message: 'successfully synced',
        startedAt: '2026-10-18T00:00:00Z',
        finishedAt: '2026-10-18T00:00:10Z',
        retryCount: 0,
        syncResult: { revision: 'rev-current-1', resources: [] },
      },
      history: [
        { id: 1, revision: 'rev-old-0', deployedAt: '2026-10-17T00:00:00Z', deployStartedAt: '2026-10-17T00:00:00Z', source: { repoURL: 'https://git.example.test/platform/demo.git', path: 'deploy', targetRevision: 'v1.0.0' }, initiatedBy: { username: 'alice' } },
        { id: 2, revision: 'rev-current-1', deployedAt: '2026-10-18T00:00:00Z', deployStartedAt: '2026-10-18T00:00:00Z', source: { repoURL: 'https://git.example.test/platform/demo.git', path: 'deploy', targetRevision: 'v1.1.0' }, initiatedBy: { username: 'bob' } },
      ],
      conditions: [],
    },
  };
}

function defaultTreeNodes(): Array<Record<string, unknown>> {
  return [
    {
      group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'workloads', name: 'web', uid: 'uid-deploy-web',
      health: { status: 'Healthy' }, createdAt: '2026-10-18T00:00:00Z', images: ['nginx:1.27'],
    },
    {
      group: '', version: 'v1', kind: 'Pod', namespace: 'workloads', name: 'web-abc123', uid: 'uid-pod-abc123',
      parentRefs: [{ group: 'apps', kind: 'Deployment', namespace: 'workloads', name: 'web', uid: 'uid-deploy-web' }],
      health: { status: 'Healthy' }, createdAt: '2026-10-18T00:00:05Z', images: ['nginx:1.27'],
    },
  ];
}

function defaultLiveManifest(kind: string, group: string, version: string, namespace: string, name: string, uid: string): Record<string, unknown> {
  return {
    apiVersion: group ? `${group}/${version}` : version,
    kind,
    metadata: { name, namespace, uid, labels: { app: name } },
    spec: kind === 'Deployment' ? { replicas: 2, template: { spec: { containers: [{ name: 'web', image: 'nginx:1.27' }] } } }
      : { containers: [{ name: 'web', image: 'nginx:1.27' }] },
    status: kind === 'Deployment' ? { replicas: 2, readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2 } : { phase: 'Running' },
  };
}

export async function startMockArgoServer(t: TestContext, initialOptions: MockArgoServerOptions = {}): Promise<MockArgoServer> {
  const options: MockArgoServerOptions = {
    token: 'synthetic-argocd-bearer-token',
    defaultNamespace: 'argocd',
    rollbackEnforceEnable: false,
    legacyActionsOnly: false,
    syncWindowBlocked: false,
    ...initialOptions,
  };
  const requests: RecordedRequest[] = [];
  const state: MockArgoServer['state'] = {
    applications: new Map([['argocd/demo', defaultApplication('demo', 'argocd')]]),
    trees: new Map([['argocd/demo', defaultTreeNodes()]]),
    liveResources: new Map([
      ['argocd/demo|apps|Deployment|workloads|web', defaultLiveManifest('Deployment', 'apps', 'v1', 'workloads', 'web', 'uid-deploy-web')],
      ['argocd/demo||Pod|workloads|web-abc123', defaultLiveManifest('Pod', '', 'v1', 'workloads', 'web-abc123', 'uid-pod-abc123')],
    ]),
    resourceActions: new Map([
      ['apps|Deployment', [
        { name: 'restart', displayName: 'Restart', iconClass: 'fa fa-redo', disabled: false, params: [] },
        { name: 'pause', displayName: 'Pause', iconClass: 'fa fa-pause', disabled: false, params: [] },
        { name: 'resume', displayName: 'Resume', iconClass: 'fa fa-play', disabled: true, params: [] },
        { name: 'scale', displayName: 'Scale', iconClass: 'fa fa-arrows-alt-v', disabled: false, params: [{ name: 'replicas', default: '2', type: 'string' }] },
      ]],
    ]),
    applicationSets: new Map([
      ['argocd/platform-set', { metadata: { name: 'platform-set', namespace: 'argocd', uid: 'uid-appset-1' }, spec: { generators: [{ list: {} }] }, status: { conditions: [] } }],
    ]),
    projects: new Map([
      ['default', {
        metadata: { name: 'default', namespace: 'argocd', uid: 'uid-proj-default', resourceVersion: '10' },
        spec: {
          description: 'Default project',
          sourceRepos: ['https://user:proj-secret@git.example.test/platform/*'],
          sourceNamespaces: ['argocd'],
          destinations: [{ name: 'in-cluster', server: 'https://kubernetes.default.svc', namespace: '*' }],
          clusterResourceWhitelist: [{ group: '*', kind: '*' }],
          namespaceResourceBlacklist: [{ group: '', kind: 'ResourceQuota' }],
          orphanedResources: { warn: true },
          syncWindows: [{ kind: 'allow', schedule: '0 * * * *', duration: '1h', applications: ['*'] }],
          roles: [{ name: 'ops', description: 'Operators', policies: ['p, proj:default:ops, applications, *, default/*, allow'], groups: ['ops'], jwtTokens: [{ id: 'jwt-keep-1', iat: 1700000000 }] }],
        },
      }],
    ]),
    repositories: new Map([
      ['https://git.example.test/platform/demo.git', { repo: 'https://git.example.test/platform/demo.git', type: 'git', connectionState: { status: 'Successful', message: '' } }],
      ['git@git.example.test:platform/ssh-demo.git', { repo: 'git@git.example.test:platform/ssh-demo.git', type: 'git', project: 'default', connectionState: { status: 'Successful', message: '' } }],
    ]),
    clusters: new Map([
      ['https://kubernetes.default.svc', { name: 'in-cluster', server: 'https://kubernetes.default.svc', connectionState: { status: 'Successful', message: '' }, info: { serverVersion: '1.31', applicationsCount: 1 } }],
    ]),
  };

  function normalizeSubresource(resource: string, subresource: string): string {
    const projectScoped = ['applications', 'applicationsets', 'logs', 'exec'].includes(resource);
    if (projectScoped && options.defaultNamespace && subresource) {
      const parts = subresource.split('/');
      if (parts.length === 3 && parts[1] === options.defaultNamespace) return `${parts[0]}/${parts[2]}`;
    }
    return subresource;
  }

  function isAllowed(resource: string, action: string, subresource: string): boolean {
    const effectiveAction = action === 'rollback' && !options.rollbackEnforceEnable ? 'sync' : action;
    const normalized = normalizeSubresource(resource, subresource);
    for (const rule of options.deny ?? []) {
      const ruleAction = rule.action === 'rollback' && !options.rollbackEnforceEnable ? 'sync' : rule.action;
      if (rule.resource === resource && (ruleAction === effectiveAction || rule.action === action)) {
        if (!rule.subresource || rule.subresource === '*' || normalizeSubresource(resource, rule.subresource) === normalized || rule.subresource === subresource) return false;
      }
    }
    return true;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';
    const body = method !== 'GET' && method !== 'HEAD' ? await readBody(req) : undefined;
    const query: Record<string, string[]> = {};
    for (const key of new Set(url.searchParams.keys())) query[key] = url.searchParams.getAll(key);
    requests.push({ method, path: url.pathname, query, body });

    if (req.headers.authorization !== `Bearer ${options.token}`) {
      grpcError(res, 401, 16, 'invalid session: token mismatch');
      return;
    }

    if (options.failStatusOnWrite && url.pathname === options.failStatusOnWrite.operationPath && method !== 'GET') {
      grpcError(res, options.failStatusOnWrite.status, options.failStatusOnWrite.code ?? 13, options.failStatusOnWrite.message ?? 'injected failure');
      return;
    }

    // Session userinfo & version
    if (method === 'GET' && url.pathname === '/api/v1/session/userinfo') {
      jsonOk(res, { loggedIn: true, username: 'synthetic-operator', iss: 'argocd', groups: ['admins'] }); return;
    }
    if (method === 'GET' && url.pathname === '/api/version') {
      jsonOk(res, { Version: 'v3.5.3+synthetic' }); return;
    }

    // Account CanI: GET /api/v1/account/can-i/{resource}/{action}/{subresource=**}
    const canIMatch = method === 'GET' && url.pathname.match(/^\/api\/v1\/account\/can-i\/([^/]+)\/([^/]+)\/(.+)$/);
    if (canIMatch) {
      const resource = decodeURIComponent(canIMatch[1]!);
      const action = decodeURIComponent(canIMatch[2]!);
      const subresource = canIMatch[3]!.split('/').map(decodeURIComponent).join('/');
      jsonOk(res, { value: isAllowed(resource, action, subresource) ? 'yes' : 'no' });
      return;
    }

    // Applications collection: GET / POST /api/v1/applications
    if (url.pathname === '/api/v1/applications') {
      if (method === 'GET') {
        jsonOk(res, { items: [...state.applications.values()] }); return;
      }
      if (method === 'POST') {
        const app = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
        const meta = (app.metadata ?? {}) as Record<string, unknown>;
        const name = String(meta.name ?? '');
        const appNs = String(meta.namespace ?? options.defaultNamespace ?? 'argocd');
        const project = String(((app.spec ?? {}) as Record<string, unknown>).project ?? 'default');
        if (!isAllowed('applications', 'create', `${project}/${appNs}/${name}`)) { grpcError(res, 403, 7, 'permission denied'); return; }
        const key = `${appNs}/${name}`;
        if (state.applications.has(key) && url.searchParams.get('upsert') !== 'true') { grpcError(res, 409, 6, `application ${key} already exists`); return; }
        const created = { ...defaultApplication(name, appNs), ...app, metadata: { ...meta, name, namespace: appNs, uid: `uid-${appNs}-${name}` } };
        state.applications.set(key, created);
        jsonOk(res, created); return;
      }
    }

    // Application sub-routes
    const appMatch = url.pathname.match(/^\/api\/v1\/applications\/([^/]+)(?:\/(.*))?$/);
    if (appMatch) {
      const appName = decodeURIComponent(appMatch[1]!);
      const sub = appMatch[2] ?? '';
      const bodyRec = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
      const bodyMeta = (bodyRec.metadata && typeof bodyRec.metadata === 'object' ? bodyRec.metadata : {}) as Record<string, unknown>;
      const appNs = sub === '' && method === 'PUT'
        ? (typeof bodyMeta.namespace === 'string' && bodyMeta.namespace ? bodyMeta.namespace : options.defaultNamespace ?? 'argocd')
        : (url.searchParams.get('appNamespace') ?? (typeof bodyRec.appNamespace === 'string' ? bodyRec.appNamespace : options.defaultNamespace ?? 'argocd'));
      const key = `${appNs}/${appName}`;
      const app = state.applications.get(key);
      if (!app) { grpcError(res, 404, 5, `applications.argoproj.io "${appName}" not found`); return; }
      const project = String(((app.spec ?? {}) as Record<string, unknown>).project ?? 'default');
      const rbacSub = `${project}/${appNs}/${appName}`;

      if (sub === '' && method === 'GET') {
        const refresh = url.searchParams.get('refresh');
        if (refresh === 'normal' || refresh === 'hard') {
          const status = (app.status ?? {}) as Record<string, unknown>;
          status.reconciledAt = new Date().toISOString();
          app.status = status;
        }
        jsonOk(res, app); return;
      }
      if (sub === '' && method === 'PUT') {
        if (url.searchParams.has('appNamespace')) { grpcError(res, 400, 3, 'unexpected appNamespace query parameter on ApplicationUpdateRequest'); return; }
        if (!isAllowed('applications', 'update', rbacSub)) { grpcError(res, 403, 7, 'permission denied'); return; }
        const updated = { ...app, ...bodyRec, metadata: { ...(app.metadata as Record<string, unknown>), ...bodyMeta, name: appName, namespace: appNs } };
        state.applications.set(key, updated);
        jsonOk(res, updated); return;
      }
      if (sub === '' && method === 'PATCH') {
        if (!isAllowed('applications', 'update', rbacSub)) { grpcError(res, 403, 7, 'permission denied'); return; }
        const patchType = String(bodyRec.patchType ?? '');
        if (patchType !== '' && patchType !== 'json' && patchType !== 'merge') {
          grpcError(res, 400, 3, `Patch type '${patchType}' is not supported`); return;
        }
        const rawPatch = JSON.parse(String(bodyRec.patch ?? '{}')) as unknown;
        const updated = patchType === 'merge' ? deepMerge(app, rawPatch as Record<string, unknown>) : app;
        state.applications.set(key, updated);
        jsonOk(res, updated); return;
      }
      if (sub === '' && method === 'DELETE') {
        if (!isAllowed('applications', 'delete', rbacSub)) { grpcError(res, 403, 7, 'permission denied'); return; }
        const cascadeParam = url.searchParams.get('cascade');
        const policyParam = url.searchParams.get('propagationPolicy') ?? '';
        if (cascadeParam === 'false' && policyParam !== '') {
          grpcError(res, 400, 3, 'cannot set propagation policy when cascading is disabled'); return;
        }
        if (policyParam !== '' && policyParam !== 'foreground' && policyParam !== 'background') {
          grpcError(res, 400, 3, `invalid propagation policy: ${policyParam}`); return;
        }
        state.applications.delete(key);
        state.trees.delete(key);
        jsonOk(res, {}); return;
      }
      if (sub === 'sync' && method === 'POST') {
        if (options.syncWindowBlocked) { grpcError(res, 403, 7, 'cannot sync: blocked by sync window'); return; }
        if (!isAllowed('applications', 'sync', rbacSub)) { grpcError(res, 403, 7, 'permission denied'); return; }
        if ((bodyRec.revision || bodyRec.revisions) && !isAllowed('applications', 'override', rbacSub)) { grpcError(res, 403, 7, 'override permission denied'); return; }
        const status = (app.status ?? {}) as Record<string, unknown>;
        const op = (status.operationState ?? {}) as Record<string, unknown>;
        if (op.phase === 'Running') { grpcError(res, 409, 9, 'another operation is already in progress'); return; }
        status.sync = { status: bodyRec.dryRun ? 'OutOfSync' : 'Synced', revision: typeof bodyRec.revision === 'string' ? bodyRec.revision : 'rev-synced-2' };
        status.operationState = {
          phase: 'Succeeded',
          message: bodyRec.dryRun ? 'successfully synced (dry run)' : 'successfully synced (all tasks run)',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          retryCount: 0,
          syncResult: { revision: typeof bodyRec.revision === 'string' ? bodyRec.revision : 'rev-synced-2', resources: [] },
        };
        app.status = status;
        jsonOk(res, app); return;
      }
      if (sub === 'operation' && method === 'DELETE') {
        if (!isAllowed('applications', 'sync', rbacSub)) { grpcError(res, 403, 7, 'permission denied'); return; }
        const status = (app.status ?? {}) as Record<string, unknown>;
        const op = (status.operationState ?? {}) as Record<string, unknown>;
        op.phase = 'Terminated';
        op.message = 'Operation terminated by user';
        status.operationState = op;
        app.status = status;
        jsonOk(res, {}); return;
      }
      if (sub === 'rollback' && method === 'POST') {
        if (!isAllowed('applications', 'rollback', rbacSub)) { grpcError(res, 403, 7, 'permission denied'); return; }
        const status = (app.status ?? {}) as Record<string, unknown>;
        const history = (Array.isArray(status.history) ? status.history : []) as Array<Record<string, unknown>>;
        const target = history.find((item) => item.id === bodyRec.id);
        if (!target) { grpcError(res, 400, 3, `revision history id ${String(bodyRec.id)} not found`); return; }
        status.sync = { status: 'Synced', revision: target.revision };
        status.operationState = { phase: 'Succeeded', message: `rolled back to #${String(bodyRec.id)}`, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), retryCount: 0, syncResult: { revision: target.revision, resources: [] } };
        app.status = status;
        jsonOk(res, app); return;
      }
      if (sub === 'resource-tree' && method === 'GET') {
        jsonOk(res, { nodes: state.trees.get(key) ?? [], orphanedNodes: [] }); return;
      }
      if (sub === 'resource/actions' && method === 'GET') {
        const group = url.searchParams.get('group') ?? '';
        const kind = url.searchParams.get('kind') ?? '';
        jsonOk(res, { actions: state.resourceActions.get(`${group}|${kind}`) ?? [] }); return;
      }
      if (sub === 'resource/actions/v2' && method === 'POST') {
        if (options.legacyActionsOnly) { grpcError(res, 404, 12, 'RunResourceActionV2 not implemented'); return; }
        const action = String(bodyRec.action ?? '');
        const group = String(bodyRec.group ?? '');
        const kind = String(bodyRec.kind ?? '');
        if (!isAllowed('applications', `action/${group}/${kind}/${action}`, rbacSub)) { grpcError(res, 403, 7, 'permission denied'); return; }
        jsonOk(res, {}); return;
      }
      if (sub === 'resource/actions' && method === 'POST') {
        const action = typeof body === 'string' ? body : '';
        const group = url.searchParams.get('group') ?? '';
        const kind = url.searchParams.get('kind') ?? '';
        if (!isAllowed('applications', `action/${group}/${kind}/${action}`, rbacSub)) { grpcError(res, 403, 7, 'permission denied'); return; }
        jsonOk(res, {}); return;
      }
      if (sub === 'resource') {
        const group = url.searchParams.get('group') ?? '';
        const kind = url.searchParams.get('kind') ?? '';
        const namespace = url.searchParams.get('namespace') ?? '';
        const resourceName = url.searchParams.get('resourceName') ?? '';
        const resKey = `${key}|${group}|${kind}|${namespace}|${resourceName}`;
        if (method === 'GET') {
          const live = state.liveResources.get(resKey);
          if (!live) { grpcError(res, 404, 5, 'resource not found'); return; }
          jsonOk(res, { manifest: JSON.stringify(live) }); return;
        }
        if (method === 'DELETE') {
          if (!isAllowed('applications', 'delete', rbacSub)) { grpcError(res, 403, 7, 'permission denied'); return; }
          state.liveResources.delete(resKey);
          const nodes = state.trees.get(key) ?? [];
          state.trees.set(key, nodes.filter((node) => !(node.group === group && node.kind === kind && node.namespace === namespace && node.name === resourceName)));
          jsonOk(res, {}); return;
        }
        if (method === 'POST') {
          if (!isAllowed('applications', 'update', rbacSub)) { grpcError(res, 403, 7, 'permission denied'); return; }
          const k8sPatchType = url.searchParams.get('patchType') ?? '';
          if (!['application/json-patch+json', 'application/merge-patch+json', 'application/strategic-merge-patch+json'].includes(k8sPatchType)) {
            grpcError(res, 400, 3, `unsupported Kubernetes patch media type: ${k8sPatchType}`); return;
          }
          const live = state.liveResources.get(resKey);
          if (!live) { grpcError(res, 404, 5, 'resource not found'); return; }
          const parsedPatch = JSON.parse(typeof body === 'string' ? body : '{}') as unknown;
          const merged = Array.isArray(parsedPatch) ? live : deepMerge(live, parsedPatch as Record<string, unknown>);
          state.liveResources.set(resKey, merged);
          jsonOk(res, { manifest: JSON.stringify(merged) }); return;
        }
      }
    }

    // ApplicationSets
    if (url.pathname === '/api/v1/applicationsets') {
      if (method === 'GET') { jsonOk(res, { items: [...state.applicationSets.values()] }); return; }
      if (method === 'POST') {
        const as = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
        const meta = (as.metadata ?? {}) as Record<string, unknown>;
        const name = String(meta.name ?? '');
        const ns = String(meta.namespace ?? options.defaultNamespace ?? 'argocd');
        if (!isAllowed('applicationsets', 'create', `*/${ns}/${name}`)) { grpcError(res, 403, 7, 'permission denied'); return; }
        const created = { ...as, metadata: { ...meta, name, namespace: ns, uid: `uid-appset-${name}` } };
        state.applicationSets.set(`${ns}/${name}`, created);
        jsonOk(res, created); return;
      }
    }
    const appsetMatch = url.pathname.match(/^\/api\/v1\/applicationsets\/([^/]+)$/);
    if (appsetMatch) {
      const name = decodeURIComponent(appsetMatch[1]!);
      const ns = url.searchParams.get('appsetNamespace') ?? options.defaultNamespace ?? 'argocd';
      const key = `${ns}/${name}`;
      if (method === 'GET') {
        const found = state.applicationSets.get(key);
        if (!found) { grpcError(res, 404, 5, 'not found'); return; }
        jsonOk(res, found); return;
      }
      if (method === 'DELETE') {
        if (!isAllowed('applicationsets', 'delete', `*/${ns}/${name}`)) { grpcError(res, 403, 7, 'permission denied'); return; }
        if (!state.applicationSets.has(key)) { grpcError(res, 404, 5, 'not found'); return; }
        state.applicationSets.delete(key);
        jsonOk(res, {}); return;
      }
    }

    // Projects
    if (url.pathname === '/api/v1/projects') {
      if (method === 'GET') { jsonOk(res, { items: [...state.projects.values()] }); return; }
      if (method === 'POST') {
        const wrapper = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
        const proj = (wrapper.project ?? wrapper) as Record<string, unknown>;
        const meta = (proj.metadata ?? {}) as Record<string, unknown>;
        const name = String(meta.name ?? '');
        if (!isAllowed('projects', 'create', name)) { grpcError(res, 403, 7, 'permission denied'); return; }
        const created = { ...proj, metadata: { ...meta, name, namespace: 'argocd', uid: `uid-proj-${name}`, resourceVersion: '1' } };
        state.projects.set(name, created);
        jsonOk(res, created); return;
      }
    }
    const projMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (projMatch) {
      const name = decodeURIComponent(projMatch[1]!);
      if (method === 'GET') {
        const existing = state.projects.get(name);
        if (!existing) { grpcError(res, 404, 5, 'project not found'); return; }
        jsonOk(res, existing); return;
      }
      if (method === 'PUT') {
        if (!isAllowed('projects', 'update', name)) { grpcError(res, 403, 7, 'permission denied'); return; }
        const existing = state.projects.get(name);
        if (!existing) { grpcError(res, 404, 5, 'project not found'); return; }
        const wrapper = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
        const proj = (wrapper.project ?? wrapper) as Record<string, unknown>;
        const existingRv = ((existing.metadata ?? {}) as Record<string, unknown>).resourceVersion;
        const incomingRv = ((proj.metadata ?? {}) as Record<string, unknown>).resourceVersion;
        if (existingRv !== undefined && incomingRv !== existingRv) {
          grpcError(res, 422, 3, 'metadata.resourceVersion must be preserved on Project update'); return;
        }
        // Full replacement like upstream Kubernetes AppProject.Update (no server-side merge!)
        const replaced = { ...proj, metadata: { ...((proj.metadata ?? {}) as Record<string, unknown>), name } };
        state.projects.set(name, replaced);
        jsonOk(res, replaced); return;
      }
      if (method === 'DELETE') {
        if (!isAllowed('projects', 'delete', name)) { grpcError(res, 403, 7, 'permission denied'); return; }
        state.projects.delete(name);
        jsonOk(res, {}); return;
      }
    }

    // Repositories
    if (url.pathname === '/api/v1/repositories' && method === 'GET') {
      jsonOk(res, { items: [...state.repositories.values()] }); return;
    }
    const repoValidateMatch = url.pathname.match(/^\/api\/v1\/repositories\/([^/]+)\/validate$/);
    if (repoValidateMatch && method === 'POST') {
      if (body !== undefined && typeof body !== 'string') {
        grpcError(res, 400, 3, 'json: cannot unmarshal non-string body into RepoAccessQuery.repo'); return;
      }
      const repo = decodeURIComponent(repoValidateMatch[1]!);
      const proj = url.searchParams.get('project') ?? '';
      const rbacTarget = proj ? `${proj}/${repo}` : repo;
      if (!isAllowed('repositories', 'create', rbacTarget)) { grpcError(res, 403, 7, 'permission denied'); return; }
      jsonOk(res, {}); return;
    }
    const repoMatch = url.pathname.match(/^\/api\/v1\/repositories\/([^/]+)$/);
    if (repoMatch && method === 'DELETE') {
      const repo = decodeURIComponent(repoMatch[1]!);
      const appProject = url.searchParams.get('appProject') ?? '';
      const rbacTarget = appProject ? `${appProject}/${repo}` : repo;
      if (!isAllowed('repositories', 'delete', rbacTarget)) { grpcError(res, 403, 7, 'permission denied'); return; }
      const stored = state.repositories.get(repo);
      if (!stored || (appProject && (stored.project ?? '') !== appProject)) {
        grpcError(res, 404, 5, 'repository not found'); return;
      }
      state.repositories.delete(repo);
      jsonOk(res, {}); return;
    }

    // Clusters
    if (url.pathname === '/api/v1/clusters' && method === 'GET') {
      jsonOk(res, { items: [...state.clusters.values()] }); return;
    }
    const clusterInvalidateMatch = url.pathname.match(/^\/api\/v1\/clusters\/([^/]+)\/invalidate-cache$/);
    if (clusterInvalidateMatch && method === 'POST') {
      const idVal = decodeURIComponent(clusterInvalidateMatch[1]!);
      const byName = url.searchParams.get('id.type') === 'name';
      const found = byName
        ? [...state.clusters.values()].find((c) => c.name === idVal)
        : state.clusters.get(idVal);
      if (!found) { grpcError(res, 403, 7, 'permission denied'); return; }
      const srv = String(found.server ?? idVal);
      if (!isAllowed('clusters', 'update', srv)) { grpcError(res, 403, 7, 'permission denied'); return; }
      found.refreshRequestedAt = new Date().toISOString();
      jsonOk(res, found); return;
    }
    const clusterMatch = url.pathname.match(/^\/api\/v1\/clusters\/([^/]+)$/);
    if (clusterMatch && method === 'DELETE') {
      const idVal = decodeURIComponent(clusterMatch[1]!);
      const byName = url.searchParams.get('id.type') === 'name';
      const entry = byName
        ? [...state.clusters.entries()].find(([, c]) => c.name === idVal)
        : (state.clusters.has(idVal) ? [idVal, state.clusters.get(idVal)!] as const : undefined);
      if (!entry) { grpcError(res, 403, 7, 'permission denied'); return; }
      if (!isAllowed('clusters', 'delete', String(entry[1].server ?? idVal))) { grpcError(res, 403, 7, 'permission denied'); return; }
      state.clusters.delete(entry[0]);
      jsonOk(res, {}); return;
    }

    grpcError(res, 404, 5, `unhandled route ${method} ${url.pathname}`);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind mock Argo CD server');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // Isolated temporary CLI config; never touches host ~/.config/argocd or ~/.kube
  const dir = await mkdtemp(join(tmpdir(), 'oc-argocd-fixture-'));
  const configPath = join(dir, 'config');
  await writeFile(configPath, stringifyYaml({
    'current-context': 'fixture',
    contexts: [{ name: 'fixture', server: `127.0.0.1:${address.port}`, user: 'fixture-user' }],
    servers: [{ server: `127.0.0.1:${address.port}`, 'plain-text': true }],
    users: [{ name: 'fixture-user', 'auth-token': options.token }],
  }), 'utf8');

  const servicesToClose: Array<() => Promise<void>> = [];
  const close = async () => {
    for (const fn of servicesToClose) await fn().catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  };
  t.after(close);

  const createClient = () => new ArgoClient(new CredentialProvider({ configPath, env: {} }), null, true);

  const createHostService = async (serviceToken = 'synthetic-host-service-token') => {
    const client = createClient();
    const svc = createService({ token: serviceToken, client: async () => client });
    await new Promise<void>((resolve) => svc.server.listen(0, '127.0.0.1', resolve));
    const addr = svc.server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind host service');
    const svcBase = `http://127.0.0.1:${addr.port}`;
    servicesToClose.push(() => svc.close());
    return {
      baseUrl: svcBase,
      token: serviceToken,
      async request<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}) {
        const response = await fetch(`${svcBase}${path}`, {
          method: init.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${serviceToken}`,
            ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        });
        return { status: response.status, body: await response.json() as T };
      },
    };
  };

  return { baseUrl, token: options.token!, configPath, requests, options, state, createClient, createHostService, close };
}
