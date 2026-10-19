export function deployment(replicas = 2) {
  return { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'demo', namespace: 'workloads' }, spec: { replicas } };
}
export function rawComparison() {
  const live = deployment(2); const target = deployment(3);
  return { group: 'apps', kind: 'Deployment', name: 'demo', namespace: 'workloads', liveState: JSON.stringify(live), targetState: JSON.stringify(target), normalizedLiveState: JSON.stringify(live), predictedLiveState: JSON.stringify(target), modified: true };
}
