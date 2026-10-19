import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { rawApplication } from './application-fixtures.js';
import { configFixture, syntheticConfig } from './helpers.js';

async function preflightFixture(t: TestContext, denied = false) {
  const requests: string[] = [];
  const upstream = createServer((req, res) => {
    requests.push(req.url!); assert.equal(req.method, 'GET'); assert.equal(req.headers.authorization, 'Bearer synthetic-original');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/version') res.end(JSON.stringify({ Version: 'v3.5.3' }));
    else if (req.url === '/api/v1/session/userinfo') { if (denied) res.statusCode = 401; res.end(JSON.stringify({ loggedIn: !denied, username: 'private-identity-name', groups: ['private-group'] })); }
    else if (req.url === '/api/v1/applications') res.end(JSON.stringify({ items: [rawApplication()] }));
    else { res.statusCode = 405; res.end('{}'); }
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const fixture = await configFixture(t, syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`));
  const bin = join(fixture.directory, 'bin'); await mkdir(bin);
  // The fake CLI refuses every command except offline version inspection.
  await writeFile(join(bin, 'argocd'), `#!${process.execPath}\nif(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['version','--client','--short']))process.exit(9);console.log('argocd: v3.4.6-test');\n`, { mode: 0o700 });
  const run = (args: string[]) => new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, ['--import', 'tsx', 'scripts/verify-local.ts', ...args], { timeout: 15000, maxBuffer: 32000,
      env: { PATH: bin, HOME: fixture.directory, USERPROFILE: fixture.directory, XDG_CONFIG_HOME: fixture.directory, ARGOCD_CONFIG_DIR: fixture.directory } }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, stdout, stderr }));
  });
  return { requests, run };
}

test('manual local preflight defaults to zero network requests and never runs a CLI network command', async (t) => {
  const fixture = await preflightFixture(t); const result = await fixture.run([]); assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout); assert.equal(report.mode, 'local-preflight-no-network'); assert.equal(report.originalConfigUnchanged, true); assert.equal(report.cliNetworkCalls, 0); assert.equal(fixture.requests.length, 0);
  assert.doesNotMatch(result.stdout, /synthetic-original|synthetic-refresh|private-identity-name|private-group|127\.0\.0\.1/);
});

test('explicit live preflight only reads fixed version/identity/application endpoints and outputs safe counts', async (t) => {
  const fixture = await preflightFixture(t); const result = await fixture.run(['--confirm-read-only']); assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout); assert.equal(report.liveResult, 'read-only-api-preflight-passed'); assert.equal(report.originalConfigUnchanged, true); assert.equal(report.applications.total, 1); assert.equal(report.writesRequested, 0);
  assert.deepEqual(fixture.requests, ['/api/version', '/api/v1/session/userinfo', '/api/v1/applications']);
  assert.doesNotMatch(result.stdout, /synthetic-original|synthetic-refresh|private-identity-name|private-group|hidden-values|127\.0\.0\.1/);
});

test('expired identity stops live preflight without login, renewal, app read or config changes', async (t) => {
  const fixture = await preflightFixture(t, true); const result = await fixture.run(['--confirm-read-only']); assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout); assert.equal(report.errorCode, 'AUTH_REQUIRED'); assert.equal(report.originalConfigUnchanged, true); assert.equal(report.refreshOrLoginAllowed, false);
  assert.deepEqual(fixture.requests, ['/api/version', '/api/v1/session/userinfo']);
});

test('manual preflight refuses arbitrary command, server and context flags before any access', async (t) => {
  const fixture = await preflightFixture(t); const result = await fixture.run(['--server=https://arbitrary.invalid']); assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.equal(fixture.requests.length, 0);
});
