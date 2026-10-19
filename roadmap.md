# OpenChamber Argo CD extension roadmap

This document breaks [plan.md](plan.md) into implementable, verifiable stages. The plan governs scope, identity, and safety; this file tracks task status. Evidence is in [docs/validation.md](docs/validation.md).

**Current status:** the main local S01–S12 implementation and packaging gates pass; the complete goal and M0–M4 are not fully accepted. The compact UI update passed 170 tests. The subsequent localization/documentation update adds English/Simplified Chinese, host-locale selection with a persisted override, and English maintained documentation. Its full check passed **178 tests, zero failed/skipped**, with dual builds, isolated smoke, archive verification, and limited synthetic-browser checks; see validation history.

**Latest requirements supersede the two-language override:** support all 15 current host locales, always follow OpenChamber's current language, fall back to English for unknown languages, and use a bundled Argo mascot on the right-side extension rail. Additional catalogs are static machine translations with coverage/placeholder gates; Arabic/Hebrew use RTL. The previous plugin language selector/storage is removed, not allowed to override the host.

The latest full check passed **182 tests, zero failed/skipped**, dual builds, isolated smoke, and deterministic 15-file archive/extraction gates. Synthetic-browser checks confirmed live RTL/Traditional Chinese/English-fallback switching without another network read. Actual host rail rendering and remote acceptance are not inferred from these results.

**Current resource-browser increment:** compact 220px navigation, 28px single-line rows/12px indentation, collapsible healthy branches, expanded anomaly paths, ancestor-preserving filters and original parent links. Resources/details/events/Live Manifest/logs now use click-to-read, with optional reload rather than a first-read button. Logs start historically on tab entry, container changes read automatically, follow remains off by default, and previously started streams are not silently resumed. Related application Manifest/Diff/window tabs also load on entry. Real-environment evidence and the remote waiver are unchanged; final incremental gates are recorded in validation history.

This increment passed the full check with **189 tests, zero failed/skipped**, dual builds, isolated smoke and 15-file archive/extraction verification. The complete-goal/real-semantics milestones below are not automatically completed by this UI increment.

**Current size-limit increment:** task results, individual query-cache entries, and plugin HTTP responses are raised to 2,000,000 bytes. The 4 MB aggregate cache and all other safety/lifecycle limits remain bounded. Pinned SDK serviceRequest still has a 256,000-character outer response cap; no chunked transport or host modification is implied. Verification is recorded separately below the resource-browser entry in validation history.

The size-limit increment passed **193 tests, zero failed/skipped**, strict typecheck, dual builds, isolated smoke and 15-file archive/extraction verification. This does not establish end-to-end delivery of 2 MB through the pinned SDK.

**Current distribution increment supersedes hash-based packaging:** repository-root prebuilt bundles and runtime notices support Git HTTPS URL installation without a host build. Fixed directory/ZIP outputs replace prior contents after staging, with rollback/concurrency protection, and no checksum files or release.json inventory. GitHub CI checks committed assets and versions; matching tags prepare draft releases only. Historical outputs remain untouched if an installed extension may still reference them. No Git repository/remote has been initialized, pushed or publicly published by this work, and GitHub/actual-host acceptance remains unverified.

Distribution gates passed locally with **200 tests, zero failed/skipped**, root prebuilt/source consistency, strict typecheck, dual builds, isolated smoke and 14-file package extraction. The included workflow is prepared, not already executed on GitHub.

The current workflow is **Load contexts -> select the existing current connection -> automatically show applications**. Context changes automatically query the list. No network setting, identity-check step, or initial manual application query is required. Production Service does not execute CLI, log in, renew credentials, write configuration, or request exec permission. These decisions supersede historical network-toggle/renewal requirements below.

## Human-agreed acceptance waiver

