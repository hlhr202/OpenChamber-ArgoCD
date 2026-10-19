import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as domain from '../src/service/domains/management.js';
import { metadataURL } from '../src/service/domains/applications.js';
import { parseManagementCommand } from '../src/service/runtime/management-input.js';
import { parseTaskCommand } from '../src/service/runtime/tasks.js';
import { operationUrl } from '../src/service/argocd/transport.js';
import { ServiceError } from '../src/service/security/errors.js';
import { rawAppSet, rawCluster, rawProject, rawRepository } from './management-fixtures.js';
import { rawEvent } from './resource-fixtures.js';

const code = (expected: string) => (error: unknown) => error instanceof ServiceError && error.code === expected;
test('ApplicationSet projection keeps generator/template structure without parameters, expressions or condition bodies', () => {
  const appset = domain.applicationSet(rawAppSet());
  assert.equal(appset.generators[0]?.type, 'matrix'); assert.equal(appset.generators[0]?.children.length, 2); assert.equal(appset.generators[0]?.children[0]?.elementsCount, 1);
  assert.equal(appset.template.sources[0]?.type, 'Helm'); assert.equal(appset.template.name, '[TEMPLATE EXPRESSION]'); assert.equal(appset.conditions[0]?.status, 'True');
  assert.doesNotMatch(JSON.stringify(appset), /opaque-|{{|jwtTokens/);
  assert.notEqual(domain.applicationSet(rawAppSet('set-a', 'team-a')).id, domain.applicationSet(rawAppSet('set-a', 'team-b')).id);
  assert.equal(domain.applicationSets({ items: [] }, '').namespaceScope, 'server-default');
  assert.throws(() => domain.applicationSets({ items: [rawAppSet()] }, 'other-namespace'), code('UPSTREAM_INVALID'));
  assert.throws(() => domain.applicationSets({ items: [rawAppSet(), rawAppSet()] }, ''), code('UPSTREAM_INVALID'));
});

test('unknown and deeply recursive generators are bounded, not arbitrary config passthrough', () => {
  const raw = rawAppSet();
  const unknown = domain.applicationSet({ ...raw, spec: { ...raw.spec, generators: [{ futureGenerator: { ordinary: 'opaque-unknown-config' } }] } });
  assert.equal(unknown.generators[0]?.type, 'Unknown'); assert.doesNotMatch(JSON.stringify(unknown), /opaque-/);
  let generator: unknown = { list: { elements: [] } }; for (let i = 0; i < 12; i++) generator = { merge: { generators: [generator] } };
  assert.throws(() => domain.applicationSet({ ...raw, spec: { ...raw.spec, generators: [generator] } }), code('RESPONSE_TOO_LARGE'));
});

test('Project restriction/role metadata preserves policy but drops all JWT locations and URL auth', () => {
  const project = domain.project(rawProject()); assert.equal(project.roles[0]?.name, 'viewer'); assert.equal(project.roles[0]?.policies.length, 1);
  assert.equal(project.rules.namespaceDeny[0]?.kind, 'Secret'); assert.equal(project.syncWindows[0]?.timeZone, 'Pacific/Kiritimati');
  assert.doesNotMatch(JSON.stringify(project), /opaque-|jwtTokens/);
  assert.throws(() => domain.projects({ items: [rawProject(), rawProject()] }), code('UPSTREAM_INVALID'));
  assert.throws(() => domain.projects({ items: Array.from({ length: 1001 }, () => rawProject()) }), code('RESPONSE_TOO_LARGE'));
});

test('repository/cluster DTOs whitelist metadata and withhold raw connection errors/configuration', () => {
  const repository = domain.repositories({ items: [rawRepository()] }).items[0]!;
  assert.equal(repository.connection.status, 'Failed'); assert.equal(repository.connection.messagePresent, true);
  assert.equal(repository.repo, 'ssh://git.example.test/team/repo'); assert.doesNotMatch(JSON.stringify(repository), /opaque-|password|bearerToken|proxy/);
  const cluster = domain.clusters({ items: [rawCluster()] }).items[0]!;
  assert.equal(cluster.connection.status, 'Successful'); assert.equal(cluster.applicationsCount, 3); assert.equal(cluster.resourcesCount, 100);
  assert.doesNotMatch(JSON.stringify(cluster), /opaque-|awsAuthConfig|tlsClientConfig|bearerToken/);
  assert.equal(domain.clusters({ items: [{ name: 'unknown' }] }).items[0]?.applicationsCount, null);
  assert.equal(domain.repositories({ items: [{ repo: 'repo', connectionState: { status: 'opaque-invalid-status' } }] }).items[0]?.connection.status, 'Unrecognized');
});

test('sync window state preserves server false and timezone without local cron-based inference', () => {
  const state = domain.windowState({ canSync: false, activeWindows: [rawProject().spec.syncWindows[0]], assignedWindows: [] }, 'application');
  assert.equal(state.canSync, false); assert.equal(state.active[0]?.timeZone, 'Pacific/Kiritimati');
  assert.equal(domain.windowState({ windows: [] }, 'project').canSync, null);
  assert.equal(domain.windowState({ windows: [] }, 'project').assigned, null);
  assert.throws(() => domain.windowState({}, 'application'), code('UPSTREAM_INVALID'));
});

test('ApplicationSet child links require explicit resource namespace and event UID', () => {
  const children = domain.applicationSetChildren({ nodes: [
    { group: 'argoproj.io', kind: 'Application', name: 'same', namespace: 'team-a' },
    { group: 'argoproj.io', kind: 'Application', name: 'same', namespace: 'team-b' },
    { group: 'argoproj.io', kind: 'Application', name: 'unknown' },
  ] });
  assert.equal(children.items.length, 2); assert.equal(children.unresolved, 1);
  const expected = { group: 'argoproj.io', version: 'v1alpha1', kind: 'ApplicationSet', namespace: 'argocd', name: 'set-a', uid: 'set-uid' };
  const event = rawEvent(expected); event.message = 'opaque-event-body';
  const events = domain.applicationSetEvents({ items: [event, rawEvent({ ...expected, uid: 'old' })] }, expected);
  assert.equal(events.scope, 'application-set'); assert.equal(events.items.length, 1); assert.equal(events.excludedCount, 1); assert.doesNotMatch(JSON.stringify(events), /opaque-event-body/);
});

test('management command/transport whitelist excludes refresh, generation, credentials and arbitrary URLs', () => {
  assert.equal(parseTaskCommand({ operation: 'projects', context: 'primary' }).operation, 'projects');
  const command = parseManagementCommand({ operation: 'applicationSet', context: 'primary', name: 'set-a', appsetNamespace: 'team-a' });
  assert.equal(command.operation, 'applicationSet');
  const url = operationUrl('https://example.test/argo', 'applicationSet', { name: 'set-a', appsetNamespace: 'team-a' });
  assert.equal(url.pathname, '/argo/api/v1/applicationsets/set-a'); assert.equal(url.searchParams.get('appsetNamespace'), 'team-a'); assert.equal(url.searchParams.has('appNamespace'), false);
  for (const value of [{ operation: 'generate', context: 'primary' }, { operation: 'repositories', context: 'primary', forceRefresh: 'true' }, { operation: 'clusters', context: 'primary', server: 'https://other' }, { operation: 'project', context: 'primary', project: '../secrets' }, { operation: 'applicationSet', context: 'primary', name: 'set-a', appNamespace: 'wrong' }]) assert.throws(() => parseManagementCommand(value), code('BAD_REQUEST'));
  assert.throws(() => operationUrl('https://example.test', 'repositories', { repo: 'arbitrary' } as never), code('BAD_REQUEST'));
});

test('metadata URL sanitization covers SSH, scp-style auth and negated repository rules without recursive bangs', () => {
  assert.equal(metadataURL('ssh://git:opaque-password@git.example.test/repo?token=opaque-query'), 'ssh://git.example.test/repo');
  assert.equal(metadataURL('git:opaque-password@git.example.test:team/repo'), 'git.example.test:team/repo');
  assert.equal(metadataURL('user:opaque-password@git.example.test/team/repo'), 'git.example.test/team/repo');
  assert.doesNotMatch(metadataURL('!https://user:opaque-pass@git.example.test/*'), /opaque-pass/);
  assert.equal(metadataURL('!'.repeat(4000) + '*').length, 4001);
});
