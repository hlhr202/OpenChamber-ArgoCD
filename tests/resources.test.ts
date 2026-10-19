import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resourceOutline } from '../src/shared/resources.js';
import { liveResource, orphanedMonitoring, resourceEvents, resourceTree } from '../src/service/domains/resources.js';
import { redactResult } from '../src/service/security/redact.js';
import { parseTaskCommand } from '../src/service/runtime/tasks.js';
import { operationUrl } from '../src/service/argocd/transport.js';
import { ServiceError } from '../src/service/security/errors.js';
import { deploymentRef, otherPodRef, podRef, rawEvent, rawPod, rawTree } from './resource-fixtures.js';

const code = (value: string) => (error: unknown) => error instanceof ServiceError && error.code === value;

test('resource identity isolates namespaces; edges retain all parents and exclude unmatched UIDs', () => {
  const raw = rawTree();
  raw.nodes.push({ ...podRef, uid: 'pod-new', health: { status: 'Unknown' } });
  const tree = resourceTree(raw);
  assert.equal(new Set(tree.nodes.map((node) => node.id)).size, 4);
  assert.equal(tree.nodes[0]?.children.length, 1);
  assert.deepEqual(tree.nodes[1]?.parents, [tree.nodes[0]?.id]);
  assert.equal(tree.nodes[2]?.parents.length, 0);
  const complex = resourceTree({ nodes: [
    deploymentRef, { ...deploymentRef, name: 'second', uid: 'deploy-b' },
    { ...podRef, parentRefs: [deploymentRef, { ...deploymentRef, name: 'second', uid: 'deploy-b' }, { ...otherPodRef, uid: 'old' }] },
  ] });
  assert.equal(complex.nodes[2]?.parents.length, 2); assert.equal(complex.nodes[2]?.unresolvedParents, 1);
  assert.deepEqual(complex.warnings, ['UNRESOLVED_PARENTS']);
  assert.equal(resourceOutline(complex).length, 3);
  assert.doesNotMatch(JSON.stringify(tree), /do-not-transfer/);
});

test('cycles, duplicate nodes, unknown kinds and large trees have bounded explicit behavior', () => {
  const tree = resourceTree({ nodes: [{ ...podRef, parentRefs: [deploymentRef] }, { ...deploymentRef, parentRefs: [podRef] }] });
  assert.deepEqual(tree.warnings, ['CYCLE_DETECTED']); assert.equal(resourceOutline(tree).length, 2);
  assert.throws(() => resourceTree({ nodes: [podRef, podRef] }), code('UPSTREAM_INVALID'));
  assert.throws(() => resourceTree({ nodes: Array.from({ length: 1001 }, () => podRef) }), code('RESPONSE_TOO_LARGE'));
  assert.equal(resourceTree({ nodes: [{ ...podRef, kind: 'CustomThing' }] }).nodes[0]?.health, 'Unknown');
  assert.equal(resourceTree({}).nodes.length, 0);
  assert.equal(resourceTree({}).orphanedMonitoring, 'unknown');
  assert.throws(() => resourceTree({ error: 'invalid-response' }), code('UPSTREAM_INVALID'));
});

test('orphaned detection is not inferred from empty nodes or warning=false', () => {
  assert.equal(resourceTree({ orphanedNodes: [podRef] }).orphanedMonitoring, 'enabled');
  assert.deepEqual(orphanedMonitoring({ spec: {} }), { state: 'disabled', warn: null });
  assert.deepEqual(orphanedMonitoring({ spec: { orphanedResources: { warn: false }, roles: [{ jwtTokens: ['private'] }] } }), { state: 'enabled', warn: false });
});

test('Live Pod is parsed before redaction; env/args/annotations hidden with container status intact', () => {
  const result = liveResource({ manifest: JSON.stringify(rawPod()) }, podRef);
  const safe = redactResult(result);
  assert.equal(safe.truncated, false);
  assert.doesNotMatch(JSON.stringify(safe.value), /private-env|private-command|private-arg|private-annotation|also-private/);
  assert.equal(result.pod?.phase, 'Pending');
  assert.equal(result.pod?.containers[0]?.reason, 'CrashLoopBackOff');
  assert.equal(result.pod?.containers[0]?.restarts, 3); assert.equal(result.pod?.containers[0]?.ready, false);
  assert.equal((result.manifest.metadata as Record<string, unknown>).name, 'demo');
});

