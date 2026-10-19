import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparisonBlocked, managedResources, manifests, supportsSourceRevisions } from '../src/service/domains/manifests.js';
import { applicationDetail } from '../src/service/domains/applications.js';
import { operationUrl } from '../src/service/argocd/transport.js';
import { parseManifestSelection } from '../src/service/runtime/manifest-input.js';
import { parseTaskCommand } from '../src/service/runtime/tasks.js';
import { ServiceError } from '../src/service/security/errors.js';
import { deployment, rawComparison } from './manifest-fixtures.js';
import { rawApplication } from './application-fixtures.js';

const code = (expected: string) => (error: unknown) => error instanceof ServiceError && error.code === expected;
test('Argo normalized/predicted pair takes precedence over differing raw Live/Target (ignored fields/defaulting)', () => {
  const raw = rawComparison();
  raw.predictedLiveState = raw.normalizedLiveState; raw.modified = false;
  const result = managedResources({ items: [raw] })[0]!;
  assert.equal(result.status, 'equal'); assert.deepEqual(result.changedPaths, []);
  assert.notDeepEqual(result.live, result.target);
  const reordered = { ...deployment(), spec: { replicas: 2 } };
  assert.equal(managedResources({ items: [{ ...raw, normalizedLiveState: JSON.stringify(reordered), predictedLiveState: JSON.stringify({ spec: reordered.spec, metadata: reordered.metadata, kind: reordered.kind, apiVersion: reordered.apiVersion }) }] })[0]?.status, 'equal');
});

test('server-side predicted values drive the visible diff without reimplementing comparison strategy', () => {
  const raw = rawComparison();
  const predicted = { ...deployment(5), spec: { replicas: 5, injected: true } }; raw.predictedLiveState = JSON.stringify(predicted);
  const result = managedResources({ items: [raw] })[0]!;
  assert.equal(result.status, 'different'); assert.deepEqual(result.changedPaths, ['/spec/injected', '/spec/replicas']);
  assert.equal((result.target?.spec as Record<string, unknown>).replicas, 3);
  assert.equal((result.predictedLive?.spec as Record<string, unknown>).replicas, 5);
});

test('missing/deprecated/malformed/inconsistent comparison state is unavailable, never silently equal', () => {
  const raw = rawComparison();
  const items = managedResources({ items: [
    { ...raw, name: 'legacy', liveState: undefined, targetState: undefined, normalizedLiveState: undefined, predictedLiveState: undefined, diff: 'private-legacy-patch' },
    { ...raw, normalizedLiveState: '{private-invalid', predictedLiveState: 'null' },
    { ...raw, name: 'inconsistent', liveState: undefined, targetState: undefined, normalizedLiveState: '{}', predictedLiveState: '{"spec":{"x":1}}', modified: false },
  ] });
  assert.deepEqual(items.map((item) => item.status), ['unavailable', 'unavailable', 'unavailable']);
  assert.deepEqual(items.map((item) => item.reason), ['NORMALIZED_PAIR_UNAVAILABLE', 'MALFORMED_COMPARISON_STATE', 'INCONSISTENT_SERVER_COMPARISON']);
  assert.doesNotMatch(JSON.stringify(items), /private-legacy-patch|private-invalid/);
  assert.throws(() => managedResources({ items: [raw, raw] }), code('UPSTREAM_INVALID'));
});

test('creation/deletion pairs and omitted false modified flag follow normalized pair; hooks are not normal diff', () => {
  const raw = rawComparison();
  const creation = managedResources({ items: [{ ...raw, modified: undefined, normalizedLiveState: 'null', predictedLiveState: raw.targetState }] })[0]!;
  assert.equal(creation.status, 'different'); assert.deepEqual(creation.changedPaths, ['']);
  assert.equal(managedResources({ items: [{ ...raw, modified: undefined, normalizedLiveState: '{}', predictedLiveState: '{}' }] })[0]?.status, 'equal');
  assert.equal(managedResources({ items: [{ ...raw, hook: true }] })[0]?.reason, 'HOOK_EXCLUDED_FROM_ARGO_DIFF');
  assert.equal(managedResources({ items: [{ ...raw, hook: 'invalid' }] })[0]?.status, 'unavailable');
  assert.equal(managedResources({}).length, 0);
});

test('Secret remains different even when normalized fields lack kind and redaction hides visible change', () => {
  const result = managedResources({ items: [{ group: '', kind: 'Secret', name: 'configuration', namespace: 'workloads', modified: true,
    liveState: JSON.stringify({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'configuration', namespace: 'workloads' }, data: { arbitrary: 'private-live' } }),
    targetState: 'null', normalizedLiveState: '{"data":{"arbitrary":"private-live"}}', predictedLiveState: '{"data":{"arbitrary":"private-target"}}',
    diff: 'private-deprecated-value',
  }] })[0]!;
  assert.equal(result.status, 'different'); assert.equal(result.reason, 'DIFFERENCE_HIDDEN_BY_REDACTION'); assert.deepEqual(result.changedPaths, []);
  assert.doesNotMatch(JSON.stringify(result), /private-live|private-target|private-deprecated-value/);
});

