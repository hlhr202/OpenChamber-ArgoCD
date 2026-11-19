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

test('can-i supports URL subresources for clusters/repositories, uppercase/dotted resource action verbs, and rejects traversal', async (t) => {
  const argo = await startMockArgoServer(t);
  const svc = await argo.createHostService();

  const canCluster = await svc.request<Envelope<CanIResult>>('/v1/can-i?context=fixture&resource=clusters&action=update&subresource=https%3A%2F%2Fkubernetes.default.svc');
  assert.equal(canCluster.status, 200);
  assert.equal(canCluster.body.ok && canCluster.body.data.allowed, true);

  const canRepo = await svc.request<Envelope<CanIResult>>('/v1/can-i?context=fixture&resource=repositories&action=delete&subresource=default%2Fhttps%3A%2F%2Fgit.example.test%2Fplatform%2Fdemo.git');
  assert.equal(canRepo.status, 200);
  assert.equal(canRepo.body.ok && canRepo.body.data.allowed, true);

  const canDeployAction = await svc.request<Envelope<CanIResult>>('/v1/can-i?context=fixture&resource=applications&action=action%2Fapps%2FDeployment%2Frestart&subresource=default%2Fargocd%2Fdemo');
  assert.equal(canDeployAction.status, 200);
  assert.equal(canDeployAction.body.ok && canDeployAction.body.data.allowed, true);

  const canRolloutAction = await svc.request<Envelope<CanIResult>>('/v1/can-i?context=fixture&resource=applications&action=action%2Fargoproj.io%2FRollout%2Fabort&subresource=default%2Fargocd%2Fdemo');
  assert.equal(canRolloutAction.status, 200);
  assert.equal(canRolloutAction.body.ok && canRolloutAction.body.data.allowed, true);

  const traversal = await svc.request<Envelope<CanIResult>>('/v1/can-i?context=fixture&resource=applications&action=sync&subresource=default%2F..%2Fdemo');
  assert.equal(traversal.status, 400);
  assert.equal(!traversal.body.ok && traversal.body.error.code, 'BAD_REQUEST');
});

test('application update/patch/delete contracts enforce upstream Argo CD semantics', async (t) => {
  const argo = await startMockArgoServer(t);
  const svc = await argo.createHostService();
  const epoch = await getEpoch(svc);

  // ApplicationService.Patch rejects 'strategic' (only 'merge' and 'json' are valid upstream)
  const strategicAppPatch = await svc.request<Envelope<ActionResult>>('/v1/actions/application-patch', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', patchType: 'strategic', patch: '{"spec":{}}' },
  });
  assert.equal(strategicAppPatch.status, 400);
  assert.equal(!strategicAppPatch.body.ok && strategicAppPatch.body.error.code, 'BAD_REQUEST');

  // ApplicationService.Update rejects mismatched metadata.name / metadata.namespace and omits ?appNamespace query param
  const mismatchedName = await svc.request<Envelope<ActionResult>>('/v1/actions/application-update', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', application: { metadata: { name: 'other', namespace: 'argocd' }, spec: {} } },
  });
  assert.equal(mismatchedName.status, 400);

  const mismatchedNs = await svc.request<Envelope<ActionResult>>('/v1/actions/application-update', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', application: { metadata: { name: 'demo', namespace: 'other-ns' }, spec: {} } },
  });
  assert.equal(mismatchedNs.status, 400);

  const validUpdate = await svc.request<Envelope<ActionResult<ApplicationDetail>>>('/v1/actions/application-update', {
    method: 'POST',
    body: {
      context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd',
      application: {
        metadata: { name: 'demo' },
        spec: { project: 'default', source: { repoURL: 'https://git.example.test/platform/demo.git', path: 'deploy', targetRevision: 'v2.0.0' }, destination: { server: 'https://kubernetes.default.svc', namespace: 'workloads' } },
      },
    },
  });
  assert.equal(validUpdate.status, 200);
  const updateReq = [...argo.requests].reverse().find((r) => r.method === 'PUT' && r.path === '/api/v1/applications/demo')!;
  assert.equal(updateReq.query.appNamespace, undefined);
  assert.equal(((updateReq.body as Record<string, unknown>).metadata as Record<string, unknown>).namespace, 'argocd');

  // ApplicationService.Delete rejects 'orphan' and cascade=false + propagationPolicy, while allowing clean cascade=false
  const orphanPolicy = await svc.request<Envelope<ActionResult>>('/v1/actions/application-delete', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', cascade: true, propagationPolicy: 'orphan' },
  });
  assert.equal(orphanPolicy.status, 400);

  const cascadeConflict = await svc.request<Envelope<ActionResult>>('/v1/actions/application-delete', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', cascade: false, propagationPolicy: 'foreground' },
  });
  assert.equal(cascadeConflict.status, 400);

  const nonCascadingDelete = await svc.request<Envelope<ActionResult>>('/v1/actions/application-delete', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', cascade: false },
  });
  assert.equal(nonCascadingDelete.status, 200);
  const deleteReq = [...argo.requests].reverse().find((r) => r.method === 'DELETE' && r.path === '/api/v1/applications/demo')!;
  assert.equal(deleteReq.query.cascade?.[0], 'false');
  assert.equal(deleteReq.query.propagationPolicy, undefined);
});

