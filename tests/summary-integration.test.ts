import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { ArgoClient } from '../src/service/argocd/client.js';
import { RefreshCoordinator } from '../src/service/auth/refresh.js';
import { createService } from '../src/service/runtime/server.js';
import { configFixture, syntheticConfig } from './helpers.js';
import { rawApplication } from './application-fixtures.js';
import { LANGUAGES } from '../src/shared/language.js';

test('local summary endpoint rechecks opaque identity epoch, re-redacts credentials, and never queries Argo for preview', async (t) => {
  let upstreamReads = 0;
  const upstream = createServer((_req, res) => { upstreamReads++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(rawApplication())); });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const config = syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`); const f = await configFixture(t, config);
  const api = new ArgoClient(f.provider, new RefreshCoordinator(async () => assert.fail()), true); const service = createService({ token: 'synthetic-host', client: async () => api });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`; const headers = { authorization: 'Bearer synthetic-host', 'content-type': 'application/json' };
  const observed = await (await fetch(base + '/v1/application?context=primary&name=demo&appNamespace=argocd', { headers })).json();
  assert.match(observed.serviceInstance, /^[a-f0-9-]{36}$/); assert.match(observed.identityEpoch, /^[\w-]{43}$/);
  const data = { context: 'primary', identityEpoch: observed.identityEpoch, evidence: { application: { name: 'demo', appNamespace: 'argocd' }, records: [{ kind: 'application', sampledAt: observed.sampledAt, expiresAt: observed.expiresAt, stale: false, source: 'argo-api', lines: ['synthetic-original Bearer hidden-value <img src=x>'] }] } };
  const draft = await (await fetch(base + '/v1/summary', { method: 'POST', headers, body: JSON.stringify(data) })).json();
  assert.equal(draft.ok, true); assert.equal(upstreamReads, 1); assert.doesNotMatch(JSON.stringify(draft), /synthetic-original|hidden-value/);
  assert.match(draft.data.parts.join('\n'), /REDACTED/);
  const english = await (await fetch(base + '/v1/summary', { method: 'POST', headers, body: JSON.stringify({ ...data, language: 'en' }) })).json();
  assert.equal(english.ok, true); assert.match(english.data.parts[0], /read-only troubleshooting summary/); assert.equal(upstreamReads, 1);
  assert.doesNotMatch(JSON.stringify(english), /synthetic-original|hidden-value/);
  for (const language of LANGUAGES) {
    const localized = await (await fetch(base + '/v1/summary', { method: 'POST', headers, body: JSON.stringify({ ...data, language }) })).json();
    assert.equal(localized.ok, true); assert.doesNotMatch(JSON.stringify(localized), /synthetic-original|hidden-value/);
  }
  for (const language of ['en-US', 'unknown-language', '', { token: 'not-a-language' }]) assert.equal((await fetch(base + '/v1/summary', { method: 'POST', headers, body: JSON.stringify({ ...data, language }) })).status, 400);
  assert.equal(upstreamReads, 1);
  config.users[0]!['auth-token'] = 'synthetic-rotated'; await f.write(config);
  const expired = await fetch(base + '/v1/summary', { method: 'POST', headers, body: JSON.stringify(data) }); assert.equal(expired.status, 410); assert.equal(upstreamReads, 1);
  assert.equal((await fetch(base + '/v1/summary', { headers })).status, 405);
  assert.equal((await fetch(base + '/v1/summary', { method: 'POST', headers, body: JSON.stringify({ ...data, send: true }) })).status, 400);
  assert.equal((await fetch(base + '/v1/summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
});