- **Human-agreed skip, not verified:** remote OpenChamber installation/update, outer login/capability approval, pause/uninstall, instance switching, Service placement, and remote end-to-end lifecycle acceptance. This includes S00.2, S02.8, S03.11, S12.7, and remote subconditions elsewhere.
- Keep the unverified facts; do not check a box to represent a waiver as a technical pass. No remote target is required as a delivery blocker, and no local host installation is implied.
- Report verified, uncovered, and waived conditions separately. The waiver does not automatically complete M0–M4 or relax the shared-host identity boundary.
- Separately authorized real checks used only the current machine's existing CLI/current-context credentials and fixed read-only requests. CLI v3.4.6 and Server v3.5.3 identity/application-list HTTPS reads passed. No example credentials, login/renewal, configuration/current-context writes, forced refresh, or deployment operations are allowed. Potentially coordinating/generating Manifest/comparison endpoints were excluded from that preflight.

## 1. Execution rules

- Every stage delivers a testable increment, including safety and tests rather than deferring them all to the end.
- Check a task only when its stated scope is satisfied. A completed implementation is not automatic real-environment acceptance.
- API-first, existing host CLI identity, host-managed protected Service, and strict read-only behavior apply throughout.
- Use only authorized read-only network requests. Unsupported versions/protocols/permissions must produce explicit degradation, not silent feature removal or false success.
- Synthetic tests can advance implementation without a real host, but cannot prove actual host behavior. Work follows dependencies, not date promises.

## 2. Stage overview

| Stage | Goal | Dependencies | Milestone |
| --- | --- | --- | --- |
| S00 | Environment and interface baseline | None | Explicit implementation inputs |
| S01 | Engineering, tests, dual builds | Host/runtime baseline | Buildable extension skeleton |
| S02 | Protected host Service | S01 | Protected request path |
| S03 | Existing CLI identity and API | S00, S02 | M0: host identity path |
| S04 | Principal application workflows | S03 | M1: observation MVP |
| S05 | Tasks, caches, query lifecycle | S04 | Bounded heavy-work foundation |
| S06 | Topology, Live details, events | S05 | Resource diagnosis |
| S07 | Manifests and Diff | S05, S06 | Difference diagnosis |
| S08 | Historical/following logs | S05, S06 | M2: resource troubleshooting |
| S09 | Management observation | S05 | AppSet/Project/repository/cluster |
| S10 | Host UI and summaries | S04, S06–S09 | M3: principal scope |
| S11 | Security/compatibility/stability | S10 | Release gates |
| S12 | Prebuilt package/docs/acceptance | S11 | M4: installable delivery |

Proceed in order by default. S07/S08/S09 can advance independently once dependencies exist; parallel development is not required.

## 3. Tasks

### S00: Environment and interface baseline

**Goal:** identify host/runtime/Argo versions, deployment placement, and network conditions.

- [ ] S00.1 Confirm OpenChamber version, OS, runtime, deployment, and Service capability.
- [ ] S00.2 Identify the target Server, OS user, and access protection. **Remote portion: human-agreed skip, not verified; do not request another target.**
- [x] S00.3 Confirm CLI path/version, configuration discovery, and contexts without exposing raw configuration/tokens. **Local PATH CLI v3.4.6, default discovery, five contexts/current-context verified; remote portion waived.**
- [x] S00.4 After authorization, check Argo version, REST/root path, and representative read permission. **Local current context only: Server v3.5.3, verified HTTPS, default REST root, identity/list GET; not all endpoints/RBAC.**
- [ ] S00.5 Record TLS/client certificates, proxies, mounts, and relevant file permissions. Renewal writeback is forbidden in this work.
- [ ] S00.6 Verify target topology/events/logs/ManagedResources/windows interfaces and permission differences.
- [ ] S00.7 Establish an evidenced support range and degradation rules; researched SDK versions are not host capability proof.

**Deliverables:** reviewable environment/compatibility baseline, local/remote validation paths, and account scope. Acceptance requires distinguishing OpenChamber Server from remote OpenCode, naming unknowns explicitly, and excluding credentials/unnecessary internal details.

### S01: Engineering, tests, and dual builds

**Goal:** reproducible, prebuilt TypeScript single-package extension.

