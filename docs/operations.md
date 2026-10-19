# Installation, operation, and troubleshooting

## Current workflow

**Load contexts -> the existing current context is selected -> applications load automatically.** Selecting another context reloads applications. No settings edit, identity check, or separate network switch is needed.

Use Applications for expanded local filters, a scrollable/resizable/collapsible list, and details. Management and Summary retain their independent workflows. Diagnostic contains process checks, JSON output, density, and background-query options. Toolbar icons support keyboard/hover tooltips. The extension always follows OpenChamber's current language, with all 15 current UI locales bundled and English fallback for unknown languages. Arabic/Hebrew are right-to-left. There is no plugin language control or stored override; legacy language preferences are ignored.

Resources now uses a 220px compact tree, 28px single-line rows and 12px indentation; it can resize 180–360px, collapse, or switch to list/details in narrow containers. Expand/collapse/search do not contact Argo. Anomaly paths open, healthy branches fold, orphan nodes stay separate, and original parent relationships remain in details.

Entering Resources reads the tree automatically; selecting a resource reads its Live overview. Open Events, Live Manifest or Logs to inspect that content without a separate Read button. Live Manifest reuses the selected redacted Live object; desired generation remains in the separate application Manifest/Diff module. That module, its Diff tab, and application sync windows also read on entry. Optional reload is not a prerequisite. Opening Logs creates a bounded historical fragment with follow off; container changes read automatically, parameter edits debounce and invalid options do not send requests. Leaving stops follow; returning does not automatically reconnect an already-started stream. Copy/summary confirmation is unchanged.

Host language changes preserve the current connection, application-list snapshot, filters, density, and active tab without an Argo query. Active tasks/logs stop and details/evidence/summary previews are cleared; select an application again. This prevents an old confirmation or stream from being reused across a rebuilt view. Resource names, logs, manifests, and other fetched content remain in their original language.

### Saved browsing state

Same-directory session changes keep the mounted browser and invalidate frozen summary confirmations. On a normal panel reload/remount, project-scoped navigation is restored from OpenChamber storage: selected context, application filters, application/resource identifiers (including resource UID), workspace/application/resource tabs, density, list widths and collapse/list-detail layout. Application/Manifest sub-tab inputs, resource-tree search/expansion, scroll positions, polling/follow settings, API payloads, credentials, log/event bodies and summary previews are not persisted. This is navigation recovery, not a continuously mounted panel or stream.

Storage uses device scope when the host advertises deviceStorage; otherwise it explicitly uses instance storage on the connected Server. A failed device operation never silently falls back to the Server. SDK namespaces separate installations/runtimes; a bounded directory-derived key plus an exact directory check separates projects. The directory hash is not anonymization: identifiers, filter text and directory are retained in the JSON and may reveal internal names. These preferences are not secret storage and must be protected by the host/browser's existing access controls.

Only a versioned, allowlisted navigation projection (maximum 32,000 UTF-8 bytes) is saved, below the SDK's per-value limit. Writes debounce for 150 ms, serialize within this extension frame across mounts, and flush best-effort on session change, document hiding and disposal. An abrupt browser/process termination may lose the latest unsaved changes; simultaneous independent windows use last-writer-wins, not a cross-window transaction. Storage refusal/quota/corruption leaves live browsing usable and does not delete a previous value. Invalid/different-directory stored data is ignored. No extension log file is written; host storage may write preferences to disk.

A first launch with no saved context is still offline until Load contexts. A restored context triggers context discovery and application reads when visible. Saved contexts must still exist; otherwise the CLI current context is used without old application filters or selection. Restored applications must occur in the freshly read filtered list; restored resources must still match their UID in the new tree. Removed/filtered objects are not blindly read. Saved non-Application workspace tabs defer application reads until Applications is opened. Reopening a saved Logs tab restores resource Overview, never a historical log read or follow connection. Summary previews never survive recovery.

Service-instance/credential/authorization boundary resets suppress automatic restoration and still require manual Load contexts. This avoids automatic retry loops or bypassing identity failures. Work Status surfaces do not load/save this navigation state. Storage behavior and restoration are covered by synthetic tests; actual host session-switch/remount acceptance remains unverified under the existing remote-testing waiver.

