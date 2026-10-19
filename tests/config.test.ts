import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { join } from 'node:path';
import { cliConfigPath, CredentialProvider, restBaseUrl } from '../src/service/auth/config.js';
import { cliEnvironment, refreshArguments, RefreshCoordinator } from '../src/service/auth/refresh.js';
import { configFixture, syntheticConfig } from './helpers.js';

const errorCode = (code: string) => (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);

test('configuration discovery matches CLI precedence including legacy before XDG', async () => {
  const options = { home: '/synthetic-home', env: {}, exists: async () => false };
  assert.equal(await cliConfigPath(options), '/synthetic-home/.config/argocd/config');
  assert.equal(await cliConfigPath({ ...options, env: { XDG_CONFIG_HOME: '/custom' } }), '/custom/argocd/config');
  assert.equal(await cliConfigPath({ ...options, env: { XDG_CONFIG_HOME: '/custom' }, exists: async () => true }), '/synthetic-home/.argocd/config');
  assert.equal(await cliConfigPath({ ...options, env: { ARGOCD_CONFIG_DIR: '/argocd' }, exists: async () => true }), '/argocd/config');
  assert.equal(await cliConfigPath({ ...options, configPath: '~/explicit' }), '/synthetic-home/explicit');
  await assert.rejects(cliConfigPath({ ...options, configPath: '../relative' }), errorCode('CONFIG_INVALID'));
});

test('resolves per-request context without changing current-context or exposing tokens', async (t) => {
  const fixture = await configFixture(t);
  const summary = await fixture.provider.list();
  assert.equal(summary[0]?.current, true);
  assert.doesNotMatch(JSON.stringify(summary), /synthetic-original|synthetic-refresh|synthetic-viewer/);
  const [primary, secondary] = await Promise.all([fixture.provider.resolve('primary'), fixture.provider.resolve('secondary')]);
  assert.equal(primary.token, 'synthetic-original');
  assert.equal(secondary.token, 'synthetic-viewer');
  assert.equal((await fixture.provider.list())[0]?.current, true);
  await assert.rejects(fixture.provider.resolve('missing'), errorCode('CONTEXT_NOT_FOUND'));
});

test('detects configuration rotation without a persistent token cache', async (t) => {
  const fixture = await configFixture(t);
  const original = await fixture.provider.resolve('primary');
  const next = syntheticConfig();
  next.users[0]!['auth-token'] = 'synthetic-rotated';
  await fixture.write(next);
  const updated = await fixture.provider.resolve('primary');
  assert.equal(updated.token, 'synthetic-rotated');
  assert.notEqual(updated.generation, original.generation);
});

test('rejects invalid YAML, aliases, duplicate keys/names, missing references and oversized files', async (t) => {
  const fixture = await configFixture(t);
  const duplicateNames = syntheticConfig();
  duplicateNames.contexts.push(duplicateNames.contexts[0]!);
  for (const invalid of ['users: [', 'contexts: []\ncontexts: []', 'contexts: &a [*a]', duplicateNames, 'x'.repeat(2_000_001)]) {
    await fixture.write(invalid);
    await assert.rejects(fixture.provider.list(), errorCode('CONFIG_INVALID'));
  }
  const missing = syntheticConfig();
  missing.contexts[0]!.user = 'missing';
  await fixture.write(missing);
  await assert.rejects(fixture.provider.list(), errorCode('CONFIG_INVALID'));
  await assert.rejects(new CredentialProvider({ configPath: join(fixture.directory, 'absent') }).list(), errorCode('CONFIG_MISSING'));
});

test('accepts core context discovery but rejects token-based access for core', async (t) => {
  const config = { ...syntheticConfig(), servers: [{ server: 'https://argo.example.test', core: true }] };
  const fixture = await configFixture(t, config);
  assert.equal((await fixture.provider.list())[0]?.core, true);
  await assert.rejects(fixture.provider.resolve('primary'), errorCode('UNSUPPORTED'));
});

test('connection URL forbids credentials, protocol downgrade and ambiguous root paths', () => {
  assert.equal(restBaseUrl({ server: 'argo.example.test:443', 'grpc-web-root-path': '/argo/' }), 'https://argo.example.test/argo');
  assert.equal(restBaseUrl({ server: 'http://localhost:9000', 'plain-text': true }, '/custom'), 'http://localhost:9000/custom');
  for (const server of ['https://user:password@example.test', 'http://example.test', 'https://example.test?token=secret', 'file:///config']) {
    assert.throws(() => restBaseUrl({ server }), errorCode('CONFIG_INVALID'));
  }
  for (const root of ['//evil.test', '/a/../b', '/%2e%2e', '/path?refresh=hard', '/path\\other']) {
    assert.throws(() => restBaseUrl({ server: 'argo.example.test' }, root), errorCode('CONFIG_INVALID'));
  }
});