test('application comparison errors or unknown Sync block otherwise empty normalized comparisons', () => {
  const raw = rawApplication(); const app = applicationDetail(raw);
  assert.equal(comparisonBlocked(app), true);
  app.conditions = []; assert.equal(comparisonBlocked(app), false);
  app.sync = 'Unknown'; assert.equal(comparisonBlocked(app), true);
});

test('manifest preview parses embedded JSON, scrubs Secret/env/annotations and does not infer namespaces or sources', () => {
  const manifest = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'configuration', annotations: { note: 'private-annotation' } }, data: { ordinary: 'private-secret' }, stringData: { arbitrary: 'private-plain' } };
  const pod = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'worker' }, spec: { containers: [{ name: 'main', env: [{ name: 'ORDINARY', value: 'private-env-value' }], args: ['private-argument-value'] }] } };
  const result = manifests({ manifests: [JSON.stringify(manifest), JSON.stringify(manifest), JSON.stringify(pod)], commands: ['private-command'], verifyResult: 'private-verification' }, { sources: [{ position: 2, revision: 'feature/abc' }] });
  assert.equal(result.items.length, 3); assert.notEqual(result.items[0]?.id, result.items[1]?.id);
  assert.equal(result.items[0]?.namespaceExplicit, false); assert.equal(result.resolvedRevision, '');
  assert.deepEqual(result.warnings, ['REPEATED_RESOURCE_IDENTITY']);
  assert.doesNotMatch(JSON.stringify(result), /private-annotation|private-secret|private-plain|private-command|private-verification|private-env-value|private-argument-value/);
  assert.throws(() => manifests({ manifests: ['{broken'] }, {}), code('UPSTREAM_INVALID'));
});

test('large/deep manifest and diff structures are bounded before normalization or redaction', () => {
  assert.throws(() => manifests({ manifests: ['x'.repeat(1_000_001)] }, {}), code('RESPONSE_TOO_LARGE'));
  let deep: unknown = 'value'; for (let i = 0; i < 30; i++) deep = { next: deep };
  assert.throws(() => managedResources({ items: [{ ...rawComparison(), predictedLiveState: JSON.stringify(deep) }] }), code('RESPONSE_TOO_LARGE'));
});

test('revision selections are canonical, validated and mapped to paired repeated API parameters', () => {
  const selection = parseManifestSelection({ sources: [{ position: 2, revision: 'feature/a?x&y' }, { position: 1, revision: 'main' }] });
  assert.equal(selection.sources?.[0]?.position, 1);
  const url = operationUrl('https://example.test/argo', 'manifests', { name: 'demo', appNamespace: 'team-a', sourcePositions: [1, 2], revisions: ['main', 'feature/a?x&y'] });
  assert.equal(url.pathname, '/argo/api/v1/applications/demo/manifests'); assert.deepEqual(url.searchParams.getAll('sourcePositions'), ['1', '2']); assert.deepEqual(url.searchParams.getAll('revisions'), ['main', 'feature/a?x&y']);
  assert.equal(url.searchParams.get('appNamespace'), 'team-a'); assert.equal(url.searchParams.has('refresh'), false);
  for (const value of [{ revision: 'a', sources: [] }, { sources: [{ position: 0, revision: 'main' }] }, { sources: [{ position: 1, revision: 'main' }, { position: 1, revision: 'other' }] }, { revision: '' }, { revision: 'a\n--sync' }, { refresh: 'hard' }, { sources: [{ position: 1, revision: 'main', command: 'sync' }] }]) assert.throws(() => parseManifestSelection(value), code('BAD_REQUEST'));
  assert.throws(() => operationUrl('https://example.test', 'manifests', { name: 'demo', appNamespace: 'argocd', sourcePositions: [1, 2], revisions: ['main'] }), code('BAD_REQUEST'));
  assert.equal(parseTaskCommand({ operation: 'comparison', context: 'primary', name: 'demo', appNamespace: 'argocd' }).operation, 'comparison');
  assert.throws(() => parseTaskCommand({ operation: 'comparison', context: 'primary', name: 'demo', appNamespace: 'argocd', revision: 'arbitrary' }), code('BAD_REQUEST'));
});

test('multi-source revision overrides are version-gated rather than silently ignored by older APIs', () => {
  for (const Version of ['v2.10.20', 'v2.8.21', 'unknown', 'v3.1.0-rc1']) assert.equal(supportsSourceRevisions({ Version }), false);
  for (const Version of ['v2.11.12', 'v2.14.16', 'v3.1.8+hash']) assert.equal(supportsSourceRevisions({ Version }), true);
});