The host right-side rail uses panel/argocd.svg, a bundled Argo mark declared in the manifest. If an old generic icon remains, replace the old extension directory/ZIP and re-enable it using normal host controls. Do not alter another extension or host configuration. Actual host icon rendering/approval remains distinct from package/schema checks.

The Service does **not execute CLI commands, log in, renew credentials, or write configuration**. The manifest requests no exec permission. Invalid/expired credentials produce an explicit error. Legacy networkEnabled is no longer a second gate, even if an existing file says false. These policies supersede the earlier default-disabled network/CLI-renewal design recorded in validation history.

## Acceptance and authorization

The package is **openchamber-argocd 1.0.0**, with private=false and the MIT license. This metadata does not imply npm publication, real host acceptance or production compatibility. Remote acceptance remains **human-agreed skip, not verified**, retained in these documents. The former release.json hash inventory is no longer generated; removing it does not turn build checks into real host acceptance.

The user explicitly waived remote OpenChamber installation/update, outer authorization/approval, pause/uninstall, instance switching, and lifecycle acceptance. Record these as **human-agreed skip, not verified** and do not request a remote instance as a blocker. Other uncovered Argo/platform behaviors are not automatically waived.

A limited real read-only preflight was separately authorized and passed on the existing local CLI/current context. It used only version, identity, and application-list GET endpoints and did not alter configuration/deployments or log in/renew. The package status describes build/host acceptance, not the absence of that limited live evidence.

Install/update/pause/uninstall only this extension on an explicitly authorized host. Do not alter other extensions, host login, or global CLI context. Some Argo GET cache misses can cause ordinary server reconciliation and manifest reads can run existing generators. Logs cannot atomically bind to Pod UID. The first real preflight excluded generation/comparison/cache-tree endpoints and production logs.

## Build a prebuilt package

On the development machine:

```sh
pnpm install --frozen-lockfile
pnpm package
```

The command runs typecheck, source tests, browser/Service builds, isolated Service smoke and ZIP inventory/redaction/extraction gates. It stages and then replaces exactly:

- `dist/openchamber-argocd/`
- `dist/openchamber-argocd.zip` (package.json at the archive root)

There is no version/hash suffix, checksum sidecar or release.json hash inventory. ZIP CRC remains part of the standard archive format, not a separate artifact. Complete candidates are checked before replacement; promotion failures roll the prior directory/ZIP pair back. Obsolete files inside the fixed directory are removed by replacement. A package lock prevents concurrent writes; a symlink, unexpected target type or different extension identity is refused. If exceptional rollback fails, the error names the staging directory containing recovery files; inspect it before another package attempt.

Existing hash-named historical directories/ZIPs/checksum files and unrelated dist content are **not** automatically deleted: an installed extension may still reference an old directory. After explicitly replacing that installation, an operator may separately remove unused historical outputs. The new build never creates more of them. Replacing files is not an automatic host re-enable/reinstall or a filesystem-wide atomic transaction.

Exactly 17 allowlisted files ship in the directory/ZIP: minimal manifest, bundled JS, HTML/CSS/Argo SVG, seven English Markdown files, the Simplified Chinese README, screenshot, MIT LICENSE and runtime/icon notices. No source/tests/scripts/node_modules/config/credentials/logs ship in those outputs. Catalogs are bundled into JS. THIRD_PARTY_NOTICES.txt is generated at the repository root as well, so Git URL installs include dependency/icon licenses without a target build. The application's own license is MIT; see the separate LICENSE file.

## Installation sources

These follow upstream contracts; remote execution is waived, not verified. Use the host's existing authenticated session and official Service approval, never a separate extension account.

