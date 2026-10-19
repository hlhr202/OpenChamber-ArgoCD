export function rawAppSet(name = 'set-a', namespace = 'argocd') {
  return { metadata: { name, namespace, uid: `uid-${namespace}-${name}`, annotations: { note: 'opaque-appset-annotation' } }, spec: {
    goTemplate: true, templatePatch: 'opaque-template-patch',
    generators: [
      { matrix: { generators: [{ list: { elements: [{ ordinary: 'opaque-generator-param' }], elementsYaml: 'opaque-elements-yaml' } }, { git: { repoURL: 'https://user:opaque-generator-auth@git.example.test/config', files: [{ path: '*.json' }], template: { data: 'opaque-generator-template' } } }] } },
      { plugin: { input: { parameters: { ordinary: 'opaque-plugin-param' } }, configMapRef: { name: 'generator' } } },
    ],
    template: { metadata: { name: '{{ .name }}', annotations: { note: 'opaque-template-annotation' } }, spec: { project: 'platform', destination: { server: 'https://kubernetes.example.test', namespace: '{{ .namespace }}' }, source: { repoURL: 'https://user:opaque-template-url@git.example.test/team/repo', path: 'apps/demo', targetRevision: '{{ .branch }}', helm: { values: 'opaque-helm-value', parameters: [{ name: 'a', value: 'opaque-helm-param' }] } } } },
  }, status: { conditions: [{ type: 'ErrorOccurred', status: 'True', reason: 'GenerationError', message: 'opaque-condition-error', lastTransitionTime: '2026-10-18T00:00:00Z' }], applicationStatus: [{ application: 'child', status: 'Waiting', message: 'opaque-application-status', targetrevisions: ['opaque-target-revision'], step: '1' }] } };
}
export function rawProject(name = 'platform') {
  return { metadata: { name, namespace: 'argocd' }, spec: { description: 'Platform workloads', sourceRepos: ['https://user:opaque-project-url@git.example.test/team/*?token=opaque-query', '!ssh://git:opaque-ssh-pass@git.example.test/forbidden'], sourceNamespaces: ['team-*'],
    destinations: [{ name: 'production', namespace: 'workloads', server: 'https://user:opaque-cluster-url@kubernetes.example.test' }], clusterResourceWhitelist: [{ group: '', kind: 'Namespace' }], namespaceResourceBlacklist: [{ group: '', kind: 'Secret' }],
    roles: [{ name: 'viewer', description: 'Read-only apps', groups: ['platform'], policies: ['p, proj:platform:viewer, applications, get, platform/*, allow'], jwtTokens: [{ id: 'opaque-role-token' }] }],
    syncWindows: [{ kind: 'deny', schedule: '0 0 * * *', duration: '1h', timeZone: 'Pacific/Kiritimati', applications: ['*-prod'], manualSync: false }],
  }, status: { jwtTokensByRole: { viewer: { items: [{ id: 'opaque-status-role-token' }] } } } };
}
export function rawRepository() {
  return { repo: 'ssh://git:opaque-repo-url@git.example.test/team/repo?token=opaque-url-query', type: 'git', name: 'main', project: 'platform', password: 'opaque-repo-password', bearerToken: 'opaque-repo-bearer', sshPrivateKey: 'opaque-repo-private', githubAppPrivateKey: 'opaque-github-key', proxy: 'http://user:opaque-proxy@proxy.test', gcpServiceAccountKey: 'opaque-gcp-key', connectionState: { status: 'Failed', message: 'opaque-repo-error with opaque-repo-password', attemptedAt: '2026-10-18T00:00:00Z' } };
}
export function rawCluster() {
  return { name: 'production', server: 'https://user:opaque-cluster-uri@kubernetes.example.test', project: 'platform', namespaces: ['workloads'], config: { bearerToken: 'opaque-kube-token', tlsClientConfig: { keyData: 'opaque-kube-key' }, awsAuthConfig: { roleARN: 'opaque-aws-auth' } }, labels: { ordinary: 'opaque-cluster-label' }, annotations: { note: 'opaque-cluster-annotation' }, info: { serverVersion: 'v1.33.1', applicationsCount: '3', cacheInfo: { resourcesCount: 100, apisCount: 30, lastCacheSyncTime: '2026-10-18T00:00:00Z' }, connectionState: { status: 'Successful', message: 'opaque-cluster-error' } } };
}