- [x] S01.1 Package manifest, pinned pnpm, lockfile, strict TypeScript.
- [x] S01.2 Separate panel/service/shared/tests/scripts responsibilities.
- [x] S01.3 esbuild browser IIFE and Node ESM with bundled runtime dependencies.
- [x] S01.4 Working typecheck/test/build scripts and initial tests.
- [x] S01.5 Panel/page/host-Service manifest requesting only necessary capabilities.
- [x] S01.6 SDK entry/theme application without duplicate mounts/listeners on repeated ready events.
- [ ] S01.7 Verify actual prebuilt-directory installation without host pnpm/Bun/project node_modules. Isolated bundle execution is covered separately, not installation.

**Deliverables/acceptance:** configurations, manifest, tests, panel HTML/JS and Service JS; frozen-lockfile checks pass, browser output is non-module, Service runtime is compatible, and actual host loading/theme works. Real host subconditions remain unproven/waived as applicable.

### S02: Host Service and secure request protocol

**Goal:** establish the protected request path before connecting real credentials/resources.

- [x] S02.1 Use injected port/token; listen only on 127.0.0.1.
- [x] S02.2 Verify the Service token on every request including health.
- [x] S02.3 Stable DTOs with sample/expiry/truncation and safe errors.
- [x] S02.4 Fixed operation/parameter allowlists; reject arbitrary URL/method/command, unknown and refresh parameters.
- [x] S02.5 Central redaction/safe errors plus body/response/time/concurrency limits.
- [x] S02.6 Process readiness and shutdown cleanup independent of Argo reachability.
- [x] S02.7 SDK serviceRequest only; no public port or host-auth bypass.
- [ ] S02.8 Actual remote approval, denial, pause, and safe diagnostics. **Human-agreed skip, not verified.**

**Deliverables:** runtime/security/shared foundations and auth/schema/redaction tests. Acceptance: protected access without revealing internal token, forged operations denied, process readiness preserved while Argo is offline. Offline tests do not verify the outer host authorization proxy.

### S03: CLI credential reuse and API connection

**Goal:** reuse the Server's existing identity without a second login system.

- [x] S03.1 Default/XDG/legacy/explicit paths; do not assume inherited ARGOCD_* variables.
- [x] S03.2 Resolve current-context/contexts/servers/users and safe context metadata.
- [x] S03.3 Explicit per-request context; no global write/shared mutable user selection.
- [x] S03.4 Fixed read-only client: Bearer, deadlines, size limits, encoding, structured errors.
- [ ] S03.5 Existing HTTP/HTTPS/insecure/CA/client certificates/REST root; reject token-bearing redirects. Parsing/connection options and basic real HTTPS are covered; full handshake variants remain unverified.
- [x] S03.6 Configuration/token/material rotation retires old identities; core mode explicitly unsupported.
- [x] S03.7 Authentication failure rereads existing configuration, with at most one retry after an external token rotation. **The earlier noninteractive CLI identity/renewal path is disabled in production.**
- [x] S03.8 Legacy renewal-helper coalescing/cooldown and 403 tests exist. **Production uses no renewal handler, so no concurrent renewal or interactive login can run.**
- [x] S03.9 Legacy helper fixed argv/config/context/environment/deadline tests exist. **Production host client never invokes it and the manifest requests no exec.**
- [ ] S03.10 Full damaged/missing/expired/read-only-mount/certificate/proxy/multiclient regression. Synthetic subsets pass; real variants remain uncovered.
- [ ] S03.11 Remote identity/placement/credential-free response verification. **Human-agreed skip, not verified; local CLI/API evidence is separate.**

**Deliverables:** auth/client/settings/connection UI and synthetic tests; safe live-preflight record. M0 acceptance requires API-first identity reuse, no global context writes/cross-client mixing, explicit auth errors without infinite retries, and no token in browser/URL/errors/settings. Renewal itself is not a requirement or permitted operation now.

### S04: Application observation MVP

- [x] S04.1 Allowlisted list/detail DTOs, withholding sensitive Helm/configuration values.
- [x] S04.2 Name/Project/cluster/Namespace/label/repository filters.
- [x] S04.3 Separate Sync/Health/anomaly/unknown counts; missing does not mean Healthy.
- [x] S04.4 Source/destination, desired/deployed/compared revisions, multi-source and safe Helm/Kustomize metadata.
- [x] S04.5 Conditions, operation phase/times/errors/resource results.
- [x] S04.6 Server-retained history without rollback.
- [x] S04.7 Loading/empty/auth/denied/offline/stale states; ordinary reads do not request forced refresh.
- [x] S04.8 Same-name cross-Application-Namespace, multi-source, unknown state, and failed-operation tests.

