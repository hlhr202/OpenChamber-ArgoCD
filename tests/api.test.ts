import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { ArgoClient } from '../src/service/argocd/client.js';
import { RefreshCoordinator } from '../src/service/auth/refresh.js';
import { createService } from '../src/service/runtime/server.js';
import { hostClient } from '../src/service/runtime/settings.js';
import { rawApplication } from './application-fixtures.js';
import { configFixture, syntheticConfig } from './helpers.js';

const signal = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === expected);
const json = (res: ServerResponse, value: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
async function mock(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('default network policy refuses requests without reading CLI credentials', async (t) => {
  const fixture = await configFixture(t, 'invalid YAML [');
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail('No renewal')));
  await assert.rejects(client.identity('primary', signal()), code('NETWORK_DISABLED'));
});

test('identity uses GET, selected-context bearer token and root path with a whitelisted DTO', async (t) => {
  const base = await mock(t, (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/argo/api/v1/session/userinfo');
    assert.equal(req.headers.authorization, 'Bearer synthetic-viewer');
    json(res, { loggedIn: true, username: 'viewer', groups: ['readers'], iss: 'synthetic-issuer', token: 'must-not-leak', password: 'must-not-leak' });
  });
  const config = { ...syntheticConfig(base), servers: [{ server: base, 'plain-text': true, 'grpc-web-root-path': '/argo' }] };
  const fixture = await configFixture(t, config);
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail()), true);
  const identity = await client.identity('secondary', signal());
  assert.deepEqual(identity, { loggedIn: true, username: 'viewer', issuer: 'synthetic-issuer', groups: ['readers'] });
  assert.doesNotMatch(JSON.stringify(identity), /synthetic-viewer|must-not-leak/);
});

test('401 triggers one noninteractive renewal and rereads the changed token', async (t) => {
  let requests = 0;
  const base = await mock(t, (req, res) => {
    requests++;
    if (req.headers.authorization !== 'Bearer synthetic-rotated') { res.writeHead(401); res.end('private-error'); return; }
    json(res, { loggedIn: true, username: 'operator' });
  });
  const config = syntheticConfig(base);
  const fixture = await configFixture(t, config);
  let renewals = 0;
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => {
    renewals++;
    config.users[0]!['auth-token'] = 'synthetic-rotated';
    await fixture.write(config);
  }), true);
  assert.equal((await client.identity('primary', signal())).username, 'operator');
  assert.equal(renewals, 1);
  assert.equal(requests, 2);
});

test('a token rotated during a request invalidates the old response and is reread without CLI', async (t) => {
  let requests = 0;
  let rotate!: () => Promise<void>;
  const base = await mock(t, (_req, res) => {
    requests++;
    if (requests === 1) void rotate().then(() => json(res, { loggedIn: true, username: 'old-identity' }));
    else json(res, { loggedIn: true, username: 'new-identity' });
  });
  const config = syntheticConfig(base);
  const fixture = await configFixture(t, config);
  rotate = async () => { config.users[0]!['auth-token'] = 'synthetic-rotated'; await fixture.write(config); };
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail('No CLI needed')), true);
  assert.equal((await client.identity('primary', signal())).username, 'new-identity');
  assert.equal(requests, 2);
});

test('cached application reads do not add a third request after a successful auth renewal', async (t) => {
  let requests = 0;
  const base = await mock(t, (req, res) => {
    requests++;
    if (req.headers.authorization !== 'Bearer synthetic-rotated') { res.writeHead(401); res.end(); return; }
    json(res, { items: [rawApplication()] });
  });
  const config = syntheticConfig(base);
  const fixture = await configFixture(t, config);
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => {
    config.users[0]!['auth-token'] = 'synthetic-rotated'; await fixture.write(config);
  }), true);
  t.after(() => client.close());
  const result = await client.applicationsSnapshot('primary', {}, signal());
  assert.equal(result.data.items[0]?.name, 'demo'); assert.equal(requests, 2);
});

test('403 never triggers renewal and upstream messages stay private', async (t) => {
  const base = await mock(t, (_, res) => { res.writeHead(403); res.end('private-token-error'); });
  const fixture = await configFixture(t, syntheticConfig(base));
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail('Must not renew')), true);
  await assert.rejects(client.identity('primary', signal()), (error: unknown) => code('FORBIDDEN')(error) && !String(error).includes('private-token-error'));
});

test('invalid token cannot cause unbounded renewal or retry', async (t) => {
  let requests = 0;
  const base = await mock(t, (_, res) => { requests++; res.writeHead(401); res.end(); });
  const fixture = await configFixture(t, syntheticConfig(base));
  let renewals = 0;
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => { renewals++; }), true);
  await assert.rejects(client.identity('primary', signal()), code('AUTH_REQUIRED'));
  assert.equal(requests, 2);
  assert.equal(renewals, 1);
  await assert.rejects(client.identity('primary', signal()), code('AUTH_REQUIRED'));
  assert.equal(renewals, 1);
});

test('redirects are never followed, including token-bearing cross-origin requests', async (t) => {
  let destinationRequests = 0;
  const destination = await mock(t, (_, res) => { destinationRequests++; json(res, {}); });
  const source = await mock(t, (_, res) => { res.writeHead(302, { location: destination + '/steal' }); res.end(); });
  const fixture = await configFixture(t, syntheticConfig(source));
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail()), true);
  await assert.rejects(client.identity('primary', signal()), code('UPSTREAM_INVALID'));
  assert.equal(destinationRequests, 0);
});

