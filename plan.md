# OpenChamber Argo CD Observer implementation plan

## 1. Objective and current decisions

Implement an official OpenChamber extension covering the principal **read-only** Argo CD observation workflows, without changing OpenChamber core. TypeScript and pnpm are required. Daily queries are API-first, reusing existing CLI-format credentials on OpenChamber Server. Clients require neither CLI nor direct Argo connectivity.

Current user decisions supersede earlier proposals:

- Load contexts, select the existing current context, and show applications automatically; selecting another context queries that list. No separate identity-check, network-toggle, or first manual-query gate.
- Opening the surface alone makes no Argo request. Explicit connection loading/selection initiates reads.
- Do not modify **any deployment or configuration**, including CLI context/token files. Production Service cannot execute CLI, log in, renew credentials, or request exec permission. Legacy networkEnabled/cliPath settings are accepted only for compatibility, not gates/execution paths.
- Real local validation is authorized only through existing credentials and fixed read-only requests. Expired authentication stops; it is not repaired. Skill/example addresses or credentials must not be used.
- **Remote OpenChamber testing is human-agreed skipped, not verified**: installation/update, outer authentication/approval, pause/uninstall, instance switching, and remote execution/lifecycle. Do not require another remote target. The design still targets remote hosts; waiver is not compatibility proof.
- All 15 current OpenChamber UI languages are supported and always follow the current host locale; unknown languages fall back to English. No independent selector or stored override is used. All maintained repository documentation is English; immutable Git-ignored historical archives retain their original contents/hashes.

Detailed progress belongs in [roadmap.md](roadmap.md), evidence in [validation](docs/validation.md), and current support claims in [compatibility](docs/compatibility.md). No milestone is completed merely by implementing a subset or checking boxes.

## 2. Identity and trust boundaries

### Host identity and Argo identity

OpenChamber login controls access to the instance/extension. The Server OS user's existing Argo CLI identity controls Argo visibility. Host credentials are never forwarded to Argo; Argo tokens never reach the browser. Authorized clients share the host Argo identity, not per-browser accounts. Exposed hosts must retain access protection and official Service approval.

### Remote placement

The Service runs on **OpenChamber Server**, using that OS user, filesystem/configuration/certificates, and network. Connecting a local OpenChamber to remote OpenCode alone does not move the extension Service. Containers require Server-side runtime, readable existing credentials/certificates, UID/HOME/path access, and network reachability.

### Service protection

- Panel requests use SDK serviceRequest through the protected host proxy.
- Service listens only on 127.0.0.1. Every request, including health, verifies OPENCHAMBER_SERVICE_TOKEN.
- Service permission declarations inform approval; they are not an OS sandbox. Enforce restrictions in backend logic even if the account is privileged.
- No public extension port, separate login, visitor-specific Argo identity, token collection, or additional browser Argo origin is introduced.

## 3. Functional scope

| Domain | Observation scope | Boundary |
| --- | --- | --- |
| Applications | Sync, Health, counts, name/Project/cluster/Namespace/label/repository filters | Keep Sync/Health separate; unknown is not Healthy |
| Details | Sources/destinations, compared/deployed revisions, multi-source, Helm/Kustomize metadata, Conditions | Application Namespace differs from destination Namespace; configuration values withheld |
| Operations/history | Phases/times/errors/resource results and retained deployment records | No cancel/retry/rollback; not a complete audit |
| Resource topology | Parents/children, health, Pod/container state, orphan nodes | Stable group/kind/Namespace/name/UID; server monitoring dependency |
| Live resources | Objects, safe metadata/status, resource errors | Backend Secret/annotation/environment/command redaction |
| Manifests | Desired preview, Live display, revision/multi-source overrides | On demand; bounded; no historical Diff inference |
| Diff | Server normalized/predicted comparison and resource/path navigation | Not raw YAML equality or client reimplementation of Argo rules |
| Events | Application, UID-scoped resource, optional AppSet events | RBAC/retention/version dependent; no-events differs from denied |
| Logs | Container, tail, previous, time ranges, local filtering, follow | No Exec/terminal, persistence, seamless reconnect, or atomic UID promise |
| ApplicationSet | Structure/type/counts, safe template/Condition/status metadata and child links | No generator values/expressions/create/generate/edit |
| Projects/windows | Source/destination/resource/visible-role rules, server window evaluation | No role tokens; no browser cron/canSync inference |
| Repositories/clusters | Safe metadata, connection states, visible counts | No authentication config or connection-error bodies |
| Host interaction | Sidebar/full page, optional Work Status, confirmed composer summary | No automatic send/session/model request |
| Localization | All 15 host locales, live host-language updates, English fallback, locale-aware times, Arabic/Hebrew RTL | No independent preference; source data stays unchanged; switch retires active work/previews |

