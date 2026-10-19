import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { ArgoClient } from '../src/service/argocd/client.js';
import { operationUrl, type ReadParameters } from '../src/service/argocd/transport.js';
import { RefreshCoordinator } from '../src/service/auth/refresh.js';
import { applicationCounts, applicationDetail, applicationSummaries, applicationSummary } from '../src/service/domains/applications.js';
import { filterApplications, labelSelector } from '../src/shared/filters.js';
import { createService } from '../src/service/runtime/server.js';
import { rawApplication } from './application-fixtures.js';
import { configFixture, syntheticConfig } from './helpers.js';

const errorCode = (code: string) => (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);

test('projects safe summary and detail without Helm values, annotation content or repository credentials', () => {
  const detail = applicationDetail(rawApplication());
  assert.equal(detail.id, 'argocd/demo');
  assert.equal(detail.destination.namespace, 'workloads');
  assert.equal(detail.sources[0]?.repoURL, 'https://git.example.test/team/repo.git');
  assert.deepEqual(detail.sources[0]?.helm?.parameterNames, ['region']);
  assert.equal(detail.sources[0]?.helm?.hasInlineValues, true);
  assert.equal(detail.sources[0]?.helm?.hasValuesObject, true);
  assert.equal(detail.conditions[0]?.type, 'ComparisonError');
  assert.equal(detail.operation?.phase, 'Failed');
  assert.equal(detail.operation?.resources[0]?.status, 'SyncFailed');
  assert.equal(detail.history[0]?.id, '7');
  assert.deepEqual(detail.history[0]?.revisions, ['previous-commit']);
  assert.deepEqual(detail.comparedRevisions, ['compared-commit']);
  assert.deepEqual(detail.lastDeploymentRevisions, ['previous-commit']);
  assert.doesNotMatch(JSON.stringify(detail), /hidden-|repository-password|url-password|git-user/);
});

test('multi-source desired/deployed revisions, source types and retained history stay distinct', () => {
  const single = rawApplication();
  const multi = { ...single, spec: { ...single.spec, sources: [single.spec.source, { repoURL: 'https://git.example.test/overlay', targetRevision: 'release', ref: 'values', kustomize: { images: ['api:v2'], commonAnnotations: { note: 'hidden-annotation-value' }, patches: [{ patch: 'hidden-patch' }] } }] },
    status: { ...single.status, sync: { status: 'Synced', revisions: ['resolved-a', 'resolved-b'] }, sourceTypes: ['Helm', 'Kustomize'],
      history: [{ id: 8, revisions: ['history-a', 'history-b'], sources: [single.spec.source], deployedAt: '2026-10-18T00:00:00Z' }] } };
  const detail = applicationDetail(multi);
  assert.equal(detail.sources.length, 2);
  assert.deepEqual(detail.comparedRevisions, ['resolved-a', 'resolved-b']);
  assert.deepEqual(detail.lastDeploymentRevisions, ['history-a', 'history-b']);
  assert.deepEqual(detail.sources.map((source) => source.targetRevision), ['main', 'release']);
  assert.equal(detail.sources[1]?.type, 'Kustomize');
  assert.equal(detail.sources[1]?.kustomize?.patchCount, 1);
  assert.deepEqual(detail.history[0]?.revisions, ['history-a', 'history-b']);
  assert.doesNotMatch(JSON.stringify(detail), /hidden-/);
});

test('missing or new status values are never mapped to healthy and empty data is explicit', () => {
  const input = rawApplication();
  const missing = applicationDetail({ ...input, status: {} });
  assert.equal(missing.sync, 'Unknown'); assert.equal(missing.health, 'Unknown');
  assert.equal(missing.healthKnown, false); assert.equal(missing.operation, null);
  assert.deepEqual(missing.history, []);
  const future = applicationSummary({ ...input, status: { sync: { status: 'NewSyncState' }, health: { status: 'NewHealthState' } } });
  assert.equal(future.health, 'NewHealthState'); assert.equal(future.healthKnown, false);
  assert.equal(applicationCounts([missing, future]).unknown, 2);
  assert.equal(applicationCounts([missing, future]).unhealthy, 0);
  assert.deepEqual(applicationSummaries({ items: null }), []);
  for (const invalid of [{}, { items: 'bad' }, { items: [input, input] }, { items: [{ ...input, metadata: { name: 'demo' } }] }]) {
    assert.throws(() => applicationSummaries(invalid), errorCode('UPSTREAM_INVALID'));
  }
});

test('same app name in different Application namespaces has a different stable identity', () => {
  const items = applicationSummaries({ items: [rawApplication('same', 'team-a'), rawApplication('same', 'team-b')] });
  assert.deepEqual(items.map((item) => item.id), ['team-a/same', 'team-b/same']);
  assert.equal(filterApplications(items, { appNamespace: 'team-b' })[0]?.id, 'team-b/same');
  assert.equal(filterApplications(items, { destinationNamespace: 'team-b' }).length, 0);
  assert.equal(filterApplications(items, { destinationNamespace: 'workloads' }).length, 2);
});