**Deliverables:** domains/DTOs/UI/tests. M1 acceptance requires principal state/Condition/failure diagnosis, correct Namespace distinction, API-only reads, and no backend mutation support. Remote-host subconditions are waived rather than verified.

### S05: Tasks, caches, and query lifecycle

- [x] S05.1 Bounded scheduling, duplicate coalescing, retry/backoff controls.
- [x] S05.2 Scope keys include configuration/server/context/identity/Application Namespace/name/parameters.
- [x] S05.3 Identity/config changes invalidate old scopes; original sample/expiry is retained.
- [x] S05.4 Create/poll/read/cancel/deadline/expiry tasks without long SDK requests.
- [x] S05.5 Identity/context binding and queue/result/retention limits.
- [x] S05.6 Hide/application/context changes stop unnecessary polls and discard late responses.
- [x] S05.7 Bounded segmentation or explicit refusal, never bypassing SDK size limits.
- [x] S05.8 Isolation/coalescing/rotation/cancel/expiry/late-response tests.

**Deliverables/acceptance:** scoped scheduler/cache/tasks and panel lifecycle helpers; short requests, no stale identity mixing, and honestly marked offline snapshots. Arbitrary-scale pagination is not claimed.

### S06: Topology, Live details, and events

- [x] S06.1 API tree with stable identities and parent/child relationships, not CLI text parsing.
- [x] S06.2 Resource health, Pod/container state, server orphan metadata.
- [x] S06.3 On-demand details with correct group/kind/name/version/resource Namespace.
- [x] S06.4 Backend Live/Secret/annotation redaction; untrusted text rendering.
- [x] S06.5 Application/resource events with time/type/reason/count/identity.
- [x] S06.6 Resource filters/selection/detail-event linking and deletion/recreation handling.
- [x] S06.7 Explicit large-tree/unknown-kind/denied/orphan-monitoring states.
- [x] S06.8 Cross-Namespace names, complex parents, Secret, empty events, partial failures.
- [x] S06.9 Compact accessible navigation tree, anomaly/ancestor filtering, original DAG links, independent lazy detail tabs and click-to-read without tree-wide detail queries (synthetic implementation evidence).

Checked items mean implementation/offline evidence, not actual version/lifecycle/RBAC/host acceptance. **Deliverables/acceptance:** resource/event domains and UI/tests; diagnose without identity ambiguity or raw Secret transport; denied events differ from no events. Real conditions remain in S11/M2.

### S07: Manifests and Diff

- [x] S07.1 Desired/Live reads and bounded on-demand resource navigation/tasks.
- [x] S07.2 Supported revision/multi-source overrides with explicit Application Namespace.
- [ ] S07.3 Verify ManagedResources outcomes against target Argo UI; stable DTO implemented.
- [ ] S07.4 Verify actual ignoreDifferences/normalization/multi-source/server-side Diff, not raw YAML equality.
- [x] S07.5 Resource navigation and equal/different/unavailable safe displays.
- [x] S07.6 Evaluate CLI fallback; record that it is **not enabled or necessary**. Missing API evidence remains unavailable.
- [x] S07.7 Synthetic Secret/multi-source/normalized-pair/large-manifest/failure/timeout tests.

S07.3/S07.4 remain unchecked: fixed official v3.1.8 contracts and synthetic pairs do not prove target controller/UI behavior. Multi-source overrides conservatively require recognizable official stable >=2.11; actual effect remains unverified. See [Diff semantics](docs/diff-semantics.md).

**Deliverables/acceptance:** bounded domains/views/contracts/degradation; representative real results match target UI, no forced refresh/mutation/unbounded CLI fallback, and comparison failures never become equality.

### S08: Historical and following logs

