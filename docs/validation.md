# Validation history

## Reading this record

Entries are chronological evidence, not claims that every historical behavior remains enabled. **Current policy supersedes earlier entries:** load contexts -> select the existing current connection -> automatically display applications; context changes query the list. No network toggle or identity-check gate is required. Production Service never executes CLI, logs in, renews credentials, writes configuration, or requests exec permission.

The user subsequently authorized a narrow existing-local-identity read-only preflight and explicitly **waived remote OpenChamber testing**. Remote installation/update, outer login/approval, pause/uninstall, instance switching, and remote lifecycle remain **human-agreed skip, not verified**, not passed. Earlier requests for a remote target describe historical gaps and are no longer delivery blockers. No deployment/configuration mutation or real renewal/writeback is permitted.

The compact-UI package passed 170 tests and the first two-language/documentation update passed 178 tests. The latest revision supersedes the independent language setting: all 15 current host languages, live host-only selection, English fallback, Arabic/Hebrew RTL, and a bundled Argo rail icon. Its evidence is recorded at the end. Browser geometry/DOM/schema checks do not constitute actual host installation/theme/lifecycle acceptance.

The latest distribution decision also supersedes historical immutable/hash-based packaging: new builds use fixed directory/ZIP paths with staged replacement, no checksum sidecars or release.json hash inventory. Git-root prebuilt assets/notices and CI/draft-release preparation are recorded in the final entry. Historical build evidence is preserved below, not a statement that hashes are still emitted.

## 2026-10-18: S01/S02 offline increment

**Scope:** TypeScript/pnpm skeleton, prebuilt panel/Service, protected HTTP boundary, and loopback tests; not complete stage or milestone acceptance.

Local executable versions: Node 22.23.3, pnpm 10.30.3, OpenChamber CLI 2.2.0, Argo CD CLI 3.4.6 (client version only). These did not establish any remote Server configuration/permissions/runtime. No real CLI credentials were read and no real Argo request was made in this increment.

Commands: `pnpm install --frozen-lockfile`, `pnpm check`.

- Strict typecheck passed; **15 tests passed, zero failed/skipped**.
- Browser IIFE/Node ESM built with no external npm runtime dependencies in metafiles.
- Built Service copied outside the checkout, without node_modules/HOME/CLI configuration, started, authenticated synthetic tokens, returned diagnostics, and exited on SIGTERM.
- Pinned SDK manifest schema accepted only Service capability. Health/diagnostics required internal tokens.
- Mutation methods, unknown operations, arbitrary URLs, refresh, encoded traversal, oversized paths, and GET bodies were rejected.
- Deadline cancellation freed cooperative query slots; health remained available under query saturation. Oversized/truncated outputs were not complete successes.
- Raw upstream exceptions were withheld; Secret/credential/Bearer/known-token/JWT/URL-auth/private-key redaction covered.

**Fixes:** fetch normalized a traversal path before sending it, so the test was changed to raw http.request plus independent allowlist assertions. Manifest schema receives contributes, with TypeScript checking the contract. Redaction budget truncation now rejects output instead of incorrectly returning truncated=false. Full checks passed after fixes.

**Gaps at that time:** target environment, real host load/theme/approval/pause/uninstall, CLI/API features, archive, and later stages. >=2.2.0 was only a provisional baseline. Local Mock HTTP did not test outer host auth. Remote gaps are now waived as stated above.

## 2026-10-18: S03 configuration and API identity offline increment

- Size-limited CLI YAML/default/legacy/XDG/explicit discovery; aliases, duplicates, and invalid references rejected.
- Explicit context resolution per request, original files reread, no writes/global context mutation.
- HTTP/HTTPS transport, connection TLS/CA/certificate options, fixed operations, deadlines/cancellation/size limits.
- **Historical behavior, now replaced:** network disabled until host settings enabled it; contexts read local files only. UI used manual identity checks. A controlled CLI renewal helper handled some 401 cases, coalesced attempts/cooled down, and retried once; 403 never renewed.
- **37 tests passed** with typecheck/build/isolated smoke. At that time `pnpm audit --prod` reported no known production vulnerabilities, not proof of no unknown vulnerabilities.
- Tests covered path precedence, damaged/large files, contexts, rotation, core refusal, certificate pairing, fixed helper argv/environment, renewal coalescing/cooldown, 401/403, redirects, malformed/large responses, cancellation, and the former network default.
- In-flight rotation discarded old responses and retried using reread credentials rather than presenting old-identity data.

Only synthetic files/tokens and ephemeral loopback services were used, not real login files or real CLI network commands.

**Built-artifact fix:** source tests passed, but isolated ESM startup failed when YAML's CommonJS dependency called require('process'). The build now supplies createRequire from import.meta.url and bundles dependencies. All gates passed afterward, demonstrating why source tests alone are insufficient.

**Retained gaps:** TLS/CA/mTLS tests then verified parsing/options, not real handshakes/rotation/proxies; helper renewal used an injected Runner, not real CLI/IdP acceptance. Host UI/lifecycle and M0 remained unproven. Production renewal was subsequently disabled, and real renewal is forbidden.

## 2026-10-18: S04 application observation offline increment

- Allowlisted list/details, on-demand GET, filters/anomaly counts, SDK UI lists/forms/details.
- Synthetic multi-source/Conditions/operation phase/time/resource results/retained history.
- Upstream contract check: status.sync.revision/revisions are compared revisions, not successful-deployment versions. UI separates those from the latest retained deployment record, without inferring running Pod versions.
- Application Namespace is explicit and separate from destination Namespace. Project before redacting/budgeting so large undisplayed Helm values do not fail a safe DTO. Parameter values/inline values/annotation contents/repository URL credentials are excluded.
- Unrecognized Sync/Health remain recognizable; missing values become Unknown. Denied/malformed/failing reads never become empty success.
- Frozen install and full checks passed: **50 tests, zero failed/skipped**, dual build and isolated execution. Full-dependency audit then reported no known vulnerabilities.
- Domain/HTTP tests covered cross-Namespace names, multi-source/version semantics, failed operations, selectors, path/refresh injection, large undisplayed config, and errors.
- Development-only Happy DOM covered then-manual reads/network default, local filters without requests, detail Namespace, retired context/detail responses, and HTML as text.
- Isolated smoke used synthetic HOME/CLI configuration and former default network denial, not the real user's files or remote DNS.