test('resource mutations verify uncached live UID, map Kubernetes patch MIME types, require UID, and check epoch before upstream reads', async (t) => {
  const argo = await startMockArgoServer(t);
  const svc = await argo.createHostService();
  const epoch = await getEpoch(svc);

  // Wrong identityEpoch on resource mutation fails with 410 EXPIRED before any upstream request
  const beforeBadEpoch = argo.requests.length;
  const badEpochDelete = await svc.request<Envelope<ActionResult>>('/v1/actions/resource-delete', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: 'B'.repeat(43), name: 'demo', appNamespace: 'argocd', resource: { group: '', version: 'v1', kind: 'Pod', namespace: 'workloads', name: 'web-abc123', uid: 'uid-pod-abc123' } },
  });
  assert.equal(badEpochDelete.status, 410);
  assert.equal(argo.requests.length, beforeBadEpoch);

  // Empty UID is rejected with 400 BAD_REQUEST on all resource mutations
  for (const [path, extra] of [
    ['/v1/actions/resource-delete', {}],
    ['/v1/actions/resource-patch', { patchType: 'merge', patch: '{}' }],
    ['/v1/actions/resource-action', { action: 'restart' }],
  ] as const) {
    const emptyUid = await svc.request<Envelope<ActionResult>>(path, {
      method: 'POST',
      body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', resource: { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'workloads', name: 'web', uid: '' }, ...extra },
    });
    assert.equal(emptyUid.status, 400, path);
  }

  // Prime the 15s resourceTree read cache via background task
  const taskCreated = await svc.request<Envelope<{ id: string }>>('/v1/tasks', {
    method: 'POST',
    body: { context: 'fixture', operation: 'resourceTree', name: 'demo', appNamespace: 'argocd' },
  });
  assert.equal(taskCreated.status, 200);
  for (let i = 0; i < 50; i++) {
    const polled = await svc.request<Envelope<{ state: string }>>(`/v1/tasks?context=fixture&id=${taskCreated.body.ok ? taskCreated.body.data.id : ''}`);
    if (polled.body.ok && polled.body.data.state === 'succeeded') break;
    await new Promise((r) => setTimeout(r, 5));
  }

  // Simulate Pod recreation with same name inside the 15s cache TTL
  const nodes = argo.state.trees.get('argocd/demo')!;
  const podNode = nodes.find((n) => n.kind === 'Pod' && n.name === 'web-abc123')!;
  podNode.uid = 'uid-pod-recreated-999';
  const livePod = argo.state.liveResources.get('argocd/demo||Pod|workloads|web-abc123')!;
  (livePod.metadata as Record<string, unknown>).uid = 'uid-pod-recreated-999';

  const stalePodRef = { group: '', version: 'v1', kind: 'Pod', namespace: 'workloads', name: 'web-abc123', uid: 'uid-pod-abc123' };
  for (const [path, extra] of [
    ['/v1/actions/resource-delete', {}],
    ['/v1/actions/resource-patch', { patchType: 'merge', patch: '{"metadata":{"labels":{"a":"b"}}}' }],
    ['/v1/actions/resource-action', { action: 'restart' }],
  ] as const) {
    const res = await svc.request<Envelope<ActionResult>>(path, {
      method: 'POST',
      body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', resource: stalePodRef, ...extra },
    });
    assert.equal(res.status, 409, `${path} must bypass 15s read cache and reject recreated Pod UID`);
    assert.equal(!res.body.ok && res.body.error.code, 'RESOURCE_CHANGED');
  }
  assert.equal(argo.state.liveResources.has('argocd/demo||Pod|workloads|web-abc123'), true);

  // Simulate controller tree lag: tree still reports uid-pod-recreated-999, but live Kubernetes object already changed to uid-pod-live-1000
  (livePod.metadata as Record<string, unknown>).uid = 'uid-pod-live-1000';
  const treeLagDelete = await svc.request<Envelope<ActionResult>>('/v1/actions/resource-delete', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', resource: { ...stalePodRef, uid: 'uid-pod-recreated-999' } },
  });
  assert.equal(treeLagDelete.status, 409);
  assert.equal(!treeLagDelete.body.ok && treeLagDelete.body.error.code, 'RESOURCE_CHANGED');

  // Kubernetes patch MIME type mapping for merge, json, and strategic patches
  const deployRef = { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'workloads', name: 'web', uid: 'uid-deploy-web' };
  for (const [patchType, patch, expectedMime] of [
    ['merge', '{"spec":{"replicas":4}}', 'application/merge-patch+json'],
    ['strategic', '{"spec":{"replicas":5}}', 'application/strategic-merge-patch+json'],
    ['json', '[{"op":"replace","path":"/spec/replicas","value":6}]', 'application/json-patch+json'],
  ] as const) {
    const patched = await svc.request<Envelope<ActionResult>>('/v1/actions/resource-patch', {
      method: 'POST',
      body: { context: 'fixture', identityEpoch: epoch, name: 'demo', appNamespace: 'argocd', resource: deployRef, patchType, patch },
    });
    assert.equal(patched.status, 200, patchType);
    const req = argo.requests.at(-1)!;
    assert.equal(req.query.patchType?.[0], expectedMime);
  }

  // Parameterized resource-action on a deleted Application preserves 404 NOT_FOUND instead of 501 CAPABILITY_UNAVAILABLE
  const missingAppAction = await svc.request<Envelope<ActionResult>>('/v1/actions/resource-action', {
    method: 'POST',
    body: { context: 'fixture', identityEpoch: epoch, name: 'missing-app', appNamespace: 'argocd', resource: deployRef, action: 'scale', parameters: [{ name: 'replicas', value: '2' }] },
  });
  assert.equal(missingAppAction.status, 404);
  assert.equal(!missingAppAction.body.ok && missingAppAction.body.error.code, 'NOT_FOUND');
});

