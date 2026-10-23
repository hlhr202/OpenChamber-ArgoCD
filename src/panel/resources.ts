import { mountButton, mountSwitch } from './ui.js';
import { t, formatTime } from './i18n.js';
import type { Envelope } from '../shared/contracts.js';
import type { ApplicationReference, EventList, LiveResource, OrphanedMonitoring, ResourceNode, ResourceReference, ResourceTree } from '../shared/resources.js';
import { queryTask, type PanelRequest } from './task-client.js';
import { mountLogs } from './logs.js';
import type { EvidenceStore } from './evidence.js';
import { mountResourceNavigation } from './resource-navigation.js';
import { mountSplitView } from './split-view.js';
import { mountSections } from './sections.js';
import { mountIconButton } from './icon-button.js';
import type { ResourceNavigationState } from './navigation-state.js';

function element<K extends keyof HTMLElementTagNameMap>(root: HTMLElement, tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = root.ownerDocument.createElement(tag); node.textContent = tag === 'pre' ? text : t(text); root.append(node); return node;
}
function reference(node: ResourceNode): ResourceReference { return { group: node.group, version: node.version, kind: node.kind, namespace: node.namespace, name: node.name, uid: node.uid }; }
function error(root: HTMLElement, response: Extract<Envelope<unknown>, { ok: false }>): void {
  element(root, 'p', `${response.error.code}: ${response.error.message}${t(response.error.code === 'NOT_FOUND' ? "; the object may be deleted, inaccessible, or unsupported. This is not an empty result." : response.error.code === 'RESOURCE_CHANGED' ? "; the resource may have been deleted or recreated. Reload the resource tree." : '')}`);
}
function age(root: HTMLElement, response: Extract<Envelope<unknown>, { ok: true }>, compact = true): HTMLElement {
  const node = element(root, 'p'); node.className = 'description'; node.dataset.resourceSample = t`Sampled at ${response.sampledAt} · ${response.source ?? 'argo-api'}`;
  if (compact) node.dataset.compactSample = response.sampledAt;
  node.dataset.expires = response.stale ? '0' : String(Date.parse(response.expiresAt ?? response.sampledAt)); paintAges(root, true);
  return node;
}
function paintAges(root: HTMLElement, visible: boolean): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-resource-sample]')) {
    const stale = !visible || Number(node.dataset.expires) <= Date.now(); node.className = stale ? 'snapshot-stale' : 'description';
    node.title = `${node.dataset.resourceSample} · ${t(stale ? "Stale" : "Time-limited snapshot, not live state")}`;
    node.textContent = node.dataset.compactSample ? `${t(stale ? "Stale" : "Snapshot")} · ${formatTime(node.dataset.compactSample)}` : node.title;
  }
}
export function renderEvents(root: HTMLElement, value: EventList): void {
  element(root, 'p', t`${t(value.scope === 'related' ? "Deployment and related resource events" : value.scope === 'application-set' ? "ApplicationSet events (bodies withheld)" : value.scope === 'application' ? "Application events (not all child-resource events)" : value.instanceScoped ? "Events scoped to resource UID" : "Resource events (not UID-scoped)")}; subject to server retention and permissions.`).className = 'description';
  if (value.related) {
    const { resources, total, omitted } = value.related;
    element(root, 'p', t`Event queries succeeded: ${resources.filter((item) => !item.eventsError).length} / ${total}`).className = resources.some((item) => item.eventsError) || omitted ? 'snapshot-stale' : 'description';
    if (omitted) element(root, 'p', t`${omitted} resources omitted by the query limit; results are incomplete.`);
    for (const item of resources) {
      if (item.eventsError || item.liveError) element(root, 'p').textContent = `${item.resource.kind} ${item.resource.namespace}/${item.resource.name} · events: ${item.eventsError ?? 'OK'} · live: ${item.liveError ?? 'OK'}`;
      if (item.pod) {
        const section = element(root, 'section'); section.className = 'related-pod-status';
        element(section, 'strong').textContent = `Pod ${item.resource.name} · ${item.pod.phase}`;
        if (item.pod.reason || item.pod.message) element(section, 'pre', `${item.pod.reason} ${item.pod.message}`);
        for (const container of item.pod.containers) element(section, 'p', t`${container.name} · ${container.image} · ${container.phase} · Ready ${container.ready ?? t('Unknown')} · Restarts ${container.restarts ?? t('Unknown')} · ${container.reason} ${container.message}`);
      }
    }
  }
  element(root, 'p', 'Occurrence counts are aggregated Kubernetes events, not sync retries or container restarts. Events may predate this rollout; individual attempts cannot be reconstructed.').className = 'description';
  if (value.excludedCount) element(root, 'p', t`Excluded ${value.excludedCount} events with a different resource identity.`);
  if (!value.items.length) element(root, 'p', "No events in the current query scope; this does not prove there were no incidents.");
  for (const event of value.items) {
    const section = element(root, 'section'); section.className = 'resource-event'; section.dataset.type = event.type;
    element(section, 'h4').textContent = `${event.type} · ${event.reason || t("Reason unknown")} · ${event.resource.kind} ${event.resource.namespace || '(cluster)'}/${event.resource.name}`;
    element(section, 'strong', t`Occurrences: ${event.count ?? t('Unknown')}`).className = 'event-count';
    element(section, 'p', t`First ${event.firstTime || t("Unknown")} · Last ${event.lastTime || t("Unknown")} · Count ${event.count ?? t("Unknown")} · Source ${event.source || t("Unknown")}`);
    element(section, 'pre', value.scope === 'application-set' ? t(event.message) : event.message);
  }
}
export function renderLiveResource(root: HTMLElement, value: LiveResource): void {
  element(root, 'p', value.redactionNotice);
  if (value.pod) {
    element(root, 'h4', `Pod: ${value.pod.phase} · ${value.pod.reason}`); element(root, 'p').textContent = value.pod.message;
    for (const container of value.pod.containers) element(root, 'p', t`${container.name} · ${container.image} · ${container.phase} · Ready ${container.ready ?? t("Unknown")} · Restarts ${container.restarts ?? t("Unknown")} · ${container.reason} ${container.message}`);
  }
  element(root, 'pre', JSON.stringify(value.manifest, null, 2));
}

