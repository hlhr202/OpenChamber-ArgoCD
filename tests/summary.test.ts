import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSummary, parseSummaryEvidence } from '../src/service/domains/summary.js';
import { EvidenceStore } from '../src/panel/evidence.js';
import { ServiceGateway } from '../src/panel/gateway.js';
import { viewPreferences } from '../src/panel/preferences.js';
import { applicationDetail } from '../src/service/domains/applications.js';
import { rawApplication } from './application-fixtures.js';
import type { Envelope } from '../src/shared/contracts.js';
import type { SummaryEvidence } from '../src/shared/summary.js';
import type { PanelRequest } from '../src/panel/task-client.js';
import { setImmediate } from 'node:timers/promises';

export const summaryEvidence = (): SummaryEvidence => ({ application: { name: 'demo', appNamespace: 'argocd' }, records: [{ kind: 'application', sampledAt: '2026-10-18T00:00:00Z', expiresAt: '2026-10-18T00:00:15Z', stale: false, source: 'argo-api', lines: ['Sync OutOfSync; Health Degraded; untrusted <img src=x>'] }] });
const sample = <T>(data: T): Extract<Envelope<T>, { ok: true }> => ({ ok: true, data, sampledAt: '2026-10-18T00:00:00Z', expiresAt: '2026-10-18T00:00:15Z', source: 'argo-api', stale: false, truncated: false, identityEpoch: 'a'.repeat(43) });

test('summary formatter preserves sample/expiry, marks stale and quotes untrusted evidence rather than declaring realtime success', () => {
  const value = parseSummaryEvidence(summaryEvidence()); const preview = buildSummary('primary', value, Date.parse('2026-10-18T00:01:00Z'));
  assert.equal(preview.staleRecords, 1); assert.equal(preview.characters, preview.parts.join('\n\n').length); assert.match(preview.parts.join('\n'), /已过期|不可信|未额外查询 Argo/);
  assert.ok(preview.parts.some((part) => part.startsWith('"Sync OutOfSync')));
  assert.throws(() => parseSummaryEvidence({ ...value, url: 'https://arbitrary' }));
  assert.throws(() => parseSummaryEvidence({ ...value, records: [{ ...value.records[0], lines: ['x'.repeat(401)] }] }));
  assert.throws(() => parseSummaryEvidence({ ...value, records: [value.records[0], value.records[0]] }));
});

test('evidence store is bounded, app-scoped and excludes full manifests/values and logs unless explicitly selected/included', () => {
  const store = new EvidenceStore(); store.reset('primary', { name: 'demo', appNamespace: 'argocd' }); store.app(sample(applicationDetail(rawApplication())));
  const first = store.snapshot()!; assert.doesNotMatch(JSON.stringify(first), /hidden-values|hidden-parameter|hidden-inline|repoURL/);
  store.logs({ context: 'primary', application: { name: 'demo', appNamespace: 'argocd' }, sampledAt: '2026-10-18T00:00:00Z', note: 'selected fragment', lines: Array.from({ length: 100 }, (_, i) => `line-${i}`) });
  assert.equal(store.snapshot()!.evidence.records.some((item) => item.kind === 'logs'), false);
  assert.equal(store.snapshot(true)!.evidence.records.find((item) => item.kind === 'logs')?.lines.length, 11);
  store.reset('secondary', { name: 'other', appNamespace: 'team-b' }); assert.equal(store.snapshot(true), null);
});

test('retired gateway requests/responses cannot cross observed Service or identity boundaries; 403 stays domain-local', async () => {
  let instance = '11111111-1111-4111-8111-111111111111'; let epoch = 'a'.repeat(43); let calls = 0; const boundaries: string[] = [];
  const transport: PanelRequest = async <T>(path: string) => { calls++; return path === '/forbidden' ? { ok: false, sampledAt: 'sample', serviceInstance: instance, identityEpoch: epoch, error: { code: 'FORBIDDEN', message: 'domain denied' } } : { ...sample({} as T), serviceInstance: instance, identityEpoch: epoch }; };
  const gateway = new ServiceGateway(transport, (reason) => boundaries.push(reason)); const first = gateway.bind();
  await first('/read', { context: 'primary' }); assert.equal((await first('/forbidden', { context: 'primary' })).ok, false); assert.equal(boundaries.length, 0);
  instance = '22222222-2222-4222-8222-222222222222'; await assert.rejects(first('/read', { context: 'primary' }));
  const before = calls; await assert.rejects(first('/v1/tasks', { context: 'primary', id: 'old' }, { method: 'DELETE' })); assert.equal(calls, before);
  const second = gateway.bind(); await second('/read', { context: 'primary' }); epoch = 'b'.repeat(43); await assert.rejects(second('/read', { context: 'primary' })); assert.equal(boundaries.length, 2);
});

test('preferences reject data-bearing keys and only admit two harmless enums', () => {
  assert.deepEqual(viewPreferences({ density: 'comfortable', module: 'summary' }), { density: 'comfortable', module: 'summary' });
  assert.deepEqual(viewPreferences({ density: 'compact', module: 'applications', context: 'production', token: 'must-not-persist' }), { density: 'compact', module: 'applications' });
});

test('late responses are discarded after explicit host retirement and cleanup cannot reach a replacement host', async () => {
  let finish!: (value: Envelope<unknown>) => void; let calls = 0;
  const request: PanelRequest = async <T>() => { calls++; return new Promise<Envelope<T>>((resolve) => { finish = resolve as typeof finish; }); };
  const gateway = new ServiceGateway(request, () => assert.fail()); const old = gateway.bind();
  const pending = old('/v1/application', { context: 'primary' }); const rejected = assert.rejects(pending, /Retired response/); await setImmediate();
  gateway.invalidate(); finish({ ...sample({}), serviceInstance: '11111111-1111-4111-8111-111111111111' }); await rejected;
  await assert.rejects(old('/v1/logs', { context: 'primary', id: 'old-stream' }, { method: 'DELETE' })); assert.equal(calls, 1);
});

test('summary evidence respects strict per-line budgets even for long names, events and log content', () => {
  const store = new EvidenceStore(); store.reset('primary', { name: 'demo', appNamespace: 'argocd' }); const application = applicationDetail(rawApplication());
  application.project = 'p'.repeat(300); application.conditions[0]!.message = 'untrusted '.repeat(500); store.app(sample(application));
  store.logs({ context: 'primary', application: { name: 'demo', appNamespace: 'argocd' }, sampledAt: new Date().toISOString(), note: 'note'.repeat(500), lines: ['log'.repeat(3000)] });
  const snapshot = store.snapshot(true)!; assert.doesNotThrow(() => parseSummaryEvidence(snapshot.evidence));
  assert.ok(snapshot.evidence.records.every((item) => item.lines.every((line) => line.length <= 400)));
});