test('Project update preserves full AppProject spec/metadata/jwtTokens/redacted URLs, SSH/project repo actions and cluster cache invalidation follow upstream contracts', async (t) => {
  const argo = await startMockArgoServer(t);
  const svc = await argo.createHostService();
  const epoch = await getEpoch(svc);

  // Panel DTO redacts https://user:proj-secret@git.example.test/platform/* -> https://git.example.test/platform/* and withholds jwtTokens & orphanedResources
  const updateProj = await svc.request<Envelope<ActionResult>>('/v1/actions/management', {
    method: 'POST',
    body: {
      operation: 'updateProject', context: 'fixture', identityEpoch: epoch, name: 'default',
      project: {
        metadata: { name: 'default', namespace: 'argocd' },
        spec: {
          description: 'Updated default project',
          sourceRepos: ['https://git.example.test/platform/*'],
          sourceNamespaces: ['argocd'],
          destinations: [{ name: 'in-cluster', server: 'https://kubernetes.default.svc', namespace: '*' }],
          clusterResourceWhitelist: [{ group: '*', kind: '*' }],
          namespaceResourceBlacklist: [{ group: '', kind: 'ResourceQuota' }],
          syncWindows: [{ kind: 'allow', schedule: '0 * * * *', duration: '1h', applications: ['*'] }],
          roles: [{ name: 'ops', description: 'Operators', policies: ['p, proj:default:ops, applications, *, default/*, allow'], groups: ['ops'] }],
        },
      },
    },
  });
  assert.equal(updateProj.status, 200);
  const savedProj = argo.state.projects.get('default')!;
  const savedMeta = savedProj.metadata as Record<string, unknown>;
  const savedSpec = savedProj.spec as Record<string, unknown>;
  assert.equal(savedMeta.resourceVersion, '10');
  assert.equal(savedMeta.uid, 'uid-proj-default');
  assert.equal(savedSpec.description, 'Updated default project');
  assert.deepEqual(savedSpec.sourceRepos, ['https://user:proj-secret@git.example.test/platform/*']);
  assert.deepEqual(savedSpec.orphanedResources, { warn: true });
  assert.deepEqual(savedSpec.sourceNamespaces, ['argocd']);
  assert.deepEqual(((savedSpec.roles as Array<Record<string, unknown>>)[0]!).jwtTokens, [{ id: 'jwt-keep-1', iat: 1700000000 }]);

  // SSH + project-scoped repository validate (string body) & delete via sanitized panel URL
  const validateSsh = await svc.request<Envelope<ActionResult>>('/v1/actions/management', {
    method: 'POST',
    body: { operation: 'validateRepository', context: 'fixture', identityEpoch: epoch, repo: 'git.example.test:platform/ssh-demo.git', type: 'git', project: 'default' },
  });
  assert.equal(validateSsh.status, 200);
  const valReq = [...argo.requests].reverse().find((r) => r.method === 'POST' && r.path.endsWith('/validate'))!;
  assert.equal(valReq.body, 'git@git.example.test:platform/ssh-demo.git');
  assert.equal(valReq.query.project?.[0], 'default');

  const deleteSsh = await svc.request<Envelope<ActionResult>>('/v1/actions/management', {
    method: 'POST',
    body: { operation: 'deleteRepository', context: 'fixture', identityEpoch: epoch, repo: 'git.example.test:platform/ssh-demo.git', appProject: 'default' },
  });
  assert.equal(deleteSsh.status, 200);
  assert.equal(argo.state.repositories.has('git@git.example.test:platform/ssh-demo.git'), false);

  // Cluster invalidate-cache uses POST /api/v1/clusters/{id}/invalidate-cache and supports idType='name'
  const invalidateByName = await svc.request<Envelope<ActionResult>>('/v1/actions/management', {
    method: 'POST',
    body: { operation: 'invalidateClusterCache', context: 'fixture', identityEpoch: epoch, server: 'in-cluster', idType: 'name' },
  });
  assert.equal(invalidateByName.status, 200);
  const invReq = argo.requests.at(-1)!;
  assert.equal(invReq.method, 'POST');
  assert.equal(invReq.path, '/api/v1/clusters/in-cluster/invalidate-cache');
  assert.equal(invReq.query['id.type']?.[0], 'name');
});