function renderPodOverview(root: HTMLElement, value: LiveResource): void {
  if (value.workload) {
    const workload = value.workload; const facts = element(root, 'dl'); facts.className = 'resource-facts';
    for (const [label, number] of [['Desired', workload.desired], ['Ready', workload.ready], ['Updated', workload.updated], ['Available', workload.available], ['Generation', workload.generation], ['Observed generation', workload.observedGeneration]] as const) {
      const field = element(facts, 'div'); element(field, 'dt', label); element(field, 'dd', String(number ?? t('Unknown')));
    }
    for (const condition of workload.conditions) { const section = element(root, 'section'); section.className = 'resource-problem'; element(section, 'strong').textContent = `${condition.type} · ${condition.status} · ${condition.reason}`; element(section, 'pre', condition.message); }
  }
  const pod = value.pod;
  if (pod) {
    const problems = pod.containers.filter((container) => container.reason || container.message);
    if (pod.reason || pod.message || problems.length) {
      const alert = element(root, 'section'); alert.className = 'resource-problem';
      if (pod.reason) element(alert, 'strong', pod.reason);
      if (pod.message) element(alert, 'pre', pod.message);
      for (const container of problems) { element(alert, 'strong', `${container.name} · ${container.reason || container.phase}`); if (container.message) element(alert, 'pre', container.message); }
    }
    const facts = element(root, 'dl'); facts.className = 'resource-facts';
    const knownReady = pod.containers.length && pod.containers.every((container) => container.ready !== null);
    const knownRestarts = pod.containers.length && pod.containers.every((container) => container.restarts !== null);
    for (const [label, text] of [['Pod', pod.phase || t("Unknown")], ['Ready', knownReady ? `${pod.containers.filter((container) => container.ready).length} / ${pod.containers.length}` : t("Unknown")], ["Restarts", knownRestarts ? String(pod.containers.reduce((sum, container) => sum + (container.restarts ?? 0), 0)) : t("Unknown")]]) {
      const field = element(facts, 'div'); element(field, 'dt', label); element(field, 'dd', text);
    }
    for (const container of pod.containers) {
      const row = element(root, 'details'); row.className = 'resource-container'; element(row, 'summary', `${container.name} · ${container.phase}`);
      element(row, 'p', t`${container.name} · ${container.image} · ${container.phase} · Ready ${container.ready ?? t("Unknown")} · Restarts ${container.restarts ?? t("Unknown")} · ${container.reason} ${container.message}`);
    }
  }
  const notice = element(root, 'details'); notice.className = 'resource-redaction'; element(notice, 'summary', "Redaction notice"); element(notice, 'p', value.redactionNotice);
}

