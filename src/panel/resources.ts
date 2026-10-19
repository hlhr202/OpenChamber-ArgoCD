import { mountButton } from './ui.js';
import { t } from './i18n.js';
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
  element(root, 'p', `${response.error.code}: ${response.error.message}${t(response.error.code === 'NOT_FOUND' ? '；对象可能已删除、不可见或服务端不支持此端点，不能作为空结果。' : response.error.code === 'RESOURCE_CHANGED' ? '；资源可能已删除或重建，请重新查询资源树。' : '')}`);
}
function age(root: HTMLElement, response: Extract<Envelope<unknown>, { ok: true }>): void {
  const node = element(root, 'p'); node.className = 'description'; node.dataset.resourceSample = t`采样 ${response.sampledAt} · ${response.source ?? 'argo-api'}`;
  node.dataset.expires = response.stale ? '0' : String(Date.parse(response.expiresAt ?? response.sampledAt)); paintAges(root, true);
}
function paintAges(root: HTMLElement, visible: boolean): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-resource-sample]')) {
    const stale = !visible || Number(node.dataset.expires) <= Date.now(); node.className = stale ? 'snapshot-stale' : 'description';
    node.textContent = `${node.dataset.resourceSample} · ${t(stale ? '已过期' : '有限时效快照，不是实时状态')}`;
  }
}
export function renderEvents(root: HTMLElement, value: EventList): void {
  element(root, 'p', t`${t(value.scope === 'application-set' ? 'ApplicationSet 自身事件（正文已隐藏）' : value.scope === 'application' ? 'Application 自身事件（不是所有子资源事件）' : value.instanceScoped ? '按资源 UID 隔离事件' : '资源事件（未按 UID 隔离）')}；事件受服务端保留时间和权限限制。`);
  if (value.excludedCount) element(root, 'p', t`已排除 ${value.excludedCount} 条不匹配资源身份的事件。`);
  if (!value.items.length) element(root, 'p', '当前查询范围没有事件；不代表没有发生过异常。');
  for (const event of value.items) {
    const section = element(root, 'section');
    element(section, 'h4', `${event.type} · ${event.reason || t('原因未知')} · ${event.resource.kind} ${event.resource.namespace || '(cluster)'}/${event.resource.name}`);
    element(section, 'p', t`首次 ${event.firstTime || t('未知')} · 最近 ${event.lastTime || t('未知')} · 次数 ${event.count ?? t('未知')} · 来源 ${event.source || t('未知')}`);
    element(section, 'pre', value.scope === 'application-set' ? t(event.message) : event.message);
  }
}
export function renderLiveResource(root: HTMLElement, value: LiveResource): void {
  element(root, 'p', value.redactionNotice);
  if (value.pod) {
    element(root, 'h4', `Pod: ${value.pod.phase} · ${value.pod.reason}`); element(root, 'p').textContent = value.pod.message;
    for (const container of value.pod.containers) element(root, 'p', t`${container.name} · ${container.image} · ${container.phase} · Ready ${container.ready ?? t('未知')} · 重启 ${container.restarts ?? t('未知')} · ${container.reason} ${container.message}`);
  }
  element(root, 'pre', JSON.stringify(value.manifest, null, 2));
}

