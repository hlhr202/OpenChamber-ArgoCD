import type { ResourceReference } from '../src/shared/resources.js';

export const podRef: ResourceReference = { group: '', version: 'v1', kind: 'Pod', namespace: 'team-a', name: 'demo', uid: 'pod-a' };
export const otherPodRef: ResourceReference = { ...podRef, namespace: 'team-b', uid: 'pod-b' };
export const deploymentRef: ResourceReference = { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'team-a', name: 'demo', uid: 'deploy-a' };
export function rawTree() {
  return { nodes: [
    { ...deploymentRef, health: { status: 'Degraded', message: 'Unavailable' } },
    { ...podRef, parentRefs: [deploymentRef], health: { status: 'Progressing' }, images: ['example.test/demo:v1'], info: [{ name: 'password', value: 'do-not-transfer' }] },
    { ...otherPodRef, health: { status: 'Unknown' } },
  ], orphanedNodes: [] };
}
export function rawPod(ref: ResourceReference = podRef) {
  return { apiVersion: 'v1', kind: 'Pod', metadata: { name: ref.name, namespace: ref.namespace, uid: ref.uid, annotations: { 'kubectl.kubernetes.io/last-applied-configuration': 'private-annotation', 'arbitrary-note': 'also-private' }, labels: { app: 'demo' } },
    spec: { containers: [{ name: 'main', image: 'example.test/demo:v1', env: [{ name: 'PUBLIC_LOOKING_NAME', value: 'private-env' }], command: ['private-command'], args: ['private-arg'] }] },
    status: { phase: 'Pending', containerStatuses: [{ name: 'main', image: 'example.test/demo:v1', ready: false, restartCount: 3, state: { waiting: { reason: 'CrashLoopBackOff', message: 'Retrying' } } }] } };
}
export function rawEvent(ref: ResourceReference = podRef, name = 'demo-event') {
  return { metadata: { name, namespace: ref.namespace, uid: `event-${ref.uid}` }, involvedObject: { ...ref, apiVersion: ref.group ? `${ref.group}/${ref.version}` : ref.version }, type: 'Warning', reason: 'BackOff', message: '<img src=x onerror=alert(1)>', firstTimestamp: '2026-10-18T00:00:00Z', lastTimestamp: '2026-10-18T00:01:00Z', count: 3, source: { component: 'kubelet' } };
}