Explicitly excluded: Sync/Rollback/Delete/Patch/Create/Edit/Actions, forced refresh, Pod Exec, Prometheus metrics, CPU/memory trends, alerting, long-term logs/audit, separate SSO/account management, MCP/OpenCode tool plugins, and unsupported native/VS Code extension runtimes. CLI Diff fallback was evaluated and is not enabled. Explicit HTTP CONNECT proxy support is not implemented or claimed.

## 4. Architecture

```text
Panel / full-page / optional status sandbox
  -> SDK serviceRequest
  -> authenticated OpenChamber extension proxy
  -> loopback host Service
       Credential Provider: read existing context/token/TLS material
       Argo client: fixed GET paths/parameters, TLS, deadlines, budgets
       Domains: allowlisted projection and redaction
       Runtime: scoped query cache, tasks, log rings/leases, cleanup
  -> Argo CD API
```

### Panel

Use pinned SDK/UI kit without requiring React. Apply host theme on every ready event, but do not duplicate controls/listeners. Main tabs are Applications, Management, Summary, Diagnostic. Context/reload/auto-update use icon toolbar controls with accessible tooltips; Diagnostic holds JSON and advanced settings.

Expanded searchable filters derive options from the complete loaded snapshot; never translate their data values or narrow candidates to current filtered rows. List rows have identity, metadata, and Conditions/Sync/Health lines. List/detail regions scroll independently; the default 280px list resizes within 220–420px by pointer/keyboard, collapses, and switches to list/detail navigation below 640px.

Resource navigation is distinct from that application list: default 220px (180–360px resize), 28px single-line rows, 12px indentation, Kind icons and status dots, ancestor-preserving search/anomaly filters, default-open anomaly paths, default-folded healthy branches and separate orphan nodes. A cycle-safe spanning forest is navigation only; all original parent links remain available. Resource detail tabs are overview/events/Live Manifest/logs, with narrow list/detail navigation.

Entering Resources reads the tree; selecting a node reads Live; opening Events reads its events; Live Manifest reuses the redacted object; opening Logs reads the first container's bounded historical fragment, with follow off. Container changes read automatically and parameter edits debounce after validation. No separate first-read controls. Already-started streams do not reconnect automatically after a hide/show and follow resets off. Application desired-manifest, cached-Diff and sync-window tabs also load on entry. No mount-time hidden query, tree N+1, forced refresh, deployment mutation, or automatic model submission is introduced. Reload, stop, copy-preview and summary-confirmation controls retain their separate purposes.

Persist only density/module enums. Always use HostReadyContext.locale, including later ready updates; ignore the former observer.language.v1 override without modifying host storage. Bundle en/de/fr/nl/zh-CN/zh-TW/uk/es/pt-BR/ko/pl/ja/tr/ar/he, matching upstream UI runtime at bf977d2ed89c079ec592210d7cd0e2d649ba0636. Unknown languages fall back to English. Arabic/Hebrew mirror layout and split/tab controls; code/log/object text retains its source direction. Language changes preserve local context/list/filter state but stop active work, clear detail/evidence/summary previews, and make no translation-driven Argo requests. Names, logs, manifests, IDs, URLs, and API data remain opaque. Render untrusted values as text. Additional catalogs are machine-translated static files with coverage/placeholder gates, not runtime network translations or human linguistic acceptance.

