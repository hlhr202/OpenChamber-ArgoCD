import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const temporaryRoot = join(tmpdir(), 'opencode');
await mkdir(temporaryRoot, { recursive: true });
// Keep the artifact outside the checkout: Node resolution must not be able
// to fall back to this project's node_modules through parent directories.
const directory = await mkdtemp(join(temporaryRoot, 'argocd-smoke-'));
const reservation = createServer();
await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
const address = reservation.address();
assert.ok(address && typeof address === 'object');
const port = address.port;
await new Promise<void>((done) => reservation.close(() => done()));
let child: ReturnType<typeof spawn> | undefined;
try {
  await cp(process.argv[2] ?? 'service/main.js', resolve(directory, 'main.js'));
  await writeFile(resolve(directory, 'package.json'), '{"type":"module"}');
  const syntheticHome = join(directory, 'home');
  const configHome = join(syntheticHome, '.config');
  await mkdir(join(configHome, 'argocd'), { recursive: true });
  await writeFile(join(configHome, 'argocd/config'), JSON.stringify({
    'current-context': 'synthetic', contexts: [{ name: 'synthetic', server: 'https://argo.invalid', user: 'synthetic-user' }],
    servers: [{ server: 'https://argo.invalid' }], users: [{ name: 'synthetic-user', 'auth-token': 'synthetic-argo-token' }],
  }));
  // The copied artifact has no node_modules or real user configuration.
  // Its only CLI configuration and credentials are synthetic test data.
  child = spawn(process.execPath, ['main.js'], {
    cwd: directory,
    env: { OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: 'smoke-test-only',
      HOME: syntheticHome, USERPROFILE: syntheticHome, XDG_CONFIG_HOME: configHome },
    stdio: 'ignore',
  });
  const exited = once(child, 'exit');
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    try {
      const response = await fetch(base + '/health', {
        headers: { authorization: 'Bearer smoke-test-only' }, signal: AbortSignal.timeout(200),
      });
      ready = response.status === 200;
      await response.text();
      if (ready) break;
    } catch { /* startup race on this temporary loopback listener */ }
    await delay(20);
  }
  assert.ok(ready, 'Copied Service artifact must start without dependencies.');
  const response = await fetch(base + '/v1/diagnostics', { headers: { authorization: 'Bearer smoke-test-only' } });
  const result = await response.json();
  assert.equal(result.data.argoConnection, 'not-attempted');
  assert.equal((await fetch(base + '/health')).status, 401);
  const contexts = await (await fetch(base + '/v1/contexts', { headers: { authorization: 'Bearer smoke-test-only' } })).json();
  assert.equal(contexts.data.networkEnabled, true);
  assert.equal(contexts.data.contexts[0].name, 'synthetic');
  assert.doesNotMatch(JSON.stringify(contexts), /synthetic-argo-token/);
  const denied = await fetch(base + '/v1/applications?context=synthetic&refresh=hard', { headers: { authorization: 'Bearer smoke-test-only' } });
  assert.equal((await denied.json()).error.code, 'BAD_REQUEST');
  child.kill('SIGTERM');
  const shutdown = await Promise.race([exited, delay(3000, undefined, { ref: false }).then(() => { throw new Error('Service did not shut down.'); })]);
  assert.equal(shutdown[0], 0);
  console.log('Built Service smoke passed: isolated directory, no npm dependencies, synthetic CLI parsed, read-only routes ready, refresh refused, auth enforced, clean SIGTERM; no upstream requests.');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await rm(directory, { recursive: true, force: true });
}
