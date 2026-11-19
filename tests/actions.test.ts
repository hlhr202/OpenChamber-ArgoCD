import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Envelope } from '../src/shared/contracts.js';
import type { ActionResult, CanIResult, ResourceActionList } from '../src/shared/actions.js';
import type { ApplicationDetail } from '../src/shared/applications.js';
import { startMockArgoServer } from './argocd-server-fixture.js';

async function getEpoch(svc: Awaited<ReturnType<Awaited<ReturnType<typeof startMockArgoServer>>['createHostService']>>): Promise<string> {
  const res = await svc.request<Envelope<unknown>>('/v1/applications?context=fixture');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.identityEpoch);
  return res.body.identityEpoch!;
}

test('diagnostics reports readOnly: false by default (mutations enabled)', async (t) => {
  const argo = await startMockArgoServer(t);
  const svc = await argo.createHostService();
  const res = await svc.request<Envelope<{ readOnly: boolean }>>('/v1/diagnostics');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.readOnly, false);
});

test('can-i mirrors Argo CD AccountService including rollback->sync fallback and 3-part subresource normalization', async (t) => {
  const argo = await startMockArgoServer(t, {
    rollbackEnforceEnable: false,
    deny: [{ resource: 'applications', action: 'delete', subresource: 'default/demo' }],
  });
  const svc = await argo.createHostService();

  const canSync = await svc.request<Envelope<CanIResult>>('/v1/can-i?context=fixture&resource=applications&action=sync&subresource=default%2Fargocd%2Fdemo');
  assert.equal(canSync.status, 200);
  assert.equal(canSync.body.ok && canSync.body.data.allowed, true);

  const canDelete = await svc.request<Envelope<CanIResult>>('/v1/can-i?context=fixture&resource=applications&action=delete&subresource=default%2Fargocd%2Fdemo');
  assert.equal(canDelete.status, 200);
  assert.equal(canDelete.body.ok && canDelete.body.data.allowed, false);

  // When rollbackEnforceEnable is true and rollback is denied, can-i returns false
  argo.options.rollbackEnforceEnable = true;
  argo.options.deny!.push({ resource: 'applications', action: 'rollback', subresource: 'default/demo' });
  const canRollback = await svc.request<Envelope<CanIResult>>('/v1/can-i?context=fixture&resource=applications&action=rollback&subresource=default%2Fargocd%2Fdemo');
  assert.equal(canRollback.status, 200);
  assert.equal(canRollback.body.ok && canRollback.body.data.allowed, false);
});

test('application refresh, sync (options + cache invalidation), terminate, rollback, patch, create, update, delete', async (t) => {
  const argo = await startMockArgoServer(t);
  const svc = await argo.createHostService();
  const epoch = await getEpoch(svc);

  // 1. Hard refresh
  const refresh = await svc.request<Envelope<ActionResult<ApplicationDetail>>>('/v1/actions/refresh', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', mode: 'hard' },
  });
  assert.equal(refresh.status, 200);
  assert.equal(refresh.body.ok, true);
  assert.equal(argo.requests.at(-1)?.query.refresh?.[0], 'hard');

  // 2. Sync with CLI-compatible options
  const sync = await svc.request<Envelope<ActionResult<ApplicationDetail>>>('/v1/actions/sync', {
    method: 'POST',
    body: {
      context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd',
      revision: 'v1.2.0', prune: true, dryRun: false, force: true, strategy: 'hook',
      replace: true, serverSideApply: true, applyOutOfSyncOnly: true, retryLimit: 3,
      resources: [{ group: 'apps', kind: 'Deployment', name: 'web', namespace: 'workloads' }],
    },
  });
  assert.equal(sync.status, 200);
  assert.equal(sync.body.ok, true);
  assert.equal(sync.body.data.data?.sync, 'Synced');
  const syncReq = argo.requests.at(-1)!;
  assert.equal(syncReq.method, 'POST');
  assert.equal(syncReq.path, '/api/v1/applications/demo/sync');
  assert.deepEqual((syncReq.body as Record<string, unknown>).syncOptions, { items: ['Replace=true', 'ServerSideApply=true', 'ApplyOutOfSyncOnly=true'] });

  // Cache was invalidated: subsequent GET /v1/application hits argo-api, not cache
  const afterSync = await svc.request<Envelope<ApplicationDetail>>('/v1/application?context=fixture&name=demo&appNamespace=argocd');
  assert.equal(afterSync.body.ok, true);
  assert.equal(afterSync.body.source, 'argo-api');
  assert.equal(afterSync.body.data.sync, 'Synced');

  // 3. Terminate operation
  const term = await svc.request<Envelope<ActionResult>>('/v1/actions/terminate', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd' },
  });
  assert.equal(term.status, 200);
  assert.equal(term.body.ok, true);

  // 4. Rollback to history #1
  const rollback = await svc.request<Envelope<ActionResult<ApplicationDetail>>>('/v1/actions/rollback', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', id: 1, prune: false, dryRun: false },
  });
  assert.equal(rollback.status, 200);
  assert.equal(rollback.body.ok, true);
  assert.equal(rollback.body.data.data?.comparedRevisions[0], 'rev-old-0');

  // 5. Patch application
  const patch = await svc.request<Envelope<ActionResult<ApplicationDetail>>>('/v1/actions/application-patch', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', patchType: 'merge', patch: '{"metadata":{"labels":{"tier":"backend"}}}' },
  });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.ok, true);

  // 6. Create & Update & Delete new application
  const created = await svc.request<Envelope<ActionResult<ApplicationDetail>>>('/v1/actions/application-create', {
    method: 'POST',
    body: {
      context: 'fixture', identityEpoch: epoch, upsert: false, validate: true,
      application: {
        metadata: { name: 'new-app', namespace: 'argocd' },
        spec: { project: 'default', source: { repoURL: 'https://git.example.test/platform/demo.git', path: 'deploy', targetRevision: 'HEAD' }, destination: { server: 'https://kubernetes.default.svc', namespace: 'workloads' } },
      },
    },
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.ok && created.body.data.data?.name, 'new-app');

  const updated = await svc.request<Envelope<ActionResult<ApplicationDetail>>>('/v1/actions/application-update', {
    method: 'POST',
    body: {
      context: 'fixture', identityEpoch: epoch, name: 'new-app', appNamespace: 'argocd', validate: true,
      application: {
        metadata: { name: 'new-app', namespace: 'argocd' },
        spec: { project: 'default', source: { repoURL: 'https://git.example.test/platform/demo.git', path: 'deploy', targetRevision: 'main' }, destination: { server: 'https://kubernetes.default.svc', namespace: 'workloads' } },
      },
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.ok, true);

  const deleted = await svc.request<Envelope<ActionResult>>('/v1/actions/application-delete', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'new-app', appNamespace: 'argocd', cascade: true, propagationPolicy: 'foreground' },
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.ok, true);
  assert.equal(argo.state.applications.has('argocd/new-app'), false);
});

