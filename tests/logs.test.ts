import assert from 'node:assert/strict';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { parseLogCommand } from '../src/service/runtime/log-input.js';
import { LogSessions, type LogSource } from '../src/service/runtime/log-sessions.js';
import { LogRedactor } from '../src/service/security/logs.js';
import { ServiceError } from '../src/service/security/errors.js';
import { logTimestamp } from '../src/shared/logs.js';
import { logCommand } from './log-fixtures.js';

const code = (value: string) => (error: unknown) => error instanceof ServiceError && error.code === value;
const line = (content: string) => ({ content, timestamp: '2026-10-18T00:00:00Z', pod: 'demo', truncated: false });
const validate = async () => {};

test('log input fixes Pod/container identity, time windows and finite tail; rejects passthrough and invalid defaults', () => {
  const command = logCommand(); assert.equal(command.tailLines, 100); assert.equal(command.follow, false);
  assert.equal(logCommand({ sinceTime: '2026-10-18T00:00:00.123456788Z', untilTime: '2026-10-18T00:00:00.123456789Z' }).sinceTime, '2026-10-18T00:00:00.123456788Z');
  assert.ok(logTimestamp('2026-10-18T00:00:00.123456788Z')! < logTimestamp('2026-10-18T00:00:00.123456789Z')!);
  for (const extra of [{ tailLines: 0 }, { tailLines: null }, { follow: null }, { tailLines: 1001 }, { follow: true, previous: true }, { sinceSeconds: 10, sinceTime: '2026-10-18T00:00:00Z' }, { sinceTime: '2026-02-31T00:00:00Z' }, { container: '../exec' }, { command: 'sync' }, { refresh: 'hard' }, { resource: { ...command.resource, uid: '' } }, { resource: { ...command.resource, kind: 'Deployment' } }]) assert.throws(() => parseLogCommand({ ...command, ...extra }), code('BAD_REQUEST'));
});

test('log redaction is stateful for multiline private keys, known credentials and terminal escapes; long lines mark truncation', () => {
  const redactor = new LogRedactor(['opaque-known-value']);
  assert.doesNotMatch(redactor.clean('\x1b[31mBearer access-token opaque-known-value\x1b[0m').content, /access-token|opaque-known-value|\x1b/);
  assert.equal(redactor.clean('-----BEGIN RSA PRIVATE KEY-----').content, '[REDACTED PRIVATE KEY]');
  assert.equal(redactor.clean('base64-private-material').content, '[REDACTED PRIVATE KEY]');
  assert.equal(redactor.clean('-----END RSA PRIVATE KEY-----').content, '[REDACTED PRIVATE KEY]');
  assert.equal(redactor.clean('safe').content, 'safe');
  assert.equal(redactor.clean('x'.repeat(5000)).truncated, true);
});

test('log ring evicts old rows, reports cursor gaps and isolates scope without removing genuine repeated lines', async (t) => {
  const logs = new LogSessions({ maxLines: 2 }); t.after(() => logs.close());
  const session = logs.create('scope-a', { validate, run: async (_signal, push, opened) => { opened(); push(line('repeat')); push(line('repeat')); push(line('last')); return 'last'; } });
  await setImmediate();
  const page = logs.get(session.id, 'scope-a', 0);
  assert.equal(page.state, 'completed'); assert.equal(page.gap, true); assert.equal(page.droppedLines, 1); assert.equal(page.oldestCursor, 2); assert.equal(page.headCursor, 3);
  assert.deepEqual(page.lines.map((line) => line.content), ['repeat', 'last']);
  assert.throws(() => logs.get(session.id, 'scope-b', 0), code('NOT_FOUND'));
  assert.throws(() => logs.stop(session.id, 'scope-b'), code('NOT_FOUND'));
  assert.throws(() => logs.get(session.id, 'scope-a', 4), code('BAD_REQUEST'));
  page.lines[0]!.content = 'changed'; assert.equal(logs.get(session.id, 'scope-a', 0).lines[0]?.content, 'repeat');
});

test('log pages bound response bytes and drain terminal buffers by cursor', async (t) => {
  const logs = new LogSessions({ pageBytes: 300, maxBytes: 1000 }); t.after(() => logs.close());
  const session = logs.create('scope', { validate, run: async (_signal, push) => { for (let i = 0; i < 4; i++) push(line(`line-${i}`)); return 'last'; } });
  await setImmediate();
  const first = logs.get(session.id, 'scope', 0); assert.ok(first.lines.length < 4); assert.ok(first.nextCursor < first.headCursor);
  const second = logs.get(session.id, 'scope', first.nextCursor); assert.equal(second.lines[0]?.cursor, first.nextCursor + 1);
});

test('lease expiration aborts and discards abandoned sessions; heartbeats extend lease but not hard lifetime', async (t) => {
  let now = 1000; let signal!: AbortSignal;
  const logs = new LogSessions({ now: () => now, leaseMs: 100, lifetimeMs: 250 }); t.after(() => logs.close());
  const source: LogSource = { validate, run: async (value) => { signal = value; await new Promise<void>((resolve) => value.addEventListener('abort', () => resolve(), { once: true })); return 'eof'; } };
  const session = logs.create('scope', source); await setImmediate();
  now = 1090; logs.get(session.id, 'scope', 0); now = 1180; logs.get(session.id, 'scope', 0); now = 1260;
  assert.equal(logs.get(session.id, 'scope', 0).error?.code, 'TIMEOUT'); assert.equal(signal.aborted, true);
  now = 2000; const abandoned = logs.create('scope', source); await setImmediate(); now = 2101;
  assert.throws(() => logs.get(abandoned.id, 'scope', 0), code('NOT_FOUND')); assert.equal(signal.aborted, true);
});

test('stopped uncooperative sources retain slots until settled; closure aborts active readers', async (t) => {
  let finish!: (value: 'last') => void;
  const logs = new LogSessions({ maxActive: 1 }); t.after(() => logs.close());
  const session = logs.create('scope', { validate, run: () => new Promise((resolve) => { finish = resolve; }) }); await setImmediate();
  logs.stop(session.id, 'scope');
  assert.throws(() => logs.create('scope', { validate, run: async () => 'last' }), code('BUSY'));
  finish('last'); await setImmediate();
  let signal!: AbortSignal; logs.create('scope', { validate, run: async (value) => { signal = value; return new Promise((resolve) => value.addEventListener('abort', () => resolve('eof'), { once: true })); } }); await setImmediate();
  logs.close(); assert.equal(signal.aborted, true);
});

test('identity validation failure discards log buffers; unexpected EOF and raw exceptions remain explicit', async (t) => {
  const logs = new LogSessions({ checkMs: 5, tickMs: 5 }); t.after(() => logs.close());
  const session = logs.create('scope', { validate: async () => { throw new ServiceError('AUTH_REQUIRED', 401); }, run: async (signal, push) => { push(line('safe')); return new Promise((resolve) => signal.addEventListener('abort', () => resolve('eof'), { once: true })); } });
  await delay(25); assert.throws(() => logs.get(session.id, 'scope', 0), code('NOT_FOUND'));
  const eof = logs.create('scope', { validate, run: async () => 'eof' });
  const error = logs.create('scope', { validate, run: async () => { throw new Error('private-upstream-token'); } }); await setImmediate();
  assert.equal(logs.get(eof.id, 'scope', 0).state, 'disconnected');
  assert.doesNotMatch(JSON.stringify(logs.get(error.id, 'scope', 0)), /private-upstream-token/);
});
