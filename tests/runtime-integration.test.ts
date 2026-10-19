import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { ArgoClient } from '../src/service/argocd/client.js';
import { RefreshCoordinator } from '../src/service/auth/refresh.js';
import { QueryCoordinator } from '../src/service/runtime/queries.js';
import { TaskManager } from '../src/service/runtime/tasks.js';
import { createService } from '../src/service/runtime/server.js';
import { rawApplication } from './application-fixtures.js';
import { configFixture, syntheticConfig } from './helpers.js';

test('HTTP cache metadata, identity invalidation and task lifecycle stay scoped and read-only', async (t) => {
  let requests = 0;
  const upstream = createServer((req, res) => {
    assert.equal(req.method, 'GET'); assert.doesNotMatch(req.url!, /refresh|sync$/);
    requests++;
    res.setHeader('content-type', 'application/json');
    const url = new URL(req.url!, 'http://localhost');
    res.end(JSON.stringify(url.pathname === '/api/v1/applications'
      ? { items: [rawApplication(`snapshot-${requests}`)] }
      : rawApplication('demo', url.searchParams.get('appNamespace') ?? 'argocd')));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const config = syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`);
  const fixture = await configFixture(t, config);
  let now = Date.now();
  const api = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail()), true, new QueryCoordinator({ now: () => now, ttlMs: 1000 }));
  const service = createService({ token: 'synthetic-host', client: async () => api, tasks: new TaskManager({ retentionMs: 2000 }) });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const headers = { authorization: 'Bearer synthetic-host', 'content-type': 'application/json' };
  const get = async (path: string) => (await fetch(base + path, { headers })).json();
  const first = await get('/v1/applications?context=primary');
  const cached = await get('/v1/applications?context=primary');
  assert.equal(first.source, 'argo-api'); assert.equal(cached.source, 'cache');
  assert.equal(cached.sampledAt, first.sampledAt); assert.equal(requests, 1);
  await get('/v1/application?context=primary&name=demo&appNamespace=namespace-a');
  const namespaced = await get('/v1/application?context=primary&name=demo&appNamespace=namespace-b');
  assert.equal(namespaced.data.appNamespace, 'namespace-b'); assert.equal(requests, 3);
  config.users[0]!['auth-token'] = 'synthetic-rotated'; await fixture.write(config);
  const changed = await get('/v1/applications?context=primary');
  assert.equal(changed.source, 'argo-api'); assert.equal(requests, 4);
  now += 1001;
  await get('/v1/applications?context=primary'); assert.equal(requests, 5);
  const created = await (await fetch(base + '/v1/tasks', { method: 'POST', headers, body: JSON.stringify({ operation: 'applications', context: 'primary', filters: {} }) })).json();
  assert.equal(created.ok, true);
  const id = created.data.id as string;
  let task;
  for (let attempt = 0; attempt < 50; attempt++) {
    task = await get(`/v1/tasks?context=primary&id=${id}`);
    if (task.data.state === 'succeeded') break;
    await delay(5);
  }
  assert.equal(task.data.state, 'succeeded'); assert.equal(task.data.result.source, 'cache');
  assert.equal((await fetch(base + `/v1/tasks?context=secondary&id=${id}`, { headers })).status, 404);
  config.users[0]!['auth-token'] = 'synthetic-another-rotation'; await fixture.write(config);
  assert.equal((await fetch(base + `/v1/tasks?context=primary&id=${id}`, { headers })).status, 404);
  const invalid = [
    JSON.stringify({ operation: 'sync', context: 'primary' }), '{bad',
    JSON.stringify({ operation: 'applications', context: 'primary', filters: { refresh: 'hard' } }),
  ];
  for (const body of invalid) assert.equal((await fetch(base + '/v1/tasks', { method: 'POST', headers, body })).status, 400);
  assert.equal((await fetch(base + '/v1/tasks', { method: 'POST', headers, body: 'x'.repeat(8001) })).status, 413);
  assert.equal((await fetch(base + '/v1/tasks', { method: 'POST', headers: { authorization: headers.authorization, 'content-type': 'text/plain' }, body: '{}' })).status, 400);
});

test('HTTP cancellation aborts a running task and Service shutdown cancels outstanding reads', async (t) => {
  let received!: () => void;
  const entered = new Promise<void>((resolve) => { received = resolve; });
  const upstream = createServer(() => { received(); });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const fixture = await configFixture(t, syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`));
  const api = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail()), true);
  const service = createService({ token: 'synthetic-host', client: async () => api });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { if (service.server.listening) await service.close(); });
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const headers = { authorization: 'Bearer synthetic-host', 'content-type': 'application/json' };
  const created = await (await fetch(base + '/v1/tasks', { method: 'POST', headers, body: JSON.stringify({ operation: 'applications', context: 'primary' }) })).json();
  await entered;
  const cancelled = await (await fetch(base + `/v1/tasks?context=primary&id=${created.data.id}`, { method: 'DELETE', headers })).json();
  assert.equal(cancelled.data.state, 'cancelled');
  assert.equal(cancelled.data.result, undefined);
  await service.close();
});
