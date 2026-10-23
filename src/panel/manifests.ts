import { mountButton, mountList, mountSelect, mountTextField } from './ui.js';
import { t } from './i18n.js';
import type { ApplicationDetail } from '../shared/applications.js';
import type { ComparisonList, ManifestList, ManifestSelection, ResourceComparison } from '../shared/manifests.js';
import type { Envelope } from '../shared/contracts.js';
import { queryTask, type PanelRequest } from './task-client.js';
import type { EvidenceStore } from './evidence.js';
import { mountIconButton } from './icon-button.js';
import { mountSections } from './sections.js';

function element<K extends keyof HTMLElementTagNameMap>(root: HTMLElement, tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = root.ownerDocument.createElement(tag); node.textContent = tag === 'pre' ? text : t(text); root.append(node); return node;
}
const labels = { equal: "Equal", different: "Different", unavailable: "Unavailable" } as const;
export function renderComparison(root: HTMLElement, item: ResourceComparison): void {
  element(root, 'h4', `${item.reference.kind} ${item.reference.namespace || '(cluster)'}/${item.reference.name} · ${t(labels[item.status])}`);
  element(root, 'p', t`Reason: ${item.reason} · server modified=${item.reportedModified ?? t("Not reported")}; redaction may hide changes. Identical visible fields do not override a server difference flag.`);
  if (item.status !== 'unavailable') element(root, 'pre', item.changedPaths.length ? t`Visible JSON Pointer change paths after redaction:
${item.changedPaths.map((path) => path || '(root)').join('\n')}` : t(item.status === 'different' ? "A difference exists, but redaction leaves no displayable change paths." : "The server-normalized comparison pair is equal; not proof of whole-application or live-cluster consistency."));
  const pair = element(root, 'div'); pair.className = 'manifest-columns';
  for (const [label, value] of [['Argo normalized Live', item.normalizedLive], ['Argo predicted Live', item.predictedLive]] as const) {
    const column = element(pair, 'section'); element(column, 'h4', label); element(column, 'pre', value === null ? t("null / absent; missing fields are explained by the unavailable-comparison reason") : JSON.stringify(value, null, 2));
  }
  const raw = element(root, 'details'); element(raw, 'summary', "View cached raw Live / Target (redacted; not used for comparison conclusions)");
  element(raw, 'h4', 'Cached Live'); element(raw, 'pre', JSON.stringify(item.live, null, 2));
  element(raw, 'h4', 'Cached Target'); element(raw, 'pre', JSON.stringify(item.target, null, 2));
}
export function mountManifests(root: HTMLElement, request: PanelRequest, context: string, application: ApplicationDetail, evidence?: EvidenceStore) {
  const disposers: Array<() => void> = []; const controllers = new Set<AbortController>();
  let disposed = false; let visible = false; let generation = 0; let revision = ''; let position = ''; let active = 'desired';
  let manifestExpires = 0; let comparisonExpires = 0; let editTimer: ReturnType<typeof setTimeout> | undefined;
  let manifestGeneration = 0; let comparisonGeneration = 0;
  let manifestController: AbortController | undefined; let comparisonController: AbortController | undefined;
  let manifestData: ManifestList | undefined; let comparisonData: ComparisonList | undefined;
  element(root, 'h3', "Manifests and Argo Diff");
  element(root, 'p', "Two independent queries: preview desired manifests at a revision, or read the server-retained Argo comparison. Preview revisions do not recompute Diff or request a forced refresh.").className = 'description';
  const nav = element(root, 'nav'); const desiredPane = element(root, 'section'); const diffPane = element(root, 'section');
  const form = element(desiredPane, 'div'); form.className = 'filter-grid';
  const revisionField = mountTextField(element(form, 'div'), { label: "Desired manifest revision (blank uses configured revision)", value: '', onChange: (value) => { revision = value; manifestExpires = 0; revisionField.update({ value }); clearTimeout(editTimer); manifestController?.abort(); editTimer = setTimeout(() => { editTimer = undefined; void loadManifests(true); }, 300); } });
  const sourceField = mountSelect(element(form, 'div'), { label: "Multi-source revision override position (not a result filter)", value: '', disabled: !application.multipleSources,
    options: [{ id: '', label: "No override; use all configured sources" }, ...application.sources.map((source, i) => ({ id: String(i + 1), label: `${i + 1}: ${source.name || source.ref || source.path || source.chart || source.type}` }))],
    onChange: (value) => { position = value; manifestExpires = 0; sourceField.update({ value }); clearTimeout(editTimer); editTimer = undefined; void loadManifests(true); },
  });
  const actions = element(nav, 'div'); actions.className = 'observer-toolbar';
  const manifestStatus = element(desiredPane, 'div'); manifestStatus.setAttribute('role', 'status');
  const manifestRoot = element(desiredPane, 'section'); manifestRoot.setAttribute('aria-label', t("Desired manifests"));
  const manifestListRoot = element(manifestRoot, 'div'); const manifestDetail = element(manifestRoot, 'section');
  const comparisonStatus = element(diffPane, 'div'); comparisonStatus.setAttribute('role', 'status');
  const comparisonRoot = element(diffPane, 'section'); comparisonRoot.setAttribute('aria-label', 'Argo Diff');
  const comparisonListRoot = element(comparisonRoot, 'div'); const comparisonDetail = element(comparisonRoot, 'section');
  const reload = mountIconButton(actions, { icon: 'reload', label: "Reload", onClick: () => { if (active === 'desired') void loadManifests(true); else void loadComparison(true); } });
  const tabs = mountSections(nav, [{ id: 'desired', label: "Desired manifests", pane: desiredPane }, { id: 'diff', label: 'Argo Diff', pane: diffPane }], active, (id) => { stop(); active = id; if (id === 'desired') void loadManifests(); else void loadComparison(); });
  const cancelButton = mountButton(actions, { label: "Stop manifest/Diff queries", variant: 'ghost', onClick: () => { stop(); manifestExpires = 0; comparisonExpires = 0; for (const node of root.querySelectorAll<HTMLElement>('[data-comparison-age]')) node.dataset.expires = '0'; paintAges(); element(manifestStatus, 'p', "Query stopped; retained content is an old snapshot."); } });
  function selectManifest(id: string): void {
    const item = manifestData?.items.find((item) => item.id === id); if (!item) return;
    manifestList.update({ selectedId: id }); manifestDetail.replaceChildren();
    element(manifestDetail, 'h4', `${item.reference.kind} ${item.reference.namespace || t("(Namespace unspecified)")}/${item.reference.name || '(generateName)'}`);
    element(manifestDetail, 'p', "Read-only, redacted preview. Not proof of deployment; an absent Namespace is not inferred to be the destination Namespace.");
    element(manifestDetail, 'pre', JSON.stringify(item.manifest, null, 2));
  }
  const manifestList = mountList(manifestListRoot, { items: [], ariaLabel: "Desired manifest resources", emptyText: "No desired manifests loaded", onSelect: selectManifest });
  function selectComparison(id: string): void {
    const item = comparisonData?.items.find((item) => item.id === id); if (!item) return;
    comparisonList.update({ selectedId: id }); comparisonDetail.replaceChildren(); renderComparison(comparisonDetail, item);
  }
  const comparisonList = mountList(comparisonListRoot, { items: [], ariaLabel: "Argo Diff resources", emptyText: "No Argo Diff loaded", onSelect: selectComparison });
  disposers.push(() => revisionField.dispose(), () => sourceField.dispose(), () => reload.dispose(), () => tabs.dispose(), () => cancelButton.dispose(), () => manifestList.dispose(), () => comparisonList.dispose());
  function stop(): void {
    generation++; clearTimeout(editTimer); editTimer = undefined; for (const controller of controllers) controller.abort(); controllers.clear();
    reload.update({ loading: false });
    paintAges();
  }
  function current(version: number, controller: AbortController): boolean { return !disposed && visible && version === generation && !controller.signal.aborted; }
  function show<T>(root: HTMLElement, response: Envelope<T>): response is Extract<Envelope<T>, { ok: true }> {
    root.replaceChildren();
    if (!response.ok) { element(root, 'p', `${response.error.code}: ${response.error.message}${t("; not an equal Diff or an empty manifest result.")}`); return false; }
    const node = element(root, 'p'); node.dataset.comparisonAge = t`Sampled at ${response.sampledAt} · ${response.source ?? 'argo-api'}`;
    node.dataset.expires = response.stale ? '0' : String(Date.parse(response.expiresAt ?? response.sampledAt)); paintAges();
    return true;
  }
  function paintAges(): void {
    for (const node of root.querySelectorAll<HTMLElement>('[data-comparison-age]')) {
      const stale = !visible || Number(node.dataset.expires) <= Date.now(); node.className = stale ? 'snapshot-stale' : 'description';
      node.textContent = `${node.dataset.comparisonAge} · ${t(stale ? "Stale/stopped" : "Time-limited snapshot (not live)")}`;
    }
  }
  async function loadManifests(force = false): Promise<void> {
    if (!visible || disposed || active !== 'desired' || root.ownerDocument.hidden) return;
    if (!force && (manifestController && controllers.has(manifestController) && !manifestController.signal.aborted || manifestData && manifestExpires > Date.now())) return;
    const selection: ManifestSelection = {};
    if (application.multipleSources && Boolean(position) !== Boolean(revision.trim())) { manifestStatus.replaceChildren(); element(manifestStatus, 'p', "A multi-source override requires both source position and revision; no request sent."); return; }
    if (application.multipleSources && position) selection.sources = [{ position: Number(position), revision }];
    else if (revision.trim()) selection.revision = revision;
    manifestController?.abort(); const controller = new AbortController(); manifestController = controller; controllers.add(controller);
    const version = generation; const requestVersion = ++manifestGeneration;
    manifestData = undefined; manifestList.update({ items: [], selectedId: null }); manifestDetail.replaceChildren(); manifestStatus.replaceChildren(); element(manifestStatus, 'p', "Generating/reading desired manifests…"); reload.update({ loading: true });
    try {
      const response = await queryTask<ManifestList>(request, { operation: 'manifests', context, name: application.name, appNamespace: application.appNamespace, selection }, controller.signal);
      if (!current(version, controller) || requestVersion !== manifestGeneration || !show(manifestStatus, response)) return;
      manifestData = response.data; manifestExpires = response.stale ? 0 : Date.parse(response.expiresAt ?? response.sampledAt); element(manifestStatus, 'p', response.data.note);
      element(manifestStatus, 'p', t`Requested selection ${JSON.stringify(response.data.selection)} · Server resolved revision: ${response.data.resolvedRevision || t("Not reported; not inferred")}`);
      if (response.data.warnings.length) element(manifestStatus, 'p', response.data.warnings.join(', '));
      manifestList.update({ emptyText: "Server generation returned no items; not proof of deployment or equal Diff", items: response.data.items.map((item) => ({ id: item.id, title: `${item.reference.kind} ${item.reference.namespace || t("(Namespace unspecified)")}/${item.reference.name || '(generateName)'}`, meta: `${item.reference.group || 'core'}/${item.reference.version}` })) });
      if (manifestData.items[0]) selectManifest(manifestData.items[0].id);
    } catch { if (current(version, controller)) { manifestStatus.replaceChildren(); element(manifestStatus, 'p', "Manifest read failed; not a successful empty result."); } }
    finally { controllers.delete(controller); if (current(version, controller) && requestVersion === manifestGeneration) reload.update({ loading: false }); }
  }
  async function loadComparison(force = false): Promise<void> {
    if (!visible || disposed || active !== 'diff' || root.ownerDocument.hidden) return;
    if (!force && (comparisonController && controllers.has(comparisonController) && !comparisonController.signal.aborted || comparisonData && comparisonExpires > Date.now())) return;
    comparisonController?.abort(); const controller = new AbortController(); comparisonController = controller; controllers.add(controller);
    const version = generation; const requestVersion = ++comparisonGeneration;
    comparisonData = undefined; comparisonList.update({ items: [], selectedId: null }); comparisonDetail.replaceChildren(); comparisonStatus.replaceChildren(); element(comparisonStatus, 'p', "Reading Argo comparison cache…"); reload.update({ loading: true });
    try {
      const response = await queryTask<ComparisonList>(request, { operation: 'comparison', context, name: application.name, appNamespace: application.appNamespace }, controller.signal);
      if (!current(version, controller) || requestVersion !== comparisonGeneration || !show(comparisonStatus, response)) return;
      comparisonData = response.data; comparisonExpires = response.stale ? 0 : Date.parse(response.expiresAt ?? response.sampledAt); element(comparisonStatus, 'p', response.data.note);
      evidence?.comparison(response);
      element(comparisonStatus, 'p', t`Application state sampled separately at ${response.data.applicationObservation.sampledAt} · reconciledAt ${response.data.applicationObservation.reconciledAt || t("Unknown")} · Observed revisions ${response.data.applicationObservation.comparedRevisions.join(', ') || t("Unknown")}`);
      if (response.data.applicationObservation.blocked) element(comparisonStatus, 'p', "The sampled application reports comparison errors or unknown Sync; all resource comparisons are unavailable.");
      comparisonList.update({ emptyText: "No comparable resources in this cache; not proof of an equal application", items: response.data.items.map((item) => ({ id: item.id, title: `${item.reference.kind} ${item.reference.namespace || '(cluster)'}/${item.reference.name}`, meta: `${t(labels[item.status])} · ${item.reason}` })) });
      if (comparisonData.items[0]) selectComparison(comparisonData.items[0].id);
    } catch { if (current(version, controller)) { comparisonStatus.replaceChildren(); element(comparisonStatus, 'p', "Argo Diff read failed; equality cannot be determined."); } }
    finally { controllers.delete(controller); if (current(version, controller) && requestVersion === comparisonGeneration) reload.update({ loading: false }); }
  }
  const timer = setInterval(paintAges, 1000); disposers.push(() => clearInterval(timer));
  return {
    setVisible(value: boolean): void { if (disposed || visible === value) return; visible = value; if (!value) stop(); else if (active === 'desired') void loadManifests(); else void loadComparison(); },
    dispose(): void { if (disposed) return; disposed = true; stop(); for (const dispose of disposers) dispose(); root.replaceChildren(); },
  };
}