DOM tests were not screenshots/actual host installation. Automatic expiry/polling, heavy-work strategy, and subsequent stages were not yet done. Large list responses failed explicitly, not as complete clipped lists. Real environment/milestones remained outstanding; remote subconditions were later waived.

## 2026-10-18: S05 bounded cache/tasks/snapshot lifecycle

- Scoped scheduler, duplicate coalescing, LRU bytes/entries, temporary-failure backoff; keys include configuration/server/context/user/material generation and operation parameters.
- Credential/certificate changes rederive scope, invalidating old cache/tasks. Hits retain original sample time and expose source/expiry/staleness.
- Shared work cancels only when the last waiter leaves. Waiting can time out without prematurely releasing slots occupied by non-cooperative work.
- Internal task POST/GET/DELETE accepts fixed read commands only; quick opaque ID, short polling, concurrency/queue/records/deadline/retention/result limits.
- Panel background/cancel/stale/offline controls, opt-in polling, and sensitive-error clearing. Context changes reject late responses.
- Page Visibility plus IntersectionObserver pauses hidden surfaces; disposal removes listeners/timers and cancels tasks. Actual host visibility still requires its own evidence.
- Oversized results fail explicitly; arbitrary-scale pagination is not claimed. Defaults are in README.

**72 tests passed**, zero failed/skipped, with typecheck/build/isolated smoke. Tests covered clone isolation/sample retention/TTL/cache budgets/scope/Namespace/last-waiter cancellation/concurrency/backoff; task binding/cancel/retention/safe sync exceptions/oversize/non-cooperation/allowlists; HTTP metadata, temporary-file rotation invalidating tasks, JSON/content-type/body size; panel stale/offline/auth clearing/opt-in polling/hide/late-create cancellation. A historical helper regression ensured successful renewal did not accidentally cause a third upstream request.

**Fixes:** dispose components before closing test windows/restoring globals; capture owning document for cleanup. Do not create tasks after the create request times out/disconnects while awaiting config. Page Visibility alone did not cover host CSS-hidden iframes, so observer handling was added.

Evidence remained synthetic/build-only, not real scale/TLS/SSO/host lifecycle. The former default-disabled network policy was still active then and was later removed.

## 2026-10-18: S06 topology, Live, and events

- Official application.proto/Swagger/handler GET contracts underpin Resource Tree/GetResource/ListResourceEvents; Project projection exposes only orphan-monitoring metadata.
- Separate Application appNamespace/resource namespace; event resourceNamespace/resourceName/resourceUID. Live has no UID parameter, so returned objects are checked after parsing.
- Stable nodes, parent/child/multiple-parent/unresolved/cycle handling, nonrecursive traversal, original unknown health. No CLI tree parsing.
- Fixed task commands/shared scheduling. Live/events first check selected tree ownership; changed UID returns RESOURCE_CHANGED.
- Parse embedded JSON before redaction: Secret data/stringData including Lists, annotations, env literals, command/args; then known-token/JWT/key/URL redaction. Pod readiness/restarts/waiting/terminated fields are projected, never guessed healthy.
- On-demand tree and local filters; selected node reads Live/events independently. Partial failure is scoped. Hide/selection/dispose cancels waits and discards late responses.
- Application events are on the Application itself, not aggregated children. Retention-limited empty events do not prove no incidents. Empty orphanedNodes does not prove enabled monitoring; Project can be queried separately. warn=false is not disabled detection.

**86 tests passed**, zero failed/skipped, strict typecheck/dual build/isolated smoke. Domain tests covered same names across Namespaces/new UIDs, multiple/unresolved/cyclic parents, duplicate rejection, unknown kinds, tree budgets, empty events/malformed responses. HTTP/security tests covered embedded Secrets, env/args/annotations, malformed identities, injection, cluster-scoped kinds, final-task redaction, Project JWT exclusion, UID filtering, 403/404, deletion/recreation. DOM tests covered local navigation/text-only HTML/partial failures/hide-late cleanup/old-resource retirement. Former default-denial regressions included all new routes.

**Limits:** 1000 tree nodes/5000 parent references, still constrained by JSON/cache/task/response budgets; not every shape at that count is guaranteed. TTL can retain deleted-object snapshots; sample time remains visible and rereading does not force server cache refresh. Custom resources/ConfigMaps/events may contain undetectable secrets; no automatic AI send. Real versions/RBAC/recreation/retention/lifecycle remained uncovered. Remote-host gaps are now waived, not proven. M0–M4 remained unchecked.

## 2026-10-18: S07 desired manifests and cached Argo Diff

- Fixed Manifest/ManagedResources/version GET, bounded quick tasks/poll/cancel/deadline/expiry.
- Single-source revision and paired/sorted/unique multi-source position/revisions with explicit Application Namespace. Multi-source response merges all sources; absent Namespace/resolved revision remains unknown.
- Fixed official v3.1.8 Swagger/handler/UI service/Diff references. Override parameters exist in sampled v2.11.0, not v2.10.20 and other older samples; recognize official stable >=2.11 conservatively, without claiming fork/proxy capability.
- Compare normalized/predicted pairs only; no raw Live/Target semantic fallback or deprecated Diff parsing. Missing/malformed/contradictory/Hook/app-comparison failure is unavailable.
- Parse and redact embedded objects, including Secret pairs whose inner kind is absent. Hidden visible changes do not remove modified=true.
- Separate desired preview and current cached Diff, resource navigation/JSON Pointers/normalized columns/raw-cache disclosure/three outcomes. Hidden/disposed/context-changed work cannot overwrite the new view.
- Compound reads recheck identity at completion to avoid mixed-scope app/manifest/comparison samples.

