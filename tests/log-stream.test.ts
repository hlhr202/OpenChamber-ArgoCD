import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { consumeLogs, logUrl, type RawLogLine } from '../src/service/argocd/logs.js';
import { ServiceError } from '../src/service/security/errors.js';
import { configFixture, syntheticConfig } from './helpers.js';
import { logCommand, logPacket, lastPacket } from './log-fixtures.js';

const code = (value: string) => (error: unknown) => error instanceof ServiceError && error.code === value;
async function mock(t: TestContext, reply: (res: ServerResponse, url: URL) => void) {
  const server = createServer((req, res) => { assert.equal(req.method, 'GET'); assert.equal(req.headers.authorization, 'Bearer synthetic-original'); res.setHeader('content-type', 'application/json'); reply(res, new URL(req.url!, 'http://localhost')); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  const config = await configFixture(t, syntheticConfig(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  return config.provider.resolve('primary');
}
test('gateway log stream decodes split JSON/UTF-8, isolates parameters and handles last marker', async (t) => {
  const connection = await mock(t, (res, url) => {
    assert.equal(url.pathname, '/api/v1/applications/demo/logs'); assert.equal(url.searchParams.get('appNamespace'), 'argocd'); assert.equal(url.searchParams.get('namespace'), 'team-a'); assert.equal(url.searchParams.get('podName'), 'demo'); assert.equal(url.searchParams.get('container'), 'main'); assert.equal(url.searchParams.has('refresh'), false);
    const bytes = Buffer.from(logPacket('💡 first\nsecond') + lastPacket);
    const split = bytes.indexOf(Buffer.from('💡')) + 2; res.write(bytes.subarray(0, split)); setImmediate(() => res.end(bytes.subarray(split)));
  });
  const lines: RawLogLine[] = [];
  const result = await consumeLogs(connection, logCommand(), new AbortController().signal, (line) => lines.push(line), () => {});
  assert.equal(result, 'last'); assert.deepEqual(lines.map((line) => line.content), ['💡 first', 'second']);
  const url = logUrl(connection.baseUrl, logCommand({ sinceTime: '2026-10-18T00:00:00.123456789Z', previous: true }));
  assert.equal(url.searchParams.get('sinceTime.nanos'), '123456789'); assert.equal(url.searchParams.get('previous'), 'true');
});

test('log errors, redirects and malformed frames never expose upstream messages or silently complete', async (t) => {
  for (const [status, body, expected] of [
    [403, 'private-http-error', 'FORBIDDEN'], [302, 'private-redirect', 'UPSTREAM_INVALID'], [200, '{"error":{"code":7,"message":"private-stream-error"}}\n', 'FORBIDDEN'], [200, 'not-json\n', 'UPSTREAM_INVALID'], [200, logPacket('wrong', 'invalid-time'), 'UPSTREAM_INVALID'],
  ] as const) {
    const connection = await mock(t, (res) => { res.statusCode = status; res.setHeader('Location', 'https://not-contacted.example.test'); res.end(body); });
    await assert.rejects(consumeLogs(connection, logCommand(), new AbortController().signal, () => assert.fail(), () => {}), (error) => { assert.doesNotMatch(String(error), /private-/); return code(expected)(error); });
  }
});

test('frame/network byte budgets, cancellation and nanosecond until bound are enforced', async (t) => {
  const huge = await mock(t, (res) => res.end(logPacket('x'.repeat(1000))));
  await assert.rejects(consumeLogs(huge, logCommand(), new AbortController().signal, () => {}, () => {}, { frameBytes: 100 }), code('RESPONSE_TOO_LARGE'));
  await assert.rejects(consumeLogs(huge, logCommand(), new AbortController().signal, () => {}, () => {}, { totalBytes: 100 }), code('RESPONSE_TOO_LARGE'));
  let opened!: () => void; const ready = new Promise<void>((resolve) => { opened = resolve; });
  const hanging = await mock(t, (res) => { res.flushHeaders(); }); const controller = new AbortController();
  const pending = consumeLogs(hanging, logCommand({ follow: true }), controller.signal, () => {}, opened); const rejected = assert.rejects(pending, code('CANCELLED')); await ready; controller.abort(); await rejected;
  const until = await mock(t, (res) => res.end(logPacket('before', '2026-10-18T00:00:00.123456788Z') + logPacket('after', '2026-10-18T00:00:00.123456790Z') + lastPacket));
  const lines: RawLogLine[] = [];
  await consumeLogs(until, logCommand({ untilTime: '2026-10-18T00:00:00.123456789Z' }), new AbortController().signal, (line) => lines.push(line), () => {});
  assert.deepEqual(lines.map((line) => line.content), ['before']);
});