1. **Directory:** place the generated prebuilt directory at an absolute path readable by OpenChamber Server. Add that root directory through Settings -> Extensions; do not choose its inner panel directory. Remote paths belong to the Server, not the client computer. Approve Service, then enable.
2. **ZIP upload:** upload dist/openchamber-argocd.zip in the authenticated target's extension UI. Upstream provides protected `/api/guests/upload`. Check its source and manifest; no checksum sidecar is provided. Do not upload user configuration.
3. **Git HTTPS URL:** the repository root is directly installable: package.json, panel HTML/CSS/SVG/main.js, service/main.js and THIRD_PARTY_NOTICES.txt are committed together. OpenChamber does not install npm dependencies/build the source. A public repository URL requires no plugin GitHub token integration; a private repository still requires existing host Git access. Git updates compare the origin package.json version, so bump version and rebuild/commit the assets for each update. A pinned tag stays fixed. Only publish/push to an explicitly authorized repository; none is hardcoded or automatically created.

For Git release preparation, run `pnpm release:prepare`, commit all root build outputs plus source/version/lockfile, then push when authorized. `pnpm verify:release` compares root build assets to an in-memory compilation and emits no checksum files. The GitHub workflow runs that check before rebuilding, requires generated assets to be tracked/unchanged afterward, then tests/packages/uploads the ZIP. A matching v-version tag creates a **draft** Release only, never an automatic public release. Review it manually; uploading a Releases ZIP alone does not make a source-only repository installable. No actual GitHub workflow or host Git install/update acceptance has been performed here.

Directory/ZIP updates require explicit replacement/reinstallation; Git update applies only to Git sources. To try a newly supplied directory, replace the previous extension and re-enable it so the old Service/bundle is not reused. Old-host, missing-build, duplicate-ID, and approval failures must not be bypassed. Installing/uninstalling this extension does not delete the host's CLI configuration; preference storage is host-managed.

## Host identity, paths, TLS, and containers

All authorized users share the Argo identity of the **OpenChamber Server OS user**. This is not browser-user isolation. Exposed hosts must retain their existing access protection; least-privilege read-only Argo RBAC is recommended.

Normal use needs no settings file. Optional path overrides live at `$XDG_CONFIG_HOME/openchamber-argocd-observer/settings.json`, otherwise `~/.config/openchamber-argocd-observer/settings.json`:

```json
{
  "configPath": "~/.config/argocd/config",
  "restRootPath": "/"
}
```

Settings are cached on first client use; restart this extension after changing a path. The panel cannot change settings, accept tokens, choose arbitrary files/URLs/CLI arguments, or initiate login. Existing networkEnabled and cliPath fields remain format-validated for compatibility, but do not gate reads or execute a binary.

Context is explicit per request and never written globally. Default discovery follows CLI precedence: process-visible ARGOCD_CONFIG_DIR, existing legacy directory, XDG, then the default directory. Host environment inheritance may omit terminal ARGOCD_* values; use an explicit non-secret path for a custom location.

TLS/CA/client-certificate material comes from the selected CLI context. REST and CLI gRPC-Web roots can differ. Redirects are refused, proxy environments are not blindly forwarded, and explicit HTTP CONNECT proxy support is not implemented. Do not disable verification to hide a certificate problem.

A Server container needs its own compatible Node runtime, existing CLI-format configuration, certificate files, correct UID/HOME/path access, and network route. Installing a CLI only on the browser machine or remote OpenCode container does not relocate this Service. Prefer read-only mounts: this Service has no renewal/writeback path. Restoring login outside the extension is an operator action, not permission for the extension to write files.

## Summary and privacy

Only limited in-memory current-application evidence is selected, with original sample/source/staleness. Full manifests/configuration are excluded. Logs require choosing the first 10 filtered lines and separately enabling inclusion. Summary framing follows the selected interface language; evidence/log text is not translated.

Generation and confirmation locally recheck the identity epoch and redact again, without Argo reads. A frozen preview plus separate confirmation invokes compose append only: **no send, new session, or model call**. Session/evidence/visibility/language changes invalidate it. The SDK has no atomic target-session/instance-bound compose transaction, so check-to-execution races remain possible. Text already explicitly added to the composer is host-managed and is not automatically deleted.

Untrusted data is rendered as text and quoted in summaries, not treated as instructions. ConfigMaps, custom resources, events, and logs may contain unrecognizable secrets. Inspect them before independently sending to a model. Clipboard limits and summary budgets fail explicitly, rather than silently clipping complete content.

## Troubleshooting