test('Secret data and stringData are redacted even in nested List objects', () => {
  const secret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'demo', namespace: 'team-a', uid: 'pod-a' }, data: { innocuous: 'base64-private-value' }, stringData: { ordinary: 'private-plain' } };
  const result = liveResource({ manifest: JSON.stringify(secret) }, { ...podRef, kind: 'Secret' });
  assert.doesNotMatch(JSON.stringify(result), /base64-private-value|private-plain/);
  const list = { apiVersion: 'v1', kind: 'List', metadata: { name: 'demo', namespace: 'team-a', uid: 'pod-a' }, items: [secret] };
  assert.doesNotMatch(JSON.stringify(liveResource({ manifest: JSON.stringify(list) }, { ...podRef, kind: 'List' })), /base64-private-value|private-plain/);
});

test('recreated resource is not silently displayed under the old UID; malformed manifests fail', () => {
  assert.throws(() => liveResource({ manifest: JSON.stringify(rawPod({ ...podRef, uid: 'new' })) }, podRef), code('RESOURCE_CHANGED'));
  assert.throws(() => liveResource({ manifest: JSON.stringify(rawPod(otherPodRef)) }, podRef), code('UPSTREAM_INVALID'));
  for (const value of [{ manifest: '{}' }, { manifest: '{invalid' }, { manifest: [] }]) assert.throws(() => liveResource(value, podRef), code('UPSTREAM_INVALID'));
});

test('events filter full resource identity including UID, support series and preserve empty vs unknown', () => {
  const event = rawEvent();
  const events = resourceEvents({ items: [event, rawEvent(otherPodRef), rawEvent({ ...podRef, uid: 'old' })] }, podRef);
  assert.equal(events.items.length, 1); assert.equal(events.excludedCount, 2); assert.equal(events.instanceScoped, true);
  assert.equal(events.items[0]?.count, 3); assert.equal(events.items[0]?.resource.version, 'v1');
  const series = resourceEvents({ items: [{ ...event, count: undefined, series: { count: 5, lastObservedTime: '2026-10-18T00:02:00Z' } }] });
  assert.equal(series.items[0]?.count, 5); assert.equal(series.scope, 'application');
  assert.equal(resourceEvents({}).items.length, 0);
  assert.throws(() => resourceEvents({ items: 'invalid' }), code('UPSTREAM_INVALID'));
  assert.throws(() => resourceEvents({ error: 'invalid-response' }), code('UPSTREAM_INVALID'));
});

test('fixed resource endpoints distinguish resource namespace from application namespace and reject commands', () => {
  const app = { name: 'demo', appNamespace: 'argocd' };
  const url = operationUrl('https://example.test/argo', 'resource', { ...app, resourceName: podRef.name, namespace: podRef.namespace, kind: podRef.kind, version: podRef.version, group: '' });
  assert.equal(url.pathname, '/argo/api/v1/applications/demo/resource'); assert.equal(url.searchParams.get('appNamespace'), 'argocd'); assert.equal(url.searchParams.get('namespace'), 'team-a');
  const events = operationUrl('https://example.test', 'events', { ...app, resourceName: 'demo', namespace: 'team-a', resourceUID: 'pod-a' });
  assert.equal(events.searchParams.get('resourceNamespace'), 'team-a'); assert.equal(events.searchParams.has('namespace'), false);
  assert.equal(parseTaskCommand({ operation: 'resource', context: 'primary', ...app, resource: podRef }).operation, 'resource');
  assert.equal(parseTaskCommand({ operation: 'resource', context: 'primary', ...app, resource: { group: 'example.test', version: 'v1beta1', kind: 'CustomResource', namespace: '', name: 'cluster-resource', uid: 'cluster-a' } }).operation, 'resource');
  assert.equal(parseTaskCommand({ operation: 'events', context: 'primary', ...app }).operation, 'events');
  for (const resource of [{ ...podRef, name: '../sync' }, { ...podRef, namespace: 'bad/name' }, { ...podRef, uid: 'pod-a', url: '/anything' }]) assert.throws(() => parseTaskCommand({ operation: 'resource', context: 'primary', ...app, resource }), code('BAD_REQUEST'));
  assert.throws(() => parseTaskCommand({ operation: 'events', context: 'primary', ...app, resource: { ...podRef, uid: '' } }), code('BAD_REQUEST'));
});