**106 tests passed**, zero failed/skipped, with complete typecheck/build/isolated smoke. Synthetic pairs cover raw differences but normalized equality, predicted versus raw Target, key ordering/create/null/omitted modified=false/hidden Secret changes/missing-malformed-contradictory pairs/Hooks/app errors. HTTP covers revision pairing/version gate/cache keys/redaction/unknown-out-of-range params/403/oversize/deadline/in-flight rotation. DOM covers preview-independent Diff/multi-source pairing/merged explanation/three statuses/text-only manifests/no false equality/hide-late cancellation. All used synthetic files/loopback services; former default-denial routes were included.

**Unproven semantics:** [diff-semantics.md](diff-semantics.md) preserves fixed references/algorithm/no-CLI-fallback decision and real checklist. Synthetic pairs do not execute target ignoreDifferences/managedFieldsManagers/defaulting/source precedence/server-side Diff. **S07.3/S07.4 and M2 remain incomplete.** Application and ManagedResources are non-atomic samples; request times or separately observed revisions cannot prove one reconciliation.

Server getCachedAppState can ordinarily refresh on cache miss; Manifest GET can generate/render. No explicit refresh/deployment mutation is sent, but zero server coordination is not promised. This caveat was added before live authorization. No real config/Argo/host installation/Git push/publication occurred in this increment.

## 2026-10-18: S08 historical/following logs and bounded sessions

- Fixed v3.1.8 Swagger/PodLogs handler parameters: Pod Namespace/name/container, tailLines, previous/follow, sinceSeconds or sinceTime seconds/nanos, untilTime.
- Incremental UTF-8/JSON gateway result/error line framing, last detection, frame/network caps. Gateway errors become safe public errors without upstream bodies.
- Context/epoch-bound opaque sessions; quick create/poll/stop and lease heartbeats. Plugin-local POST/DELETE never goes to Argo. No direct iframe stream/new public port.
- Bounded Service/client rings expose drops/truncation/cursor gaps/terminal status. EOF without last is disconnected, not complete. Identical lines remain: no false deduplication.
- Explicit reconnect starts a new fragment with possible overlap/gaps, no automatic replay/exactly-once promise. Previous is historical-only; ordinary/init/ephemeral containers selectable. Filtering is retained-fragment local only.
- Validate tree membership, fresh Pod UID/container bypassing plugin Live cache, and recheck every five seconds. Identity/permission failure clears buffers; UID change/exit/lease/hide closes streams. **No upstream UID parameter means these checks are not atomic instance binding.**
- Known tokens/Bearer/JWT/URL auth/control characters/multiline PEM are redacted. A memory-only dictionary retains at most 16 recently seen tokens/refresh tokens for redaction, not auth cache/disk/output.
- Clipboard uses a frozen preview and separate confirmation, including context/app/Pod UID/container/fragment status. Over 32,000 characters is refused, not silently clipped. No automatic model/send/composer operation.

**Budgets:** four actual execution slots, eight records; unfinished non-cooperative work retains a slot. Per session 1000 lines/256,000 bytes; per page 100 lines/64,000 bytes plus global envelope cap. Frame 32,768 bytes, network stream 8,000,000 bytes, redacted line 2048 bytes with explicit truncation. Lease 15 seconds, hard deadline 10 minutes, terminal retention 60 seconds, bounded cleanup, no persistence.

**124 tests passed**, zero failed/skipped, complete build/smoke. Framing tests covered split UTF-8/JSON, embedded newlines, last, gateway/HTTP 403, redirects, malformed/time/budget/cancel/nanosecond end. Session tests covered eviction/duplicates/old-future cursors/isolation/draining terminals/lease/deadline/idle/non-cooperation/invalidity/safe errors. HTTP integrated create/poll/stop, Namespace parameters, token/PEM redaction, unknown containers/recreation, identity rotation closing/retiring streams, new streams redacting prior known tokens, RBAC/EOF/shutdown. DOM covered local filters/text-only content, previous-follow exclusivity/cursors/disconnect/hide-late cleanup/frozen copy confirmation.

A copy test initially searched for the broad word error, which also matched onerror in the test line. The assertion was corrected to use its intended complete test phrase; the implementation was not weakened. Former network-disabled log-create regression used only synthetic config/HTTP.

**S08.1/M2 remain incomplete:** fixed source and gateway mocks do not prove target Kubernetes tail/previous/time/container-error/proxy-stream behavior. Start/periodic checks cannot guarantee no mixing during same-name recreation between checks. Existing fragments do not prove current Pod state. Sixteen tokens are a finite redaction window, not every historical secret. No automatic auth replay of streams; the then-existing metadata renewal helper was later disabled in production. Remote lifecycle/approval gaps were later waived; no real logs were read.

## 2026-10-18: S09 principal read-only management

- Fixed official v3.1.8 management/window contracts and allowlisted tasks; shared scoped identity/cache/scheduling/budgets.
- AppSet list/details with explicit appsetNamespace, generator structure/types/counts, safe template/Conditions/status metadata, and resource-tree child links. Generator/element values, templatePatch/expressions, Helm values, and arbitrary errors withheld.
- AppSet events absent in reviewed v3.1.8 Swagger, present in then-reviewed main branch. Optional API returns explicit 404/403 degradation, not empty success; supported events UID-scoped and bodies withheld.
- Project sources/destinations/resource rules/visible role names/groups/policies/windows; no spec.roles.jwtTokens or status token index.
- Project active windows and Application assigned/active/canSync are distinct server responses. No client cron. Official v3.1.8 CanSync(true) means manual-window evaluation, not automatic-sync/RBAC/ability to perform Sync.
- Repository/cluster DTOs exclude auth config/Bearer/SSH/client keys/proxy/workload identity/label-annotation values. Connection-error bodies are withheld wholesale to avoid unknown credentials.
- HTTP/SSH/scp/other URI/userinfo/query/fragment metadata sanitized; negated repository rules keep their negation marker. Display URLs never become arbitrary upstream requests.
- Independent manual modules and scoped additional reads; management failures do not break application observation. Project/repository/cluster filter links, AppSet child navigation requires explicit Application Namespace/name, not guessed templates.
- Hide/context/dispose cancels tasks, retires late results, and cleans controls/listeners. Bounded extra sections do not accumulate history; original sampling/expiry retained.

