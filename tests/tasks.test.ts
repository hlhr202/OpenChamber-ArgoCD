import assert from 'node:assert/strict';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { TaskManager, parseTaskCommand } from '../src/service/runtime/tasks.js';
import { ServiceError } from '../src/service/security/errors.js';
import type { QuerySnapshot } from '../src/shared/contracts.js';

const command = { operation: 'applications', context: 'primary', filters: {} } as const;
const result = <T>(data: T): QuerySnapshot<T> => ({ data, sampledAt: new Date(1000).toISOString(), expiresAt: new Date(2000).toISOString(), stale: false, source: 'argo-api' });
const code = (expected: string) => (error: unknown) => error instanceof ServiceError && error.code === expected;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

test('task snapshots have opaque IDs, bound scope, original sample metadata and finite retention', async (t) => {
  let now = 1500;
  const tasks = new TaskManager({ now: () => now, retentionMs: 100 }); t.after(() => tasks.close());
  const job = tasks.create('scope-a', command, async () => result({ value: 'safe' }));
  assert.match(job.id, /^[a-f0-9-]{36}$/);
  await setImmediate();
  assert.equal(tasks.get(job.id, 'scope-a').state, 'succeeded');
  assert.equal(tasks.get(job.id, 'scope-a').result?.sampledAt, new Date(1000).toISOString());
  assert.throws(() => tasks.get(job.id, 'scope-b'), code('NOT_FOUND'));
  assert.throws(() => tasks.cancel(job.id, 'scope-b'), code('NOT_FOUND'));
  now = 1601;
  assert.throws(() => tasks.get(job.id, 'scope-a'), code('EXPIRED'));
});

test('task capacity and queue limits reject excess work without starting it', async (t) => {
  const tasks = new TaskManager({ concurrency: 1, maxQueued: 1, maxEntries: 2 }); t.after(() => tasks.close());
  const source = deferred<QuerySnapshot<unknown>>();
  tasks.create('scope', command, () => source.promise);
  const queued = tasks.create('scope', command, async () => result('second'));
  assert.equal(queued.state, 'queued');
  assert.throws(() => tasks.create('scope', command, async () => assert.fail()), code('BUSY'));
  source.resolve(result('first')); await setImmediate();
  assert.equal(tasks.get(queued.id, 'scope').state, 'succeeded');
});

test('cancel and deadline abort task work, discard late results and preserve execution limits', async (t) => {
  const tasks = new TaskManager({ concurrency: 1, timeoutMs: 30 }); t.after(() => tasks.close());
  let signal!: AbortSignal;
  const source = deferred<QuerySnapshot<unknown>>();
  const job = tasks.create('scope', command, async (value) => { signal = value; return source.promise; });
  await setImmediate();
  tasks.cancel(job.id, 'scope'); assert.equal(signal.aborted, true);
  assert.equal(tasks.get(job.id, 'scope').state, 'cancelled');
  let started = false;
  const next = tasks.create('scope', command, async () => { started = true; return result('next'); });
  await setImmediate(); assert.equal(started, false);
  source.resolve(result('late')); await setImmediate();
  assert.equal(tasks.get(job.id, 'scope').result, undefined);
  assert.equal(tasks.get(next.id, 'scope').state, 'succeeded');
  const never = deferred<QuerySnapshot<unknown>>();
  const timedOut = tasks.create('scope', command, () => never.promise);
  await delay(45);
  assert.equal(tasks.get(timedOut.id, 'scope').error?.code, 'TIMEOUT');
  never.resolve(result('late'));
});

test('unsafe errors, oversize and truncated results never appear as successful task data', async (t) => {
  const tasks = new TaskManager({ maxResultBytes: 500 }); t.after(() => tasks.close());
  const failure = tasks.create('scope', command, () => { throw new Error('private-host-token'); });
  const oversized = tasks.create('scope', command, async () => result('x'.repeat(1000)));
  const truncated = tasks.create('scope', command, async () => result('x'.repeat(5000)));
  await setImmediate();
  assert.equal(tasks.get(failure.id, 'scope').state, 'failed');
  assert.doesNotMatch(JSON.stringify(tasks.get(failure.id, 'scope')), /private-host-token/);
  assert.equal(tasks.get(oversized.id, 'scope').error?.code, 'RESPONSE_TOO_LARGE');
  assert.equal(tasks.get(truncated.id, 'scope').error?.code, 'RESPONSE_TOO_LARGE');
});

test('command parser only permits fixed read operations, filters and structured application references', () => {
  assert.deepEqual(parseTaskCommand({ operation: 'applications', context: 'primary' }), command);
  assert.equal(parseTaskCommand({ operation: 'application', context: 'primary', name: 'demo', appNamespace: 'argocd' }).operation, 'application');
  for (const value of [{ operation: 'sync', context: 'primary' }, { ...command, url: 'https://other.test' }, { ...command, filters: { refresh: 'hard' } }, { operation: 'application', context: 'primary', name: 'demo' }, { operation: 'application', context: 'primary', name: '../sync', appNamespace: 'argocd' }, { ...command, filters: { selector: 'invalid in (' } }, { ...command, filters: [] }]) {
    assert.throws(() => parseTaskCommand(value), code('BAD_REQUEST'));
  }
});