### Service

Prebuilt Node ESM, separate runtime/auth/API/domain/security layers, fixed operation/parameter schemas, no generic URL/method/command proxy. Health means process readiness, not remote connectivity. UUID/opaque identity epoch metadata lets the panel retire observed old boundaries. SDK lacks an explicit remote instance ID and atomic target-session compose; do not claim instantaneous zero-race switching.

## 5. Existing CLI identity and connection handling

- Discover process-visible ARGOCD_CONFIG_DIR, existing legacy directory, XDG, and default CLI paths in official precedence; optional explicit host paths are non-secret settings.
- Parse current-context/contexts/servers/users with size/structure limits, no duplicate/alias ambiguity. Resolve context -> server/user per request, never global mutation or argocd context commands.
- Use the selected existing auth-token as Bearer in backend GET headers only. Credentials remain memory-only; no copied credential file/browser store/settings values.
- Check configuration and referenced certificate material changes. Generations include actual material bytes; changed identities invalidate old scoped caches/tasks/streams.
- Honor configured HTTP/HTTPS, existing insecure choice, CA/client certificate pairs, and REST root without globally weakening verification. Refuse credential-bearing URLs, path ambiguity, and redirects. Core mode is unsupported explicitly.
- On 401, reread existing files. If an external actor already rotated credentials, one bounded retry may use that material; unchanged failed credentials return AUTH_REQUIRED. Production Service has a null renewal handler. 403 is not renewed/retried.
- Old controlled CLI-helper/renewal tests remain historical synthetic compatibility coverage, not production behavior. No subprocess or exec capability is reachable from the runtime host client.
- Do not assume terminal ARGOCD_OPTS/proxy/custom environment is inherited. Never concatenate commands or forward arbitrary options/environment. Settings are cached on first client use; path changes require this extension to restart.

## 6. API and contracts

| Domain | Fixed upstream GET examples |
| --- | --- |
| Identity/version | /api/v1/session/userinfo, /api/version |
| Applications | /api/v1/applications, /api/v1/applications/{name} |
| Tree/Live/events | /api/v1/applications/{name}/resource-tree, /resource, /events |
| Desired/comparison | /api/v1/applications/{name}/manifests, /managed-resources |
| Windows | /api/v1/applications/{name}/syncwindows; Project syncwindows |
| Management | /api/v1/applicationsets, /projects, /repositories, /clusters and allowlisted details |

Encode paths and distinguish appNamespace, appsetNamespace, and resource Namespace. Stable DTOs include sample/source/stale/truncation/error metadata and allowlist fields rather than exposing upstream objects. Unknown state names remain recognizable, not Healthy.

Plugin-local tasks/logs use POST/GET/DELETE; summary uses local POST. Those methods are never forwarded to Argo. Summary accepts only a context, opaque identity epoch, bounded evidence, and optional language from the same 15-code allowlist. No locale changes upstream request parameters or permissions.

Diff uses retained normalized/predicted states and equal/different/unavailable outcomes. Multi-source override requires recognizable official stable >=2.11; absent revisions/Namespaces remain unknown. Application/comparison samples are non-atomic. Full semantics and fixed upstream references are in [diff-semantics.md](docs/diff-semantics.md).

## 7. Scheduling, logs, and freshness

Short SDK calls create/poll bounded background tasks instead of holding an unbounded proxy connection. The pinned SDK contract, not a newer researched release, is authoritative. Historical research examined SDK 2.4.0 complete-response limits; the project pins 2.2.0 and validates its actual schema/bundles.