test('resource actions list, V2 run, automatic V2->V1 fallback, patchResource, deleteResource, and stale UID rejection', async (t) => {
  const argo = await startMockArgoServer(t);
  const svc = await argo.createHostService();
  const epoch = await getEpoch(svc);

  const deployRef = { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'workloads', name: 'web', uid: 'uid-deploy-web' };
  const podRef = { group: '', version: 'v1', kind: 'Pod', namespace: 'workloads', name: 'web-abc123', uid: 'uid-pod-abc123' };

  // List resource actions
  const listRes = await svc.request<Envelope<ResourceActionList>>('/v1/resource-actions?context=fixture&name=demo&appNamespace=argocd&group=apps&version=v1&kind=Deployment&namespace=workloads&resourceName=web&uid=uid-deploy-web');
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.ok, true);
  assert.ok(listRes.body.data.actions.some((a) => a.name === 'restart' && !a.disabled));
  assert.ok(listRes.body.data.actions.some((a) => a.name === 'scale' && a.params[0]?.name === 'replicas'));

  // Run action V2 with parameters
  const runV2 = await svc.request<Envelope<ActionResult>>('/v1/actions/resource-action', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', resource: deployRef, action: 'scale', parameters: [{ name: 'replicas', value: '3' }] },
  });
  assert.equal(runV2.status, 200);
  assert.equal(runV2.body.ok && runV2.body.data.fallbackUsed, false);

  // Legacy server: V2 returns 404 -> automatic fallback to V1 for parameterless action
  argo.options.legacyActionsOnly = true;
  const runV1 = await svc.request<Envelope<ActionResult>>('/v1/actions/resource-action', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', resource: deployRef, action: 'restart' },
  });
  assert.equal(runV1.status, 200);
  assert.equal(runV1.body.ok && runV1.body.data.fallbackUsed, true);
  assert.equal(argo.requests.at(-1)?.path, '/api/v1/applications/demo/resource/actions');
  assert.equal(argo.requests.at(-1)?.body, 'restart');

  // Legacy server with parameters must fail with CAPABILITY_UNAVAILABLE
  const runV1Params = await svc.request<Envelope<ActionResult>>('/v1/actions/resource-action', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', resource: deployRef, action: 'scale', parameters: [{ name: 'replicas', value: '4' }] },
  });
  assert.equal(runV1Params.status, 501);
  assert.equal(!runV1Params.body.ok && runV1Params.body.error.code, 'CAPABILITY_UNAVAILABLE');

  // Patch resource
  const patched = await svc.request<Envelope<ActionResult>>('/v1/actions/resource-patch', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', resource: deployRef, patchType: 'merge', patch: '{"spec":{"replicas":3}}' },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.ok, true);

  // Stale UID must be rejected with 409 RESOURCE_CHANGED before hitting delete endpoint
  const staleDelete = await svc.request<Envelope<ActionResult>>('/v1/actions/resource-delete', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', resource: { ...podRef, uid: 'uid-pod-stale' } },
  });
  assert.equal(staleDelete.status, 409);
  assert.equal(!staleDelete.body.ok && staleDelete.body.error.code, 'RESOURCE_CHANGED');

  // Valid delete resource removes node from tree
  const deletedPod = await svc.request<Envelope<ActionResult>>('/v1/actions/resource-delete', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', resource: podRef, force: true, orphan: false },
  });
  assert.equal(deletedPod.status, 200);
  assert.equal(deletedPod.body.ok, true);
  assert.equal((argo.state.trees.get('argocd/demo') ?? []).some((n) => n.name === 'web-abc123'), false);
});

