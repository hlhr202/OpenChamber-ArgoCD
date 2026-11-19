import { mountButton, mountList, mountSelect, mountTextField } from './ui.js';
import { t } from './i18n.js';
import type { ApplicationFilters } from '../shared/applications.js';
import type { Envelope } from '../shared/contracts.js';
import type { ApplicationSet, ApplicationSetChildren, Cluster, ManagementCommand, Project, Repository, WindowState } from '../shared/management.js';
import type { ApplicationReference, EventList } from '../shared/resources.js';
import { queryTask, type PanelRequest } from './task-client.js';
import { renderEvents } from './resources.js';
import { mountIconButton } from './icon-button.js';
import type { ActionResult } from '../shared/actions.js';
import { openConfirmDialog, openEditorDialog } from './action-dialogs.js';

function element<K extends keyof HTMLElementTagNameMap>(root: HTMLElement, tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = root.ownerDocument.createElement(tag); node.textContent = tag === 'pre' ? text : t(text); root.append(node); return node;
}
function response<T>(root: HTMLElement, value: Envelope<T>): value is Extract<Envelope<T>, { ok: true }> {
  if (!value.ok) { element(root, 'p', `${value.error.code}: ${value.error.message}${t("; not a successful empty result.")}${value.error.code === 'NOT_FOUND' ? t(" The endpoint may be unsupported, or the object deleted/inaccessible; do not infer that there are no events.") : ''}`); return false; }
  const node = element(root, 'p'); node.dataset.managementAge = t`Sampled at ${value.sampledAt} · ${value.source ?? 'argo-api'}`;
  node.dataset.expires = value.stale ? '0' : String(Date.parse(value.expiresAt ?? value.sampledAt)); paintAges(root, true); return true;
}
function paintAges(root: HTMLElement, visible: boolean): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-management-age]')) {
    const stale = !visible || Date.now() >= Number(node.dataset.expires); node.className = stale ? 'snapshot-stale' : 'description';
    node.textContent = `${node.dataset.managementAge} · ${t(stale ? "Stale/paused" : "Time-limited snapshot, not live state")}`;
  }
}
export function renderWindowState(root: HTMLElement, value: WindowState): void {
  element(root, 'p', value.note);
  element(root, 'h4', value.scope === 'application' ? t`Server canSync: ${value.canSync === null ? t("Unknown") : String(value.canSync)} (read-only observation)` : t("Server Project active windows (not application canSync)"));
  element(root, 'pre', JSON.stringify({ activeWindows: value.active, assignedWindows: value.assigned }, null, 2));
}
export function mountWindowStatus(root: HTMLElement, request: PanelRequest, command: Extract<ManagementCommand, { operation: 'applicationWindows' }>) {
  let generation = 0; let visible = false; let disposed = false; let controller: AbortController | undefined; let expires = 0;
  const output = element(root, 'section'); output.setAttribute('aria-label', t("Application sync windows"));
  const button = mountIconButton(root, { icon: 'reload', label: "Reload", onClick: () => { void load(); } });
  async function load(): Promise<void> {
    if (!visible || disposed) return; controller?.abort(); controller = new AbortController(); const local = controller; const version = ++generation;
    output.replaceChildren(); element(output, 'p', "Reading server window evaluation…"); button.update({ loading: true });
    try { const result = await queryTask<WindowState>(request, command, local.signal); if (version !== generation || local.signal.aborted) return; output.replaceChildren(); if (response(output, result)) { expires = result.stale ? 0 : Date.parse(result.expiresAt ?? result.sampledAt); renderWindowState(output, result.data); } }
    catch { if (version === generation) { output.replaceChildren(); element(output, 'p', "Sync windows unavailable; local time will not be used to infer sync eligibility."); } }
    finally { if (version === generation) button.update({ loading: false }); }
  }
  const timer = setInterval(() => paintAges(root, visible), 1000);
  return { setVisible(value: boolean): void { if (disposed || visible === value) return; visible = value; if (!value) { generation++; controller?.abort(); button.update({ loading: false }); paintAges(root, false); } else if (expires <= Date.now() && !root.ownerDocument.hidden) void load(); }, dispose(): void { if (disposed) return; disposed = true; generation++; controller?.abort(); clearInterval(timer); button.dispose(); root.replaceChildren(); } };
}

