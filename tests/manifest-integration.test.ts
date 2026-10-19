import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { ArgoClient } from '../src/service/argocd/client.js';
import { RefreshCoordinator } from '../src/service/auth/refresh.js';
import { QueryCoordinator } from '../src/service/runtime/queries.js';
import { TaskManager } from '../src/service/runtime/tasks.js';
import { createService } from '../src/service/runtime/server.js';
import { configFixture, syntheticConfig } from './helpers.js';
import { rawApplication } from './application-fixtures.js';
import { deployment, rawComparison } from './manifest-fixtures.js';

async function fixture(t: TestContext, options: { multi?: boolean; version?: string; comparisonError?: boolean; hang?: boolean; large?: boolean; denied?: boolean } = {}) {
  const calls: URL[] = [];
  const upstream = createServer((req, res) => {
    assert.equal(req.method, 'GET'); assert.equal(req.headers.authorization, 'Bearer synthetic-original');
    const url = new URL(req.url!, 'http://localhost'); calls.push(url);
    assert.equal(url.searchParams.has('refresh'), false);
    res.setHeader('content-type', 'application/json');
    if (url.pathname.endsWith('/managed-resources') && options.hang) return;
    if (options.denied && (url.pathname.endsWith('/manifests') || url.pathname.endsWith('/managed-resources'))) { res.statusCode = 403; res.end(JSON.stringify({ error: 'private-upstream-error' })); return; }
    let body: unknown;
    if (url.pathname === '/api/version') body = { Version: options.version ?? 'v3.1.8+test' };
    else if (url.pathname.endsWith('/manifests')) body = { manifests: [JSON.stringify({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'configuration', namespace: 'workloads', annotations: { note: 'private-annotation' } }, data: { ordinary: 'private-secret' } }), JSON.stringify(options.large ? { ...deployment(), spec: { message: 'x'.repeat(1_000_001) } } : deployment())], commands: ['private-command'] };
    else if (url.pathname.endsWith('/managed-resources')) body = { items: [rawComparison()] };
    else if (url.pathname === '/api/v1/applications/demo') {
      const raw = rawApplication('demo', url.searchParams.get('appNamespace') ?? 'argocd');
      body = { ...raw, spec: options.multi ? { ...raw.spec, source: undefined, sources: [raw.spec.source, { repoURL: 'https://example.test/values.git', ref: 'values', targetRevision: 'main' }] } : raw.spec,
        status: { ...raw.status, conditions: options.comparisonError ? raw.status.conditions : [], sync: { status: 'Synced', revision: 'server-compared' } } };
    } else { res.statusCode = 404; body = {}; }
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const config = await configFixture(t, syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`));
  const api = new ArgoClient(config.provider, new RefreshCoordinator(async () => assert.fail()), true, new QueryCoordinator(options.hang ? { timeoutMs: 100 } : {}));
  const service = createService({ token: 'synthetic-host', client: async () => api, tasks: new TaskManager({ timeoutMs: 1000 }) });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const headers = { authorization: 'Bearer synthetic-host', 'content-type': 'application/json' };
  const get = async (path: string) => { const res = await fetch(base + path, { headers }); return { status: res.status, body: await res.json() }; };
  const task = async (operation: string, extra: Record<string, unknown> = {}) => {
    const created = await (await fetch(base + '/v1/tasks', { method: 'POST', headers, body: JSON.stringify({ operation, context: 'primary', name: 'demo', appNamespace: 'argocd', ...extra }) })).json();
    assert.equal(created.ok, true);
    for (let i = 0; i < 150; i++) { const res = await get(`/v1/tasks?context=primary&id=${created.data.id}`); if (['failed', 'succeeded', 'cancelled'].includes(res.body.data.state)) return res.body.data; await delay(5); }
    assert.fail('Task did not finish');
  };
  return { calls, api, get, task };
}

test('Manifest and normalized Diff tasks are bounded, redacted, namespace-aware and revision-isolated', async (t) => {
  const f = await fixture(t);
  const first = await f.task('manifests', { selection: { revision: 'feature/one?x&y' } });
  assert.equal(first.state, 'succeeded'); assert.equal(first.result.data.items.length, 2);
  assert.doesNotMatch(JSON.stringify(first), /private-secret|private-annotation|private-command/);
  assert.equal(first.result.data.resolvedRevision, '');
  await f.task('manifests', { selection: { revision: 'feature/two' } });
  await f.task('manifests', { selection: { revision: 'feature/one?x&y' } });
  const previews = f.calls.filter((url) => url.pathname.endsWith('/manifests'));
  assert.equal(previews.length, 2); assert.equal(previews[0]?.searchParams.get('revision'), 'feature/one?x&y');
  assert.equal(previews[0]?.searchParams.get('appNamespace'), 'argocd');
  const diff = await f.task('comparison'); assert.equal(diff.state, 'succeeded');
  assert.equal(diff.result.data.items[0].status, 'different'); assert.deepEqual(diff.result.data.items[0].changedPaths, ['/spec/replicas']);
  assert.equal(diff.result.data.applicationObservation.blocked, false);
  assert.equal((await f.get('/v1/comparison?context=primary&name=demo&appNamespace=argocd&revision=other')).status, 400);
  assert.equal((await f.get('/v1/manifests?context=primary&name=demo&appNamespace=argocd&refresh=hard')).status, 400);
});

test('multi-source override uses paired repeated params and does not pretend to filter combined manifests', async (t) => {
  const f = await fixture(t, { multi: true });
  const task = await f.task('manifests', { selection: { sources: [{ position: 2, revision: 'values/next' }, { position: 1, revision: 'code/release' }] } });
  assert.equal(task.state, 'succeeded'); assert.equal(task.result.data.items.length, 2);
  const call = f.calls.find((url) => url.pathname.endsWith('/manifests'))!;
  assert.deepEqual(call.searchParams.getAll('sourcePositions'), ['1', '2']); assert.deepEqual(call.searchParams.getAll('revisions'), ['code/release', 'values/next']);
  const invalid = await f.task('manifests', { selection: { revision: 'single-revision-on-multisource' } }); assert.equal(invalid.error.code, 'BAD_REQUEST');
  const outOfRange = await f.task('manifests', { selection: { sources: [{ position: 3, revision: 'main' }] } }); assert.equal(outOfRange.error.code, 'BAD_REQUEST');
});

test('older API refuses multi-source revision override without making an unhonored manifest request', async (t) => {
  const f = await fixture(t, { multi: true, version: 'v2.10.20' });
  const result = await f.task('manifests', { selection: { sources: [{ position: 1, revision: 'main' }] } });
  assert.equal(result.state, 'failed'); assert.equal(result.error.code, 'CAPABILITY_UNAVAILABLE');
  assert.equal(f.calls.some((call) => call.pathname.endsWith('/manifests')), false);
});

test('comparison errors block nominal cached pair and permission failures remain failures', async (t) => {
  const f = await fixture(t, { comparisonError: true });
  const diff = await f.task('comparison'); assert.equal(diff.result.data.applicationObservation.blocked, true);
  assert.equal(diff.result.data.items[0].status, 'unavailable'); assert.equal(diff.result.data.items[0].reason, 'APPLICATION_COMPARISON_UNAVAILABLE');
  const denied = await fixture(t, { denied: true });
  for (const operation of ['manifests', 'comparison']) {
    const result = await denied.task(operation); assert.equal(result.state, 'failed'); assert.equal(result.error.code, 'FORBIDDEN'); assert.equal(result.result, undefined); assert.doesNotMatch(JSON.stringify(result), /private-upstream-error/);
  }
});

test('large Manifest and stalled comparison task explicitly fail rather than becoming empty success', async (t) => {
  const large = await fixture(t, { large: true });
  const result = await large.task('manifests'); assert.equal(result.error.code, 'RESPONSE_TOO_LARGE'); assert.equal(result.result, undefined);
  const slow = await fixture(t, { hang: true });
  const timeout = await slow.task('comparison'); assert.equal(timeout.error.code, 'TIMEOUT'); assert.equal(timeout.result, undefined);
});

test('composite comparison refuses to mix an old application observation with a newly rotated identity', async (t) => {
  let rotate: (() => Promise<void>) | undefined;
  const upstream = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url!.includes('/managed-resources')) {
      if (rotate) { const current = rotate; rotate = undefined; await current(); }
      res.end(JSON.stringify({ items: [rawComparison()] }));
    } else { const raw = rawApplication(); res.end(JSON.stringify({ ...raw, status: { ...raw.status, conditions: [] } })); }
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const config = syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`); const f = await configFixture(t, config);
  rotate = async () => { config.users[0]!['auth-token'] = 'synthetic-rotated'; await f.write(config); };
  const api = new ArgoClient(f.provider, new RefreshCoordinator(async () => assert.fail()), true); t.after(() => api.close());
  await assert.rejects(api.comparisonSnapshot('primary', { name: 'demo', appNamespace: 'argocd' }, new AbortController().signal), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'AUTH_REQUIRED');
});
