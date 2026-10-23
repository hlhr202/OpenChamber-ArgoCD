import { mountButton, mountSelect, mountSwitch, mountTextField } from './ui.js';
import { t, formatTime } from './i18n.js';
import type { ApplicationDetail, ApplicationFilters, ApplicationList, ApplicationSummary, SourceDetail } from '../shared/applications.js';
import { filterApplications } from '../shared/filters.js';
import { queryTask, type PanelRequest } from './task-client.js';
import { mountResources } from './resources.js';
import { mountManifests } from './manifests.js';
import { mountWindowStatus } from './management.js';
import type { ApplicationReference } from '../shared/resources.js';
import type { EvidenceStore } from './evidence.js';
import { mountSections } from './sections.js';
import { mountIconButton } from './icon-button.js';
import { mountApplicationList } from './application-list.js';
import { mountSplitView } from './split-view.js';
import { filterChoices, type ChoiceFilter } from './application-filters.js';
import type { ApplicationNavigationState } from './navigation-state.js';

export type { PanelRequest } from './task-client.js';
export interface ApplicationViewState {
  applications: ApplicationSummary[]; filters: ApplicationFilters;
  snapshot: { sampledAt: string; expiresAt: string; source: string } | null; forceStale: boolean;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = tag === 'pre' ? text : t(text);
  parent?.append(node);
  return node;
}
function fields(parent: HTMLElement, values: Record<string, string>): void {
  const list = element('dl', '', parent);
  for (const [label, value] of Object.entries(values)) {
    element('dt', t(label), list);
    element('dd', '', list).textContent = value || '—';
  }
}
function sources(parent: HTMLElement, values: SourceDetail[]): void {
  for (const source of values) {
    const section = element('details', '', parent);
    element('summary', `${source.type} · ${source.name || source.chart || source.path || source.repoURL}`, section);
    fields(section, { "Repository": source.repoURL, "Path / Chart": source.path || source.chart, "Target revision": source.targetRevision, "Reference": source.ref });
    if (source.helm) fields(section, {
      'Helm release': source.helm.releaseName, 'Value files': source.helm.valueFiles.join(', '),
      "Parameter names (values withheld)": source.helm.parameterNames.join(', '), "File parameter names (values withheld)": source.helm.fileParameterNames.join(', '),
      "Inline values present (contents withheld)": String(source.helm.hasInlineValues), "valuesObject present (contents withheld)": String(source.helm.hasValuesObject),
    });
    if (source.kustomize) fields(section, {
      'Kustomize version': source.kustomize.version, "Name prefix / suffix": `${source.kustomize.namePrefix} / ${source.kustomize.nameSuffix}`,
      'Namespace': source.kustomize.namespace, 'Images': source.kustomize.images.join(', '), 'Components': source.kustomize.components.join(', '),
      'Common label keys': source.kustomize.commonLabelKeys.join(', '), 'Common annotation keys': source.kustomize.commonAnnotationKeys.join(', '),
      "Patch count (contents withheld)": String(source.kustomize.patchCount),
    });
  }
}

