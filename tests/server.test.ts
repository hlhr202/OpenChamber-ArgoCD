import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createService, type ServiceOptions } from '../src/service/runtime/server.js';

const token = 'synthetic-service-token';
async function start(options: Partial<ServiceOptions> = {}) {
  const service = createService({ token, ...options });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const address = service.server.address() as AddressInfo;
  return { ...service, base: `http://127.0.0.1:${address.port}` };
}
const headers = { authorization: `Bearer ${token}` };

test('requires internal authentication including health and unknown routes', async (t) => {
  const service = await start();
  t.after(() => service.close());
  for (const path of ['/health', '/v1/diagnostics', '/unknown']) {
    assert.equal((await fetch(service.base + path)).status, 401);
    assert.equal((await fetch(service.base + path, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  }
});

test('returns bounded diagnostic envelope without touching Argo CD', async (t) => {
  const service = await start();
  t.after(() => service.close());
  const response = await fetch(service.base + '/v1/diagnostics', { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.data.readOnly, true);
  assert.equal(result.data.argoConnection, 'not-attempted');
  assert.equal(result.stale, false);
  assert.ok(Date.parse(result.sampledAt));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token));
});

test('denies methods, arbitrary routes and side-effect query parameters', async (t) => {
  const service = await start();
  t.after(() => service.close());
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    assert.equal((await fetch(service.base + '/v1/diagnostics', { headers, method })).status, 405);
  }
  for (const path of ['/v1/diagnostics?refresh=hard', '/v1/diagnostics?url=http://example.test']) {
    assert.equal((await fetch(service.base + path, { headers })).status, 400);
  }
  assert.equal((await fetch(service.base + '/api/v1/applications/a/sync', { headers })).status, 404);
  assert.equal((await fetch(service.base + '/' + 'x'.repeat(2050), { headers })).status, 400);
});

test('rejects raw encoded path traversal before URL normalization', async (t) => {
  const service = await start();
  t.after(() => service.close());
  // fetch normalizes dot segments before sending. Use raw http.request to
  // exercise what the server actually receives from a malicious caller.
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(service.base, { path: '/v1/%2e%2e/diagnostics', headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 400);
});

test('deadlines abort underlying operations and release slots', async (t) => {
  let aborted = false;
  const service = await start({ timeoutMs: 30, diagnostics: (signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('secret-upstream')); }, { once: true });
  }) });
  t.after(() => service.close());
  const response = await fetch(service.base + '/v1/diagnostics', { headers });
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'TIMEOUT');
  assert.equal(aborted, true);
  assert.equal((await fetch(service.base + '/v1/diagnostics', { headers })).status, 504);
  assert.equal((await fetch(service.base + '/health', { headers })).status, 200);
});

test('GET uploads are refused and body-bearing connections are closed', async (t) => {
  const service = await start();
  t.after(() => service.close());
  const result = await new Promise<{ status: number | undefined; connection: string | undefined }>((resolve, reject) => {
    const req = request(service.base, {
      method: 'GET', path: '/v1/diagnostics', headers: { ...headers, 'content-length': '4' },
    }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, connection: res.headers.connection });
    });
    req.on('error', reject);
    req.end('test');
  });
  assert.equal(result.status, 400);
  assert.equal(result.connection, 'close');
});

test('exceptions do not expose messages or credentials', async (t) => {
  const service = await start({ diagnostics: async () => { throw new Error(`Bearer ${token} password-value`); } });
  t.after(() => service.close());
  const response = await fetch(service.base + '/v1/diagnostics', { headers });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /synthetic-service-token|password-value/);
});

test('oversized results are rejected rather than silently returned as complete', async (t) => {
  const service = await start({ maxResponseBytes: 150 });
  t.after(() => service.close());
  const response = await fetch(service.base + '/v1/diagnostics', { headers });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'RESPONSE_TOO_LARGE');
});

test('redaction truncation is not reported as a complete successful result', async (t) => {
  const service = await start({ diagnostics: async () => ({
    service: 'ready', readOnly: true, runtime: 'x'.repeat(5000),
    platform: 'test', argoConnection: 'not-attempted',
  }) });
  t.after(() => service.close());
  const response = await fetch(service.base + '/v1/diagnostics', { headers });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'RESPONSE_TOO_LARGE');
});

test('query concurrency is bounded and health remains independent', async (t) => {
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const service = await start({ maxConcurrent: 1, timeoutMs: 200, diagnostics: () => {
    entered();
    return new Promise(() => {});
  } });
  t.after(() => service.close());
  const first = fetch(service.base + '/v1/diagnostics', { headers });
  await ready;
  assert.equal((await fetch(service.base + '/v1/diagnostics', { headers })).status, 429);
  assert.equal((await fetch(service.base + '/health', { headers })).status, 200);
  assert.equal((await first).status, 504);
});

test('cross-module forged mutations and refresh/URL overrides are denied before a client can execute', async (t) => {
  let clients = 0;
  const service = await start({ client: async () => { clients++; throw new Error('Must not resolve client.'); } }); t.after(() => service.close());
  const reads = ['/v1/identity', '/v1/applications', '/v1/application', '/v1/resource-tree', '/v1/resource', '/v1/events', '/v1/orphaned-monitoring', '/v1/manifests', '/v1/comparison', '/v1/management'];
  for (const path of reads) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await fetch(service.base + path, { method, headers })).status, 405);
    for (const key of ['refresh', 'hard-refresh', 'url', 'command', 'exec', 'server', 'forceRefresh']) assert.equal((await fetch(service.base + path + '?context=primary&' + key + '=forbidden', { headers })).status, 400);
    assert.equal((await fetch(service.base + path + '?context=primary&context=secondary', { headers })).status, 400);
  }
  for (const method of ['PUT', 'PATCH']) for (const path of ['/v1/tasks', '/v1/logs', '/v1/summary']) assert.equal((await fetch(service.base + path, { method, headers })).status, 405);
  for (const path of ['/api/v1/applications/demo/sync', '/v1/sync', '/v1/exec', '/v1/refresh', '/v1/rollback']) assert.equal((await fetch(service.base + path, { method: 'POST', headers })).status, 404);
  assert.equal(clients, 0);
});
