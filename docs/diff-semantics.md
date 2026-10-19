# Manifest / Diff semantics and acceptance boundaries

## Fixed implementation references

Contracts were checked against fixed official tags, not assumed identical to the current main branch:

- [v3.1.8 Swagger](https://github.com/argoproj/argo-cd/blob/v3.1.8/assets/swagger.json): GetManifests/ManagedResources parameters and ResourceDiff fields.
- [v3.1.8 applications-service.ts](https://github.com/argoproj/argo-cd/blob/v3.1.8/ui/src/app/shared/services/applications-service.ts): official UI parsing of embedded JSON states.
- [v3.1.8 application-resources-diff.tsx](https://github.com/argoproj/argo-cd/blob/v3.1.8/ui/src/app/applications/components/application-resources-diff/application-resources-diff.tsx): normalizedLiveState/predictedLiveState comparison, not raw Live/Target; Hooks excluded.
- [v3.1.8 application.go](https://github.com/argoproj/argo-cd/blob/v3.1.8/server/application/application.go): merged manifest sources, controller-cache comparison reads, Hook filtering, and cache-miss coordination.
- [v2.11.0 Swagger](https://github.com/argoproj/argo-cd/blob/v2.11.0/assets/swagger.json) contains sourcePositions/revisions; sampled v2.10.20, v2.8.21, and v2.6.15 do not.

These are source-contract references, **not evidence that a target controller executed the rules or that its real UI matched**.

Multi-source overrides first read fixed `GET /api/version` and require a recognizable official stable version >=2.11. Unknown, pre-release, or older versions are refused so silently ignored parameters cannot be presented as applied overrides. Version gates do not prove fork/proxy/custom-service capability. Position/revision pairs are unique, sorted, paired, and limited to 20.

Single-source applications use revision; multi-source applications use sourcePositions/revisions, including a one-element spec.sources array. Missing resolved revision is reported as absent, not replaced with the requested branch name.

## Independent workflows

1. **Desired manifest preview:** generated using configured revisions, a single revision, or position/revision overrides. The response merges all sources. Individual manifests cannot reliably be attributed to sources, and client-side overwrite precedence is not invented.
2. **Current cached Argo Diff:** reads the server-retained comparison pair. It is not an arbitrary preview revision versus Live. Preview controls do not initiate historical comparison, forced refresh, or Sync.

An absent Namespace is not filled with the destination Namespace: it may mean cluster scope, default Namespace behavior, or require server interpretation. Duplicate identities remain separate preview items with warnings; the client does not assume last-write-wins.

## DTO and three outcomes

- **equal:** a valid normalized/predicted pair is structurally equal and there is no explicit modified=true. Only the cached pair is equal, not necessarily the entire application or live cluster.
- **different:** the normalized/predicted pair differs or the server explicitly reports modified=true. Secret redaction can hide visible differences without removing that flag.
- **unavailable:** missing/legacy-only/malformed states, identity mismatch, contradictory flags, Hooks, or a sampled application reporting ComparisonError/InvalidSpecError/UnknownError or non-Synced/OutOfSync status.

ResourceDiff.modified uses Go omitempty. Absence alone proves neither success nor failure; a complete pair is required. Raw Live/Target and deprecated Diff strings are not used as fallback computations.

JSON Pointer navigation uses only the **server-normalized pair** and exposes only redacted visible paths. Object-key order is irrelevant; array order matters and array changes are represented at their whole path. Root change is the empty pointer, displayed as `(root)`. This does not reimplement ignoreDifferences, managedFieldsManagers, Kubernetes defaulting, or server-side apply.

Application observations and ManagedResources are non-atomic samples. Both observation sample time, reconciledAt, and revisions are shown, without claiming one controller reconciliation produced both. An identity change during a compound read fails rather than mixing identities.

## Security and server effects

- Upstream methods are fixed GET. No refresh/hard-refresh, mutations, Sync, resource Actions, or Exec requests are sent.
- Embedded JSON is parsed and budget-checked before Kubernetes-aware redaction. Outer ResourceDiff.kind identifies Secrets even if embedded comparison states omit kind; data/stringData remain hidden. Deprecated Diff and raw rendering/validation output are withheld.
- Projected/redacted data is cached and returned only after known-credential, JWT, key, and URL-credential redaction. Custom objects, ConfigMaps, and status/error text may still contain undetectable secrets. No automatic copying/export/model submission occurs.
- Oversized/deep objects, too many paths, or task/cache/response budget overruns fail explicitly, rather than returning a clipped complete Diff.
- v3.1.8 getCachedAppState can request ordinary refresh on cache miss; resource-tree/ManagedResources depend on it. GetManifests can invoke existing server generators. Not supplying refresh cannot prove the server never coordinates or renders. Explain this before authorizing real reads.

## CLI fallback decision

CLI Diff fallback is neither necessary nor enabled. Missing normalized pairs remain unavailable rather than hiding API/RBAC gaps with CLI recomputation. Production Service does not execute `argocd app diff` or any CLI command, and therefore introduces no external Diff executable, exit-code 0/1 interpretation, or external Diff environment dependence. Supporting a new gap would require a separately scoped, tested change.

## Evidence and outstanding checks

Synthetic tests cover raw differences with equal normalized pairs, defaulting/key order, predicted state versus raw Target, hidden Secret differences, create/delete/null, Hooks, missing/malformed/contradictory fields, application comparison errors, timeout/limits, version-gated multi-source overrides, compound identity boundaries, and safe text rendering. They do not prove a real controller ran ignore rules or server-side Diff successfully.

The limited authorized real preflight intentionally excluded these potentially coordinating/generating endpoints. Do not modify production application configuration to manufacture test cases.

- [ ] Compare equal/different/unavailable and Secret outcomes against existing target Argo UI observations.
- [ ] Verify existing representative ignoreDifferences, managedFieldsManagers, normalization/defaulting, duplicate multi-source resources, and server-side Diff behavior.
- [ ] Confirm single-/multi-source revision overrides actually take effect, not merely HTTP 200.
- [ ] Verify target RBAC, cache-miss coordination, generation delay, and budgets without configuration changes.
- [ ] Remote OpenChamber visibility/context/pause/uninstall/task lifecycle: **human-agreed skip, not verified**.

S07.3/S07.4 and the corresponding real-semantics portion of M2 remain unproven. Remote-host testing is waived, not a reason to request another target.