test('management mutations (ApplicationSet, Project, Repository, Cluster) and security guardrails', async (t) => {
  const argo = await startMockArgoServer(t);
  const svc = await argo.createHostService();
  const epoch = await getEpoch(svc);

  // Create & Delete ApplicationSet
  const createAs = await svc.request<Envelope<ActionResult>>('/v1/actions/management', {
    method: 'POST',
    body: { operation: 'createApplicationSet', context: 'fixture', identityEpoch: epoch, applicationSet: { metadata: { name: 'appset-2', namespace: 'argocd' }, spec: { generators: [] } } },
  });
  assert.equal(createAs.status, 200);
  const deleteAs = await svc.request<Envelope<ActionResult>>('/v1/actions/management', {
    method: 'POST',
    body: { operation: 'deleteApplicationSet', context: 'fixture', identityEpoch: epoch, name: 'appset-2', appsetNamespace: 'argocd' },
  });
  assert.equal(deleteAs.status, 200);

  // Create, Update, Delete Project
  const createProj = await svc.request<Envelope<ActionResult>>('/v1/actions/management', {
    method: 'POST',
    body: { operation: 'createProject', context: 'fixture', identityEpoch: epoch, project: { metadata: { name: 'team-a' }, spec: { description: 'Team A' } } },
  });
  assert.equal(createProj.status, 200);
  const updateProj = await svc.request<Envelope<ActionResult>>('/v1/actions/management', {
    method: 'POST',
    body: { operation: 'updateProject', context: 'fixture', identityEpoch: epoch, name: 'team-a', project: { metadata: { name: 'team-a' }, spec: { description: 'Team A v2' } } },
  });
  assert.equal(updateProj.status, 200);
  const deleteProj = await svc.request<Envelope<ActionResult>>('/v1/actions/management', {
    method: 'POST',
    body: { operation: 'deleteProject', context: 'fixture', identityEpoch: epoch, name: 'team-a' },
  });
  assert.equal(deleteProj.status, 200);

  // Validate & Delete Repository; Invalidate & Delete Cluster
  const validateRepo = await svc.request<Envelope<ActionResult>>('/v1/actions/management', {
    method: 'POST',
    body: { operation: 'validateRepository', context: 'fixture', identityEpoch: epoch, repo: 'https://git.example.test/platform/demo.git', type: 'git' },
  });
  assert.equal(validateRepo.status, 200);
  const invalidateCluster = await svc.request<Envelope<ActionResult>>('/v1/actions/management', {
    method: 'POST',
    body: { operation: 'invalidateClusterCache', context: 'fixture', identityEpoch: epoch, server: 'https://kubernetes.default.svc' },
  });
  assert.equal(invalidateCluster.status, 200);

  // Guardrail 1: Wrong identityEpoch rejected with 410 EXPIRED
  const badEpoch = await svc.request<Envelope<ActionResult>>('/v1/actions/sync', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: 'A'.repeat(43), name: 'demo', appNamespace: 'argocd' },
  });
  assert.equal(badEpoch.status, 410);
  assert.equal(!badEpoch.body.ok && badEpoch.body.error.code, 'EXPIRED');

  // Guardrail 2: SyncWindow / RBAC 403 mapped to FORBIDDEN and never retried
  argo.options.syncWindowBlocked = true;
  const beforeCount = argo.requests.length;
  const blocked = await svc.request<Envelope<ActionResult>>('/v1/actions/sync', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd' },
  });
  assert.equal(blocked.status, 403);
  assert.equal(!blocked.body.ok && blocked.body.error.code, 'FORBIDDEN');
  assert.equal(argo.requests.length - beforeCount, 1); // exactly 1 upstream request, zero retries

  // Guardrail 3: Invalid JSON patch or unknown fields rejected with 400 BAD_REQUEST
  const badPatch = await svc.request<Envelope<ActionResult>>('/v1/actions/application-patch', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', patchType: 'json', patch: '{"not":"an-array"}' },
  });
  assert.equal(badPatch.status, 400);
  const unknownField = await svc.request<Envelope<ActionResult>>('/v1/actions/sync', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', arbitraryUrl: 'https://evil.invalid' },
  });
  assert.equal(unknownField.status, 400);
});
