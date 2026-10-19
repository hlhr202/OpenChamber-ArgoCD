import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HostClient, JsonValue } from '@openchamber/sdk';
import { navigationKey, navigationState } from '../src/panel/navigation-state.js';
import { navigationStorage } from '../src/panel/navigation-storage.js';
import { savedNavigation } from './navigation-fixtures.js';

test('navigation state only projects bounded identifiers, filters, enums and layout, never query bodies or credentials', () => {
  const input = savedNavigation();
  const extra = { ...input, credentials: 'private-token', snapshots: ['private-application-data'], logs: 'private-log', preview: 'private-summary', applications: { ...input.applications, applications: ['private-response'], filters: { ...input.applications.filters, token: 'private-token' } } };
  assert.deepEqual(navigationState(extra, input.directory), input);
  assert.doesNotMatch(JSON.stringify(navigationState(extra, input.directory)), /private-/);
  const logs = structuredClone(input) as unknown as { applications: { resources: { detailTab: string; follow: boolean } } };
  logs.applications.resources.detailTab = 'logs'; logs.applications.resources.follow = true;
  assert.equal(navigationState(logs, input.directory)!.applications.resources!.detailTab, 'overview');
  assert.doesNotMatch(JSON.stringify(navigationState(logs, input.directory)), /follow/);
});

test('navigation restoration rejects corrupt versions, cross-directory data, oversized values and invalid layout/enums', () => {
  const input = savedNavigation();
  for (const value of [null, [], {}, { ...input, version: 2 }, { ...input, context: 'x'.repeat(2049) }, { ...input, tab: 'execute' }, { ...input, density: 'tiny' }]) assert.equal(navigationState(value, input.directory), null);
  assert.equal(navigationState(input, '/other-project'), null);
  for (const width of [-1, 421, Infinity, NaN]) {
    const value = structuredClone(input); value.applications.split.width = width; assert.equal(navigationState(value, input.directory), null);
  }
  const large = structuredClone(input); large.applications.filters = Object.fromEntries(['name', 'project', 'cluster', 'appNamespace', 'destinationNamespace', 'repo', 'sync', 'health', 'selector'].map((key) => [key, '界'.repeat(2048)]));
  assert.equal(navigationState(large, input.directory), null);
  assert.ok(navigationKey('/project/' + 'x'.repeat(4000)).length < 128);
  assert.notEqual(navigationKey('/project/a'), navigationKey('/project/b'));
});

test('navigation saves coalesce, use advertised storage scope and serialize before a subsequent mount reads', async () => {
  for (const device of [true, false]) {
    const values = new Map<string, JsonValue>(); const scopes: string[] = []; let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const storage: HostClient['storage'] = {
      get: async (key, options) => { scopes.push(options!.scope!); return values.get(key); },
      set: async (key, value, options) => { scopes.push(options!.scope!); await gate; values.set(key, value); }, delete: async () => assert.fail(), keys: async () => [],
    };
    const first = navigationStorage(storage, '/synthetic/project', device, () => assert.fail());
    first.save(savedNavigation()); const latest = savedNavigation(); latest.context = 'secondary'; first.save(latest); first.close();
    const second = navigationStorage(storage, '/synthetic/project', device, () => assert.fail());
    const loading = second.load(); release(); assert.deepEqual(await loading, latest);
    assert.deepEqual(scopes, [device ? 'device' : 'instance', device ? 'device' : 'instance']);
    assert.equal(values.size, 1); second.close();
  }
});

test('storage refusal reports failure without deleting old data or silently changing scopes', async () => {
  let failures = 0; const scopes: string[] = []; const previous = savedNavigation();
  const storage: HostClient['storage'] = {
    get: async (_key, options) => { scopes.push(options!.scope!); return JSON.parse(JSON.stringify(previous)); },
    set: async (_key, _value, options) => { scopes.push(options!.scope!); throw new Error('UNSUPPORTED'); }, delete: async () => assert.fail(), keys: async () => [],
  };
  const state = navigationStorage(storage, previous.directory, true, () => failures++);
  state.save({ ...previous, context: 'changed' }); await state.flush(); assert.equal(failures, 1);
  assert.deepEqual(await state.load(), previous); assert.deepEqual(scopes, ['device', 'device']); state.close();
});