function editableProjectPayload(item: Project): Record<string, unknown> {
  return {
    metadata: {
      name: item.name,
      ...(item.namespace ? { namespace: item.namespace } : {}),
    },
    spec: {
      description: item.description,
      sourceRepos: item.sourceRepos,
      ...(item.sourceNamespaces.length ? { sourceNamespaces: item.sourceNamespaces } : {}),
      destinations: item.destinations.map((d) => ({
        ...(d.name ? { name: d.name } : {}),
        ...(d.server ? { server: d.server } : {}),
        ...(d.namespace ? { namespace: d.namespace } : {}),
      })),
      ...(item.rules.clusterAllow.length ? { clusterResourceWhitelist: item.rules.clusterAllow } : {}),
      ...(item.rules.clusterDeny.length ? { clusterResourceBlacklist: item.rules.clusterDeny } : {}),
      ...(item.rules.namespaceAllow.length ? { namespaceResourceWhitelist: item.rules.namespaceAllow } : {}),
      ...(item.rules.namespaceDeny.length ? { namespaceResourceBlacklist: item.rules.namespaceDeny } : {}),
      ...(item.roles.length ? { roles: item.roles } : {}),
      ...(item.syncWindows.length ? {
        syncWindows: item.syncWindows.map((w) => ({
          kind: w.kind,
          schedule: w.schedule,
          duration: w.duration,
          ...(w.timeZone ? { timeZone: w.timeZone } : {}),
          ...(w.applications.length ? { applications: w.applications } : {}),
          ...(w.namespaces.length ? { namespaces: w.namespaces } : {}),
          ...(w.clusters.length ? { clusters: w.clusters } : {}),
          ...(w.manualSync !== null ? { manualSync: w.manualSync } : {}),
          ...(w.andOperator !== null ? { andOperator: w.andOperator } : {}),
        })),
      } : {}),
    },
  };
}

type Domain = 'applicationSets' | 'projects' | 'repositories' | 'clusters';
type Row = ApplicationSet | Project | Repository | Cluster;
interface ManagementActionBinding { conn: number; context: string; epoch: string; selection?: number }