- Query cache isolation includes configuration/server/context/identity/Application Namespace/name/parameters. Duplicate work coalesces; concurrency, queued work, failures/backoff, bytes, entries, and retention are bounded.
- Preserve original sample timestamps on cache hits. Identity changes retire old work; ordinary outages may leave visibly stale snapshots, never live-success claims. A failed response is not an empty list, no events, or Healthy.
- Heavy resources are loaded only for the selected application, avoiding list N+1 reads. Hidden views/context/application changes stop unnecessary polling and discard late responses.
- Logs use Service-consumed streams and cursor polling, memory-only bounded rings, explicit drops/truncation/gaps, lease heartbeat, hard deadlines, and terminal retention. Stops are best effort with independent lease/shutdown cleanup.
- Reconnection starts a new fragment, without automatic replay/deduplication or continuity promises. UID/container are checked freshly and periodically; the upstream API cannot atomically bind to UID.
- Budget defaults and detailed failure behavior are in README; exceeding limits fails rather than claiming a clipped complete result.

Task results, single query-cache entries, and plugin HTTP responses allow 2,000,000 serialized UTF-8 bytes each. Aggregate query-cache budget remains 4,000,000 bytes with LRU eviction; task count/retention/concurrency, log rings, upstream cap and structural security budgets are unchanged. The pinned SDK's independent serviceRequest response-body cap is 256,000 characters, so raising plugin limits is not an end-to-end 2 MB panel guarantee. Chunked result delivery is not implemented by this limit-only change, and host code/authentication is not modified.

Some server GET handlers may coordinate internally on cache miss, and manifests may run existing renderers. Not sending refresh is not proof of zero server coordination. Explain the distinction before authorizing such reads; no deployment/configuration mutations are permitted.

## 8. Security, privacy, and summaries

- Backend fixed allowlists apply even if the host Argo identity is admin. Hiding a UI button is not enforcement; GET alone does not prove semantic read-only behavior.
- Reject arbitrary URL/method/command/arguments, unknown parameters, forced refresh, and encoded traversal/redirects.
- Parse/project/redact before caching or transport. Secret values, credentials, private keys, embedded URL auth, repository/cluster auth config, generator values, and risky error bodies are withheld.
- Keep at most 16 recently seen tokens for memory-only redaction, not authentication caching. Never promise recognition of every secret in arbitrary data/logs.
- No raw upstream errors, token-bearing IDs/URLs/cache identifiers, automatic exports, model requests, or unchecked HTML. Copy and summary require bounded frozen previews and separate user confirmation.
- Summary includes only limited current-application evidence with distinct sample/source/expiry. Logs are explicitly selected and excluded by default. Full manifests/config values and full log rings do not enter candidates.
- Recheck Service/identity/redaction both when generating and confirming; locally format the selected language without Argo reads. Only compose append is allowed; no automatic send/session/model. Preview invalidates on evidence/session/visibility/language changes. Host execution remains non-atomic, so a final composer check is required.

## 9. Engineering and delivery

Single strict TypeScript package: src/panel for sandbox UI/localization, src/service/{auth,argocd,domains,runtime,security}, src/shared contracts, tests, scripts, panel assets, and service bundle. Pinned pnpm/lockfile, frozen installs, esbuild browser IIFE/Node ESM, and no external npm runtime dependencies except Node builtins.

Manifest declares panel/page/optional statusSection/host Service only; no token integration, arbitrary Argo browser origins, or exec permission. panel.icon points to the bundled panel/argocd.svg Argo mascot for the host right-side rail. The SVG is inert, package-local, and covered by integrity/provenance checks. Version floor is provisional until evidenced, not copied as a production claim. Target installs consume prebuilt assets, not source/Bun/pnpm builds.

Packaging now has a fixed 14-file inventory, schema/entry checks, stored ZIP/standard CRC, secret-sentinel/path scans, runtime/icon notices and isolated extracted-Service execution. Outputs are fixed at dist/openchamber-argocd-plugin and its .zip, staged before replacement with rollback and a concurrency lock. No hash suffix, checksum sidecar or release.json inventory is generated. Obsolete files inside the fixed output directory disappear on replacement; unrelated/historical outputs are not deleted because an existing installation may still use them.

