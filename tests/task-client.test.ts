import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { queryTask, type PanelRequest } from '../src/panel/task-client.js';
import type { Envelope } from '../src/shared/contracts.js';
import type { TaskSnapshot } from '../src/shared/tasks.js';

const command = { operation: 'applications', context: 'primary', filters: {} } as const;
const ok = <T>(data: T): Envelope<T> => ({ ok: true, data, sampledAt: '2026-10-18T00:00:00Z', stale: false, truncated: false });
const task: TaskSnapshot = { id: 'synthetic-id', state: 'running', createdAt: '2026-10-18T00:00:00Z', expiresAt: '2026-10-18T00:00:30Z' };

test('task client uses bounded POST/GET calls and preserves result sampling metadata', async () => {
  const methods: string[] = [];
  const request: PanelRequest = async <T>(_path: string, query?: Record<string, string>, options?: { method?: string; body?: unknown }) => {
    const method = options?.method ?? 'GET'; methods.push(method);
    if (method === 'POST') { assert.deepEqual(options?.body, command); return ok(task as T); }
    assert.deepEqual(query, { context: 'primary', id: task.id });
    return ok({ ...task, state: 'succeeded', result: { data: { value: 'safe' }, sampledAt: '2026-10-17T00:00:00Z', expiresAt: '2026-10-17T00:00:15Z', stale: true, source: 'cache' } } as T);
  };
  const result = await queryTask<{ value: string }>(request, command, new AbortController().signal, { pollMs: 1 });
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.source, 'cache'); assert.equal(result.sampledAt, '2026-10-17T00:00:00Z'); assert.equal(result.stale, true); }
  assert.deepEqual(methods, ['POST', 'GET']);
});

test('abort after creation cancels the background task once and stops polling', async () => {
  const methods: string[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { method?: string }) => {
    methods.push(options?.method ?? 'GET'); return ok(task as T);
  };
  const controller = new AbortController();
  const pending = queryTask(request, command, controller.signal, { pollMs: 1000 });
  const rejection = assert.rejects(pending);
  await setImmediate(); controller.abort(); await rejection;
  assert.deepEqual(methods, ['POST', 'DELETE']);
});

test('abort during pending creation still cancels once its task ID arrives', async () => {
  let finish!: () => void;
  const methods: string[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { method?: string }) => {
    methods.push(options?.method ?? 'GET');
    if (options?.method === 'POST') await new Promise<void>((resolve) => { finish = resolve; });
    return ok(task as T);
  };
  const controller = new AbortController();
  const pending = queryTask(request, command, controller.signal);
  const rejection = assert.rejects(pending);
  controller.abort(); finish(); await rejection;
  assert.deepEqual(methods, ['POST', 'DELETE']);
});