- [ ] S08.1 Verify real target framing/Pod/container/tail/previous/time behavior.
- [x] S08.2 Historical reads/container selection/local filtering, not long-term storage.
- [x] S08.3 Service-consumed following stream and bounded rings.
- [x] S08.4 Cursor increments and explicit drops/truncation/gaps/continuity limitations.
- [x] S08.5 Start/stop/explicit reconnect/container changes/leases/idle cleanup.
- [x] S08.6 SDK polling, no iframe-to-Argo stream or public streaming port.
- [x] S08.7 Copy/summary preview and confirmation with best-effort redaction.
- [x] S08.8 Disconnect/flood/cursor/old-container/hide/dispose/Service-exit tests.

S08.1 remains unchecked: fixed v3.1.8 Swagger/handler and synthetic streams do not establish real previous/time/container errors. Reconnect explicitly creates a new fragment, with no deduplication/continuity claim. Local filters cover retained data only. Upstream has no UID parameter; periodic checks are not atomic instance binding.

**Deliverables/M2 acceptance:** session/ring/domain/UI/tests; navigate from application to resource/events/manifests/Diff/logs, memory-only bounded streams and independent lease cleanup, visible disconnections rather than false live state.

### S09: Read-only management

- [x] S09.1 AppSet list/detail, generator/template metadata, Conditions, derived links.
- [x] S09.2 Optional AppSet events with explicit unsupported/denied degradation.
- [x] S09.3 Project rules and visible role metadata, excluding role tokens.
- [x] S09.4 Window configuration/server evaluation, no browser cron inference.
- [x] S09.5 Safe repository type/connection state without auth configuration.
- [x] S09.6 Safe cluster metadata/connection/counts without Kubernetes credentials.
- [x] S09.7 Supported application links with filters/sample/error/staleness.
- [x] S09.8 Denied/unsupported/credential-injected management tests.

Implementation/offline evidence is not real target RBAC/version acceptance. AppSet events are absent in reviewed v3.1.8 Swagger, present in the main branch examined. Generator values/expressions/error bodies are withheld. canSync is server/manual-window evaluation, not automatic-sync/RBAC permission. **Deliverables/acceptance:** independent safe modules and links; no management denial blocks authorized application reads; all operations stay read-only. Real checks remain in S11/M3.

### S10: Host UI, full page, summaries, and localization

- [x] S10.1 Compact sidebar/context/navigation/empty-error states; synthetic DOM/browser evidence, not full target acceptance.
- [ ] S10.2 Full page with wide resource/details/manifest/log layout. Shared entry/contracts implemented; actual surface acceptance outstanding.
- [x] S10.3 Non-secret density/module preferences only; context stays explicit per request, never persisted globally. Legacy language preferences are ignored.
- [x] S10.4 Limited sampled status/Conditions/resources/events/Diff/selected-log summary, synthetic Service/task/stream E2E.
- [x] S10.5 Frozen preview plus separate confirmation invokes compose append only; local recheck at generation/confirmation. Real host session race remains unproven.
- [ ] S10.6 Optional Work Status on supported hosts; implemented, actual target acceptance outstanding.
- [ ] S10.7 Full theme/keyboard/long/untrusted-text/remount acceptance. Offline subsets pass, actual host variants unverified.
- [ ] S10.8 Actual instance-switch data/request isolation. **Remote portion waived; observed UUID retirement is not instantaneous isolation.**
- [x] S10.9 All 15 current host languages, live host-language updates with English fallback, locale-aware times/summary framing and Arabic/Hebrew RTL; no independent override, opaque fetched data, no runtime translation/network query.

Offline evidence includes shared wide/full-page entry, optional statusSection, keyboard/theme/remount cleanup, browser iframe confirmed compose, and observed Service-restart retirement. Language changes retain context/list/filter state but stop active work and clear details/evidence/previews. This does not change real acceptance/waiver status.

**Deliverables/M3 acceptance:** integrated surfaces, optional status, localized UI and confirmed summary; principal read-only scope implemented or explicitly degraded, no unconfirmed model/chat data, no client CLI/direct Argo requirement.

### S11: Security, compatibility, and stability