export function renderApplicationDetail(root: HTMLElement, app: ApplicationDetail, options: { heading?: boolean } = {}): void {
  root.replaceChildren();
  root.classList.add('application-overview');
  if (options.heading !== false) element('h2', `${app.appNamespace}/${app.name}`, root);
  fields(root, {
    'Sync': app.syncKnown ? app.sync : t`${app.sync} (unrecognized state)`,
    'Health': app.healthKnown ? app.health : t`${app.health} (unrecognized state)`, 'Project': app.project,
    "Destination Namespace": app.destination.namespace,
    "Destination cluster": app.destination.name || app.destination.server, "Compared revisions": app.comparedRevisions.join(', '),
  });
  if (app.operation && app.operation.phase !== 'Succeeded') {
    const alert = element('section', '', root); alert.className = 'application-operation-alert';
    fields(alert, { "Phase": app.operation.phase, "Application sync retries": String(app.operation.retryCount) }); element('pre', app.operation.message, alert);
  }
  else if (app.operation) fields(root, { "Application sync retries": String(app.operation.retryCount) });
  element('h3', `Conditions · ${app.conditions.length}`, root);
  if (!app.conditions.length) element('p', "No reported Conditions; this does not prove the application is healthy.", root);
  for (const condition of app.conditions) {
    const section = element('section', '', root);
    element('h4', `${condition.type} · ${condition.lastTransitionTime || t("Time unknown")}`, section);
    element('pre', condition.message, section);
  }
  const configuration = element('details', '', root); configuration.className = 'application-disclosure'; element('summary', "Sources and configuration", configuration);
  fields(configuration, { 'Application Namespace': app.appNamespace, "Latest retained deployment revisions": app.lastDeploymentRevisions.join(', '), "Latest retained deployment time": app.lastDeploymentAt, "Last Argo reconciliation": app.reconciledAt });
  element('p', "To protect sensitive configuration, Helm values/parameter values, Kustomize patches/annotation values and plugin environment values are withheld.", configuration).className = 'description';
  sources(configuration, app.sources);
  const operation = element('details', '', root); operation.className = 'application-disclosure'; element('summary', "Operation", operation);
  if (!app.operation) element('p', "No operation status reported.", operation);
  else {
    fields(operation, { "Phase": app.operation.phase, "Started": app.operation.startedAt, "Finished": app.operation.finishedAt, "Retries": String(app.operation.retryCount), 'revisions': app.operation.revisions.join(', ') });
    element('pre', app.operation.message, operation);
    for (const resource of app.operation.resources) {
      const section = element('details', '', operation);
      element('summary', `${resource.kind} ${resource.namespace}/${resource.name} · ${resource.status || 'Unknown'}`, section);
      fields(section, { 'Group': resource.group, 'Sync phase': resource.syncPhase, 'Hook phase': resource.hookPhase });
      element('pre', resource.message, section);
    }
  }
  const historyRoot = element('details', '', root); historyRoot.className = 'application-disclosure'; element('summary', "Deployment history (retained server records only)", historyRoot);
  if (!app.history.length) element('p', "No retained deployment history.", historyRoot);
  for (const history of [...app.history].reverse()) {
    const section = element('details', '', historyRoot);
    element('summary', `#${history.id} · ${history.deployedAt || t("Time unknown")} · ${history.revisions.join(', ')}`, section);
    fields(section, { "Started": history.deployStartedAt, "Completed": history.deployedAt, "Initiated by": history.initiatedBy.automated ? t("Automated") : history.initiatedBy.username });
    sources(section, history.sources);
  }
}