**141 tests passed**, zero failed/skipped, strict typecheck/dual build/isolated smoke. Domain tests covered nested matrix/merge/unknown generators/recursion/hidden expressions/Namespace identity/sensitive fields; windows retained canSync=false/timeZone and refused missing app canSync. HTTP covered ten management commands, safe output/Namespace/scope, forceRefresh/generate/URL/mutation rejection, Project 403 and AppSet events 404 without blocking main reads. DOM covered independent queries/metadata/filter and child navigation/server windows/unsupported API/context-late cleanup. Former default-denial gates remained synthetic-only.

**Navigation fixes:** direct detail navigation shows sampling even without a prior list; explicit navigation is not silently ignored merely outside the viewport, but document.hidden still blocks it. Navigation stops auto-list refresh to prevent late lists clearing new details.

**Remaining:** default AppSet Namespace is not global; Namespace-less status is metadata only. Conservative metadata, not a config editor. Unknown is not healthy/connected. Real AppSet events/RBAC/retention/windows and real Diff/log/CA/mTLS/SSO/proxy/container behavior remained uncovered; remote subconditions later waived. M0–M4 remained unchecked; no Git initialization/commit/push/public release.

## 2026-10-18: S10–S12 host interaction, summary, offline archive gates

- Shared SDK entry/contracts/responsive layout for sidebar/page, page launcher, application subviews, and optional default-collapsed Work Status with explicit limited snapshots, not continuous network observation.
- Density/module-only enum persistence at that time; no context/filter/production/summary persistence. Explicit field names and tab aria-controls/labelledby with SDK keyboard behavior.
- Memory-only bounded evidence and local POST summary: status/Conditions/resource-container/events/Diff statuses-paths/explicit first-ten-log selection. Full manifests/config/generator values/log rings excluded, logs opt-in and clear on relevant selection changes.
- Generation and confirmation verify Service/identity and re-redact, preserving independent sampling/source/staleness. Frozen preview plus separate compose append only, no send/session/model or additional Argo query.
- Random Service UUID and HMAC epoch on envelopes; observed process/config/auth/identity changes retire views and old callbacks cannot create/cancel against new bindings. Missing metadata rejects an old unidentified Service. This is observation-driven, not instantaneous instance isolation.
- Fixed 14-file archive: minimal manifest/assets/bundles/English docs after localization/runtime licenses/per-file SHA-256 metadata; no source/tests/dependencies/config/logs. Deterministic stored ZIP, external SHA-256, immutable content-addressed outputs reject changes/symlinks/extras.
- release.json remains offline-validation-only/realRemoteAcceptance=false; private 0.1.0 and provisional 2.2.0 baseline. Operations document directory/ZIP/Git paths, containers/certificates/roots/auth/shared identity/troubleshooting. Remote waiver metadata was subsequently added.

**159 tests passed**, zero failed/skipped, strict checks/dual bundled builds/isolated Service/ZIP/extracted-Service execution.

- Regression: preference allowlist, long/untrusted text/evidence budgets/six categories/current-app isolation/log opt-in, Service/identity/late responses, session change during confirmation, stale identity compose refusal, keyboard/theme remount cleanup, late contexts after disposal.
- Synthetic full flow uses real local Service routes/client and Mock upstream/tasks/logs with workspace: contexts -> list/details -> tree/Live/events -> selected logs -> cached Diff -> six-category preview -> confirmed append. At that time contexts alone made zero upstream reads; current workflow now additionally loads applications automatically. Preview/confirmation made no additional Argo calls; compose=0 before confirmation; output excluded known markers/hidden fields; disposal stopped requests. This bypassed the actual host proxy, so is not host E2E acceptance.
- Forged-method/query matrix covered all GET modules, refresh/hard-refresh/URL/server/exec/command/duplicate-context/unknown mutations/internal unsupported methods before client creation. Existing redirect/error/scope/concurrency/budget tests continued.
- Archive gate: inventory/schema/no install scripts/no external npm/CRC/SHA/tamper-extra rejection/known-token-JWT-PEM scan; identical inputs yielded byte-identical ZIPs. Extracted Service outside project with synthetic HOME started, authenticated, read context, then former network-denied behavior and SIGTERM. Rule/marker scanning is not universal secret detection.
- Synthetic browser: real parent/child iframe SDK postMessage, packaged panel, loopback synthetic Service. Contexts/list/details/preview tested; compose=0 before, 1 after confirmation, send/model=0. Simulated Service restart caused next observed response to clear data/previews. Confirmation recheck was subsequently automated. Harness stopped and excluded from delivery.
- Initial top-level browser harness failed because SDK requires a parent; corrected to a real iframe without changing SDK/real host. One E2E assertion waited for a nonexistent comparison heading; changed to the actual separate-application-sampling text, not a skipped scenario.

**Retained gaps:** actual page/Work Status/multiclient theme/keyboard/long text/visibility; no SDK explicit remote instance ID or atomic target-session compose. UUID/local recheck cannot promise zero switching races, and confirmed composer text is host-managed, not automatically removed. Real platform/CA/mTLS/SSO/proxy/mount/long-running load/outer auth/pause/uninstall/restart evidence was absent. Final support/clean installation was not established by schema/ZIP/execution. Real Diff/log/management semantics remained uncovered. Remote portions were later waived; all milestones remained unchecked.

## Subsequent human authorization: waive remote testing, run local read-only preflight

**Decision:** no remote OpenChamber testing; mark it human-agreed skipped. Real access may use only existing local CLI credentials, read-only, without deployment or configuration changes.

- S00.2/S02.8/S03.11/S12.7 and all remote subconditions now explicitly human-agreed skipped/not verified. Other gaps are not automatically accepted; no remote target is requested.
- No skill/example addresses/accounts/passwords. Only existing default-config current-context. No login/relogin/context commands, CLI network command, renewal, refresh/hard-refresh, Sync/Exec/mutation, host-settings/credential-file writes.
- Use existing token directly for fixed GET. Stop on 401/403/failure without login repair. First preflight excludes potential rendering/ordinary cache coordination endpoints and production logs.

**Observed results:**