test('TLS material is per-connection, paired and file references precede inline data', async (t) => {
  const fixture = await configFixture(t);
  const config = { ...syntheticConfig(), servers: [{ server: 'https://argo.example.test',
    'certificate-authority-data': Buffer.from('synthetic-ca').toString('base64'),
    'client-certificate-data': Buffer.from('synthetic-cert').toString('base64'),
    'client-certificate-key-data': Buffer.from('synthetic-key').toString('base64'), insecure: true }] };
  await fixture.write(config);
  const connection = await fixture.provider.resolve('primary');
  assert.equal(connection.ca?.toString(), 'synthetic-ca');
  assert.equal(connection.cert?.toString(), 'synthetic-cert');
  assert.equal(connection.key?.toString(), 'synthetic-key');
  assert.equal(connection.insecure, true);
  const certPath = join(fixture.directory, 'synthetic-cert');
  const keyPath = join(fixture.directory, 'synthetic-key');
  await writeFile(certPath, 'file-cert');
  await writeFile(keyPath, 'file-key');
  await fixture.write({ ...config, servers: [{ ...config.servers[0], 'client-certificate': certPath, 'client-certificate-key': keyPath,
    'client-certificate-data': 'invalid-inline-is-not-used', 'client-certificate-key-data': 'invalid-inline-is-not-used' }] });
  const fileConnection = await fixture.provider.resolve('primary');
  assert.equal(fileConnection.cert?.toString(), 'file-cert');
  assert.equal(fileConnection.key?.toString(), 'file-key');
  await writeFile(certPath, 'rotated-file-cert');
  assert.notEqual((await fixture.provider.resolve('primary')).generation, fileConnection.generation);
  await fixture.write({ ...config, servers: [{ ...config.servers[0], 'client-certificate': '/missing-file' }] });
  await assert.rejects(fixture.provider.resolve('primary'), errorCode('CONFIG_INVALID'));
  await fixture.write({ ...config, servers: [{ ...config.servers[0], 'certificate-authority-data': '%%%not-base64' }] });
  await assert.rejects(fixture.provider.resolve('primary'), errorCode('CONFIG_INVALID'));
});

test('CLI command is fixed, noninteractive and excludes tokens and host-service environment', async (t) => {
  const fixture = await configFixture(t);
  const connection = await fixture.provider.resolve('primary');
  assert.deepEqual(refreshArguments(connection), ['account', 'get-user-info', '--output=json', '--prompts-enabled=false', `--config=${fixture.path}`, '--argocd-context=primary']);
  assert.doesNotMatch(JSON.stringify(refreshArguments(connection)), /synthetic-original|synthetic-refresh/);
  assert.deepEqual(cliEnvironment({ PATH: '/tools', HOME: '/synthetic-home', OPENCHAMBER_SERVICE_TOKEN: 'private', ARGOCD_AUTH_TOKEN: 'override', ARGOCD_SERVER: 'other', ARGOCD_OPTS: '--core', NODE_OPTIONS: '--inspect', HTTPS_PROXY: 'secret-proxy' }), { PATH: '/tools', HOME: '/synthetic-home' });
});

test('renewal merges concurrent requests and applies cooldown', async (t) => {
  const fixture = await configFixture(t);
  const connection = await fixture.provider.resolve('primary');
  let calls = 0;
  let release!: () => void;
  const coordinator = new RefreshCoordinator(async () => { calls++; await new Promise<void>((resolve) => { release = resolve; }); });
  const signal = new AbortController().signal;
  const first = coordinator.refresh(connection, signal);
  const second = coordinator.refresh(connection, signal);
  await Promise.resolve();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  await assert.rejects(coordinator.refresh(connection, signal), errorCode('AUTH_REQUIRED'));
  await assert.rejects(coordinator.refresh({ ...connection, refreshToken: '', user: 'local-user' }, signal), errorCode('AUTH_REQUIRED'));
});

test('failed renewal is cooled down without leaking runner errors', async (t) => {
  const fixture = await configFixture(t);
  const connection = await fixture.provider.resolve('primary');
  let attempts = 0;
  const coordinator = new RefreshCoordinator(async () => { attempts++; throw new Error('synthetic-runner-failure'); });
  await assert.rejects(coordinator.refresh(connection, new AbortController().signal), (error: unknown) => errorCode('AUTH_REQUIRED')(error) && !String(error).includes('synthetic-runner-failure'));
  await assert.rejects(coordinator.refresh(connection, new AbortController().signal), errorCode('AUTH_REQUIRED'));
  assert.equal(attempts, 1);
});