export function mountManagement(root: HTMLElement, request: PanelRequest, options: { applications?: (filters: ApplicationFilters) => void; application?: (ref: ApplicationReference) => void } = {}) {
  const document = root.ownerDocument; let context = ''; let enabled = false; let connectionGeneration = 0; let generation = 0; let selectionGeneration = 0; let disposed = false; let intersecting = true; let active = true;
  let domain: Domain = 'applicationSets'; let namespace = ''; let rows: Row[] = []; let currentEpoch = '';
  let createDialogController = new AbortController(); let detailDialogController = new AbortController();
  const resetCreateDialogs = () => { createDialogController.abort(); createDialogController = new AbortController(); };
  const resetDetailDialogs = () => { detailDialogController.abort(); detailDialogController = new AbortController(); };
  const controllers = new Set<AbortController>(); const selectedControllers = new Set<AbortController>(); const detailDisposers: Array<() => void> = [];
  const extraDisposers: Array<() => void> = []; let extraController: AbortController | undefined;
  const disposers: Array<() => void> = [];
  const hidden = () => document.hidden || !intersecting || !active;
  element(root, 'h2', "Management");
  element(root, 'p', "Modules load independently on demand. Denied or unsupported modules do not block applications. Generator values, template expressions, connection-error bodies and authentication settings are withheld.").className = 'description';
  const controls = element(root, 'div'); controls.className = 'filter-grid';
  const select = mountSelect(controls, { label: "Management module", value: domain, options: [{ id: 'applicationSets', label: 'ApplicationSet' }, { id: 'projects', label: 'Project' }, { id: 'repositories', label: t("Repository") }, { id: 'clusters', label: t("Cluster") }], onChange: (value) => { domain = value as Domain; select.update({ value }); reset(); namespaceField.update({ disabled: domain !== 'applicationSets' }); createBtn.update({ disabled: !enabled || !context || !['applicationSets', 'projects'].includes(domain) }); } });
  const namespaceField = mountTextField(controls, { label: "ApplicationSet Namespace (blank means server default, not all Namespaces)", value: '', onChange: (value) => { namespace = value; namespaceField.update({ value }); } });
  const status = element(root, 'section'); status.setAttribute('role', 'status');
  const listRoot = element(root, 'div'); const detail = element(root, 'section'); detail.setAttribute('aria-label', t("Management details"));
  const button = mountButton(controls, { label: "Read management data", disabled: true, onClick: () => { void load(); } });
  const createBtn = mountButton(controls, { label: "Create", disabled: true, variant: 'secondary', onClick: () => { void runCreate(); } });
  const list = mountList(listRoot, { ariaLabel: "Management entries", items: [], emptyText: "No management data loaded", onSelect: (id) => { void pick(id); } });
  disposers.push(() => createDialogController.abort(), () => detailDialogController.abort(), () => select.dispose(), () => namespaceField.dispose(), () => button.dispose(), () => createBtn.dispose(), () => list.dispose());
  function clearDetail(): void { selectionGeneration++; resetDetailDialogs(); for (const item of selectedControllers) { item.abort(); controllers.delete(item); } selectedControllers.clear(); for (const dispose of detailDisposers.splice(0)) dispose(); for (const dispose of extraDisposers.splice(0)) dispose(); detail.replaceChildren(); }
  function cancel(): void { generation++; for (const item of controllers) item.abort(); controllers.clear(); button.update({ loading: false }); }
  function reset(): void { resetCreateDialogs(); cancel(); clearDetail(); rows = []; list.update({ items: [], selectedId: null }); status.replaceChildren(); element(status, 'p', t`Context: ${context || t("Not selected")}; click to query, no automatic connection.`); }
  function current(version: number, controller: AbortController, selection?: number, conn = connectionGeneration): boolean { return !disposed && !hidden() && !controller.signal.aborted && conn === connectionGeneration && version === generation && (selection === undefined || selection === selectionGeneration); }
  function start(selected = false): AbortController { const controller = new AbortController(); controllers.add(controller); if (selected) selectedControllers.add(controller); return controller; }
  function addButton(parent: HTMLElement, label: string, action: () => void, extra = false): void { const mounted = mountButton(parent, { label, variant: 'secondary', onClick: action }); (extra ? extraDisposers : detailDisposers).push(() => mounted.dispose()); }
  function captureBinding(selection?: number): ManagementActionBinding | null {
    if (disposed || !enabled || !context) return null;
    if (!currentEpoch) {
      status.replaceChildren(); element(status, 'p', 'Session identity unavailable. Read management data first.');
      return null;
    }
    return { conn: connectionGeneration, context, epoch: currentEpoch, ...(selection !== undefined ? { selection } : {}) };
  }
  function validBinding(expected: ManagementActionBinding): boolean {
    if (disposed || expected.conn !== connectionGeneration || context !== expected.context) return false;
    if (expected.selection !== undefined && expected.selection !== selectionGeneration) return false;
    if (currentEpoch !== expected.epoch) {
      status.replaceChildren(); element(status, 'p', 'Session identity unavailable. Read management data first.');
      return false;
    }
    return true;
  }
  async function execManagementAction(expected: ManagementActionBinding, payload: Record<string, unknown>, doneText: string, reloadAfter = true): Promise<void> {
    if (!validBinding(expected)) return;
    status.replaceChildren(); element(status, 'p', 'Running management action…');
    try {
      const res = await request<ActionResult>('/v1/actions/management', undefined, { method: 'POST', body: { context: expected.context, identityEpoch: expected.epoch, ...payload } });
      if (disposed || expected.conn !== connectionGeneration || context !== expected.context) return;
      if (res.identityEpoch) currentEpoch = res.identityEpoch;
      status.replaceChildren();
      if (!res.ok) { element(status, 'p', `${res.error.code}: ${res.error.message}`); return; }
      element(status, 'p', doneText);
      if (reloadAfter) void load();
    } catch { if (!disposed && expected.conn === connectionGeneration && context === expected.context) { status.replaceChildren(); element(status, 'p', 'Action failed.'); } }
  }
  async function runCreate(): Promise<void> {
    if (!enabled || !context || !['applicationSets', 'projects'].includes(domain)) return;
    const binding = captureBinding();
    if (!binding) return;
    resetCreateDialogs();
    const isAppSet = domain === 'applicationSets';
    const template = isAppSet
      ? JSON.stringify({ metadata: { name: 'my-appset', namespace: namespace || 'argocd' }, spec: { generators: [], template: {} } }, null, 2)
      : JSON.stringify({ metadata: { name: 'my-project' }, spec: { description: '', sourceRepos: ['*'], destinations: [{ server: '*', namespace: '*' }] } }, null, 2);
    const edited = await openEditorDialog(document, { title: isAppSet ? 'Create ApplicationSet' : 'Create Project', initialText: template, mode: 'object', confirmLabel: 'Create', signal: createDialogController.signal });
    if (!edited?.object || !validBinding(binding)) return;
    await execManagementAction(
      binding,
      isAppSet ? { operation: 'createApplicationSet', applicationSet: edited.object, upsert: Boolean(edited.upsert) }
        : { operation: 'createProject', project: edited.object, upsert: Boolean(edited.upsert) },
      isAppSet ? 'ApplicationSet created.' : 'Project created.',
    );
  }
  async function load(): Promise<void> {
    if (!enabled || !context || hidden() || disposed) return;
    reset(); const conn = connectionGeneration; const capturedContext = context; const version = generation; const controller = start(); button.update({ loading: true }); status.replaceChildren(); element(status, 'p', "Reading management data…");
    const command: ManagementCommand = domain === 'applicationSets' ? { operation: domain, context: capturedContext, ...(namespace ? { appsetNamespace: namespace } : {}) } : { operation: domain, context: capturedContext };
    try {
      const result = await queryTask<{ items: Row[]; namespaceScope?: string }>(request, command, controller.signal);
      if (!current(version, controller, undefined, conn)) return; status.replaceChildren();
      if (result.identityEpoch) currentEpoch = result.identityEpoch;
      if (!response(status, result)) return; rows = result.data.items;
      if (domain === 'applicationSets') element(status, 'p', t`ApplicationSet scope: ${result.data.namespaceScope ?? t("Unknown")}; the default scope is not a global list.`);
      list.update({ emptyText: "No management entries in the visible scope; not proof of no global configuration", items: rows.map((item) => ({ id: item.id, title: 'repo' in item ? item.repo : 'server' in item ? item.name || item.server : 'generators' in item ? `${item.namespace}/${item.name}` : item.name, meta: 'connection' in item ? `${item.connection.status} · ${t(item.connection.summary)}` : 'generators' in item ? `${item.generators.map((generator) => generator.type).join(', ')} · ${item.conditions.length} Conditions` : `${item.roles.length} roles · ${item.syncWindows.length} windows` })) });
    } catch { if (current(version, controller, undefined, conn)) { status.replaceChildren(); element(status, 'p', "Management read failed; this is not an empty success. Applications remain available."); } }
    finally { controllers.delete(controller); if (version === generation && conn === connectionGeneration) button.update({ loading: false }); }
  }
  async function pick(id: string): Promise<void> {
    const row = rows.find((item) => item.id === id); if (!row || hidden()) return;
    clearDetail(); list.update({ selectedId: id }); const conn = connectionGeneration; const capturedContext = context; const version = generation; const selection = selectionGeneration;
    let selected = row;
    if ('generators' in row || 'roles' in row) {
      const controller = start(true);
      try {
        const command: ManagementCommand = 'generators' in row ? { operation: 'applicationSet', context: capturedContext, name: row.name, appsetNamespace: row.namespace } : { operation: 'project', context: capturedContext, project: row.name };
        const result = await queryTask<ApplicationSet | Project>(request, command, controller.signal);
        if (!current(version, controller, selection, conn)) return;
        if (result.identityEpoch) currentEpoch = result.identityEpoch;
        if (!response(detail, result)) return; selected = result.data;
      } catch { if (current(version, controller, selection, conn)) element(detail, 'p', "Management details failed to load; the previous record will not be displayed."); return; }
      finally { controllers.delete(controller); selectedControllers.delete(controller); }
    }
    if (conn !== connectionGeneration || version !== generation || selection !== selectionGeneration) return;
    const item = selected;
    // Translate only Service-authored privacy notices. Resource metadata stays opaque.
    const display = 'connection' in item ? { ...item, connection: { ...item.connection, summary: t(item.connection.summary) } }
      : 'generators' in item ? { ...item, conditions: item.conditions.map((condition) => ({ ...condition, summary: t(condition.summary) })) } : item;
    element(detail, 'pre', JSON.stringify(display, null, 2));
    const actions = element(detail, 'div'); actions.className = 'argocd-action-bar'; const extra = element(detail, 'section');
    if ('repo' in item) {
      addButton(actions, "Show applications for this repository", () => options.applications?.({ repo: item.repo }));
      addButton(actions, "Validate access", () => {
        const binding = captureBinding(selection); if (!binding) return;
        void execManagementAction(binding, {
          operation: 'validateRepository', repo: item.repo,
          ...(item.type ? { type: item.type } : {}),
          ...(item.project ? { project: item.project } : {}),
        }, 'Repository access validated.', false);
      });
      addButton(actions, "Delete", () => {
        const binding = captureBinding(selection); if (!binding) return;
        resetDetailDialogs();
        void openConfirmDialog(document, { title: 'Delete repository', description: 'Remove this repository configuration from Argo CD?', targetLabel: item.repo, confirmLabel: 'Delete', danger: true, signal: detailDialogController.signal }).then((ok) => {
          if (ok && validBinding(binding)) void execManagementAction(binding, {
            operation: 'deleteRepository', repo: item.repo,
            ...(item.project ? { appProject: item.project } : {}),
          }, 'Repository deleted.');
        });
      });
    } else if ('server' in item) {
      const clusterTarget = item.server || item.name;
      const idType = item.server ? undefined : ('name' as const);
      addButton(actions, "Show applications for this cluster", () => options.applications?.({ cluster: clusterTarget }));
      addButton(actions, "Invalidate cache", () => {
        const binding = captureBinding(selection); if (!binding) return;
        void execManagementAction(binding, {
          operation: 'invalidateClusterCache', server: clusterTarget,
          ...(idType ? { idType } : {}),
        }, 'Cluster cache invalidated.', false);
      });
      addButton(actions, "Delete", () => {
        const binding = captureBinding(selection); if (!binding) return;
        resetDetailDialogs();
        void openConfirmDialog(document, { title: 'Delete cluster', description: 'Remove this cluster registration from Argo CD?', targetLabel: clusterTarget, confirmLabel: 'Delete', danger: true, requireInput: clusterTarget, signal: detailDialogController.signal }).then((ok) => {
          if (ok && validBinding(binding)) void execManagementAction(binding, {
            operation: 'deleteCluster', server: clusterTarget,
            ...(idType ? { idType } : {}),
          }, 'Cluster deleted.');
        });
      });
    } else if ('roles' in item) {
      addButton(actions, "Show applications for this Project", () => options.applications?.({ project: item.name }));
      addButton(actions, "Read active Project sync windows", () => { void extraQuery<WindowState>({ operation: 'projectWindows', context: capturedContext, project: item.name }, extra, renderWindowState, version, selection, conn); });
      addButton(actions, "Edit", () => {
        const binding = captureBinding(selection); if (!binding) return;
        resetDetailDialogs();
        const template = JSON.stringify(editableProjectPayload(item), null, 2);
        void openEditorDialog(document, { title: 'Update Project', targetLabel: item.name, initialText: template, mode: 'object', allowUpsert: false, confirmLabel: 'Save', signal: detailDialogController.signal }).then((edited) => {
          if (edited?.object && validBinding(binding)) void execManagementAction(binding, { operation: 'updateProject', name: item.name, project: edited.object }, 'Project updated.');
        });
      });
      addButton(actions, "Delete", () => {
        const binding = captureBinding(selection); if (!binding) return;
        resetDetailDialogs();
        void openConfirmDialog(document, { title: 'Delete Project', description: 'Permanently delete this Argo CD Project?', targetLabel: item.name, confirmLabel: 'Delete', danger: true, requireInput: item.name, signal: detailDialogController.signal }).then((ok) => {
          if (ok && validBinding(binding)) void execManagementAction(binding, { operation: 'deleteProject', name: item.name }, 'Project deleted.');
        });
      });
    } else {
      const appset = item;
      element(detail, 'p', "Only generator structure/type and counts are shown; expressions and values are withheld. applicationStatus without Namespace is metadata only, not a navigation target.");
      addButton(actions, "Read generated-application links", () => { void extraQuery<ApplicationSetChildren>({ operation: 'applicationSetChildren', context: capturedContext, name: appset.name, appsetNamespace: appset.namespace }, extra, (parent, data) => {
        element(parent, 'p', t`${t(data.note)} · ${data.unresolved} references with incomplete Namespace/name were not linked`);
        if (!data.items.length) element(parent, 'p', "Server links are empty or incomplete; this does not prove applications were never generated.");
        for (const item of data.items) addButton(parent, t`View application ${item.appNamespace}/${item.name}`, () => options.application?.(item), true);
      }, version, selection, conn); });
      addButton(actions, "Read ApplicationSet events (optional API)", () => { void extraQuery<EventList>({ operation: 'applicationSetEvents', context: capturedContext, name: appset.name, appsetNamespace: appset.namespace }, extra, renderEvents, version, selection, conn); });
      addButton(actions, "Delete", () => {
        const binding = captureBinding(selection); if (!binding) return;
        resetDetailDialogs();
        void openConfirmDialog(document, { title: 'Delete ApplicationSet', description: 'Permanently delete this ApplicationSet?', targetLabel: `${appset.namespace}/${appset.name}`, confirmLabel: 'Delete', danger: true, requireInput: appset.name, signal: detailDialogController.signal }).then((ok) => {
          if (ok && validBinding(binding)) void execManagementAction(binding, { operation: 'deleteApplicationSet', name: appset.name, appsetNamespace: appset.namespace }, 'ApplicationSet deleted.');
        });
      });
    }
  }
  async function extraQuery<T>(command: ManagementCommand, parent: HTMLElement, render: (parent: HTMLElement, data: T) => void, version: number, selection: number, conn: number): Promise<void> {
    if (hidden() || disposed || conn !== connectionGeneration) return;
    extraController?.abort(); for (const dispose of extraDisposers.splice(0)) dispose(); parent.replaceChildren();
    const controller = start(true); extraController = controller; const section = element(parent, 'section'); element(section, 'p', "Reading additional information…");
    try { const result = await queryTask<T>(request, command, controller.signal); if (!current(version, controller, selection, conn)) return; if (result.identityEpoch) currentEpoch = result.identityEpoch; section.replaceChildren(); if (response(section, result)) render(section, result.data); }
    catch { if (current(version, controller, selection, conn)) { section.replaceChildren(); element(section, 'p', "Additional information unavailable; main details remain available. Do not infer an empty result."); } }
    finally { controllers.delete(controller); selectedControllers.delete(controller); }
  }
  function visibility(): void { if (hidden()) { cancel(); clearDetail(); element(status, 'p', "Management paused; the existing list is an old snapshot."); } paintAges(root, !hidden()); }
  document.addEventListener('visibilitychange', visibility); disposers.push(() => document.removeEventListener('visibilitychange', visibility));
  const Observer = document.defaultView?.IntersectionObserver;
  if (Observer) { const observer = new Observer((entries) => { intersecting = entries[0]?.isIntersecting ?? false; visibility(); }); observer.observe(root); disposers.push(() => observer.disconnect()); }
  const timer = setInterval(() => paintAges(root, !hidden()), 1000); disposers.push(() => clearInterval(timer));
  return { setVisible(value: boolean): void { active = value; visibility(); }, setConnection(next: string, networkEnabled: boolean): void { connectionGeneration++; context = next; enabled = networkEnabled; currentEpoch = ''; reset(); button.update({ disabled: !context || !enabled }); createBtn.update({ disabled: !context || !enabled || !['applicationSets', 'projects'].includes(domain) }); }, dispose(): void { if (disposed) return; disposed = true; connectionGeneration++; cancel(); clearDetail(); for (const dispose of disposers) dispose(); root.replaceChildren(); } };
}
