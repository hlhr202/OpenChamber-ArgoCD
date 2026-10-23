import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { ArgoClient } from '../src/service/argocd/client.js';
import { configFixture, syntheticConfig } from './helpers.js';
import { deploymentRef, otherPodRef, podRef, rawEvent } from './resource-fixtures.js';
import { rolloutFixture } from './deployment-fixtures.js';
import { parseTaskCommand } from '../src/service/runtime/tasks.js';
import { resourceEvents } from '../src/service/domains/resources.js';

async function fixture(t: TestContext) {
  const f = rolloutFixture(); let forbidden = ''; let active = 0; let peak = 0; const calls: URL[] = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.method, 'GET'); active++; peak = Math.max(active, peak);
    const url = new URL(req.url!, 'http://localhost'); calls.push(url); assert.equal(url.searchParams.has('refresh'), false);
    res.setHeader('content-type', 'application/json'); let body: unknown = {};
    if (url.pathname.endsWith('/resource-tree')) body = f.raw;
    else if (url.pathname.endsWith('/resource')) {
      const node = f.raw.nodes.find((node) => node.name === url.searchParams.get('resourceName') && node.kind === url.searchParams.get('kind'));
      body = { manifest: JSON.stringify(f.manifests.get(node?.uid ?? '')) };
    } else if (url.pathname.endsWith('/events')) {
      const node = f.raw.nodes.find((node) => node.uid === url.searchParams.get('resourceUID'));
      if (node?.uid === forbidden) { res.statusCode = 403; body = { message: 'private-server-error' }; }
      else body = { items: node ? [{ ...rawEvent(node), reason: node.kind === 'Pod' ? 'FailedAttachVolume' : 'CustomFutureReason', message: 'Read only', type: node.kind === 'Pod' ? 'Warning' : 'FutureType' }, rawEvent(otherPodRef)] : [] };
    }
    await new Promise((resolve) => setImmediate(resolve)); active--; res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  const config = await configFixture(t, syntheticConfig(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  const api = new ArgoClient(config.provider, null, true); t.after(() => api.close());
  return { ...f, api, calls, forbid: (uid: string) => { forbidden = uid; }, peak: () => peak };
}
const app = { name: 'demo', appNamespace: 'argocd' };
test('rollback canonical RS is template-matched, with bounded reads and no raw template disclosure', async (t) => {
  const f = await fixture(t);
  const currentManifest = f.manifests.get(f.current.uid) as { spec: { template: { metadata: { labels: Record<string, string> } } } };
  currentManifest.spec.template.metadata.labels['pod-template-hash'] = 'not-part-of-template-identity';
  const tree = await f.api.resourceTreeSnapshot('primary', app, new AbortController().signal);
  assert.equal(tree.data.nodes.find((node) => node.uid === f.current.uid)?.replicaSet?.current, true);
  assert.deepEqual(tree.data.nodes.find((node) => node.uid === f.historical.uid)?.replicaSet, { revision: 2, desired: 0, replicas: 0, current: false });
  assert.equal(tree.data.nodes.find((node) => node.uid === f.failed.uid)?.replicaSet?.desired, 1);
  assert.doesNotMatch(JSON.stringify(tree), /private-template-token|templateKey|containers/); assert.ok(f.peak() <= 4);
});
test('missing canonical template is unknown, never a reason to fold all zero-pod ReplicaSets', async (t) => {
  const f = await fixture(t);
  const manifest = f.manifests.get(deploymentRef.uid) as { spec: { template?: unknown } }; delete manifest.spec.template;
  const tree = await f.api.resourceTreeSnapshot('primary', app, new AbortController().signal);
  assert.ok(tree.data.nodes.filter((node) => node.kind === 'ReplicaSet').every((node) => node.replicaSet?.current === null));
});
test('large descendant queries report their cap and reject pre-cancelled work', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 70; i++) f.raw.nodes.push({ ...podRef, name: `extra-${i}`, uid: `extra-${i}`, parentRefs: [deploymentRef], health: { status: 'Healthy' } });
  const result = await f.api.relatedEventsSnapshot('primary', app, new AbortController().signal, deploymentRef);
  assert.equal(result.data.related?.total, 75); assert.equal(result.data.related?.omitted, 11);
  assert.equal(result.data.related?.resources.length, 64); assert.ok(f.peak() <= 4);
  const before = f.calls.length; const controller = new AbortController(); controller.abort();
  await assert.rejects(f.api.relatedEventsSnapshot('primary', app, controller.signal, deploymentRef), { code: 'CANCELLED' });
  assert.equal(f.calls.length, before);
});
test('related events preserve unknown types and reasons, isolate UIDs, and report partial failure without losing pod status', async (t) => {
  const f = await fixture(t); f.forbid(f.failed.uid);
  const result = await f.api.relatedEventsSnapshot('primary', app, new AbortController().signal, deploymentRef);
  assert.equal(result.data.related?.total, 5); assert.equal(result.data.related?.omitted, 0);
  assert.equal(result.data.related?.resources.find((item) => item.resource.uid === f.failed.uid)?.eventsError, 'FORBIDDEN');
  assert.equal(result.data.related?.resources.find((item) => item.resource.uid === podRef.uid)?.pod?.containers[0]?.restarts, 3);
  assert.equal(result.data.items.length, 4); assert.ok(result.data.items.some((item) => item.type === 'FutureType' && item.reason === 'CustomFutureReason'));
  assert.ok(result.data.items.some((item) => item.reason === 'FailedAttachVolume')); assert.ok(result.data.items.every((item) => item.count === 3 && item.message === 'Read only' && item.resource.uid !== otherPodRef.uid));
  assert.doesNotMatch(JSON.stringify(result), /private-env|private-server-error/); assert.ok(f.peak() <= 4);
  const before = f.calls.length;
  await assert.rejects(f.api.relatedEventsSnapshot('primary', app, new AbortController().signal, { ...deploymentRef, uid: 'old-deployment' }), { code: 'RESOURCE_CHANGED' });
  assert.equal(f.calls.length, before);
});
test('related query parser is Deployment-only and events/v1 fields remain generic', () => {
  assert.equal(parseTaskCommand({ operation: 'relatedEvents', context: 'primary', ...app, resource: deploymentRef }).operation, 'relatedEvents');
  assert.throws(() => parseTaskCommand({ operation: 'relatedEvents', context: 'primary', ...app, resource: podRef }));
  const events = resourceEvents({ items: [{ metadata: { name: 'future' }, regarding: podRef, type: 'FutureType', reason: 'CustomReason', note: 'Read only', eventTime: '2026-10-22T00:00:00Z', reportingController: 'future-controller', series: { count: 9, lastObservedTime: '2026-10-22T00:02:00Z' } }] }, podRef);
  assert.equal(events.items[0]?.source, 'future-controller'); assert.equal(events.items[0]?.count, 9); assert.equal(events.items[0]?.message, 'Read only');
});