Task results, single query-cache entries, and plugin HTTP responses now allow **2,000,000 serialized UTF-8 bytes** each (metadata/envelope overhead counts in its respective layer). Aggregate cache remains **4,000,000 bytes** with LRU eviction. Upstream response, log rings/pages, structural redaction/node/depth/string budgets, task count and retention are unchanged; those independent limits can still return RESPONSE_TOO_LARGE below 2 MB.

The pinned SDK separately caps serviceRequest response body strings at **256,000 characters**. Plugin-side 2 MB support does not remove that outer limit, and this increment does not implement chunked delivery or modify the host. Large direct-HTTP successes therefore do not prove panel transport succeeds. Preserve host auth/Service approval and do not expose the internal Service publicly.

| Symptom | Action and boundary |
| --- | --- |
| Service startup failure / NO_SERVICE | Check enablement/Service approval, Node 22+, complete prebuilt assets, and entry paths. The host injects port/internal token. Do not expose a public port or paste tokens into diagnostics. |
| NETWORK_DISABLED from an older install | Replace the old extension with the current prebuilt directory and re-enable it. Do not create/change a network setting to fix this version. |
| CONFIG_MISSING / CONFIG_INVALID | Check the Server user's HOME, path, file size/format, and container mount permissions. Do not share the raw file. |
| CONTEXT_NOT_FOUND / core unsupported | Reload contexts and choose an existing non-core connection. Global CLI selection is unchanged. |
| AUTH_REQUIRED | Existing credentials failed or changed during a request. No login/renewal is attempted. Check existing credentials externally, then reload; old observations are not current identity proof. |
| FORBIDDEN | The account lacks this module's permission; not proof of no objects/events. Other authorized modules remain independent. |
| REST/TLS/root-path failure | Check the Server-to-Argo route, certificate SAN/trust, material paths, and REST versus gRPC-Web roots. Redirect/proxy compatibility is not assumed. |
| UPSTREAM_INVALID / CAPABILITY_UNAVAILABLE | API/version/fields unsupported. Record public code/version, not raw response bodies. AppSet events and Diff fields can degrade explicitly. |
| TIMEOUT / BUSY / RESPONSE_TOO_LARGE | Narrow scope or log tail, wait for bounded slots, then query explicitly. No unlimited retries/buffers or false empty-success fallback. |
| Log EOF/disconnect/gap | Inspect fragment state, cursor gaps, and resource UID. Explicit reconnect creates a new fragment that may duplicate or miss lines. |
| RESOURCE_CHANGED / EXPIRED | Reload tree/application and reselect Pod or regenerate the preview; do not reuse old UID/identity tasks or streams. |
| Service/instance changed | Retired callbacks/responses are refused. Reload contexts. Observation-driven invalidation is not instantaneous isolation. |
| Language/preference/full-page/Work Status unavailable | Use in-memory defaults and the main panel. Unsupported optional features do not add privileges or initiate network work. Language switches intentionally stop active work and clear confirmation previews. |

Collect versions, public error codes, redacted sample/source metadata, and reproduction steps only. Do not upload CLI files, keys, raw logs, complete environments, or authorization headers.

## Waived remote acceptance reference

The following is **optional future operator reference, human-agreed skipped for this work**, not a request for a new target:

1. Identify the authorized Server/version/scope and test existing host login, Service approval, wrong internal token, pause/uninstall denial paths.
2. Install only a prebuilt ZIP without target dependency installation; opening the panel alone makes no Argo requests. Check sidebar/full page/optional Work Status, keyboard, themes, and narrow layouts.
3. Separately authorize read-only Argo access, verify host identity/context/TLS and representative RBAC, and compare existing UI/Diff/log/management observations. Do not change production configuration or enable renewal.
4. Check hide/application/context/instance/session changes, Service crash/restart, pause/uninstall cleanup, and summary-confirmation behavior.
5. Record actual evidence before revising support/milestone conclusions. Local schema and extracted-Service checks are not host acceptance.

References: [SDK ship checklist](https://github.com/openchamber/openchamber/blob/main/packages/sdk/API.md), [extension installation/update contract](https://github.com/openchamber/openchamber/blob/main/packages/web/server/lib/guests/DOCUMENTATION.md).
