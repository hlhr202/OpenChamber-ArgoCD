# Compatibility and evidence

## Declared scope

Current development baseline: Node 22+, pnpm 10.30.3, pinned `@openchamber/sdk` 2.2.0. OpenChamber `>=2.2.0` is a provisional install floor, not proof that all later versions or remote platforms work. Package `openchamber-argocd` is version `1.0.0` with `private: false`; the metadata change does not establish production compatibility or imply npm publication.

The user explicitly agreed to skip remote OpenChamber tests. Their status is **human-agreed skip, not verified**, not passed. A separately authorized local read-only preflight passed using existing CLI/current-context credentials without deployment/configuration changes, login, or renewal. Results do not extend to other contexts or authentication methods.

## Matrix

| Environment / capability | Evidence | Conclusion |
| --- | --- | --- |
| macOS arm64, Node 22.23.3 | Typecheck, synthetic HTTP/DOM tests, dual builds, isolated Service smoke | Offline execution passed; not host installation |
| Linux / containers / Windows | No target execution of the prebuilt package | Not claimed as verified |
| Actual local OpenChamber | User-provided screenshots show loading and application inspection; automated host install not performed | User testing is in progress, not full lifecycle acceptance |
| Remote install/update, outer login/approval, pause/uninstall/instance switching | Explicit user waiver | Human-agreed skip, not verified |
| SDK postMessage / summary compose | Synthetic parent iframe and packaged panel in the browser panel | Limited flow checked; host session race remains unverified |
| Themes / keyboard / long text | Synthetic DOM and limited browser-panel checks | Not complete multi-client host visual acceptance |
| Responsive layout | Synthetic browser-panel geometry at 1180 px and 360 px, independent list scrolling and collapse | Bounded layout checks passed; actual host rendering still merits inspection |
| All 15 current host locales | Bundled catalogs, live host-locale updates, English fallback, coverage/placeholder and opaque-data gates | No independent language override; additional translations are machine-generated, not native-speaker reviewed |
| Arabic / Hebrew direction | RTL document/layout plus mirrored splitter/tab keyboard behavior; code/log text remains source-oriented | Synthetic regression coverage, not every real host/assistive-technology combination |
| Right-side Argo icon | Package-local panel/argocd.svg manifest declaration, fixed inventory/integrity and inert-SVG checks | Actual host rail rendering remains subject to normal installation/approval; remote acceptance waived |
| Compact resource tree / click-to-read | Synthetic tree/DOM/Service tests: folding, ancestor-preserving filters, DAG/cycles/orphans, selected-resource cache, independent tabs, log entry/container changes and cancellation | 220px/28px geometry checked in synthetic browser; actual host visual acceptance remains outstanding |
| 2 MB task/cache/HTTP limits | Exact-boundary task/cache tests, aggregate-cache eviction, large direct Service HTTP responses and over-limit rejection | Plugin-side limits only; pinned SDK serviceRequest still caps bodies at 256,000 characters. No chunked transport or real host large-response acceptance |
| Service restart boundary | New UUID observed in synthetic browser; retired callbacks rejected in tests | Observation-driven, not instantaneous instance isolation |
| ZIP / directory | Fixed 17-file inventory including bilingual READMEs, screenshot and MIT LICENSE; manifest/entry checks, ZIP CRC, staged replacement/rollback and isolated extracted-Service execution; no checksum artifacts | Local packaging passed; not a real host installation |
| Git install/update | Root prebuilt assets/notices committed and pushed; initial main-branch GitHub Actions build passed on Ubuntu with source-consistency and package gates | Actual host Git installation/update remains unverified; remote host testing waived. Tag release checks and publication are separate from host acceptance |
| CLI configuration / contexts | Synthetic files plus local CLI v3.4.6 and five real contexts parsed read-only; current-context API preflight | Original bytes/size/mtime unchanged; real material rotation untested |
| 401 / 403 / redirects | Synthetic HTTP and legacy renewal-helper tests; production Service renewal disabled | Authentication failures do not execute CLI or write configuration |
| HTTPS / CA / mTLS / proxy / read-only mounts | Current local context used HTTPS/system trust with certificate verification enabled, no custom CA/client certificate | Basic HTTPS passed; other variants uncovered; explicit HTTP proxy unimplemented |
| Argo applications / tree / Live / events / logs | Real Server v3.5.3 identity/application-list GET; other contracts synthetic | Representative list permission passed; resource/event/log behavior unverified |
| Manifest / Diff | Fixed upstream source references and synthetic normalized/predicted/multi-source tests | Real UI/normalizer/ignore-rules comparison remains outstanding |
| Management / sync windows | Allowlisted DTOs and synthetic API responses | Real version/RBAC scope remains unverified |

## Known limitations

- Some Argo GET cache misses can cause ordinary server reconciliation; manifest GET can invoke existing server rendering. The extension does not request refresh or deployment mutations. Those calls were excluded from the limited live preflight.
- Multi-source overrides require recognizable official stable versions >=2.11. Unknown/pre-release builds are conservatively rejected. Responses merge all sources, rather than filtering to one source.
- Diff uses retained normalized/predicted pairs. Historical revision Diff, CLI Diff fallback, and client raw-JSON substitutes are not enabled. See [Diff semantics](diff-semantics.md).
- Logs lack a Pod UID request parameter. Fresh/periodic checks are not atomic binding. Explicit reconnection can overlap or lose lines, with no deduplication guarantee. The redaction dictionary covers at most 16 recently seen tokens, not all historical secrets.
- AppSet events are absent from the reviewed v3.1.8 Swagger but existed on the main branch examined; 404/403 degrades explicitly. Generated-application navigation requires explicit Application Namespace.
- v3.1.8 canSync reflects manual-sync windows, not automatic-sync or RBAC permission. The extension cannot Sync.
- Snapshot/cache/task/log budgets are finite. Failures are not empty-success or healthy states.
- The SDK has no explicit remote instance ID or atomic target-bound compose. UUIDs, identity epochs, retired views, and confirmation rechecks block observed changes, not all races.
- Work Status is optional and uses explicit limited snapshot reads, not continuous/bulk background observation.
- Changing UI language retains only the application-list snapshot/filter state, stops active operations/logs, and clears detail/evidence/summary previews. No additional Argo query is made just to translate the interface.

Update support conclusions only when [validation evidence](validation.md) changes. Test counts and checked boxes are not substitutes for real acceptance.