- `pnpm exec tsx scripts/verify-local.ts`: local read-only inspection passed. PATH CLI **v3.4.6+e1becb7.dirty**; default config parsed, five contexts, existing current-context has token. Paths/addresses/user/context/group names/credentials were not printed.
- `pnpm exec tsx scripts/verify-local.ts --confirm-read-only`: exactly one current context, fixed **GET /api/version, /api/v1/session/userinfo, /api/v1/applications**, no query/redirect/refresh/generation/mutation. Other four contexts not probed.
- Server **v3.5.3**, HTTPS/system trust/certificate verification on, default REST root, no custom CA/client cert. loggedIn=true and projected list succeeded (**124 applications at that sample**), without printing names/config/manifests/logs.
- Original CLI configuration **content digest, size, and mtime unchanged**; zero config writes/CLI network calls/login/renewal. No OpenChamber extension/host/deployment/settings installation or modification.
- This proves only existing identity and representative REST read access at that moment, not all RBAC/objects/Diff/log UID/SSO/CA/mTLS/platforms or absence of normal server coordination. Real renewal intentionally untested because it can write config.

**Delivery implications:** local S00.3/S00.4 now have evidence; remote waiver is not host-proxy validation. Automatic check/package stays synthetic-only; preflight script not shipped, raw config/responses not retained.

Four isolated preflight tests use synthetic HOME/config, a fake CLI accepting offline version only, and loopback HTTP: default zero network, confirmed exactly three GET/safe counts, 401 no login/renewal/further app read, arbitrary server/command/context options rejected. **163 tests passed**, zero failed/skipped, full build/smoke/14-file ZIP/extraction gates. Metadata now requires remoteOpenChamberAcceptance=human-agreed-skip-not-verified. M0–M4 are not automatically complete after a waiver and three GET.

## Local workflow fix: context selection displays applications

- Load contexts selects existing current-context and immediately reads applications. Context changes retire old filters/details and query automatically. No extra identity/network/first-query gate; mounting alone remains offline. Default Applications, not a previously persisted empty Summary.
- Then-advanced diagnostics moved checks/JSON/density/full-page controls away from the main view; background/polling were secondary. The later four-tab layout supersedes the collapsed-diagnostic presentation.
- Explicit application navigation works outside the viewport, but actual hidden documents/modules cancel/defer it. Resume no longer leaves an incorrect hidden-page message.
- Legacy settings read without networkEnabled gate or file write. hostClient uses a null renewal handler; 401 only rereads externally rotated material, never invokes CLI/login/renewal. Exec permission removed.
- Regressions: absent/false legacy gate, expired token one GET with unchanged config bytes/mtime, automatic current/context reads, retired late responses, latest hidden selection loaded on reveal. Six-category E2E no longer manually triggers the first list query.
- **166 tests passed**, zero failed/skipped, full checks/build/isolated/ZIP/extraction. Synthetic-only, no new real request/host/deployment/config change. Remote waiver retained.

## Compact UI: tabs, toolbar, searchable filters, independent list

- Four tabs: Applications/Management/Summary/Diagnostic. Shared context toolbar; app reload/auto icons only in Applications. Checks/JSON/density/background in Diagnostic, not the default view. No redundant successful-connection banner.
- SDK button wrapper preserves loading/disabled/disposal, decorative SVG with aria-label. Bounded keyboard/hover tooltip flips/clamps at edges and clears on Escape/scroll/blur/dispose; text-only content.
- Expanded name search plus eight searchable dropdowns. Options deduplicated/sorted from complete loaded snapshots, not filtered rows; no extra requests. Advanced selectors separate; management navigation filters retained. Context changes, including unavailable connections, clear old options/values/sample metadata.
- SDK keyboard list, two identity/metadata lines plus Conditions/Sync/Health third row. Long title/metadata has full title. content-visibility and bounded independent scrolling replace a fixed 40% split.
- Default 280px; pointer/arrows resize 220–420px, Home/End reach bounds; collapse/expand retains details. Hide/drag-cancel/blur/context/dispose cleans dragging. Under 640px container, list/detail switch and return without query.
- Regressions cover complete options, search/reset without network, invalid-context clearing, row structure, width/pointer bounds, collapse/back retention, Diagnostic isolation, focus/Escape/disposal tooltip cleanup. Existing automatic load/late response/theme/read-only/summary/E2E continue.
- Synthetic browser at **1180px**: list **280px**, keyboard adjusted **296px**; viewport height 668px/content 3815px, independent scrollTop=250px; local filtering **36 -> 18**, collapsed width=0 with details retained. At **360px**, document width=360px in list/detail, no document-level horizontal overflow. Filters open; state row has three badges.
- Geometry is not complete actual-host/theme acceptance. SDK host theme tokens remain, no hardcoded product colors. A synthetic dark-control background inconsistency was not resolved by a temporary CSS override; that override was removed. No claim of fully accepted host colors. Harness stopped; screenshot moved outside the project.
- Final **pnpm package passed: 170 tests, zero failed/skipped**, strict typecheck/dual builds/isolated smoke/fixed 14-file ZIP/extraction. New immutable directory delivered without overwriting or automatically updating the prior installation. No real CLI/deployment/config writes. Remote waiver unchanged.

## Initial localization and English documentation update (language override now superseded)