export function mountApplications(root: HTMLElement, request: PanelRequest, options: { now?: () => number; tickMs?: number; refreshMs?: number; copy?: (text: string) => Promise<void>; evidence?: EvidenceStore; toolbar?: HTMLElement; diagnosticRoot?: HTMLElement; changed?: () => void } = {}) {
  const document = root.ownerDocument;
  root.classList.add('applications-view');
  const actions = options.toolbar ?? element('div', '', root); actions.classList.add('observer-toolbar'); actions.setAttribute('role', 'toolbar'); actions.setAttribute('aria-label', t("Application toolbar"));
  const advanced = element('details', '', options.diagnosticRoot ?? root); element('summary', "More query options", advanced);
  const advancedActions = element('div', '', advanced);
  const status = element('p', "Load contexts to display applications automatically.", root);
  status.setAttribute('role', 'status');
  const filterRoot = element('details', '', root);
  filterRoot.className = 'application-filters';
  element('summary', "Filter applications", filterRoot);
  const clearRoot = element('div', '', filterRoot); clearRoot.className = 'filter-clear';
  const filterGrid = element('div', '', filterRoot);
  filterGrid.className = 'filter-grid';
  const metrics = element('div', '', root); metrics.className = 'application-metrics';
  const counts = element('span', '', metrics);
  const snapshotStatus = element('span', '', metrics);
  const columns = element('div', '', root);
  const split = mountSplitView(columns, { changed: () => options.changed?.(), showList: () => { if (detailTab === 'resources') detailTabs?.select('overview'); } }); const listRoot = split.list; const detailRoot = split.detail;
  const disposers: Array<() => void> = [];
  let context = '';
  let enabled = false;
  let generation = 0;
  let detailGeneration = 0;
  let applications: ApplicationSummary[] = [];
  let selected = '';
  let snapshot: { sampledAt: string; expiresAt: string; source: string } | null = null;
  let detailSnapshot: { sampledAt: string; expiresAt: string; source: string } | null = null;
  let detailAgeNode: HTMLElement | undefined;
  let resourceView: ReturnType<typeof mountResources> | undefined;
  let manifestView: ReturnType<typeof mountManifests> | undefined;
  let windowView: ReturnType<typeof mountWindowStatus> | undefined;
  let detailTabs: ReturnType<typeof mountSections> | undefined; let detailTab = 'overview';
  let active = true;
  let forceStale = false;
  let busy = false;
  let automatic = false;
  let lastAttemptAt = 0;
  let activeTask: AbortController | undefined;
  let intersecting = true;
  let disposed = false;
  let pendingContextLoad = false; let wasPaused = false;
  let pendingNavigation: ApplicationNavigationState | undefined;
  let selectedReference: ApplicationReference | null = null;
  let openingNavigation: ApplicationNavigationState | undefined;
  const hidden = () => document.hidden || !intersecting || !active;
  const now = options.now ?? Date.now;
  const filters: ApplicationFilters = {};
  const filterUpdates = new Map<string, (value: string) => void>();
  const queryButton = mountIconButton(actions, { icon: 'reload', label: "Reload applications", tooltip: "Read applications again without requesting an Argo refresh", disabled: true, onClick: () => { void load(false, true); } });
  const backgroundButton = mountButton(advancedActions, { label: "Query applications in background", disabled: true, variant: 'secondary', onClick: () => { void load(true); } });
  const cancelButton = mountButton(advancedActions, { label: "Cancel background query", disabled: true, variant: 'ghost', onClick: () => {
    generation++; activeTask?.abort(); activeTask = undefined; busy = false; forceStale = true;
    queryButton.update({ loading: false }); backgroundButton.update({ loading: false }); cancelButton.update({ disabled: true });
    status.textContent = t("Background query cancelled. Existing snapshots do not represent the current state."); paintSnapshot();
  } });
  const autoSwitch = mountSwitch(advancedActions, { label: "Update every 15 seconds (visible only)", checked: false, disabled: true,
    onChange: (value) => { setAutomatic(value); },
  });
  const autoButton = mountIconButton(actions, { icon: 'clock', label: "Auto-update applications", tooltip: "Auto-update: off (every 15 seconds, visible only)", pressed: false, disabled: true, onClick: () => setAutomatic(!automatic) });
  function setAutomatic(value: boolean): void { automatic = value; autoSwitch.update({ checked: value }); autoButton.update({ pressed: value, tooltip: t`Auto-update: ${t(value ? "on" : "off")} (every 15 seconds, visible only)` }); }
  const list = mountApplicationList(listRoot, (id) => { pendingNavigation = undefined; void detail(id); });
  const clearButton = mountIconButton(clearRoot, { icon: 'reset', label: "Clear filters", onClick: () => { pendingNavigation = undefined; for (const key of Object.keys(filters)) delete filters[key as keyof ApplicationFilters]; for (const update of filterUpdates.values()) update(''); updateChoices(); paint(); options.changed?.(); } });
  disposers.push(() => queryButton.dispose(), () => backgroundButton.dispose(), () => cancelButton.dispose(), () => autoSwitch.dispose(), () => autoButton.dispose(), () => clearButton.dispose(), () => list.dispose(), () => split.dispose(), () => advanced.remove());

  const searchRoot = element('div', '', root); searchRoot.className = 'application-search'; root.insertBefore(searchRoot, filterRoot);
  const nameField = mountTextField(searchRoot, { label: "Application name", placeholder: "Search applications…", value: '', onChange: (value) => { pendingNavigation = undefined; filters.name = value; nameField.update({ value }); paint(); options.changed?.(); } });
  disposers.push(() => nameField.dispose()); filterUpdates.set('name', (value) => nameField.update({ value }));
  const choiceFields = new Map<ChoiceFilter, ReturnType<typeof mountSelect>>();
  for (const [key, label] of [['project', 'Project'], ['cluster', "Cluster"], ['appNamespace', 'Application Namespace'], ['destinationNamespace', "Destination Namespace"], ['repo', "Repository"], ['sync', 'Sync'], ['health', 'Health'], ['selector', "Labels"]] as const) {
    const field = mountSelect(element('div', '', filterGrid), {
      label, value: '', options: [{ id: '', label: "All" }], searchable: true, searchPlaceholder: t`Search ${t(label)}…`,
      onChange: (value) => { pendingNavigation = undefined; filters[key] = value; field.update({ value }); if (key === 'selector') expressionField.update({ value }); paint(); options.changed?.(); },
    });
    choiceFields.set(key, field); disposers.push(() => field.dispose());
    filterUpdates.set(key, (value) => field.update({ value }));
  }
  const expressionRoot = element('details', '', filterRoot); expressionRoot.className = 'advanced-label-filter'; element('summary', "Advanced label selector", expressionRoot);
  const expressionField = mountTextField(element('div', '', expressionRoot), { label: "Label selector (advanced)", placeholder: "For example env in (production,staging)…", value: '', onChange: (value) => { pendingNavigation = undefined; filters.selector = value; expressionField.update({ value }); updateChoices(); paint(); options.changed?.(); } });
  disposers.push(() => expressionField.dispose()); filterUpdates.set('selector', (value) => { expressionField.update({ value }); choiceFields.get('selector')?.update({ value }); });
  function updateChoices(): void {
    for (const [key, field] of choiceFields) {
      const values = filterChoices(applications, key); const value = filters[key] ?? '';
      if (value && !values.some((item) => item.id === value)) values.push({ id: value, label: value, hint: t("Current filter value") });
      field.update({ value, options: [{ id: '', label: "All" }, ...values] });
    }
  }

  function clear(): void {
    detailGeneration++;
    applications = []; selected = ''; split.reset(); updateChoices();
    snapshot = null; forceStale = false; paintSnapshot();
    detailSnapshot = null; detailAgeNode = undefined;
    list.update({ items: [], selectedId: null, emptyText: "No current query results" });
    counts.textContent = '';
    clearDetail();
  }
  function clearDetail(): void {
    split.setHeader();
    split.setDetailOnly(false);
    root.dataset.resourceFocus = 'false';
    selectedReference = null; openingNavigation = undefined;
    resourceView?.dispose(); resourceView = undefined;
    manifestView?.dispose(); manifestView = undefined;
    windowView?.dispose(); windowView = undefined;
    detailTabs?.dispose(); detailTabs = undefined; options.evidence?.reset(context);
    detailRoot.replaceChildren(); detailSnapshot = null; detailAgeNode = undefined;
  }
  function paint(reconcile = false): void {
    filterRoot.dataset.active = String(Object.entries(filters).filter(([key, value]) => key !== 'name' && value).length);
    let visible: ApplicationSummary[];
    try { visible = filterApplications(applications, filters); }
    catch {
      detailGeneration++; selected = ''; clearDetail();
      list.update({ items: [], selectedId: null, emptyText: "Invalid label selector" });
      counts.textContent = t("The filter is invalid; this is not an empty query result."); split.reset(); return;
    }
    if (!(reconcile ? applications : visible).some((app) => app.id === selected)) { selected = ''; detailGeneration++; clearDetail(); split.reset(); }
    counts.textContent = t`Showing ${visible.length} / ${applications.length} · OutOfSync ${visible.filter((app) => app.sync === 'OutOfSync').length} · Degraded/Missing ${visible.filter((app) => ['Degraded', 'Missing'].includes(app.health)).length} · Unknown ${visible.filter((app) => !app.healthKnown || !app.syncKnown || app.health === 'Unknown').length} · With Conditions ${visible.filter((app) => app.conditionsCount).length}`;
    counts.title = counts.textContent;
    list.update({ selectedId: selected || null, emptyText: "No applications match the current filters", items: visible });
  }
  function paintSnapshot(): void {
    if (!snapshot) { snapshotStatus.textContent = ''; snapshotStatus.removeAttribute('title'); root.dataset.stale = 'true'; }
    else {
      const stale = forceStale || Date.parse(snapshot.expiresAt) <= now() || hidden();
      root.dataset.stale = String(stale);
      snapshotStatus.className = stale ? 'snapshot-stale' : 'description';
      snapshotStatus.textContent = `${t(stale ? "Stale" : "Snapshot")} · ${formatTime(snapshot.sampledAt)}`;
      snapshotStatus.title = t`Snapshot sampled at ${snapshot.sampledAt} · Source ${snapshot.source} · ${t(stale ? "Current state not verified" : "Not continuously live")}`;
    }
    if (detailSnapshot && detailAgeNode) {
      const old = hidden() || forceStale || Date.parse(detailSnapshot.expiresAt) <= now();
      detailAgeNode.className = `application-detail-age ${old ? 'snapshot-stale' : 'description'}`;
      detailAgeNode.title = t`Detail sampled at ${detailSnapshot.sampledAt} · Source ${detailSnapshot.source} · ${t(old ? "Stale" : "Time-limited snapshot")}`;
      detailAgeNode.textContent = `${t("Application overview")} · ${t(old ? "Stale" : "Snapshot")} · ${formatTime(detailSnapshot.sampledAt)}`;
    }
  }
  function invalidateSensitive(code: string): boolean {
    return ['AUTH_REQUIRED', 'FORBIDDEN', 'NETWORK_DISABLED', 'CONFIG_MISSING', 'CONFIG_INVALID', 'CONTEXT_NOT_FOUND', 'UNSUPPORTED'].includes(code);
  }
  async function load(background = false, navigation = false): Promise<void> {
    if (!enabled || !context || (navigation ? document.hidden : hidden()) || busy) return;
    const version = ++generation;
    busy = true; lastAttemptAt = now(); forceStale = true; paintSnapshot();
    queryButton.update({ loading: !background }); backgroundButton.update({ loading: background });
    activeTask = background ? new AbortController() : undefined;
    cancelButton.update({ disabled: !background });
    status.textContent = t("Reading applications; no forced Argo refresh.");
    status.hidden = false;
    try {
      const response = background
        ? await queryTask<ApplicationList>(request, { operation: 'applications', context, filters: {} }, activeTask!.signal)
        : await request<ApplicationList>('/v1/applications', { context });
      if (version !== generation) return;
      if (!response.ok) {
        if (invalidateSensitive(response.error.code)) clear();
        status.textContent = `${response.error.code}: ${response.error.message}${t("(no new valid snapshot)")}`; return;
      }
      applications = response.data.items; updateChoices();
      snapshot = { sampledAt: response.sampledAt, expiresAt: response.expiresAt ?? new Date(Date.parse(response.sampledAt) + 15_000).toISOString(), source: response.source ?? 'argo-api' };
      forceStale = response.stale;
      status.textContent = ''; status.hidden = true;
      paint(true);
      restoreSelection();
    } catch { if (version === generation) status.textContent = t("Query failed. Check host connection/authorization; application health is unknown."); }
    finally { if (version === generation) {
      busy = false; activeTask = undefined;
      queryButton.update({ loading: false }); backgroundButton.update({ loading: false }); cancelButton.update({ disabled: true }); paintSnapshot();
    } }
  }
  async function detail(id: string, reference?: ApplicationReference, navigation = false, restore?: ApplicationNavigationState): Promise<void> {
    const app = applications.find((item) => item.id === id) ?? (reference ? { ...reference, id } : undefined);
    if (!app || !enabled || (navigation ? document.hidden : hidden())) return;
    if (selected === id && detailTabs && !restore) { split.openDetail(); return; }
    selected = id; list.update({ selectedId: id }); split.openDetail();
    const version = ++detailGeneration;
    clearDetail(); element('p', "Reading details…", detailRoot);
    selectedReference = { name: app.name, appNamespace: app.appNamespace }; openingNavigation = restore;
    detailTab = restore?.detailTab ?? 'overview'; if (restore) split.restoreState(restore.split);
    options.changed?.();
    options.evidence?.reset(context, { name: app.name, appNamespace: app.appNamespace });
    try {
      const response = await request<ApplicationDetail>('/v1/application', { context, name: app.name, appNamespace: app.appNamespace });
      if (version !== detailGeneration) return;
      detailRoot.replaceChildren();
      if (!response.ok) { element('p', `${response.error.code}: ${response.error.message}`, detailRoot); return; }
      const header = element('header', '', detailRoot); header.className = 'application-detail-header';
      const title = element('h2', `${app.appNamespace}/${app.name}`, header); title.className = 'application-current-title'; title.title = title.textContent!;
      split.setHeader(header);
      const nav = element('nav', '', detailRoot); nav.className = 'application-tabs'; nav.setAttribute('aria-label', t("Application troubleshooting views"));
      const overview = element('section', '', detailRoot); const resources = element('section', '', detailRoot); const manifests = element('section', '', detailRoot); const windows = element('section', '', detailRoot);
      renderApplicationDetail(overview, response.data, { heading: false }); options.evidence?.app(response);
      detailSnapshot = { sampledAt: response.sampledAt, expiresAt: response.expiresAt ?? new Date(Date.parse(response.sampledAt) + 15_000).toISOString(), source: response.source ?? 'argo-api' };
      detailAgeNode = element('p', '', detailRoot); paintSnapshot();
      resourceView = mountResources(resources, request, context, { name: app.name, appNamespace: app.appNamespace }, response.data.project, { ...(options.copy ? { copy: options.copy } : {}), ...(options.evidence ? { evidence: options.evidence } : {}), ...(restore?.resources ? { initialState: restore.resources } : {}), changed: () => options.changed?.() });
      manifestView = mountManifests(manifests, request, context, response.data, options.evidence);
      windowView = mountWindowStatus(windows, request, { operation: 'applicationWindows', context, name: app.name, appNamespace: app.appNamespace });
      openingNavigation = undefined;
      detailTabs = mountSections(nav, [{ id: 'overview', label: "Application overview", pane: overview }, { id: 'resources', label: "Resources / Events / Logs", pane: resources }, { id: 'manifests', label: 'Manifest / Diff', pane: manifests }, { id: 'windows', label: "Sync windows", pane: windows }], detailTab, (id) => { detailTab = id; syncDetailVisibility(); options.changed?.(); });
      syncDetailVisibility();
    } catch { if (version === detailGeneration) { split.setHeader(); detailRoot.replaceChildren(); element('p', "Could not read details. Data from the previous application will not be shown.", detailRoot); } }
  }
  function syncDetailVisibility(): void {
    const resourceFocus = Boolean(detailTabs && detailTab === 'resources');
    split.setDetailOnly(resourceFocus); root.dataset.resourceFocus = String(resourceFocus);
    if (resourceFocus) split.openDetail();
    resourceView?.setVisible(!hidden() && detailTab === 'resources');
    manifestView?.setVisible(!hidden() && detailTab === 'manifests');
    windowView?.setVisible(!hidden() && detailTab === 'windows');
  }
  function visibility(): void {
    syncDetailVisibility();
    const paused = document.hidden || !active;
    if (paused && !wasPaused) {
      split.stopResize();
      generation++; detailGeneration++; activeTask?.abort(); activeTask = undefined; busy = false; forceStale = true;
      queryButton.update({ loading: false }); backgroundButton.update({ loading: false }); cancelButton.update({ disabled: true });
      if (enabled && context) status.textContent = t("Updates paused.");
    } else if (!paused && wasPaused && enabled && context) {
      status.textContent = t(snapshot ? "Visible again; showing the last application snapshot." : "You can reload applications.");
    }
    wasPaused = paused;
    if (!hidden() && pendingContextLoad) { pendingContextLoad = false; void load(false, true); }
    else if (!hidden()) restoreSelection();
    paintSnapshot();
  }
  document.addEventListener('visibilitychange', visibility);
  // Page Visibility alone does not detect an iframe hidden by host layout.
  // Observe this surface as well; lack of the API falls back to document
  // visibility, and real host hide/show behavior still needs E2E validation.
  const Observer = document.defaultView?.IntersectionObserver;
  if (Observer) {
    const observer = new Observer((entries) => { intersecting = entries[0]?.isIntersecting ?? false; visibility(); });
    observer.observe(root); disposers.push(() => observer.disconnect());
  }
  const ticker = setInterval(() => {
    paintSnapshot();
    if (automatic && snapshot && !hidden() && !busy && now() - lastAttemptAt >= (options.refreshMs ?? 15_000)) void load();
  }, options.tickMs ?? 1000);
  disposers.push(() => clearInterval(ticker), () => document.removeEventListener('visibilitychange', visibility));
  function restoreSelection(): void {
    if (!pendingNavigation || !snapshot || hidden()) return;
    const state = pendingNavigation; pendingNavigation = undefined;
    let visible: ApplicationSummary[];
    try { visible = filterApplications(applications, filters); } catch { return; }
    const app = visible.find((item) => item.name === state.selected?.name && item.appNamespace === state.selected.appNamespace);
    if (app) void detail(app.id, undefined, false, state);
    else { if (state.selected) split.restoreState({ ...state.split, collapsed: false, detailOpen: false }); options.changed?.(); }
  }
  function restoreNavigation(state: ApplicationNavigationState): void {
    pendingNavigation = structuredClone(state);
    for (const key of Object.keys(filters)) delete filters[key as keyof ApplicationFilters]; Object.assign(filters, state.filters);
    for (const [key, update] of filterUpdates) update(filters[key as keyof ApplicationFilters] ?? '');
    split.restoreState(state.split); updateChoices(); paint();
  }
  return {
    restoreNavigation,
    loadWhenVisible(): void { if (!enabled || !context) return; pendingContextLoad = true; if (!hidden()) { pendingContextLoad = false; void load(false, true); } },
    captureNavigation(): ApplicationNavigationState {
      return { filters: { ...filters }, selected: selectedReference ? { ...selectedReference } : pendingNavigation?.selected ?? null, detailTab: (pendingNavigation?.detailTab ?? detailTab) as ApplicationNavigationState['detailTab'], split: split.captureState(), resources: resourceView?.captureNavigation() ?? openingNavigation?.resources ?? pendingNavigation?.resources ?? null };
    },
    captureState(): ApplicationViewState { return structuredClone({ applications, filters, snapshot, forceStale }); },
    restoreState(state: ApplicationViewState): void {
      applications = structuredClone(state.applications); snapshot = structuredClone(state.snapshot); forceStale = state.forceStale;
      Object.assign(filters, state.filters); for (const [key, update] of filterUpdates) update(filters[key as keyof ApplicationFilters] ?? ''); updateChoices(); paint(); paintSnapshot();
      status.hidden = Boolean(snapshot); if (!snapshot) status.textContent = t("Select an available context.");
    },
    setVisible(value: boolean): void { active = value; visibility(); },
    search(next: ApplicationFilters): void {
      pendingNavigation = undefined;
      generation++; activeTask?.abort(); activeTask = undefined; busy = false; setAutomatic(false);
      for (const key of Object.keys(filters)) delete filters[key as keyof ApplicationFilters];
      Object.assign(filters, next); for (const [key, update] of filterUpdates) update(filters[key as keyof ApplicationFilters] ?? '');
      clear(); options.changed?.(); void load(false, true);
    },
    openReference(reference: ApplicationReference): void {
      pendingNavigation = undefined;
      generation++; activeTask?.abort(); activeTask = undefined; busy = false;
      queryButton.update({ loading: false }); backgroundButton.update({ loading: false }); cancelButton.update({ disabled: true });
      setAutomatic(false);
      void detail(`${reference.appNamespace}/${reference.name}`, reference, true);
    },
    setConnection(nextContext: string, networkEnabled: boolean, loadApplications = false, restore?: ApplicationNavigationState): void {
      pendingNavigation = undefined;
      for (const key of Object.keys(filters)) delete filters[key as keyof ApplicationFilters];
      for (const update of filterUpdates.values()) update('');
      generation++; activeTask?.abort(); activeTask = undefined; busy = false; clear(); context = nextContext; enabled = networkEnabled; setAutomatic(false);
      pendingContextLoad = false;
      queryButton.update({ disabled: !enabled || !context, loading: false });
      backgroundButton.update({ disabled: !enabled || !context, loading: false }); cancelButton.update({ disabled: true });
      autoSwitch.update({ disabled: !enabled || !context, checked: false });
      autoButton.update({ disabled: !enabled || !context }); status.hidden = false;
      status.textContent = t(enabled ? "Preparing applications…" : "Select an available context.");
      if (restore) restoreNavigation(restore);
      if (loadApplications && enabled && context) {
        if (document.hidden || !active) pendingContextLoad = true; else void load(false, true);
      }
    },
    dispose(): void { if (disposed) return; disposed = true; generation++; detailGeneration++; activeTask?.abort(); resourceView?.dispose(); manifestView?.dispose(); windowView?.dispose(); detailTabs?.dispose(); options.evidence?.reset(); for (const dispose of disposers) dispose(); root.replaceChildren(); },
  };
}