- [ ] S11.1 Actual host unauthenticated/unapproved/pause/uninstall paths. **Remote portion waived; internal-token denial tested offline.**
- [x] S11.2 Forged mutation/refresh/arbitrary URL/parameter/command/redirect matrix rejected; local Service/Mock, not outer host auth.
- [ ] S11.3 Final response/error/log/cache-ID/summary/archive credential/Secret scan and review. Known markers/rules pass; no universal secret-detection claim.
- [ ] S11.4 Complete multicontext/multiclient/Namespace/configuration/identity regression. Synthetic coverage exists, real variants uncovered.
- [ ] S11.5 Evidence for declared platforms/TLS/roots/auth cases. **Remote waived; local basic HTTPS/identity/list passed. Real renewal is prohibited because it can write configuration.**
- [ ] S11.6 Target timeout/large-response/tree/log/task concurrency/memory/cleanup limits. Bounded synthetic load tests are not long-running target evidence.
- [ ] S11.7 Actual host restart/Service crash/hide/instance cleanup. **Remote restart/switch waived; synthetic cleanup cannot prove all environments. Production has no CLI children.**
- [ ] S11.8 Complete supported-scope E2E record, fix blockers, rerun gates.

Offline cross-module safety/lifecycle/summary/budget tests pass; real outer auth/lifecycle/platform/CA/mTLS/SSO evidence remains absent. **Deliverables/acceptance:** reproducible tests, redacted record, honest support matrix; backend enforcement, no false healthy/empty fallback or unbounded retry/buffer/leak, and evidence for every claimed environment.

### S12: Package, documentation, and acceptance

- [x] S12.1 Fixed-path 14-file directory/ZIP including the right-rail Argo SVG, runtime notices, staged overwrite/rollback, scans and isolated extraction execution; no hash artifacts, dependencies/credentials/logs.
- [ ] S12.2 Final evidenced version/host/runtime support range. Private 0.1.0 and >=2.2.0 remain provisional.
- [x] S12.3 Directory/remote ZIP/Git install-update documentation and prebuilt delivery rules, no automatic installation/push/publication.
- [x] S12.4 Server CLI/config/context/certificate/root/mount/auth-failure documentation, explicitly forbidding renewal/writeback.
- [x] S12.5 Shared identity/read-only/denied/unsupported/AI confirmation boundaries.
- [x] S12.6 Auth/REST/denial/oversize/log/Service troubleshooting.
- [ ] S12.7 Clean remote prebuilt-only E2E. **Human-agreed skip, not verified; isolated extraction evidence remains valid.**
- [ ] S12.8 Final full checks/artifact review and complete-goal status reconciliation. Each incremental build is recorded; final acceptance remains outstanding.
- [x] S12.9 All maintained repository documentation in English, with preserved evidence/limitations and immutable ignored historical archives.
- [x] S12.10 Git-root build/notices, source-consistency check, version/tag CI and draft-release preparation; actual GitHub execution/push/host installation are not claimed.

**Deliverables/M4 acceptance:** installable directory/ZIP/Git layout, English docs and credential-free integrity metadata; no target dependency install/client CLI/direct network; existing host identity and official approval only. Remote install/identity-flow conditions are waived, not passed. No public release is implied.

## 4. Milestones

Original definitions remain, with remote subconditions **human-agreed skipped, not verified**. A waiver does not automatically check a milestone.

- [ ] M0: S00–S03 and evidenced host auth/Service/identity path.
- [ ] M1: S04 application observation MVP acceptance.
- [ ] M2: S05–S08 resource/event/manifest/Diff/log diagnosis acceptance.
- [ ] M3: S09–S10 principal scope and host interaction acceptance.
- [ ] M4: S11–S12 release gates and clean-install acceptance, with explicit waived portions.

## 5. Shared completion template

- [ ] Stage features/DTOs/errors implemented without expanding privileges/scope.
- [ ] Relevant tests pass; any real validation has an explicit result or waiver.
- [ ] Typecheck/build pass and prebuilt output matches source.
- [ ] Identity/authorization/redaction/output/lifecycle boundaries reviewed.
- [ ] Task/support/open-issue records updated; architectural changes reflected in plan.md.

Apply this template per stage. Another stage's success does not automatically complete it.
