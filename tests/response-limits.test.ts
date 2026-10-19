import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { GUEST_REQUEST_RESPONSE_MAX } from '@openchamber/sdk';
import { LIMITS, type Diagnostics, type QuerySnapshot } from '../src/shared/contracts.js';
import { TaskManager } from '../src/service/runtime/tasks.js';
import { QueryCoordinator } from '../src/service/runtime/queries.js';
import { createService } from '../src/service/runtime/server.js';
import { ServiceError } from '../src/service/security/errors.js';

/** Exact serialized ASCII byte size, without bypassing string/node budgets. */
function sized(bytes: number): { rows: string[]; padding: string } {
  const value = { rows: Array.from({ length: Math.floor((bytes - 32) / 4003) }, () => 'x'.repeat(4000)), padding: '' };
  const remaining = bytes - Buffer.byteLength(JSON.stringify(value));
  assert.ok(remaining >= 0 && remaining <= 4096); value.padding = 'x'.repeat(remaining);
  assert.equal(Buffer.byteLength(JSON.stringify(value)), bytes); return value;
}
const snapshot = (data: unknown): QuerySnapshot<unknown> => ({ data, sampledAt: new Date(1000).toISOString(), expiresAt: new Date(2000).toISOString(), stale: false, source: 'argo-api' });

test('default task result limit accepts 2,000,000 serialized bytes and rejects the next byte', async (t) => {
  const tasks = new TaskManager({ now: () => 1000 }); t.after(() => tasks.close());
  const overhead = Buffer.byteLength(JSON.stringify(snapshot(null))) - 4;
  const job = tasks.create('scope', { operation: 'applications', context: 'primary', filters: {} }, async () => snapshot(sized(LIMITS.taskResultBytes - overhead)));
  const tooLarge = tasks.create('scope', { operation: 'applications', context: 'primary', filters: {} }, async () => snapshot(sized(LIMITS.taskResultBytes + 1 - overhead)));
  await setImmediate();
  assert.equal(tasks.get(job.id, 'scope').state, 'succeeded');
  assert.equal(Buffer.byteLength(JSON.stringify(tasks.get(job.id, 'scope').result)), 2_000_000);
  assert.equal(tasks.get(tooLarge.id, 'scope').state, 'failed'); assert.equal(tasks.get(tooLarge.id, 'scope').error?.code, 'RESPONSE_TOO_LARGE');
});

test('default cache entry limit is 2 MB while aggregate cache memory remains bounded to 4 MB', async (t) => {
  const queue = new QueryCoordinator(); t.after(() => queue.close()); const signal = new AbortController().signal;
  assert.equal((await queue.run('scope', 'boundary', async () => sized(2_000_000), signal)).source, 'argo-api');
  assert.equal((await queue.run('scope', 'boundary', async () => assert.fail('Expected cache hit'), signal)).source, 'cache');
  await assert.rejects(queue.run('scope', 'over', async () => sized(2_000_001), signal), (error: unknown) => error instanceof ServiceError && error.code === 'RESPONSE_TOO_LARGE');
  queue.invalidateScope('scope');
  for (const key of ['first', 'second', 'third']) await queue.run('scope', key, async () => sized(1_500_000), signal);
  assert.equal((await queue.run('scope', 'second', async () => assert.fail('Second entry should remain'), signal)).source, 'cache');
  assert.equal((await queue.run('scope', 'first', async () => sized(1_500_000), signal)).source, 'argo-api');
});

test('Service HTTP supports large redacted responses below 2 MB and still refuses oversized or structurally truncated output', async (t) => {
  let data: unknown = sized(1_900_000);
  const service = createService({ token: 'synthetic-size-host', diagnostics: async () => data as Diagnostics });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const url = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}/v1/diagnostics`; const headers = { authorization: 'Bearer synthetic-size-host' };
  const accepted = await fetch(url, { headers }); const text = await accepted.text();
  assert.equal(accepted.status, 200); assert.ok(Buffer.byteLength(text) > 256_000); assert.ok(Buffer.byteLength(text) < 2_000_000); assert.equal(JSON.parse(text).ok, true);
  data = sized(2_000_001); const oversized = await fetch(url, { headers }); assert.equal(oversized.status, 413); assert.equal((await oversized.json()).error.code, 'RESPONSE_TOO_LARGE');
  data = { message: 'x'.repeat(4097) }; const truncated = await fetch(url, { headers }); assert.equal(truncated.status, 413); assert.equal((await truncated.json()).error.code, 'RESPONSE_TOO_LARGE');
});

test('plugin-side size increases do not misrepresent the pinned SDK transport response cap', () => {
  assert.equal(LIMITS.responseBytes, 2_000_000); assert.equal(LIMITS.taskResultBytes, 2_000_000); assert.equal(LIMITS.cacheEntryBytes, 2_000_000);
  assert.equal(GUEST_REQUEST_RESPONSE_MAX, 256_000); assert.ok(GUEST_REQUEST_RESPONSE_MAX < LIMITS.responseBytes);
});
