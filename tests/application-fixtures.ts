export function rawApplication(name = 'demo', namespace = 'argocd') {
  const source = {
    repoURL: 'https://git-user:repository-password@git.example.test/team/repo.git?token=url-password',
    path: 'apps/demo', targetRevision: 'main',
    helm: { releaseName: 'demo', valueFiles: ['values.yaml'], parameters: [{ name: 'region', value: 'hidden-parameter-value' }],
      fileParameters: [{ name: 'file-value', path: 'hidden-file-path' }], values: 'hidden-inline-values', valuesObject: { ordinary: 'hidden-values-object' } },
  };
  return {
    metadata: { name, namespace, labels: { env: 'production', team: 'platform' }, annotations: { sensitive: 'hidden-annotation' } },
    spec: { project: 'platform', destination: { server: 'https://kubernetes.example.test', name: 'production', namespace: 'workloads' }, source },
    status: {
      sync: { status: 'OutOfSync', revision: 'compared-commit' }, health: { status: 'Degraded' }, sourceType: 'Helm',
      reconciledAt: '2026-10-18T00:00:00Z', conditions: [{ type: 'ComparisonError', message: 'manifest rendering failed', lastTransitionTime: '2026-10-18T00:00:00Z' }],
      operationState: { phase: 'Failed', message: 'resource sync failed', startedAt: '2026-10-18T00:00:00Z', finishedAt: '2026-10-18T00:01:00Z', retryCount: 1,
        syncResult: { revision: 'attempted-commit', resources: [{ group: 'apps', kind: 'Deployment', namespace: 'workloads', name: 'demo', status: 'SyncFailed', syncPhase: 'Sync', message: 'admission denied' }] } },
      history: [{ id: 7, revision: 'previous-commit', deployedAt: '2026-10-17T00:00:00Z', deployStartedAt: '2026-10-16T23:59:00Z', initiatedBy: { username: 'operator', automated: false }, source }],
    },
  };
}