- Added English and Simplified Chinese catalogs, host-locale default, English fallback for other locales, explicit language selector, and a separately persisted auto/en/zh-CN enum. Host locale updates apply when following the host; an explicit preference wins.
- Localized authored UI labels, warnings, tooltips, placeholders, empty/stale states, and summary framing. Template substitutions are opaque; actual names/IDs/revisions/URLs/events/logs/manifests stay unchanged. Dates use the selected language.
- Language switching rebuilds the view while retaining selected context, application-list snapshot/filters, density, and tab, with **no additional Argo query**. Disposal stops active tasks/logs and clears details/evidence/frozen summary confirmation. Previously confirmed composer text remains host-managed.
- The local summary schema accepts only en/zh-CN as optional language; language cannot alter upstream URLs/permissions or create model/send calls. Default legacy framing remains compatible.
- All maintained Markdown/project documentation is now English, including plan, task IDs/statuses, chronological evidence, known limits, and the remote waiver. Historical Git-ignored generated archives are retained unchanged for integrity; new archives include the English source documentation.
- Regression evidence includes catalog coverage, locale/preference/interpolation/fallback, English workspace and detail chrome, language switching with retained filters/no new queries, stored-preference restoration and late-read protection, explicit-preference precedence, unchanged resource data, retired summary confirmations, and localized summary framing with unchanged selected evidence. Prototype-property names remain literal fallback strings. The HTTP summary route rejects unsupported languages before any upstream request.
- The English-documentation gate checks all seven maintained Markdown files for remaining Chinese text and resolves their relative Markdown links. Historical ignored build archives are deliberately excluded.
- Final `pnpm check`: **178 tests passed, zero failed/skipped**, strict TypeScript, browser IIFE/Node ESM, isolated built-Service smoke, deterministic 14-file ZIP/integrity/sentinel checks, and extracted-Service execution all passed. Packaging runs these same checks before emitting the new immutable installation directory and ZIP.
- The packaged panel was also exercised in the synthetic browser harness: load 36 applications, locally filter Project to 18, then switch to English while retaining primary/platform and 18/36. The counters remained **one synthetic upstream read/two Service RPCs** after filtering/language selection. At a 360px iframe width the document width was **360px**, filters remained expanded, and rows retained three status badges.
- A subsequent explicit detail read and English summary preview raised counters only to **two synthetic upstream reads/four RPCs**. Switching back to Simplified Chinese retained the Summary tab/context, cleared the preview/candidates, and left compose/model/send all zero, without another request. The harness was shut down afterward. This is limited synthetic-browser evidence, not actual OpenChamber host acceptance or a new real Argo test.

No new real Argo requests, credential/config/deployment changes, host installation, Git push, or public publication are part of this update. Real-semantics/platform/host-visual gaps and **human-agreed skipped, not verified** remote acceptance remain unchanged.

## All host languages and the Argo right-side rail icon

