import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { ArgoClient } from '../src/service/argocd/client.js';
import { RefreshCoordinator } from '../src/service/auth/refresh.js';
import { createService } from '../src/service/runtime/server.js';
import { rawApplication } from './application-fixtures.js';
import { rawAppSet, rawCluster, rawProject, rawRepository } from './management-fixtures.js';
import { rawEvent } from './resource-fixtures.js';
import { configFixture, syntheticConfig } from './helpers.js';

async function fixture(t: TestContext, options: { events?: boolean; denied?: boolean } = {}) {
  const calls: URL[] = [];
  const upstream = createServer((req, res) => {
    assert.equal(req.method, 'GET'); const url = new URL(req.url!, 'http://localhost'); calls.push(url);
    assert.equal(url.searchParams.has('forceRefresh'), false); assert.equal(url.searchParams.has('refresh'), false);
    res.setHeader('content-type', 'application/json');
    if (options.denied && url.pathname === '/api/v1/projects') { res.statusCode = 403; res.end('{"message":"opaque-upstream-error"}'); return; }
    let body: unknown;
    if (url.pathname === '/api/v1/projects') body = { items: [rawProject()] };
    else if (url.pathname === '/api/v1/projects/platform') body = rawProject();
    else if (url.pathname === '/api/v1/projects/platform/syncwindows') body = { windows: rawProject().spec.syncWindows };
    else if (url.pathname === '/api/v1/applications/demo/syncwindows') body = { canSync: false, activeWindows: rawProject().spec.syncWindows, assignedWindows: rawProject().spec.syncWindows };
    else if (url.pathname === '/api/v1/repositories') body = { items: [{ ...rawRepository(), name: req.headers.authorization === 'Bearer synthetic-viewer' ? 'viewer' : 'operator' }] };
    else if (url.pathname === '/api/v1/clusters') body = { items: [rawCluster()] };
    else if (url.pathname === '/api/v1/applicationsets') body = { items: [rawAppSet('set-a', url.searchParams.get('appsetNamespace') || 'argocd')] };
    else if (url.pathname === '/api/v1/applicationsets/set-a') body = rawAppSet('set-a', url.searchParams.get('appsetNamespace') || 'argocd');
    else if (url.pathname === '/api/v1/applicationsets/set-a/resource-tree') body = { nodes: [{ group: 'argoproj.io', kind: 'Application', namespace: 'team-a', name: 'same' }, { group: 'argoproj.io', kind: 'Application', namespace: 'team-b', name: 'same' }] };
    else if (url.pathname === '/api/v1/applicationsets/set-a/events' && options.events) {
      const namespace = url.searchParams.get('appsetNamespace') || 'argocd';
      body = { items: [rawEvent({ group: 'argoproj.io', version: 'v1alpha1', kind: 'ApplicationSet', namespace, name: 'set-a', uid: `uid-${namespace}-set-a` })] };
    } else if (url.pathname === '/api/v1/applications') body = { items: [rawApplication()] };
    else { res.statusCode = 404; body = { message: 'opaque-unavailable-route' }; }
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const config = await configFixture(t, syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`));
  const api = new ArgoClient(config.provider, new RefreshCoordinator(async () => assert.fail()), true);
  const service = createService({ token: 'synthetic-host', client: async () => api });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`; const headers = { authorization: 'Bearer synthetic-host', 'content-type': 'application/json' };
  const get = async (operation: string, parameters: Record<string, string> = {}) => {
    const res = await fetch(base + '/v1/management?' + new URLSearchParams({ context: 'primary', operation, ...parameters }), { headers }); return { status: res.status, body: await res.json() };
  };
  const task = async (operation: string, parameters = {}) => {
    const created = await (await fetch(base + '/v1/tasks', { method: 'POST', headers, body: JSON.stringify({ context: 'primary', operation, ...parameters }) })).json(); assert.equal(created.ok, true);
    for (let i = 0; i < 100; i++) {
      const result = await (await fetch(base + '/v1/tasks?' + new URLSearchParams({ context: 'primary', id: created.data.id }), { headers })).json();
      if (['failed', 'succeeded', 'cancelled'].includes(result.data.state)) return result.data;
      await delay(5);
    }
    assert.fail('Management task did not settle');
  };
  return { base, headers, get, task, calls };
}

test('management task/HTTP outputs are whitelisted and safe while preserving navigation metadata', async (t) => {
  const f = await fixture(t, { events: true });
  const commands: Array<[string, Record<string, string>]> = [
    ['projects', {}], ['project', { project: 'platform' }], ['projectWindows', { project: 'platform' }], ['repositories', {}], ['clusters', {}], ['applicationSets', { appsetNamespace: 'argocd' }], ['applicationSet', { name: 'set-a', appsetNamespace: 'argocd' }], ['applicationSetChildren', { name: 'set-a', appsetNamespace: 'argocd' }], ['applicationSetEvents', { name: 'set-a', appsetNamespace: 'argocd' }], ['applicationWindows', { name: 'demo', appNamespace: 'argocd' }],
  ];
  for (const [operation, parameters] of commands) {
    const result = await f.task(operation, parameters); assert.equal(result.state, 'succeeded', operation); assert.doesNotMatch(JSON.stringify(result), /opaque-|synthetic-original|synthetic-refresh/);
  }
  const windows = await f.get('applicationWindows', { name: 'demo', appNamespace: 'argocd' }); assert.equal(windows.body.data.canSync, false);
  const children = await f.get('applicationSetChildren', { name: 'set-a', appsetNamespace: 'argocd' }); assert.deepEqual(children.body.data.items.map((item: { appNamespace: string }) => item.appNamespace), ['team-a', 'team-b']);
  const appsetCalls = f.calls.filter((url) => /applicationsets\/set-a/.test(url.pathname));
  assert.ok(appsetCalls.every((url) => url.searchParams.get('appsetNamespace') === 'argocd' && !url.searchParams.has('appNamespace')));
});

test('management cache isolates namespaces and identities and refuses side-effect/credential query parameters', async (t) => {
  const f = await fixture(t);
  const first = await f.get('applicationSet', { name: 'set-a', appsetNamespace: 'team-a' }); const other = await f.get('applicationSet', { name: 'set-a', appsetNamespace: 'team-b' });
  assert.equal(first.body.data.namespace, 'team-a'); assert.equal(other.body.data.namespace, 'team-b');
  const operator = await f.get('repositories'); const viewer = await f.get('repositories', { context: 'secondary' }); assert.equal(operator.body.data.items[0].name, 'operator'); assert.equal(viewer.body.data.items[0].name, 'viewer');
  const before = f.calls.length;
  for (const [operation, parameters] of [['repositories', { forceRefresh: 'true' }], ['clusters', { server: 'https://arbitrary.example.test' }], ['applicationSet', { name: 'set-a', appNamespace: 'wrong' }], ['generate', {}]] as const) assert.equal((await f.get(operation, parameters)).status, 400);
  assert.equal(f.calls.length, before);
  assert.equal((await fetch(f.base + '/v1/management?context=primary&operation=projects', { method: 'POST', headers: f.headers })).status, 405);
});

test('forbidden projects and unsupported ApplicationSet events do not break existing application observability', async (t) => {
  const f = await fixture(t, { denied: true });
  const denied = await f.get('projects'); assert.equal(denied.status, 403); assert.equal(denied.body.error.code, 'FORBIDDEN'); assert.doesNotMatch(JSON.stringify(denied), /opaque-upstream-error/);
  const events = await f.task('applicationSetEvents', { name: 'set-a', appsetNamespace: 'argocd' }); assert.equal(events.state, 'failed'); assert.equal(events.error.code, 'NOT_FOUND'); assert.equal(events.result, undefined);
  const parent = await f.get('applicationSet', { name: 'set-a', appsetNamespace: 'argocd' }); assert.equal(parent.status, 200);
  const applications = await (await fetch(f.base + '/v1/applications?context=primary', { headers: f.headers })).json(); assert.equal(applications.ok, true); assert.equal(applications.data.items[0].name, 'demo');
});