test('invalid JSON, wrong content type, bad shape and oversized body are explicit failures', async (t) => {
  for (const scenario of ['json', 'html', 'shape', 'size']) {
    const base = await mock(t, (_, res) => {
      if (scenario === 'html') { res.end('<html>login</html>'); return; }
      res.setHeader('content-type', 'application/json');
      if (scenario === 'json') res.end('{invalid');
      else if (scenario === 'shape') res.end('{}');
      else res.end('x'.repeat(2_000_001));
    });
    const fixture = await configFixture(t, syntheticConfig(base));
    const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail()), true);
    await assert.rejects(client.identity('primary', signal()), code(scenario === 'size' ? 'RESPONSE_TOO_LARGE' : 'UPSTREAM_INVALID'));
  }
});

test('cancellation aborts an upstream request without a renewal', async (t) => {
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const base = await mock(t, () => { entered(); });
  const fixture = await configFixture(t, syntheticConfig(base));
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail()), true);
  const controller = new AbortController();
  const operation = client.identity('primary', controller.signal);
  const rejected = assert.rejects(operation, code('TIMEOUT'));
  await ready;
  controller.abort();
  await rejected;
});

test('known opaque credentials are scrubbed even from otherwise displayable strings', async (t) => {
  const base = await mock(t, (_, res) => json(res, { loggedIn: true, username: 'synthetic-original', groups: ['synthetic-refresh'] }));
  const fixture = await configFixture(t, syntheticConfig(base));
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail()), true);
  const result = await client.identity('primary', signal());
  assert.doesNotMatch(JSON.stringify(result), /synthetic-original|synthetic-refresh/);
});

test('Service context routes enforce parameter schemas and keep network disabled', async (t) => {
  const fixture = await configFixture(t);
  const client = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail()));
  const service = createService({ token: 'synthetic-service', client: async () => client });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close());
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const options = { headers: { authorization: 'Bearer synthetic-service' } };
  const contexts = await (await fetch(base + '/v1/contexts', options)).json();
  assert.equal(contexts.data.networkEnabled, false);
  assert.doesNotMatch(JSON.stringify(contexts), /synthetic-original|synthetic-refresh/);
  assert.equal((await fetch(base + '/v1/identity?context=primary', options)).status, 403);
  const taskStart = await fetch(base + '/v1/tasks', { method: 'POST', headers: { ...options.headers, 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'applications', context: 'primary' }) });
  assert.equal(taskStart.status, 403); assert.equal((await taskStart.json()).error.code, 'NETWORK_DISABLED');
  const logStart = await fetch(base + '/v1/logs', { method: 'POST', headers: { ...options.headers, 'content-type': 'application/json' }, body: JSON.stringify({ context: 'primary', name: 'demo', appNamespace: 'argocd', resource: { group: '', version: 'v1', kind: 'Pod', namespace: 'team-a', name: 'demo', uid: 'pod-a' }, container: 'main' }) });
  assert.equal(logStart.status, 403); assert.equal((await logStart.json()).error.code, 'NETWORK_DISABLED');
  for (const path of ['/v1/resource-tree?context=primary&name=demo&appNamespace=argocd', '/v1/events?context=primary&name=demo&appNamespace=argocd', '/v1/orphaned-monitoring?context=primary&project=default', '/v1/resource?context=primary&name=demo&appNamespace=argocd&kind=Pod&version=v1&resourceName=demo&namespace=team-a&uid=pod-a', '/v1/manifests?context=primary&name=demo&appNamespace=argocd', '/v1/comparison?context=primary&name=demo&appNamespace=argocd', '/v1/management?context=primary&operation=projects']) {
    const response = await fetch(base + path, options); assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'NETWORK_DISABLED');
  }
  for (const path of ['/v1/identity', '/v1/identity?context=primary&context=secondary', '/v1/identity?context=primary&refresh=hard', '/v1/contexts?configPath=/arbitrary']) {
    assert.equal((await fetch(base + path, options)).status, 400);
  }
});

test('host settings need no network toggle and reject unknown configuration', async (t) => {
  const fixture = await configFixture(t);
  const client = await hostClient(fixture.directory + '/absent-settings');
  assert.equal(client.networkEnabled, true); client.close();
  for (const settings of [{ token: 'must-not-be-configured' }, { networkEnabled: 'true' }, { configPath: '../relative' }, { cliPath: 'argocd --evil' }]) {
    await fixture.write(settings);
    await assert.rejects(hostClient(fixture.path), code('CONFIG_INVALID'));
  }
});

test('host Service ignores the old network gate and never renews or writes CLI config on 401', async (t) => {
  let reads = 0;
  const base = await mock(t, (_req, res) => { reads++; res.writeHead(401); res.end('{}'); });
  const fixture = await configFixture(t, syntheticConfig(base));
  const { readFile, stat, writeFile } = await import('node:fs/promises');
  const before = await readFile(fixture.path); const modified = (await stat(fixture.path)).mtimeMs;
  const settings = fixture.directory + '/settings.json';
  await writeFile(settings, JSON.stringify({ configPath: fixture.path, networkEnabled: false, cliPath: '/must-never-execute' }));
  const client = await hostClient(settings); t.after(() => client.close());
  assert.equal((await client.contexts()).networkEnabled, true);
  await assert.rejects(client.identity('primary', signal()), code('AUTH_REQUIRED'));
  assert.equal(reads, 1); assert.ok((await readFile(fixture.path)).equals(before)); assert.equal((await stat(fixture.path)).mtimeMs, modified);
});
