import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { ArgoClient } from '../src/service/argocd/client.js';
import { RefreshCoordinator } from '../src/service/auth/refresh.js';
import { createService } from '../src/service/runtime/server.js';
import { configFixture, syntheticConfig } from './helpers.js';
import { otherPodRef, podRef, rawEvent, rawPod, rawTree } from './resource-fixtures.js';
import type { ResourceReference } from '../src/shared/resources.js';

async function fixture(t: TestContext) {
  const calls: URL[] = []; let eventsStatus = 200; let resourceStatus = 200; let uid = podRef.uid;
  const upstream = createServer((req, res) => {
    assert.equal(req.method, 'GET'); assert.equal(req.headers.authorization, 'Bearer synthetic-original');
    const url = new URL(req.url!, 'http://localhost'); calls.push(url);
    assert.equal(url.searchParams.has('refresh'), false);
    res.setHeader('content-type', 'application/json');
    const ref = url.searchParams.get('namespace') === 'team-b' ? otherPodRef : { ...podRef, uid };
    let body: unknown;
    if (url.pathname.endsWith('/resource-tree')) body = { ...rawTree(), nodes: [...rawTree().nodes, { ...podRef, kind: 'Secret', name: 'configuration', uid: 'secret-a' }] };
    else if (url.pathname.endsWith('/resource')) {
      const manifest = url.searchParams.get('kind') === 'Secret'
        ? { apiVersion: 'v1', kind: 'Secret', metadata: { namespace: 'team-a', name: 'configuration', uid: 'secret-a' }, data: { ordinary: 'private-secret-value' }, stringData: { text: 'private-stringData-value' } } : rawPod(ref);
      res.statusCode = resourceStatus; body = resourceStatus === 200 ? { manifest: JSON.stringify(manifest) } : { message: 'private-error-token' };
    }
    else if (url.pathname.endsWith('/events')) { res.statusCode = eventsStatus; body = eventsStatus === 200 ? { items: [rawEvent(), rawEvent(otherPodRef), rawEvent({ ...podRef, uid: 'old' })] } : { message: 'private-error-token' }; }
    else if (url.pathname === '/api/v1/projects/default') body = { spec: { orphanedResources: { warn: false }, roles: [{ jwtTokens: ['private-project-token'] }] } };
    else { res.statusCode = 404; body = {}; }
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const config = await configFixture(t, syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`));
  const api = new ArgoClient(config.provider, new RefreshCoordinator(async () => assert.fail()), true);
  const service = createService({ token: 'synthetic-host', client: async () => api });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const headers = { authorization: 'Bearer synthetic-host', 'content-type': 'application/json' };
  const get = async (path: string, values: Record<string, string>) => {
    const response = await fetch(base + path + '?' + new URLSearchParams(values), { headers }); return { status: response.status, body: await response.json() };
  };
  const task = async (body: unknown) => {
    const started = await (await fetch(base + '/v1/tasks', { method: 'POST', headers, body: JSON.stringify(body) })).json();
    assert.equal(started.ok, true);
    for (let i = 0; i < 100; i++) {
      const value = await get('/v1/tasks', { context: 'primary', id: started.data.id });
      if (['succeeded', 'failed', 'cancelled'].includes(value.body.data.state)) return value.body.data;
      await delay(5);
    }
    assert.fail('Task did not settle');
  };
  return { calls, api, get, task, setEventsStatus: (value: number) => { eventsStatus = value; }, setResourceStatus: (value: number) => { resourceStatus = value; }, setUID: (value: string) => { uid = value; } };
}
const app = { name: 'demo', appNamespace: 'argocd' };
const params = (ref: ResourceReference) => ({ context: 'primary', ...app, group: ref.group, version: ref.version, kind: ref.kind, namespace: ref.namespace, resourceName: ref.name, uid: ref.uid });

test('resource/task HTTP flow validates app namespace, protects Live payloads and scopes events to selected UID', async (t) => {
  const f = await fixture(t);
  const tree = await f.task({ operation: 'resourceTree', context: 'primary', ...app });
  assert.equal(tree.state, 'succeeded'); assert.equal(tree.result.data.nodes.length, 4);
  const pod = await f.task({ operation: 'resource', context: 'primary', ...app, resource: podRef });
  assert.equal(pod.state, 'succeeded');
  assert.doesNotMatch(JSON.stringify(pod), /private-env|private-command|private-arg|private-annotation|also-private|do-not-transfer/);
  assert.equal(pod.result.data.pod.containers[0].reason, 'CrashLoopBackOff');
  const secret = await f.task({ operation: 'resource', context: 'primary', ...app, resource: { ...podRef, kind: 'Secret', name: 'configuration', uid: 'secret-a' } });
  assert.equal(secret.state, 'succeeded'); assert.doesNotMatch(JSON.stringify(secret), /private-secret-value|private-stringData-value/);
  assert.equal(secret.result.data.manifest.data, '[REDACTED]');
  const other = await f.get('/v1/resource', params(otherPodRef));
  assert.equal(other.status, 200); assert.equal(other.body.data.reference.namespace, 'team-b');
  const events = await f.task({ operation: 'events', context: 'primary', ...app, resource: podRef });
  assert.equal(events.result.data.items.length, 1); assert.equal(events.result.data.excludedCount, 2);
  const eventCall = f.calls.find((url) => url.pathname.endsWith('/events'))!;
  assert.equal(eventCall.searchParams.get('appNamespace'), 'argocd'); assert.equal(eventCall.searchParams.get('resourceNamespace'), 'team-a'); assert.equal(eventCall.searchParams.get('resourceUID'), 'pod-a');
  const appEvents = await f.get('/v1/events', { context: 'primary', ...app });
  assert.equal(appEvents.body.data.scope, 'application');
  const monitoring = await f.get('/v1/orphaned-monitoring', { context: 'primary', project: 'default' });
  assert.deepEqual(monitoring.body.data, { state: 'enabled', warn: false }); assert.doesNotMatch(JSON.stringify(monitoring), /private-project-token/);
  const calls = f.calls.length;
  assert.equal((await f.get('/v1/resource', { ...params(podRef), resourceName: '../sync' })).status, 400);
  assert.equal((await f.get('/v1/resource-tree', { context: 'primary', ...app, refresh: 'hard' })).status, 400);
  assert.equal(f.calls.length, calls);
});

test('resource errors are not empty-success fallbacks; deleted, rebuilt and stale references stay distinct', async (t) => {
  const f = await fixture(t);
  f.setEventsStatus(403);
  const events = await f.task({ operation: 'events', context: 'primary', ...app, resource: podRef });
  assert.equal(events.state, 'failed'); assert.equal(events.error.code, 'FORBIDDEN'); assert.equal(events.result, undefined);
  assert.doesNotMatch(JSON.stringify(events), /private-error-token/);
  const live = await f.get('/v1/resource', params(otherPodRef)); assert.equal(live.status, 200);
  f.setResourceStatus(404);
  const deleted = await f.get('/v1/resource', params(podRef));
  assert.equal(deleted.status, 404); assert.equal(deleted.body.error.code, 'NOT_FOUND');
  f.setResourceStatus(200); f.setUID('new-pod');
  const recreated = await f.get('/v1/resource', params(podRef));
  assert.equal(recreated.status, 409); assert.equal(recreated.body.error.code, 'RESOURCE_CHANGED');
  const staleTree = await f.get('/v1/resource', params({ ...podRef, uid: 'not-in-tree' }));
  assert.equal(staleTree.status, 409);
});
