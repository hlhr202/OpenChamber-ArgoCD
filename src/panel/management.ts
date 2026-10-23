import { mountButton, mountList, mountSelect, mountTextField } from './ui.js';
import { t } from './i18n.js';
import type { ApplicationFilters } from '../shared/applications.js';
import type { Envelope } from '../shared/contracts.js';
import type { ApplicationSet, ApplicationSetChildren, Cluster, ManagementCommand, Project, Repository, WindowState } from '../shared/management.js';
import type { ApplicationReference, EventList } from '../shared/resources.js';
import { queryTask, type PanelRequest } from './task-client.js';
import { renderEvents } from './resources.js';
import { mountIconButton } from './icon-button.js';

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

type Domain = 'applicationSets' | 'projects' | 'repositories' | 'clusters';
type Row = ApplicationSet | Project | Repository | Cluster;
export function mountManagement(root: HTMLElement, request: PanelRequest, options: { applications?: (filters: ApplicationFilters) => void; application?: (ref: ApplicationReference) => void } = {}) {
  const document = root.ownerDocument; let context = ''; let enabled = false; let generation = 0; let selectionGeneration = 0; let disposed = false; let intersecting = true; let active = true;
  let domain: Domain = 'applicationSets'; let namespace = ''; let rows: Row[] = [];
  const controllers = new Set<AbortController>(); const selectedControllers = new Set<AbortController>(); const detailDisposers: Array<() => void> = [];
  const extraDisposers: Array<() => void> = []; let extraController: AbortController | undefined;
  const disposers: Array<() => void> = [];
  const hidden = () => document.hidden || !intersecting || !active;
  element(root, 'h2', "Read-only management");
  element(root, 'p', "Modules load independently on demand. Denied or unsupported modules do not block applications. Generator values, template expressions, connection-error bodies and authentication settings are withheld.").className = 'description';
  const controls = element(root, 'div'); controls.className = 'filter-grid';
  const select = mountSelect(controls, { label: "Management module", value: domain, options: [{ id: 'applicationSets', label: 'ApplicationSet' }, { id: 'projects', label: 'Project' }, { id: 'repositories', label: t("Repository") }, { id: 'clusters', label: t("Cluster") }], onChange: (value) => { domain = value as Domain; select.update({ value }); reset(); namespaceField.update({ disabled: domain !== 'applicationSets' }); } });
  const namespaceField = mountTextField(controls, { label: "ApplicationSet Namespace (blank means server default, not all Namespaces)", value: '', onChange: (value) => { namespace = value; namespaceField.update({ value }); } });
  const status = element(root, 'section'); status.setAttribute('role', 'status');
  const listRoot = element(root, 'div'); const detail = element(root, 'section'); detail.setAttribute('aria-label', t("Management details"));
  const button = mountButton(controls, { label: "Read management data", disabled: true, onClick: () => { void load(); } });
  const list = mountList(listRoot, { ariaLabel: "Management entries", items: [], emptyText: "No management data loaded", onSelect: (id) => { void pick(id); } });
  disposers.push(() => select.dispose(), () => namespaceField.dispose(), () => button.dispose(), () => list.dispose());
  function clearDetail(): void { selectionGeneration++; for (const item of selectedControllers) { item.abort(); controllers.delete(item); } selectedControllers.clear(); for (const dispose of detailDisposers.splice(0)) dispose(); for (const dispose of extraDisposers.splice(0)) dispose(); detail.replaceChildren(); }
  function cancel(): void { generation++; for (const item of controllers) item.abort(); controllers.clear(); button.update({ loading: false }); }
  function reset(): void { cancel(); clearDetail(); rows = []; list.update({ items: [], selectedId: null }); status.replaceChildren(); element(status, 'p', t`Context: ${context || t("Not selected")}; click to query, no automatic connection.`); }
  function current(version: number, controller: AbortController, selection?: number): boolean { return !disposed && !hidden() && !controller.signal.aborted && version === generation && (selection === undefined || selection === selectionGeneration); }
  function start(selected = false): AbortController { const controller = new AbortController(); controllers.add(controller); if (selected) selectedControllers.add(controller); return controller; }
  function addButton(parent: HTMLElement, label: string, action: () => void, extra = false): void { const mounted = mountButton(parent, { label, variant: 'secondary', onClick: action }); (extra ? extraDisposers : detailDisposers).push(() => mounted.dispose()); }
  async function load(): Promise<void> {
    if (!enabled || !context || hidden() || disposed) return;
    reset(); const version = generation; const controller = start(); button.update({ loading: true }); status.replaceChildren(); element(status, 'p', "Reading management data…");
    const command: ManagementCommand = domain === 'applicationSets' ? { operation: domain, context, ...(namespace ? { appsetNamespace: namespace } : {}) } : { operation: domain, context };
    try {
      const result = await queryTask<{ items: Row[]; namespaceScope?: string }>(request, command, controller.signal);
      if (!current(version, controller)) return; status.replaceChildren(); if (!response(status, result)) return; rows = result.data.items;
      if (domain === 'applicationSets') element(status, 'p', t`ApplicationSet scope: ${result.data.namespaceScope ?? t("Unknown")}; the default scope is not a global list.`);
      list.update({ emptyText: "No management entries in the visible scope; not proof of no global configuration", items: rows.map((item) => ({ id: item.id, title: 'repo' in item ? item.repo : 'server' in item ? item.name || item.server : 'generators' in item ? `${item.namespace}/${item.name}` : item.name, meta: 'connection' in item ? `${item.connection.status} · ${t(item.connection.summary)}` : 'generators' in item ? `${item.generators.map((generator) => generator.type).join(', ')} · ${item.conditions.length} Conditions` : `${item.roles.length} roles · ${item.syncWindows.length} windows` })) });
    } catch { if (current(version, controller)) { status.replaceChildren(); element(status, 'p', "Management read failed; this is not an empty success. Applications remain available."); } }
    finally { controllers.delete(controller); if (version === generation) button.update({ loading: false }); }
  }
  async function pick(id: string): Promise<void> {
    const row = rows.find((item) => item.id === id); if (!row || hidden()) return;
    clearDetail(); list.update({ selectedId: id }); const version = generation; const selection = selectionGeneration;
    let selected = row;
    if ('generators' in row || 'roles' in row) {
      const controller = start(true);
      try {
        const command: ManagementCommand = 'generators' in row ? { operation: 'applicationSet', context, name: row.name, appsetNamespace: row.namespace } : { operation: 'project', context, project: row.name };
        const result = await queryTask<ApplicationSet | Project>(request, command, controller.signal);
        if (!current(version, controller, selection) || !response(detail, result)) return; selected = result.data;
      } catch { if (current(version, controller, selection)) element(detail, 'p', "Management details failed to load; the previous record will not be displayed."); return; }
      finally { controllers.delete(controller); selectedControllers.delete(controller); }
    }
    if (version !== generation || selection !== selectionGeneration) return;
    const item = selected;
    // Translate only Service-authored privacy notices. Resource metadata stays opaque.
    const display = 'connection' in item ? { ...item, connection: { ...item.connection, summary: t(item.connection.summary) } }
      : 'generators' in item ? { ...item, conditions: item.conditions.map((condition) => ({ ...condition, summary: t(condition.summary) })) } : item;
    element(detail, 'pre', JSON.stringify(display, null, 2));
    const actions = element(detail, 'div'); const extra = element(detail, 'section');
    if ('repo' in item) addButton(actions, "Show applications for this repository", () => options.applications?.({ repo: item.repo }));
    else if ('server' in item) addButton(actions, "Show applications for this cluster", () => options.applications?.({ cluster: item.server || item.name }));
    else if ('roles' in item) {
      addButton(actions, "Show applications for this Project", () => options.applications?.({ project: item.name }));
      addButton(actions, "Read active Project sync windows", () => { void extraQuery<WindowState>({ operation: 'projectWindows', context, project: item.name }, extra, renderWindowState, version, selection); });
    } else {
      const appset = item;
      element(detail, 'p', "Only generator structure/type and counts are shown; expressions and values are withheld. applicationStatus without Namespace is metadata only, not a navigation target.");
      addButton(actions, "Read generated-application links", () => { void extraQuery<ApplicationSetChildren>({ operation: 'applicationSetChildren', context, name: appset.name, appsetNamespace: appset.namespace }, extra, (parent, data) => {
        element(parent, 'p', t`${t(data.note)} · ${data.unresolved} references with incomplete Namespace/name were not linked`);
        if (!data.items.length) element(parent, 'p', "Server links are empty or incomplete; this does not prove applications were never generated.");
        for (const item of data.items) addButton(parent, t`View application ${item.appNamespace}/${item.name}`, () => options.application?.(item), true);
      }, version, selection); });
      addButton(actions, "Read ApplicationSet events (optional API)", () => { void extraQuery<EventList>({ operation: 'applicationSetEvents', context, name: appset.name, appsetNamespace: appset.namespace }, extra, renderEvents, version, selection); });
    }
  }
  async function extraQuery<T>(command: ManagementCommand, parent: HTMLElement, render: (parent: HTMLElement, data: T) => void, version: number, selection: number): Promise<void> {
    if (hidden() || disposed) return;
    extraController?.abort(); for (const dispose of extraDisposers.splice(0)) dispose(); parent.replaceChildren();
    const controller = start(true); extraController = controller; const section = element(parent, 'section'); element(section, 'p', "Reading additional information…");
    try { const result = await queryTask<T>(request, command, controller.signal); if (!current(version, controller, selection)) return; section.replaceChildren(); if (response(section, result)) render(section, result.data); }
    catch { if (current(version, controller, selection)) { section.replaceChildren(); element(section, 'p', "Additional information unavailable; main details remain available. Do not infer an empty result."); } }
    finally { controllers.delete(controller); selectedControllers.delete(controller); }
  }
  function visibility(): void { if (hidden()) { cancel(); clearDetail(); element(status, 'p', "Management paused; the existing list is an old snapshot."); } paintAges(root, !hidden()); }
  document.addEventListener('visibilitychange', visibility); disposers.push(() => document.removeEventListener('visibilitychange', visibility));
  const Observer = document.defaultView?.IntersectionObserver;
  if (Observer) { const observer = new Observer((entries) => { intersecting = entries[0]?.isIntersecting ?? false; visibility(); }); observer.observe(root); disposers.push(() => observer.disconnect()); }
  const timer = setInterval(() => paintAges(root, !hidden()), 1000); disposers.push(() => clearInterval(timer));
  return { setVisible(value: boolean): void { active = value; visibility(); }, setConnection(next: string, networkEnabled: boolean): void { context = next; enabled = networkEnabled; reset(); button.update({ disabled: !context || !enabled }); }, dispose(): void { if (disposed) return; disposed = true; cancel(); clearDetail(); for (const dispose of disposers) dispose(); root.replaceChildren(); } };
}
