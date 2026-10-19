import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { ArgoClient } from '../src/service/argocd/client.js';
import { RefreshCoordinator } from '../src/service/auth/refresh.js';
import { createService } from '../src/service/runtime/server.js';
import { LogSessions } from '../src/service/runtime/log-sessions.js';
import { configFixture, syntheticConfig } from './helpers.js';
import { logCommand, logPacket, lastPacket } from './log-fixtures.js';
import { podRef, rawPod, rawTree } from './resource-fixtures.js';

async function fixture(t: TestContext, mode: 'normal' | 'forbidden' | 'eof' = 'normal') {
  let uid = podRef.uid; let logCalls = 0; const streams = new Set<ServerResponse>();
  const upstream = createServer((req, res) => {
    assert.equal(req.method, 'GET'); assert.ok(['Bearer synthetic-original', 'Bearer synthetic-rotated'].includes(req.headers.authorization!));
    const url = new URL(req.url!, 'http://localhost'); assert.equal(url.searchParams.has('refresh'), false);
    res.setHeader('content-type', 'application/json');
    if (url.pathname.endsWith('/resource-tree')) res.end(JSON.stringify(rawTree()));
    else if (url.pathname.endsWith('/resource')) res.end(JSON.stringify({ manifest: JSON.stringify(rawPod({ ...podRef, uid })) }));
    else if (url.pathname.endsWith('/logs')) {
      logCalls++; assert.equal(url.searchParams.get('namespace'), 'team-a'); assert.equal(url.searchParams.get('appNamespace'), 'argocd'); assert.equal(url.searchParams.get('container'), 'main');
      if (mode === 'forbidden') { res.end('{"error":{"code":7,"message":"private-rbac-error"}}\n'); return; }
      const data = logPacket('one synthetic-original Bearer private-access') + logPacket('-----BEGIN PRIVATE KEY-----') + logPacket('private-key-material') + logPacket('-----END PRIVATE KEY-----') + logPacket('x'.repeat(5000));
      if (mode === 'eof') { res.end(data); return; }
      if (url.searchParams.get('follow') === 'true') { streams.add(res); res.once('close', () => streams.delete(res)); res.write(data); }
      else res.end(data + lastPacket);
    } else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const config = syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`); const f = await configFixture(t, config);
  const api = new ArgoClient(f.provider, new RefreshCoordinator(async () => assert.fail()), true);
  const service = createService({ token: 'synthetic-host', client: async () => api, logs: new LogSessions({ checkMs: 10, tickMs: 5, maxLines: 3 }) });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { if (service.server.listening) await service.close(); });
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`; const headers = { authorization: 'Bearer synthetic-host', 'content-type': 'application/json' };
  const get = async (id: string, context = 'primary', after = '0') => { const res = await fetch(base + '/v1/logs?' + new URLSearchParams({ id, context, after }), { headers }); return { status: res.status, body: await res.json() }; };
  const start = async (extra = {}) => { const res = await fetch(base + '/v1/logs', { method: 'POST', headers, body: JSON.stringify({ ...logCommand(), ...extra }) }); return { status: res.status, body: await res.json() }; };
  const wait = async (id: string, predicate: (data: { state: string; headCursor: number }) => boolean) => {
    for (let i = 0; i < 100; i++) { const res = await get(id); if (res.body.ok && predicate(res.body.data)) return res.body.data; await delay(5); }
    assert.fail('Log session did not settle');
  };
  return { base, headers, service, get, start, wait, streams, calls: () => logCalls, setUID: (value: string) => { uid = value; }, rotate: async () => { config.users[0]!['auth-token'] = 'synthetic-rotated'; await f.write(config); } };
}

test('HTTP log session is short-call, read-only, bounded, redacted and bound to context/identity', async (t) => {
  const f = await fixture(t); const created = await f.start(); assert.equal(created.status, 200); const id = created.body.data.id as string;
  const page = await f.wait(id, (data) => data.state === 'completed');
  assert.equal(page.gap, true); assert.equal(page.droppedLines, 2); assert.equal(page.truncatedLines, 1);
  assert.doesNotMatch(JSON.stringify(page), /synthetic-original|private-access|private-key-material/);
  assert.equal((await f.get(id, 'secondary')).status, 404);
  assert.equal((await f.get(id, 'primary', '-1')).status, 400);
  assert.equal((await fetch(f.base + '/v1/logs', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await f.start({ refresh: 'hard' })).status, 400);
  assert.equal((await f.start({ tailLines: 0 })).status, 400);
  await f.rotate(); assert.equal((await f.get(id)).status, 404);
});

test('fresh Pod/container validation prevents stale UID and unknown container reads', async (t) => {
  const f = await fixture(t);
  const wrong = await f.start({ container: 'not-present' }); const failure = await f.wait(wrong.body.data.id, (data) => data.state === 'failed'); assert.equal(failure.error.code, 'NOT_FOUND'); assert.equal(f.calls(), 0);
  f.setUID('recreated-pod'); const changed = await f.start();
  const recreated = await f.wait(changed.body.data.id, (data) => data.state === 'failed'); assert.equal(recreated.error.code, 'RESOURCE_CHANGED'); assert.equal(f.calls(), 0);
});

test('follow reader stops on DELETE, observed Pod replacement and Service shutdown', async (t) => {
  const f = await fixture(t); const first = await f.start({ follow: true }); const id = first.body.data.id as string;
  await f.wait(id, (data) => data.state === 'streaming' && data.headCursor >= 5);
  const stop = await (await fetch(f.base + '/v1/logs?' + new URLSearchParams({ context: 'primary', id }), { method: 'DELETE', headers: f.headers })).json(); assert.equal(stop.data.state, 'stopped');
  for (let i = 0; i < 30 && f.streams.size; i++) await delay(5); assert.equal(f.streams.size, 0);
  const second = await f.start({ follow: true }); await f.wait(second.body.data.id, (data) => data.state === 'streaming'); f.setUID('new-pod');
  const changed = await f.wait(second.body.data.id, (data) => data.state === 'failed'); assert.equal(changed.error.code, 'RESOURCE_CHANGED');
  f.setUID(podRef.uid); const third = await f.start({ follow: true }); await f.wait(third.body.data.id, (data) => data.state === 'streaming');
  await f.rotate(); assert.equal((await f.get(third.body.data.id)).status, 404);
  for (let i = 0; i < 50 && f.streams.size; i++) await delay(5); assert.equal(f.streams.size, 0);
  const fourth = await f.start({ follow: true });
  const rotated = await f.wait(fourth.body.data.id, (data) => data.state === 'streaming' && data.headCursor >= 5);
  assert.doesNotMatch(JSON.stringify(rotated), /synthetic-original|synthetic-rotated/);
  await f.service.close();
  for (let i = 0; i < 30 && f.streams.size; i++) await delay(5); assert.equal(f.streams.size, 0);
});

test('gateway RBAC failure and truncated EOF never turn into successful empty/history results', async (t) => {
  const denied = await fixture(t, 'forbidden'); const created = await denied.start();
  const error = await denied.wait(created.body.data.id, (data) => data.state === 'failed'); assert.equal(error.error.code, 'FORBIDDEN'); assert.doesNotMatch(JSON.stringify(error), /private-rbac-error/);
  const eof = await fixture(t, 'eof'); const started = await eof.start();
  const disconnected = await eof.wait(started.body.data.id, (data) => data.state === 'disconnected'); assert.equal(disconnected.continuity, 'not-guaranteed');
});
