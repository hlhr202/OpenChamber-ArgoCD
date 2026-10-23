import { deploymentRef, podRef, rawPod } from './resource-fixtures.js';
export function rolloutFixture() {
  const current = { ...deploymentRef, kind: 'ReplicaSet', name: 'demo-old-current', uid: 'rs-current' };
  const historical = { ...current, name: 'demo-newer-history', uid: 'rs-history' };
  const failed = { ...current, name: 'demo-failed-create', uid: 'rs-failed' };
  const template = (image: string) => ({ metadata: { labels: { app: 'demo' } }, spec: { containers: [{ name: 'main', image, env: [{ name: 'TOKEN', value: 'private-template-token' }] }] } });
  const manifest = (ref: typeof deploymentRef, image: string, replicas: number, revision: number) => ({ apiVersion: 'apps/v1', kind: ref.kind, metadata: { name: ref.name, namespace: ref.namespace, uid: ref.uid, generation: 2, annotations: { 'deployment.kubernetes.io/revision': String(revision) } }, spec: { replicas, template: template(image) }, status: { replicas, readyReplicas: 0, updatedReplicas: replicas, observedGeneration: 2, conditions: [] } });
  const manifests = new Map<string, unknown>([
    [deploymentRef.uid, manifest(deploymentRef, 'demo:v1', 1, 3)],
    [current.uid, manifest(current, 'demo:v1', 1, 3)],
    [historical.uid, manifest(historical, 'demo:v2', 0, 2)],
    [failed.uid, manifest(failed, 'demo:v3', 1, 1)],
    [podRef.uid, rawPod()],
  ]);
  const raw = { nodes: [
    { ...deploymentRef, health: { status: 'Progressing' } },
    { ...historical, parentRefs: [deploymentRef], createdAt: '2026-10-20T00:00:00Z', health: { status: 'Healthy' } },
    { ...failed, parentRefs: [deploymentRef], health: { status: 'Degraded' } },
    { ...current, parentRefs: [deploymentRef], createdAt: '2026-10-18T00:00:00Z', health: { status: 'Healthy' } },
    { ...podRef, parentRefs: [current], health: { status: 'Progressing' } },
  ] };
  return { raw, manifests, current, historical, failed };
}