test('application filters combine name, project, cluster, repo, status and labels', () => {
  const items = [applicationSummary(rawApplication())];
  assert.equal(filterApplications(items, { name: 'DEM', project: 'platform', cluster: 'production', repo: 'https://git.example.test/team/repo.git', sync: 'OutOfSync', health: 'Degraded', selector: 'env in (production,staging),team=platform' }).length, 1);
  assert.equal(filterApplications(items, { cluster: 'https://kubernetes.example.test' }).length, 1);
  assert.equal(filterApplications(items, { project: 'other' }).length, 0);
});

test('label selector supports equality, set, existence, absence and missing-key inequality', () => {
  const labels = { env: 'production', team: 'platform', empty: '' };
  for (const selector of ['env=production', 'team==platform', 'env in (production, staging)', 'env notin (dev)', 'team', '!missing', 'missing!=value', 'missing notin (value)', 'empty=', '']) {
    assert.equal(labelSelector(selector)(labels), true, selector);
  }
  for (const selector of ['env!=production', 'missing=value', 'missing in (value)', '!team']) assert.equal(labelSelector(selector)(labels), false, selector);
  for (const invalid of ['env in (prod', 'env=production,', 'env>=prod', '=prod', 'a,,b', 'a in ((b))']) assert.throws(() => labelSelector(invalid), invalid);
});

test('upstream detail URL requires explicit namespace and rejects path/refresh injection', () => {
  const url = operationUrl('https://argo.example.test/argo', 'application', { name: 'my-app', appNamespace: 'team-a' });
  assert.equal(url.toString(), 'https://argo.example.test/argo/api/v1/applications/my-app?appNamespace=team-a');
  for (const name of ['../app', 'app/sync', 'app?refresh=hard', '%2f']) assert.throws(() => operationUrl('https://example.test', 'application', { name, appNamespace: 'team-a' }), errorCode('BAD_REQUEST'));
  assert.throws(() => operationUrl('https://example.test', 'application', { name: 'app' }), errorCode('BAD_REQUEST'));
  assert.throws(() => operationUrl('https://example.test', 'applications', { refresh: 'hard' } as ReadParameters), errorCode('BAD_REQUEST'));
});

test('Mock API list/detail is read-only, whitelisted before output limits, namespace aware and default-denied', async (t) => {
  const input = rawApplication();
  input.spec.source.helm.values = 'hidden-'.repeat(10_000);
  input.status.conditions[0]!.message = 'invalid Bearer synthetic-original';
  const paths: string[] = [];
  const upstream = createServer((req, res) => {
    assert.equal(req.method, 'GET'); assert.equal(req.headers.authorization, 'Bearer synthetic-original');
    paths.push(req.url!);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/v1/applications') res.end(JSON.stringify({ items: [input, rawApplication('demo', 'other')] }));
    else if (req.url === '/api/v1/applications/demo?appNamespace=argocd') res.end(JSON.stringify(input));
    else { res.writeHead(404); res.end('hidden-upstream-error'); }
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const fixture = await configFixture(t, syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`));
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail()), true);
  const list = await client.applications('primary', { appNamespace: 'argocd' }, new AbortController().signal);
  assert.equal(list.totals.total, 2); assert.equal(list.matched.total, 1);
  assert.equal(list.items[0]?.id, 'argocd/demo');
  const detail = await client.application('primary', 'demo', 'argocd', new AbortController().signal);
  assert.doesNotMatch(JSON.stringify(detail), /hidden-|synthetic-original|repository-password/);
  await assert.rejects(client.application('primary', 'missing', 'argocd', new AbortController().signal), errorCode('NOT_FOUND'));
  await assert.rejects(client.applications('primary', { selector: 'bad in (' }, new AbortController().signal), errorCode('BAD_REQUEST'));
  assert.ok(paths.every((path) => !/refresh|sync$/.test(path)));
  const disabled = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail()));
  await assert.rejects(disabled.applications('primary', {}, new AbortController().signal), errorCode('NETWORK_DISABLED'));

  const service = createService({ token: 'synthetic-host', client: async () => client });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close());
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const options = { headers: { authorization: 'Bearer synthetic-host' } };
  assert.equal((await fetch(base + '/v1/applications?context=primary&refresh=hard', options)).status, 400);
  assert.equal((await fetch(base + '/v1/application?context=primary&name=demo&appNamespace=argocd', options)).status, 200);
  const filtered = await (await fetch(base + '/v1/applications?context=primary&appNamespace=argocd', options)).json();
  assert.equal(filtered.data.items.length, 1);
  assert.equal((await fetch(base + '/v1/applications?context=primary', { ...options, method: 'POST' })).status, 405);
});