- Verified the actual upstream UI language list, not the smaller documentation-site language list, at [runtime.ts, commit bf977d2ed89c079ec592210d7cd0e2d649ba0636](https://github.com/openchamber/openchamber/blob/bf977d2ed89c079ec592210d7cd0e2d649ba0636/packages/ui/src/lib/i18n/runtime.ts): **en, de, fr, nl, zh-CN, zh-TW, uk, es, pt-BR, ko, pl, ja, tr, ar, he**. SDK onReady/HostReadyContext.locale updates drive the interface.
- Removed the independent selector and preference read/write. Old observer.language.v1 values are ignored, not deleted or allowed to override the host. Unknown language codes fall back to English; missing individual translations also fall back to the English message, not the Chinese authoring key.
- Added bundled static catalogs for every locale, with **364 authored messages per additional locale**, numbered-variable/coverage checks, opaque interpolation, locale-aware times, and shared language-specific summary framing. Public Service error descriptions and SDK empty-search chrome are localized without translating resource data or error codes.
- Additional catalogs were generated from authored UI text using a development-only translation utility, with terminology corrections for chat input, privacy filtering, stale snapshots, and key labels. Traditional Chinese uses the original authored Chinese as its basis. No credentials, configuration, application data, logs, manifests, or source files were submitted. No translation endpoint or generation script is bundled into runtime JS, and automatic checks do not regenerate catalogs. The extra languages have not been native-speaker reviewed; schema/placeholder coverage is not linguistic acceptance.
- Arabic/Hebrew set dir=rtl. Splitter pointer/arrow movement and tab arrow navigation mirror; filter reset positioning and list alignment use logical CSS. Code/log/object data keeps source-oriented text handling. Other/unknown languages restore ltr.
- Changed panel.icon from radar to **panel/argocd.svg**, a package-local Argo mascot from Simple Icons under CC0-1.0. The pinned SDK manifest accepts the local SVG contract; title/viewBox/path and inertness are tested. The icon is included in the now **15-file** archive, integrity inventory and runtime/icon notices. No remote image or new browser/exec/Service permission is needed. Actual host rail rendering remains installation/approval-dependent, not proven merely by this schema check.
- Synthetic browser using the built panel: loaded 36 applications, filtered locally to 18, then pushed Arabic, Hebrew, Traditional Chinese, and an unknown host language. Connection primary, Project platform, list/filter data and 18/36 counts survived. Unknown locale displayed English/ltr. Counters stayed **one synthetic upstream GET/two Service RPCs**, compose/model/send all zero.
- Arabic desktop layout placed the 280px list on the right (left offset 478px within the measured 764px surface). At 360px, both Arabic and the English fallback had documentWidth=360px, expanded filters and three row-status badges, without document-level horizontal overflow. The synthetic harness was shut down afterward. These observations do not prove every actual host/theme/assistive-technology combination.
- Automated gates cover all 15 live host locales, ignored legacy preferences, preserved list/filter state, unknown/missing-language fallback, frozen-preview retirement, untranslated data, mirrored controls, localized empty search, all-language summary HTTP schema and redaction, icon manifest/inventory/inertness, and no bundled translation transport.

Final `pnpm check` passed: **182 tests, zero failed/skipped**, strict TypeScript, dual bundled builds, isolated Service smoke, deterministic **15-file** inventory/ZIP/SHA-256/scans, bundled-icon and no-runtime-translation checks, and extracted-Service execution. Packaging runs the same gates before emitting immutable outputs.

No new real Argo access, configuration/deployment mutation, installation/update of a running extension, push, or publication occurred. Remote OpenChamber acceptance remains **human-agreed skip, not verified**; the other real semantics/platform gaps remain unchanged.

## Compact resource navigation and click-to-read

- Replaced repeated-arrow list cards with a keyboard-navigable ARIA tree: default **220px**, pointer/keyboard resize **180–360px**, **28px** single-line rows, **12px** indentation, Kind glyphs, status dots and name truncation/full tooltips. Healthy branches fold; anomaly paths expand. Search and Only anomalies preserve ancestors. Multi-parent/cyclic topology remains a navigation spanning forest with original parent links in metadata; orphan nodes are separate and unknown health is never marked Healthy.
- Entering Resources loads only the selected application's tree. Node selection loads Live overview, not events/logs for every row. Events load on their tab; Live Manifest reuses the selected redacted object. Application Events/orphan settings are tab-driven. Valid selected snapshots are reused; selection/filter/hide/context/disposal retire old work. Optional reload controls remain, not a first-read prerequisite.
- Opening a Pod's Logs tab reads a bounded recent fragment, follow off. Container changes auto-read; valid time/tail edits debounce and mutually exclusive time fields clear the other input. Invalid parameters do not query. Rapid container changes retire old starts/late sessions; hiding cancels polling and follow, and returning does not automatically reconnect an already-started stream. Frozen copy/summary confirmation and existing Service budgets/leases remain unchanged.
- Application desired-manifest and cached-Diff are independent tab-driven reads; the first returned resource is selected. Revision edits debounce, source/revision pairing remains validated, and preview controls do not initiate historical Diff. Application sync windows also load on tab entry. Hidden module mounting stays offline. Management workflows outside this resource-focused change retain their previous scope.
- All newly authored strings are bundled across the same 15 host languages; catalogs now cover **384 messages**. Additional translations remain machine-generated with terminology overrides and placeholder/coverage checks, not native-speaker acceptance. No runtime translation calls or production data exports were added.
- New/updated regression cases exercise no request at mount, automatic entry reads, no event/log read on node selection, cache reuse and return-to-list without a read, healthy folding/anomaly expansion, search ancestor retention, multiple parents/cycles/orphans, unknown status, tree keyboard operation, late namespaced results, lazy log/container reads, rapid-start retirement, invalid/debounced parameters, time exclusivity, and no automatic follow reconnection. Existing read-only/auth/redaction/summary/packaging regressions continue.
- Built-panel synthetic browser: a seven-node tree initially showed six rows because the healthy child was folded. At 1180px iframe width, the resource surface measured **1126px**, navigator **220px**, row **28px**, and document width **1180px**. Selecting a Pod brought synthetic upstream reads to four (list/detail/tree/Live), with **zero log streams**. Opening Events then Logs read their own content and produced **one** log stream; no composer/model/send action occurred. At 360px, selected-detail mode measured documentWidth **354px** (vertical scrollbar reserved), resource width **300px**, without document-level horizontal overflow. This is bounded synthetic-browser evidence, not complete host/theme acceptance. The harness was stopped afterward.

Final `pnpm check` passed: **189 tests, zero failed/skipped**, strict TypeScript, dual bundled builds, isolated Service smoke, deterministic 15-file archive/integrity/scans and extracted-Service execution. The active-Live-Manifest transport-failure regression also confirms old objects are removed and errors shown on the tab being viewed. Packaging reruns the same gates before writing the new immutable delivery directory and ZIP.

No existing installation was automatically updated. No real Argo request, login/renewal, deployment/configuration write, push, or public publication occurred. Remote acceptance remains **human-agreed skip, not verified**.

## 2 MB plugin result/cache/HTTP ceilings

- Raised shared default limits for task results, individual query-cache entry data and complete plugin HTTP responses to **2,000,000 serialized UTF-8 bytes**. Task QuerySnapshot/final envelope overhead counts at those layers. Boundaries remain inclusive and oversized or structurally truncated results fail explicitly.
- Kept the aggregate query cache at **4,000,000 bytes**, 32 cache entries, existing TTL/LRU/scoping, task concurrency/queue/count/retention, upstream 2 MB response cap, log ring/page/stream budgets and all string/node/depth/redaction limits unchanged. Task results may now occupy up to roughly 64 MB across 32 records before object/serialization overhead; this is a bounded size increase, not an unlimited-memory claim.
- Inspected the pinned SDK 2.2.0 contract/protocol: GUEST_REQUEST_RESPONSE_MAX is **256,000 characters**, and the response-body schema uses it. This independent SDK/host transport cap is not changed by raising plugin-side limits. No chunked result transport, public Service access or host modification was added, so direct-HTTP large-response success is not end-to-end panel acceptance.
- New synthetic regressions accept exactly 2,000,000-byte task snapshots and cache entry data, reject the next byte, verify 4 MB aggregate LRU eviction, pass a 1.9 MB direct Service HTTP response, reject an oversized envelope, and retain structural-string rejection. A separate assertion documents the smaller pinned SDK cap. Fixtures use many bounded strings rather than accidentally triggering the independent 4096-character string limit.

Final `pnpm check` passed: **193 tests, zero failed/skipped**, strict TypeScript, dual bundled builds, isolated Service smoke, deterministic 15-file archive/integrity/scans and extracted-Service execution. Packaging reruns these gates before emitting the immutable delivery directory and ZIP.

No real Argo request, credential/configuration/deployment change, running-host installation/update, push or publication occurred. Remote testing remains **human-agreed skip, not verified**. The SDK transport limitation remains explicitly unmodified.

## Git-root installation and fixed-path packaging without checksum artifacts

- Refactored compilation into a shared in-memory build. `pnpm build` now writes panel/main.js, service/main.js and **root THIRD_PARTY_NOTICES.txt**, ready to commit alongside manifest/HTML/CSS/SVG/source/lockfile for a Git HTTPS installation. No repository address is hardcoded and private=true remains an npm-publication safeguard, not a Git install prohibition.
- Added `pnpm verify:release`: it compiles in memory, compares the root runtime bundles/notices to source without rewriting them, and checks declared manifest entries and package files. It emits no checksum files or hash inventory. `pnpm release:prepare` runs the complete check chain and this Git-asset check; version increments and Git commits remain human actions.
- Replaced content-addressed outputs with **dist/openchamber-argocd-plugin/** and **dist/openchamber-argocd-plugin.zip**. Complete candidates are staged/checked before promotion; the previous directory/ZIP pair is rolled back on a failed promotion, and a lock prevents concurrent writers. A different extension identity, unexpected target type or symlink is refused. Obsolete files inside the fixed output directory disappear on replacement. This is not a filesystem-wide atomic transaction.
- Removed packaging SHA-256 digests, checksum sidecars, hash-based names and release.json/per-file hash inventories. The new directory/ZIP contains **14 files**, including notices and English documentation. Standard ZIP CRC, in-memory comparisons, source/type/manifest/path/marker checks and isolated extracted-Service execution remain tests, not published checksum artifacts. Earlier metadata/immutability records are historical; remote acceptance status remains in the current documents.
- Existing historical hash-named packages/sidecars and unrelated dist content are preserved because a running directory installation may still reference an old path. No existing installed extension is automatically replaced or re-enabled. The new build writes only the fixed pair.
- Added GitHub Actions configuration for branches/PRs/manual checks and v-version tags. It checks prebuilt assets **before** any rebuild, rejects untracked/changed generated runtime assets afterward, requires tags to match package.json version, runs full packaging and uploads only the fixed ZIP. Only a tag-push job requests contents:write, and it creates a **draft** Release using verify-tag/draft, not an automatic public release. Action references and CLI flags were checked against current public action metadata/documentation; the workflow itself has not executed on GitHub.
- New synthetic tests cover fixed names/no hash files, overwrite with version changes, stale-file removal, staging failure preserving old outputs, promotion failure rolling both outputs back, symlink refusal, preservation of unrelated work, exclusive package locks and workflow ordering/draft-only permissions.
- Local `pnpm verify:release` and full `pnpm check` passed: **200 tests, zero failed/skipped**, strict TypeScript, bundled browser/Service builds, isolated Service smoke and 14-file ZIP/extraction checks. The root generated files exist and match source; this checkout still has no Git repository, so no claim that they have already been committed/tracked is made. Git tracking is an explicit future CI gate.

No repository initialization, commit, remote configuration, push, GitHub Release creation, actual Actions execution, running-host installation or new Argo/configuration/deployment access occurred. Remote OpenChamber acceptance remains **human-agreed skip, not verified**. Production compatibility and SDK large-response caveats remain unchanged.

## Project-scoped navigation persistence

- Added versioned, bounded navigation persistence through the existing OpenChamber SDK storage API. Device storage is preferred only when advertised; older hosts explicitly use instance storage on the connected Server. Failed device operations do not silently change scopes. Keys are directory-derived and values also require an exact directory match; SDK namespaces retain runtime/installation isolation. No session ID is used, so chats in one directory share navigation rather than restoring separate per-chat copies.
- Persisted fields are limited to directory/context, application filters and selected application/resource identifiers (including resource UID), workspace/application/resource tabs, density and list widths/collapse/list-detail layout. Query results, credentials, Manifest/log/event bodies, summary previews, log connections, polling settings, resource-tree search/expansion and scroll positions are excluded. Saved Logs tabs normalize to resource Overview. This changes the historical density/module-only storage policy, not the no-telemetry/no-collection-service policy; bilingual privacy notices disclose local/Server preference storage.
- Normal panel remounts re-read contexts and application lists, validate saved selections against the resulting data, and restore a resource only if its group/kind/namespace/name/UID still matches the new tree. Missing contexts fall back to the CLI current context without old filters/selections. Hidden documents defer restoration, and saved non-Application tabs defer application queries until Applications is opened. Fresh user actions win over late storage/context restoration. Work Status surfaces do not read/write navigation state.
- Session changes keep mounted browsing state, flush queued preferences and invalidate frozen summary confirmations. Explicit Service/credential/authorization boundary resets disable automatic restoration, preserving manual recovery and preventing auto-retry loops. Disposal retires callbacks and attempts a final save; abrupt termination may lose a last pending write. Writes debounce for 150 ms and serialize across mounts in one frame, not atomically across independent windows. Storage errors do not delete old values or block browsing. Each navigation projection is limited to 32,000 UTF-8 bytes, below the SDK per-value limit.
- Added unit/synthetic-DOM tests for schema projection and payload exclusion, size/enum/layout/version validation, directory isolation, scope selection/no silent fallback, queued write/read ordering and failure preservation, session/remount recovery, deferred tabs/hidden documents, late/disposed callbacks, missing contexts/applications, resource UID replacement, log-tab safety and boundary-reset suppression. Local source tests passed: **215 tests, zero failed/skipped**, plus strict typecheck.

No real Argo request, CLI/configuration/deployment write, running-extension update, Git commit/push or public release was performed. Real host session-switch/remount behavior is still unverified; remote OpenChamber acceptance remains **human-agreed skip, not verified**. Browser/host storage is not secret storage and persisted names/filter text may contain internal information.

## Authorized 1.0.0 GitHub publication preparation

- The user authorized GitHub publication of openchamber-argocd 1.0.0, not npm publication or a change in repository visibility. The target repository is hlhr202/OpenChamber-ArgoCD and remains private; access to its code/releases requires existing repository permissions.
- Final local release preparation passed **216 tests, zero failed/skipped**, strict typecheck, bundled builds, isolated Service/archive smoke and prebuilt/source consistency. A heuristic review of 137 initial candidate files found no matching credential material, local environment/log files or symlinks; this is not a guarantee that every possible secret would be recognized.
- Source, manifest/lockfile, MIT and third-party licenses, bilingual READMEs/screenshot and root prebuilt runtime assets were committed as c35666c1a0fedaaf930b4743a939ed1592e76c77 and pushed to main. Ignored local tools, dependencies, caches and dist outputs were excluded. No force push or host extension update was used.
- The initial main-branch GitHub workflow passed on Ubuntu: https://github.com/hlhr202/OpenChamber-ArgoCD/actions/runs/39204352211 . This includes frozen dependency installation, prebuild source-consistency, full packaging gates, tracked/unchanged prebuilt assets and ZIP artifact upload. Tag/version/draft-release steps are separate and are not claimed by this branch-run evidence.
- README installation now links to Releases and distinguishes the attached prebuilt ZIP from GitHub's automatic source archive. This record supersedes earlier statements that no Git commit/push or Actions run had occurred, without upgrading actual host/platform acceptance.

Remote OpenChamber acceptance remains **human-agreed skip, not verified**. No real Argo request, credential/configuration/deployment change or npm publication was performed during these publication steps.