/** Lazy, bounded resource browser. No requests at mount; entering a tab is the
 * read action. Only selected resources are inspected, never all tree nodes. */
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
  const actions = element(root, 'div'); actions.className = 'resource-toolbar'; const nav = element(actions, 'nav');
  const treePane = element(root, 'section'); const appEventsRoot = element(root, 'section'); appEventsRoot.setAttribute('aria-label', t('应用事件'));
  const monitorStatus = element(root, 'section'); monitorStatus.setAttribute('role', 'status');
  const treeStatus = element(treePane, 'div'); treeStatus.className = 'resource-tree-status'; treeStatus.setAttribute('role', 'status');
  const columns = element(treePane, 'div'); const split = mountSplitView(columns, { resource: true, changed: () => options.changed?.() }); const selection = split.detail;
  if (pendingState) split.restoreState(pendingState.split);
  const navigation = mountResourceNavigation(split.list, select, () => { clearSelection(); options.changed?.(); });
  let overview: HTMLElement | undefined; let eventPane: HTMLElement | undefined; let manifest: HTMLElement | undefined; let logs: HTMLElement | undefined;
  const refresh = mountIconButton(actions, { icon: 'reload', label: '重新查询', onClick: () => { if (section === 'tree') void loadTree(); else void loadExtra(true); } });
  const tabs = mountSections(nav, [{ id: 'tree', label: '应用资源树', pane: treePane }, { id: 'events', label: '应用事件', pane: appEventsRoot }, { id: 'monitoring', label: '孤立资源', pane: monitorStatus }], section, (id) => {
    section = id; extraController?.abort(); extraController = undefined; refresh.update({ loading: false });
    if (id !== 'tree') { treeController?.abort(); treeController = undefined; if (!tree) treeStarted = false; cancelSelected(); }
    activate();
    options.changed?.();
  });
  const fresh = (sample: { stale: boolean; sampledAt: string; expiresAt?: string } | undefined) => Boolean(sample && !sample.stale && Date.parse(sample.expiresAt ?? sample.sampledAt) > Date.now());
  function usable(): boolean { return !disposed && visible && !document.hidden; }
  function cancelSelected(): void { liveController?.abort(); liveController = undefined; eventController?.abort(); eventController = undefined; logView?.setVisible(false); }
  function clearSelection(): void {
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
    treeController?.abort(); clearSelection(); options.evidence?.clearResources(); navigation.clear(); tree = undefined; treeStarted = true;
    const version = ++generation; const controller = new AbortController(); treeController = controller;
    treeStatus.replaceChildren(); element(treeStatus, 'p', '正在查询资源树…'); refresh.update({ loading: true });
    try {
      const response = await queryTask<ResourceTree>(request, { operation: 'resourceTree', context, ...app }, controller.signal);
      if (!usable() || version !== generation || controller.signal.aborted) return; treeStatus.replaceChildren();
      if (!response.ok) { error(treeStatus, response); return; }
      tree = response.data; treeExpires = response.stale ? 0 : Date.parse(response.expiresAt ?? response.sampledAt); navigation.setTree(tree); options.evidence?.tree(response);
      const summary = element(treeStatus, 'span', t`资源 ${tree.nodes.length}`); summary.className = 'description'; age(treeStatus, response);
      const note = element(treeStatus, 'details'); element(note, 'summary', '更多查询选项');
      element(note, 'p', t`${tree.nodes.length} 个资源 · 孤立资源监测 ${t(tree.orphanedMonitoring === 'enabled' ? '服务端返回了孤立节点' : '未知；空列表不能证明已开启检测，请查询 Project 配置')}`);
      if (tree.warnings.length) element(note, 'p', t`拓扑警示：${tree.warnings.join(', ')}；多父关系保留，环路节点只展示一次。`);
      if (pendingState) {
        const state = pendingState; pendingState = undefined;
        const node = tree.nodes.find((node) => state.selected && node.group === state.selected.group && node.kind === state.selected.kind && node.namespace === state.selected.namespace && node.name === state.selected.name && node.uid === state.selected.uid);
        if (node) { select(node.id, state); } else { split.restoreState({ ...state.split, detailOpen: false, collapsed: false }); options.changed?.(); }
      }
    } catch { if (usable() && version === generation && !controller.signal.aborted) { treeStatus.replaceChildren(); element(treeStatus, 'p', '资源树查询失败；不是空结果。'); } }
    finally { if (treeController === controller) { treeController = undefined; refresh.update({ loading: false }); } }
  }
  async function loadExtra(force = false): Promise<void> {
    if (!usable() || section === 'tree' || extraController) return;
    const domain = section; const parent = domain === 'events' ? appEventsRoot : monitorStatus;
    if (!force && fresh(domain === 'events' ? appEvents : monitoring)) return;
    const controller = new AbortController(); extraController = controller; const version = generation;
    parent.replaceChildren(); element(parent, 'p', domain === 'events' ? '正在查询应用事件…' : '正在读取详情…'); refresh.update({ loading: true });
    try {
      if (domain === 'events') {
        const response = await queryTask<EventList>(request, { operation: 'events', context, ...app }, controller.signal);
        if (!usable() || controller.signal.aborted || version !== generation || section !== domain) return;
        parent.replaceChildren(); if (!response.ok) error(parent, response); else { appEvents = response; age(parent, response); renderEvents(parent, response.data); options.evidence?.events(response); }
      } else {
        if (!project) { parent.replaceChildren(); element(parent, 'p', '孤立资源检测配置未知；Project 配置读取失败。'); return; }
        const response = await request<OrphanedMonitoring>('/v1/orphaned-monitoring', { context, project });
        if (!usable() || controller.signal.aborted || version !== generation || section !== domain) return;
        parent.replaceChildren(); if (!response.ok) error(parent, response); else { monitoring = response; age(parent, response); element(parent, 'p', response.data.state === 'disabled' ? t('Project 未开启孤立资源检测；没有孤立节点不是没有孤立资源的证明。') : t`Project 已开启孤立资源检测；warn=${response.data.warn ?? t('默认')}。`); }
      }
    } catch { if (usable() && !controller.signal.aborted && version === generation) { parent.replaceChildren(); element(parent, 'p', domain === 'events' ? '应用事件查询失败；不是没有事件。' : '孤立资源检测配置未知；Project 配置读取失败。'); } }
    finally { if (extraController === controller) { extraController = undefined; refresh.update({ loading: false }); } }
  }
  function select(id: string, restore?: ResourceNavigationState): void {
    const node = tree?.nodes.find((node) => node.id === id); if (!node || !usable()) return;
    if (selected?.id === id) { split.openDetail(); void activateDetail(); return; }
    pendingState = undefined; clearSelection(); selected = node; detailTab = restore?.detailTab ?? 'overview'; navigation.select(id); split.openDetail();
    if (restore) split.restoreState(restore.split);
    element(selection, 'h3', `${node.kind} · ${node.namespace || '(cluster)'}/${node.name}`); element(selection, 'p', '').textContent = node.health;
    const metadata = element(selection, 'details'); element(metadata, 'summary', '关联父资源');
    element(metadata, 'p', t`UID ${node.uid || t('未知')} · 父节点 ${node.parents.length} · 镜像 ${node.images.join(', ') || t('未知')}`);
    for (const id of node.parents) { const parent = tree?.nodes.find((item) => item.id === id); if (parent) { const button = mountButton(metadata, { label: `${parent.kind} ${parent.namespace || '(cluster)'}/${parent.name}`, variant: 'ghost', onClick: () => select(id) }); detailDisposers.push(() => button.dispose()); } }
    if (node.unresolvedParents) element(metadata, 'p', '父引用未解析');
    const detailNav = element(selection, 'nav'); overview = element(selection, 'section'); overview.setAttribute('aria-label', t('Live 资源'));
    eventPane = element(selection, 'section'); eventPane.setAttribute('aria-label', t('资源事件'));
    manifest = element(selection, 'section'); manifest.setAttribute('aria-label', 'Live Manifest'); logs = element(selection, 'section');
    const reload = mountIconButton(detailNav, { icon: 'reload', label: '重新查询资源详情', onClick: () => { if (detailTab === 'logs') logView?.reload(); else void activateDetail(true); } }); detailDisposers.push(() => reload.dispose());
    detailTabs = mountSections(detailNav, [{ id: 'overview', label: '概览', pane: overview }, { id: 'events', label: '资源事件', pane: eventPane }, { id: 'manifest', label: 'Manifest', pane: manifest }, { id: 'logs', label: '日志', pane: logs }], detailTab, (id) => { detailTab = id; logView?.setVisible(id === 'logs' && usable()); void activateDetail(); options.changed?.(); });
    void activateDetail();
    options.changed?.();
  }
  async function activateDetail(force = false): Promise<void> {
    if (!usable() || section !== 'tree' || !selected) return;
    if (detailTab === 'events') { await loadSelected('events', force); return; }
    const version = selectionVersion;
    await loadSelected('resource', force);
    if (version !== selectionVersion) return;
    showLogs();
  }
  function showLogs(): void {
    if (!usable() || section !== 'tree' || detailTab !== 'logs' || !live || !selected || !logs) return;
    if (!logView) {
      if (!live.data.pod || live.data.reference.kind !== 'Pod' || live.data.reference.group) { logs.replaceChildren(); element(logs, 'p', '日志仅适用于 Pod，请选择 Pod。'); return; }
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
      manifest.replaceChildren(); element(manifest, 'p', '正在读取 Live 详情…');
      if (detailTab === 'logs' && logs) { logs.replaceChildren(); element(logs, 'p', '正在读取 Live 详情…'); }
    }
    parent.replaceChildren(); element(parent, 'p', operation === 'resource' ? '正在读取 Live 详情…' : '正在读取资源事件…');
    try {
      const response = operation === 'resource' ? await queryTask<LiveResource>(request, { operation, context, ...app, resource: reference(node) }, controller.signal) : await queryTask<EventList>(request, { operation, context, ...app, resource: reference(node) }, controller.signal);
      if (!usable() || controller.signal.aborted || version !== selectionVersion) return;
      parent.replaceChildren(); if (!response.ok) { error(parent, response); if (operation === 'resource') { live = undefined; manifest.replaceChildren(); error(manifest, response); if (detailTab === 'logs' && logs) { logs.replaceChildren(); error(logs, response); } } return; }
      age(parent, response);
      if (operation === 'events') { events = response as Extract<Envelope<EventList>, { ok: true }>; renderEvents(parent, events.data); options.evidence?.events(events); }
      else {
        live = response as Extract<Envelope<LiveResource>, { ok: true }>; options.evidence?.live(live);
        const value = live.data; element(parent, 'p', value.redactionNotice).className = 'description';
        if (value.pod) { element(parent, 'h4', `Pod · ${value.pod.phase} · ${value.pod.reason}`); element(parent, 'pre', value.pod.message); for (const container of value.pod.containers) { element(parent, 'h4', '').textContent = container.name; element(parent, 'p', t`${container.name} · ${container.image} · ${container.phase} · Ready ${container.ready ?? t('未知')} · 重启 ${container.restarts ?? t('未知')} · ${container.reason} ${container.message}`); } }
        manifest.replaceChildren(); age(manifest, live); element(manifest, 'p', value.redactionNotice); element(manifest, 'pre', JSON.stringify(value.manifest, null, 2));
        logView?.dispose(); logView = undefined;
        if (detailTab === 'logs') queueMicrotask(() => { if (!disposed && version === selectionVersion) showLogs(); });
      }
    } catch { if (usable() && !controller.signal.aborted && version === selectionVersion) {
      parent.replaceChildren(); element(parent, 'p', '此部分读取失败；其他部分的成功不代表本部分成功。');
      if (operation === 'resource') { manifest.replaceChildren(); element(manifest, 'p', '此部分读取失败；其他部分的成功不代表本部分成功。'); if (detailTab === 'logs' && logs) { logs.replaceChildren(); element(logs, 'p', '此部分读取失败；其他部分的成功不代表本部分成功。'); } }
    } }
    finally { if (operation === 'resource' && liveController === controller) liveController = undefined; if (operation === 'events' && eventController === controller) eventController = undefined; }
  }
  const ticker = setInterval(() => paintAges(root, visible), 1000);
  return {
    captureNavigation(): ResourceNavigationState {
      return { selected: selected ? reference(selected) : pendingState?.selected ?? null, section: section as ResourceNavigationState['section'], detailTab: (pendingState?.detailTab ?? (detailTab === 'logs' ? 'overview' : detailTab)) as ResourceNavigationState['detailTab'], split: split.captureState() };
    },
    setVisible(value: boolean): void {
      if (disposed || visible === value) return; visible = value;
      if (!value) { generation++; selectionVersion++; treeController?.abort(); treeController = undefined; if (!tree) treeStarted = false; extraController?.abort(); extraController = undefined; cancelSelected(); split.stopResize(); refresh.update({ loading: false }); paintAges(root, false); }
      else activate();
    },
    dispose(): void { if (disposed) return; visible = false; generation++; treeController?.abort(); extraController?.abort(); clearSelection(); disposed = true; clearInterval(ticker); navigation.dispose(); split.dispose(); tabs.dispose(); refresh.dispose(); root.replaceChildren(); },
  };
}