The same repository root supports Git HTTPS installation without host dependency installation or compilation: commit the root manifest, bundled panel/main.js and service/main.js, HTML/CSS/SVG and generated THIRD_PARTY_NOTICES.txt alongside source/lockfile. Build generates these assets; verify:release compares them to source without rewriting them or persisting hashes. Version bumps are explicit and enable Git-source update detection. GitHub CI checks committed prebuilt assets before rebuilding, tests/packages and uploads the ZIP; a matching version tag can create a draft for human review, not an automatic public release. No repository address, Git initialization, commit, push, real installation or actual workflow execution is implied by preparing this code.

## 10. Stages and milestones

[Roadmap](roadmap.md) tracks S00 environment, S01 engineering, S02 protected Service, S03 identity, S04 applications, S05 bounded work, S06 resources/events, S07 manifests/Diff, S08 logs, S09 management, S10 host UI/summary/localization, S11 security/compatibility/stability, and S12 packaging/documentation/acceptance.

- M0: host/identity path, with remote subconditions now human-waived rather than verified.
- M1: principal application observation, without mutation support.
- M2: resource/events/manifest/Diff/log troubleshooting with bounded work.
- M3: management, integrated views, safe confirmed summaries, and explicit unsupported features.
- M4: security/compatibility/lifecycle and prebuilt delivery, retaining uncovered facts and remote waiver.

Milestones remain unproven as a whole where real semantics or final acceptance is missing. Synthetic evidence and waiver do not automatically complete them.

## 11. Verification

Unit/contracts: CLI paths/context/material parsing and rotation; safe DTOs/Secret/URL/error redaction; path/schema/Namespace/unknown-state behavior; production no-renewal and legacy helper bounds; scoped caches/tasks/log cursors/leases/expiry; i18n coverage and opaque interpolation.

Integration: same-name cross-Namespace/context isolation, independent module denial, expired credentials, redirects/TLS/roots, large/deep responses, query/task/log concurrency/cleanup, safe DOM and clipboard/compose confirmation, language changes without another Argo request, English documentation inventory, and isolated prebuilt archive execution.

Actual local HTTPS/current-context identity/list reads have narrow recorded evidence. CA/mTLS, proxies, containers, other platforms, real normalizer/ignore/server-side Diff/log behavior, and prolonged workloads remain uncovered unless specifically recorded. Remote host lifecycle is explicitly waived. No production fixture/configuration may be changed to create a test scenario; real renewal is forbidden because it can write configuration.

## 12. Research and references

Research snapshot: 2026-10-18. Initial offline CLI inspection found v3.4.6+e1becb7.dirty; later authorized read-only preflight found Server v3.5.3. Research saw SDK 2.4.0 published, but the actual dependency is pinned to 2.2.0. Upstream main/master can change; fixed tags and actual target evidence take precedence.

- [OpenChamber SDK](https://docs.openchamber.dev/sdk/), [Host API](https://docs.openchamber.dev/sdk/host/), [UI kit](https://docs.openchamber.dev/sdk/ui/)
- [Extensions](https://docs.openchamber.dev/extensions/), [Remote Instances](https://docs.openchamber.dev/remote-instances/)
- [Guest Service contract](https://github.com/openchamber/openchamber/blob/main/packages/sdk/GUEST_SERVICES.md), [Service implementation](https://github.com/openchamber/openchamber/blob/main/packages/web/server/lib/guests/service.js)
- [Historical SDK 2.4.0 contract](https://unpkg.com/@openchamber/sdk@2.4.0/dist/contract.js)
- [Argo API authentication](https://argo-cd.readthedocs.io/en/stable/developer-guide/api-docs/), [CLI local configuration](https://github.com/argoproj/argo-cd/blob/master/util/localconfig/localconfig.go)
- [Argo client authentication/renewal](https://github.com/argoproj/argo-cd/blob/master/pkg/apiclient/apiclient.go), [OpenAPI](https://github.com/argoproj/argo-cd/blob/master/assets/swagger.json), [metrics boundary](https://argo-cd.readthedocs.io/en/stable/operator-manual/metrics/)
