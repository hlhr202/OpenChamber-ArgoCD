import assert from 'node:assert/strict';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { QueryCoordinator } from '../src/service/runtime/queries.js';
import { ServiceError } from '../src/service/security/errors.js';

const signal = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) => error instanceof ServiceError && error.code === expected;
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('identical queries merge, retain original sampling time and isolate returned objects', async (t) => {
  let now = 1000; let calls = 0;
  const queue = new QueryCoordinator({ now: () => now, ttlMs: 100 }); t.after(() => queue.close());
  const source = deferred<{ value: string }>();
  const load = async () => { calls++; return source.promise; };
  const a = queue.run('scope', 'query', load, signal());
  const b = queue.run('scope', 'query', load, signal());
  source.resolve({ value: 'original' });
  const [first, second] = await Promise.all([a, b]);
  assert.equal(calls, 1); assert.equal(first.source, 'argo-api');
  assert.equal(first.sampledAt, second.sampledAt);
  first.data.value = 'modified';
  now = 1050;
  const cached = await queue.run('scope', 'query', load, signal());
  assert.equal(cached.source, 'cache'); assert.equal(cached.data.value, 'original');
  assert.equal(cached.sampledAt, first.sampledAt); assert.equal(calls, 1);
  now = 1101;
  await queue.run('scope', 'query', async () => { calls++; return { value: 'new' }; }, signal());
  assert.equal(calls, 2);
});

test('cancelling one waiter does not cancel another; cancelling the last aborts the loader', async (t) => {
  const queue = new QueryCoordinator(); t.after(() => queue.close());
  const source = deferred<string>(); let underlying!: AbortSignal;
  const first = new AbortController(); const second = new AbortController();
  const a = queue.run('scope', 'query', async (signal) => { underlying = signal; return source.promise; }, first.signal);
  const b = queue.run('scope', 'query', async () => assert.fail(), second.signal);
  const rejectedA = assert.rejects(a, code('CANCELLED'));
  first.abort(); await rejectedA; assert.equal(underlying.aborted, false);
  const rejectedB = assert.rejects(b, code('CANCELLED'));
  second.abort(); await rejectedB; assert.equal(underlying.aborted, true);
  source.resolve('late'); await setImmediate();
});

test('active and queued work is bounded, cancelled queue entries are removed', async (t) => {
  const queue = new QueryCoordinator({ concurrency: 1, maxQueued: 1 }); t.after(() => queue.close());
  const source = deferred<string>();
  const first = queue.run('scope', 'first', () => source.promise, signal());
  for (let i = 0; i < 20; i++) {
    const controller = new AbortController();
    const pending = queue.run('scope', `cancelled-${i}`, async () => assert.fail(), controller.signal);
    const rejected = assert.rejects(pending, code('CANCELLED')); controller.abort(); await rejected;
  }
  const second = queue.run('scope', 'second', async () => 'next', signal());
  await assert.rejects(queue.run('scope', 'third', async () => assert.fail(), signal()), code('BUSY'));
  source.resolve('first');
  assert.equal((await first).data, 'first'); assert.equal((await second).data, 'next');
});

test('scope and parameter keys isolate cache; invalidation cannot return a prior identity', async (t) => {
  const queue = new QueryCoordinator(); t.after(() => queue.close());
  await queue.run('identity-a', 'namespace-a/app', async () => 'a', signal());
  assert.equal((await queue.run('identity-b', 'namespace-a/app', async () => 'b', signal())).data, 'b');
  assert.equal((await queue.run('identity-a', 'namespace-b/app', async () => 'other', signal())).data, 'other');
  queue.invalidateScope('identity-a');
  assert.equal((await queue.run('identity-a', 'namespace-a/app', async () => 'new', signal())).data, 'new');
});

test('transient failure has bounded backoff, but auth/permission failures are never cached as success', async (t) => {
  let now = 1000; let calls = 0;
  const queue = new QueryCoordinator({ now: () => now }); t.after(() => queue.close());
  const load = async () => { calls++; throw new ServiceError('UPSTREAM_UNAVAILABLE', 502); };
  await assert.rejects(queue.run('scope', 'query', load, signal()), code('UPSTREAM_UNAVAILABLE'));
  await assert.rejects(queue.run('scope', 'query', load, signal()), code('UPSTREAM_UNAVAILABLE'));
  assert.equal(calls, 1);
  now += 501;
  await assert.rejects(queue.run('scope', 'query', load, signal()), code('UPSTREAM_UNAVAILABLE'));
  assert.equal(calls, 2);
  for (const codeName of ['AUTH_REQUIRED', 'FORBIDDEN'] as const) {
    let attempts = 0;
    const denied = async () => { attempts++; throw new ServiceError(codeName, 403); };
    await assert.rejects(queue.run('scope', codeName, denied, signal()), code(codeName));
    await assert.rejects(queue.run('scope', codeName, denied, signal()), code(codeName));
    assert.equal(attempts, 2);
  }
});

test('cache memory limits evict old entries and oversized results fail explicitly', async (t) => {
  const queue = new QueryCoordinator({ maxEntries: 1, maxEntryBytes: 100, maxCacheBytes: 100 }); t.after(() => queue.close());
  await queue.run('scope', 'first', async () => 'first', signal());
  await queue.run('scope', 'second', async () => 'second', signal());
  assert.equal((await queue.run('scope', 'first', async () => 'reloaded', signal())).source, 'argo-api');
  await assert.rejects(queue.run('scope', 'large', async () => 'x'.repeat(200), signal()), code('RESPONSE_TOO_LARGE'));
});

test('deadline rejects waiters even if a loader ignores cancellation, without freeing its execution slot early', async (t) => {
  const queue = new QueryCoordinator({ timeoutMs: 20, concurrency: 1 }); t.after(() => queue.close());
  const source = deferred<string>();
  const first = queue.run('scope', 'slow', () => source.promise, signal());
  const rejected = assert.rejects(first, code('TIMEOUT'));
  await delay(30); await rejected;
  let started = false;
  const second = queue.run('scope', 'next', async () => { started = true; return 'next'; }, signal());
  await setImmediate(); assert.equal(started, false);
  source.resolve('late'); assert.equal((await second).data, 'next');
});