/** Lazy, bounded resource browser. No requests at mount; entering a tab is the
 * read action. Deployment diagnostics inspect a bounded descendant subtree. */
export function mountResources(root: HTMLElement, request: PanelRequest, context: string, app: ApplicationReference, project: string, options: { copy?: (text: string) => Promise<void>; evidence?: EvidenceStore; initialState?: ResourceNavigationState; changed?: () => void } = {}) {
  const document = root.ownerDocument; root.classList.add('resource-workspace');
  let disposed = false; let visible = false; let generation = 0; let selectionVersion = 0; let section = 'tree'; let detailTab = 'overview';
  let pendingState = options.initialState ? structuredClone(options.initialState) : undefined;
  if (pendingState) section = pendingState.section;
  let tree: ResourceTree | undefined; let selected: ResourceNode | undefined; let treeStarted = false; let treeExpires = 0;
  let treeController: AbortController | undefined; let liveController: AbortController | undefined; let eventController: AbortController | undefined; let extraController: AbortController | undefined;
  let live: Extract<Envelope<LiveResource>, { ok: true }> | undefined; let events: Extract<Envelope<EventList>, { ok: true }> | undefined;
  let appEvents: Extract<Envelope<EventList>, { ok: true }> | undefined; let monitoring: Extract<Envelope<OrphanedMonitoring>, { ok: true }> | undefined;
  let detailTabs: ReturnType<typeof mountSections> | undefined; let logView: ReturnType<typeof mountLogs> | undefined;
  const detailDisposers: Array<() => void> = [];
  let includeRelated = true; let automatic = false; let lastUpdate = 0;
  const actions = element(root, 'div'); actions.className = 'resource-toolbar'; const nav = element(actions, 'nav');
  const treePane = element(root, 'section'); const appEventsRoot = element(root, 'section'); appEventsRoot.setAttribute('aria-label', t("Application events"));
  treePane.className = 'resource-tree-pane';
  const monitorStatus = element(root, 'section'); monitorStatus.setAttribute('role', 'status');
  const treeStatus = element(treePane, 'div'); treeStatus.className = 'resource-tree-status'; treeStatus.setAttribute('role', 'status');
  const columns = element(treePane, 'div'); const split = mountSplitView(columns, { resource: true, changed: () => options.changed?.(), showList: () => cancelSelected() }); const selection = split.detail;
  treePane.append(treeStatus);
  if (pendingState) split.restoreState(pendingState.split);
  const navigation = mountResourceNavigation(split.list, select, () => { clearSelection(); options.changed?.(); });
  let overview: HTMLElement | undefined; let eventPane: HTMLElement | undefined; let manifest: HTMLElement | undefined; let logs: HTMLElement | undefined;
  const refresh = mountIconButton(actions, { icon: 'reload', label: "Reload", onClick: () => { if (section === 'tree') void loadTree(); else void loadExtra(true); } });
  const auto = mountIconButton(actions, { icon: 'clock', label: 'Auto-update resource details', tooltip: 'Update every 15 seconds (visible only)', pressed: false, onClick: () => { automatic = !automatic; lastUpdate = Date.now(); auto.update({ pressed: automatic }); } });
  const tabs = mountSections(nav, [{ id: 'tree', label: "Application resource tree", pane: treePane }, { id: 'events', label: "Application events", pane: appEventsRoot }, { id: 'monitoring', label: "Orphaned", pane: monitorStatus }], section, (id) => {
    section = id; extraController?.abort(); extraController = undefined; refresh.update({ loading: false });
    if (id !== 'tree') { treeController?.abort(); treeController = undefined; if (!tree) treeStarted = false; cancelSelected(); }
    activate();
    options.changed?.();
  });
  const fresh = (sample: { stale: boolean; sampledAt: string; expiresAt?: string } | undefined) => Boolean(sample && !sample.stale && Date.parse(sample.expiresAt ?? sample.sampledAt) > Date.now());
  function usable(): boolean { return !disposed && visible && !document.hidden; }
  function cancelSelected(): void { liveController?.abort(); liveController = undefined; eventController?.abort(); eventController = undefined; logView?.setVisible(false); }
  function clearSelection(): void {
    split.setHeader(); columns.dataset.selected = 'false';
    selectionVersion++; cancelSelected(); selected = undefined; live = undefined; events = undefined;
    logView?.dispose(); logView = undefined; detailTabs?.dispose(); detailTabs = undefined;
    for (const dispose of detailDisposers.splice(0)) dispose(); options.evidence?.clearResource(); selection.replaceChildren(); split.reset();
  }
  function activate(): void {
    if (!usable()) return;
    if (section === 'tree') { if (!treeStarted || tree && treeExpires <= Date.now()) void loadTree(); else if (selected) void activateDetail(); } else void loadExtra();
  }
  async function loadTree(): Promise<void> {
    if (!usable() || section !== 'tree') return;
    treeController?.abort(); treeStarted = true;
    const version = ++generation; const controller = new AbortController(); treeController = controller;
    treeStatus.replaceChildren(); element(treeStatus, 'p', "Reading resource tree…"); refresh.update({ loading: true });
    try {
      const response = await queryTask<ResourceTree>(request, { operation: 'resourceTree', context, ...app }, controller.signal);
      if (!usable() || version !== generation || controller.signal.aborted) return; treeStatus.replaceChildren();
      if (!response.ok) { if (['AUTH_REQUIRED', 'FORBIDDEN', 'CONTEXT_NOT_FOUND', 'RESOURCE_CHANGED'].includes(response.error.code)) { clearSelection(); tree = undefined; navigation.clear(); options.evidence?.clearResources(); } error(treeStatus, response); return; }
      tree = response.data; treeExpires = response.stale ? 0 : Date.parse(response.expiresAt ?? response.sampledAt); navigation.setTree(tree); options.evidence?.tree(response);
      if (selected) {
        const current = tree.nodes.find((node) => node.id === selected!.id);
        if (current) selected = current;
        else { clearSelection(); options.changed?.(); }
      }
      const summary = element(treeStatus, 'span', t`${tree.nodes.length} resources`); summary.className = 'description'; age(treeStatus, response, true);
      const note = element(treeStatus, 'details'); element(note, 'summary', "More query options");
      element(note, 'p', t`${tree.nodes.length} resources · Orphan monitoring: ${t(tree.orphanedMonitoring === 'enabled' ? "server returned orphaned nodes" : "unknown; an empty list does not prove monitoring is enabled. Read Project settings")}`);
      if (tree.warnings.length) element(note, 'p', t`Topology warnings: ${tree.warnings.join(', ')}; multiple parents are preserved, cycle nodes appear once.`);
      if (pendingState) {
        const state = pendingState; pendingState = undefined;
        const node = tree.nodes.find((node) => state.selected && node.group === state.selected.group && node.kind === state.selected.kind && node.namespace === state.selected.namespace && node.name === state.selected.name && node.uid === state.selected.uid);
        if (node) { select(node.id, state); } else { split.restoreState({ ...state.split, detailOpen: false, collapsed: false }); options.changed?.(); }
      }
      if (selected) void activateDetail();
    } catch { if (usable() && version === generation && !controller.signal.aborted) { treeStatus.replaceChildren(); element(treeStatus, 'p', "Resource-tree query failed; this is not an empty result."); } }
    finally { if (treeController === controller) { treeController = undefined; refresh.update({ loading: false }); } }
  }
  async function loadExtra(force = false): Promise<void> {
    if (!usable() || section === 'tree' || extraController) return;
    const domain = section; const parent = domain === 'events' ? appEventsRoot : monitorStatus;
    if (!force && fresh(domain === 'events' ? appEvents : monitoring)) return;
    const controller = new AbortController(); extraController = controller; const version = generation;
    parent.replaceChildren(); element(parent, 'p', domain === 'events' ? "Reading application events…" : "Reading details…"); refresh.update({ loading: true });
    try {
      if (domain === 'events') {
        const response = await queryTask<EventList>(request, { operation: 'events', context, ...app }, controller.signal);
        if (!usable() || controller.signal.aborted || version !== generation || section !== domain) return;
        parent.replaceChildren(); if (!response.ok) error(parent, response); else { appEvents = response; renderEvents(parent, response.data); age(parent, response); options.evidence?.events(response); }
      } else {
        if (!project) { parent.replaceChildren(); element(parent, 'p', "Orphan-monitoring settings unknown; could not read Project settings."); return; }
        const response = await request<OrphanedMonitoring>('/v1/orphaned-monitoring', { context, project });
        if (!usable() || controller.signal.aborted || version !== generation || section !== domain) return;
        parent.replaceChildren(); if (!response.ok) error(parent, response); else { monitoring = response; element(parent, 'p', response.data.state === 'disabled' ? t("Orphan monitoring is disabled for this Project; no orphan nodes is not proof of no orphaned resources.") : t`Project orphan monitoring is enabled; warn=${response.data.warn ?? t("Default")}.`); age(parent, response); }
      }
    } catch { if (usable() && !controller.signal.aborted && version === generation) { parent.replaceChildren(); element(parent, 'p', domain === 'events' ? "Application-event query failed; this does not mean there are no events." : "Orphan-monitoring settings unknown; could not read Project settings."); } }
    finally { if (extraController === controller) { extraController = undefined; refresh.update({ loading: false }); } }
  }
  function select(id: string, restore?: ResourceNavigationState): void {
    const node = tree?.nodes.find((node) => node.id === id); if (!node || !usable()) return;
    if (selected?.id === id) { split.openDetail(); void activateDetail(); options.changed?.(); return; }
    pendingState = undefined; clearSelection(); selected = node; detailTab = restore?.detailTab ?? 'overview'; navigation.select(id); split.openDetail();
    includeRelated = true;
    if (restore) split.restoreState(restore.split);
    columns.dataset.selected = 'true';
    const path = element(selection, 'div'); path.className = 'resource-return-path'; split.setHeader(path); element(path, 'span', `${app.appNamespace}/${app.name}`);
    const identity = element(selection, 'header'); identity.className = 'resource-identity'; element(identity, 'h3', `${node.kind} · ${node.name}`);
    const coordinate = element(selection, 'p', `${node.namespace || '(cluster)'} · ${node.health}`); coordinate.className = 'resource-coordinate';
    const metadata = element(selection, 'details'); element(metadata, 'summary', "Related parents");
    element(metadata, 'p', t`UID ${node.uid || t("Unknown")} · Parents ${node.parents.length} · Images ${node.images.join(', ') || t("Unknown")}`);
    for (const id of node.parents) { const parent = tree?.nodes.find((item) => item.id === id); if (parent) { const button = mountButton(metadata, { label: `${parent.kind} ${parent.namespace || '(cluster)'}/${parent.name}`, variant: 'ghost', onClick: () => select(id) }); detailDisposers.push(() => button.dispose()); } }
    if (node.unresolvedParents) element(metadata, 'p', "Unresolved parent references");
    const detailNav = element(selection, 'nav'); detailNav.className = 'resource-detail-tabs'; overview = element(selection, 'section'); overview.setAttribute('aria-label', t("Live resource"));
    eventPane = element(selection, 'section'); eventPane.setAttribute('aria-label', t("Resource events"));
    manifest = element(selection, 'section'); manifest.setAttribute('aria-label', 'Live Manifest'); logs = element(selection, 'section');
    const reload = mountIconButton(identity, { icon: 'reload', label: "Reload resource details", onClick: () => { if (detailTab === 'logs') logView?.reload(); else void activateDetail(true); } }); detailDisposers.push(() => reload.dispose());
    if (node.kind === 'Deployment' && node.group === 'apps') {
      const toggle = mountSwitch(metadata, { label: 'Include related resource events', checked: true, onChange: (value) => { includeRelated = value; toggle.update({ checked: value }); events = undefined; void activateDetail(true); } }); detailDisposers.push(() => toggle.dispose());
    }
    selection.append(metadata);
    detailTabs = mountSections(detailNav, [{ id: 'overview', label: "Overview", pane: overview }, { id: 'events', label: "Resource events", pane: eventPane }, { id: 'manifest', label: 'Manifest', pane: manifest }, { id: 'logs', label: "Logs", pane: logs }], detailTab, (id) => { detailTab = id; logView?.setVisible(id === 'logs' && usable()); void activateDetail(); options.changed?.(); });
    void activateDetail();
    options.changed?.();
  }
  async function activateDetail(force = false): Promise<void> {
    if (!usable() || section !== 'tree' || !selected) return;
    if (detailTab === 'events') { await loadSelected('events', force); return; }
    const version = selectionVersion;
    await loadSelected('resource', force);
    if (version !== selectionVersion) return;
    if (detailTab === 'overview' && selected?.kind === 'Deployment' && selected.group === 'apps') await loadSelected('events', force);
    showLogs();
  }
  function showLogs(): void {
    if (!usable() || section !== 'tree' || detailTab !== 'logs' || !live || !selected || !logs) return;
    if (!logView) {
      if (!live.data.pod || live.data.reference.kind !== 'Pod' || live.data.reference.group) { logs.replaceChildren(); element(logs, 'p', "Logs are available for Pods only. Select a Pod."); return; }
      const spec = live.data.manifest.spec as Record<string, unknown> | undefined;
      const containers = [...new Set(['containers', 'initContainers', 'ephemeralContainers'].flatMap((key) => Array.isArray(spec?.[key]) ? (spec![key] as unknown[]).flatMap((value) => value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string' ? [(value as { name: string }).name] : []) : []))];
      logView = mountLogs(logs, request, context, app, live.data.reference, containers, { ...(options.copy ? { copy: options.copy } : {}), ...(options.evidence ? { selected: (value) => options.evidence!.logs(value), clearSelection: () => options.evidence!.clearLogs() } : {}) });
    }
    logView.setVisible(true);
  }
  async function loadSelected(operation: 'resource' | 'events', force: boolean): Promise<void> {
    if (!selected || !overview || !manifest || !eventPane) return;
    if (!force && (operation === 'resource' ? liveController || fresh(live) : eventController || fresh(events))) return;
    const node = selected; const version = selectionVersion; const parent = operation === 'resource' ? overview : eventPane; const controller = new AbortController();
    if (operation === 'resource') { liveController?.abort(); liveController = controller; } else { eventController?.abort(); eventController = controller; }
    if (operation === 'events') events = undefined;
    else {
      live = undefined; logView?.dispose(); logView = undefined; options.evidence?.clearLogs();
      manifest.replaceChildren(); element(manifest, 'p', "Reading Live details…");
      if (detailTab === 'logs' && logs) { logs.replaceChildren(); element(logs, 'p', "Reading Live details…"); }
    }
    parent.replaceChildren(); element(parent, 'p', operation === 'resource' ? "Reading Live details…" : "Reading resource events…");
    try {
      const response = operation === 'resource' ? await queryTask<LiveResource>(request, { operation, context, ...app, resource: reference(node) }, controller.signal) : await queryTask<EventList>(request, { operation: includeRelated && node.kind === 'Deployment' && node.group === 'apps' ? 'relatedEvents' : 'events', context, ...app, resource: reference(node) }, controller.signal);
      if (!usable() || controller.signal.aborted || version !== selectionVersion) return;
      parent.replaceChildren(); if (!response.ok) { error(parent, response); if (operation === 'resource') { live = undefined; manifest.replaceChildren(); error(manifest, response); if (detailTab === 'logs' && logs) { logs.replaceChildren(); error(logs, response); } } return; }
      if (operation === 'events') { events = response as Extract<Envelope<EventList>, { ok: true }>; renderEvents(parent, events.data); options.evidence?.events(events); }
      else {
        live = response as Extract<Envelope<LiveResource>, { ok: true }>; options.evidence?.live(live);
        const value = live.data; renderPodOverview(parent, value);
        if (node.kind === 'Deployment' && events) showDeploymentEvents();
        manifest.replaceChildren(); element(manifest, 'p', value.redactionNotice); element(manifest, 'pre', JSON.stringify(value.manifest, null, 2)); age(manifest, live);
        logView?.dispose(); logView = undefined;
        if (detailTab === 'logs') queueMicrotask(() => { if (!disposed && version === selectionVersion) showLogs(); });
      }
      age(parent, response);
    } catch { if (usable() && !controller.signal.aborted && version === selectionVersion) {
      parent.replaceChildren(); element(parent, 'p', "This section failed to load; other successful sections do not prove this one succeeded.");
      if (operation === 'resource') { manifest.replaceChildren(); element(manifest, 'p', "This section failed to load; other successful sections do not prove this one succeeded."); if (detailTab === 'logs' && logs) { logs.replaceChildren(); element(logs, 'p', "This section failed to load; other successful sections do not prove this one succeeded."); } }
    } }
    finally {
      if (operation === 'events' && version === selectionVersion && !controller.signal.aborted && overview && node.kind === 'Deployment') {
        showDeploymentEvents();
      }
      if (operation === 'resource' && liveController === controller) liveController = undefined; if (operation === 'events' && eventController === controller) eventController = undefined;
    }
  }
  function showDeploymentEvents(): void {
    if (!overview || !eventPane) return;
    overview.querySelector('.deployment-events')?.remove(); const summary = element(overview, 'details'); summary.className = 'deployment-events'; summary.open = true; element(summary, 'summary', 'Related resource events');
    summary.append(...[...eventPane.childNodes].map((node) => node.cloneNode(true)));
  }
  const ticker = setInterval(() => {
    paintAges(root, visible);
    if (automatic && usable() && !(section === 'tree' && detailTab === 'logs') && Date.now() - lastUpdate >= 15_000 && !treeController && !liveController && !eventController && !extraController) { lastUpdate = Date.now(); activate(); }
  }, 1000);
  return {
    captureNavigation(): ResourceNavigationState {
      return { selected: selected ? reference(selected) : pendingState?.selected ?? null, section: section as ResourceNavigationState['section'], detailTab: (pendingState?.detailTab ?? (detailTab === 'logs' ? 'overview' : detailTab)) as ResourceNavigationState['detailTab'], split: split.captureState() };
    },
    setVisible(value: boolean): void {
      if (disposed || visible === value) return; visible = value;
      if (!value) { generation++; selectionVersion++; treeController?.abort(); treeController = undefined; if (!tree) treeStarted = false; extraController?.abort(); extraController = undefined; cancelSelected(); split.stopResize(); refresh.update({ loading: false }); paintAges(root, false); }
      else activate();
    },
    dispose(): void { if (disposed) return; visible = false; generation++; treeController?.abort(); extraController?.abort(); clearSelection(); disposed = true; clearInterval(ticker); navigation.dispose(); split.dispose(); tabs.dispose(); refresh.dispose(); auto.dispose(); root.replaceChildren(); },
  };
}
