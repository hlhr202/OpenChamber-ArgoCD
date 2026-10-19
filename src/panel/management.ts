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
  if (!value.ok) { element(root, 'p', `${value.error.code}: ${value.error.message}${t('；不是空成功。')}${value.error.code === 'NOT_FOUND' ? t(' 服务端可能不支持此端点，或对象已删除/不可见；不作无事件推断。') : ''}`); return false; }
  const node = element(root, 'p'); node.dataset.managementAge = t`采样 ${value.sampledAt} · ${value.source ?? 'argo-api'}`;
  node.dataset.expires = value.stale ? '0' : String(Date.parse(value.expiresAt ?? value.sampledAt)); paintAges(root, true); return true;
}
function paintAges(root: HTMLElement, visible: boolean): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-management-age]')) {
    const stale = !visible || Date.now() >= Number(node.dataset.expires); node.className = stale ? 'snapshot-stale' : 'description';
    node.textContent = `${node.dataset.managementAge} · ${t(stale ? '已过期/暂停' : '有限时效快照，不是实时状态')}`;
  }
}
export function renderWindowState(root: HTMLElement, value: WindowState): void {
  element(root, 'p', value.note);
  element(root, 'h4', value.scope === 'application' ? t`服务端 canSync: ${value.canSync === null ? t('未知') : String(value.canSync)}（只读观察）` : t('服务端 Project 活跃窗口（不是应用 canSync 判定）'));
  element(root, 'pre', JSON.stringify({ activeWindows: value.active, assignedWindows: value.assigned }, null, 2));
}
export function mountWindowStatus(root: HTMLElement, request: PanelRequest, command: Extract<ManagementCommand, { operation: 'applicationWindows' }>) {
  let generation = 0; let visible = false; let disposed = false; let controller: AbortController | undefined; let expires = 0;
  const output = element(root, 'section'); output.setAttribute('aria-label', t('应用同步窗口'));
  const button = mountIconButton(root, { icon: 'reload', label: '重新查询', onClick: () => { void load(); } });
  async function load(): Promise<void> {
    if (!visible || disposed) return; controller?.abort(); controller = new AbortController(); const local = controller; const version = ++generation;
    output.replaceChildren(); element(output, 'p', '正在读取服务端窗口判定…'); button.update({ loading: true });
    try { const result = await queryTask<WindowState>(request, command, local.signal); if (version !== generation || local.signal.aborted) return; output.replaceChildren(); if (response(output, result)) { expires = result.stale ? 0 : Date.parse(result.expiresAt ?? result.sampledAt); renderWindowState(output, result.data); } }
    catch { if (version === generation) { output.replaceChildren(); element(output, 'p', '同步窗口不可用；不会根据本地时间推断可同步。'); } }
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
  element(root, 'h2', '管理域只读观测');
  element(root, 'p', '各模块独立按需查询；无权限或不支持不会阻塞应用观测。生成器参数值、模板表达式、连接错误正文与认证配置不传输。').className = 'description';
  const controls = element(root, 'div'); controls.className = 'filter-grid';
  const select = mountSelect(controls, { label: '管理域模块', value: domain, options: [{ id: 'applicationSets', label: 'ApplicationSet' }, { id: 'projects', label: 'Project' }, { id: 'repositories', label: t('仓库') }, { id: 'clusters', label: t('集群') }], onChange: (value) => { domain = value as Domain; select.update({ value }); reset(); namespaceField.update({ disabled: domain !== 'applicationSets' }); } });
  const namespaceField = mountTextField(controls, { label: 'ApplicationSet Namespace（留空为服务端默认，不代表所有 Namespace）', value: '', onChange: (value) => { namespace = value; namespaceField.update({ value }); } });
  const status = element(root, 'section'); status.setAttribute('role', 'status');
  const listRoot = element(root, 'div'); const detail = element(root, 'section'); detail.setAttribute('aria-label', t('管理域详情'));
  const button = mountButton(controls, { label: '查询管理域（只读）', disabled: true, onClick: () => { void load(); } });
  const list = mountList(listRoot, { ariaLabel: '管理域条目', items: [], emptyText: '尚未查询管理域', onSelect: (id) => { void pick(id); } });
  disposers.push(() => select.dispose(), () => namespaceField.dispose(), () => button.dispose(), () => list.dispose());
  function clearDetail(): void { selectionGeneration++; for (const item of selectedControllers) { item.abort(); controllers.delete(item); } selectedControllers.clear(); for (const dispose of detailDisposers.splice(0)) dispose(); for (const dispose of extraDisposers.splice(0)) dispose(); detail.replaceChildren(); }
  function cancel(): void { generation++; for (const item of controllers) item.abort(); controllers.clear(); button.update({ loading: false }); }
  function reset(): void { cancel(); clearDetail(); rows = []; list.update({ items: [], selectedId: null }); status.replaceChildren(); element(status, 'p', t`Context: ${context || t('未选择')}；点击查询，不自动连接。`); }
  function current(version: number, controller: AbortController, selection?: number): boolean { return !disposed && !hidden() && !controller.signal.aborted && version === generation && (selection === undefined || selection === selectionGeneration); }
  function start(selected = false): AbortController { const controller = new AbortController(); controllers.add(controller); if (selected) selectedControllers.add(controller); return controller; }
  function addButton(parent: HTMLElement, label: string, action: () => void, extra = false): void { const mounted = mountButton(parent, { label, variant: 'secondary', onClick: action }); (extra ? extraDisposers : detailDisposers).push(() => mounted.dispose()); }
  async function load(): Promise<void> {
    if (!enabled || !context || hidden() || disposed) return;
    reset(); const version = generation; const controller = start(); button.update({ loading: true }); status.replaceChildren(); element(status, 'p', '正在读取管理域…');
    const command: ManagementCommand = domain === 'applicationSets' ? { operation: domain, context, ...(namespace ? { appsetNamespace: namespace } : {}) } : { operation: domain, context };
    try {
      const result = await queryTask<{ items: Row[]; namespaceScope?: string }>(request, command, controller.signal);
      if (!current(version, controller)) return; status.replaceChildren(); if (!response(status, result)) return; rows = result.data.items;
      if (domain === 'applicationSets') element(status, 'p', t`ApplicationSet 查询范围：${result.data.namespaceScope ?? t('未知')}；不把默认范围视作全局列表。`);
      list.update({ emptyText: '当前可见范围没有管理域条目；不是全局无配置证明', items: rows.map((item) => ({ id: item.id, title: 'repo' in item ? item.repo : 'server' in item ? item.name || item.server : 'generators' in item ? `${item.namespace}/${item.name}` : item.name, meta: 'connection' in item ? `${item.connection.status} · ${t(item.connection.summary)}` : 'generators' in item ? `${item.generators.map((generator) => generator.type).join(', ')} · ${item.conditions.length} Conditions` : `${item.roles.length} roles · ${item.syncWindows.length} windows` })) });
    } catch { if (current(version, controller)) { status.replaceChildren(); element(status, 'p', '此管理域读取失败；不是空成功，应用观测仍可使用。'); } }
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
      } catch { if (current(version, controller, selection)) element(detail, 'p', '管理域详情读取失败；不会显示上一条记录。'); return; }
      finally { controllers.delete(controller); selectedControllers.delete(controller); }
    }
    if (version !== generation || selection !== selectionGeneration) return;
    const item = selected;
    // Translate only Service-authored privacy notices. Resource metadata stays opaque.
    const display = 'connection' in item ? { ...item, connection: { ...item.connection, summary: t(item.connection.summary) } }
      : 'generators' in item ? { ...item, conditions: item.conditions.map((condition) => ({ ...condition, summary: t(condition.summary) })) } : item;
    element(detail, 'pre', JSON.stringify(display, null, 2));
    const actions = element(detail, 'div'); const extra = element(detail, 'section');
    if ('repo' in item) addButton(actions, '查看关联仓库应用', () => options.applications?.({ repo: item.repo }));
    else if ('server' in item) addButton(actions, '查看关联集群应用', () => options.applications?.({ cluster: item.server || item.name }));
    else if ('roles' in item) {
      addButton(actions, '查看关联 Project 应用', () => options.applications?.({ project: item.name }));
      addButton(actions, '查询 Project 活跃同步窗口', () => { void extraQuery<WindowState>({ operation: 'projectWindows', context, project: item.name }, extra, renderWindowState, version, selection); });
    } else {
      const appset = item;
      element(detail, 'p', '生成器仅展示结构/类型与数量；模板表达式和参数值隐藏。applicationStatus 缺少 Namespace 时仅作状态元信息，不据此导航。');
      addButton(actions, '查询派生应用关联', () => { void extraQuery<ApplicationSetChildren>({ operation: 'applicationSetChildren', context, name: appset.name, appsetNamespace: appset.namespace }, extra, (parent, data) => {
        element(parent, 'p', t`${t(data.note)} · ${data.unresolved} 个 Namespace/名称不完整的引用未导航`);
        if (!data.items.length) element(parent, 'p', '当前服务端关联为空或不完整；不证明从未生成应用。');
        for (const item of data.items) addButton(parent, t`查看应用 ${item.appNamespace}/${item.name}`, () => options.application?.(item), true);
      }, version, selection); });
      addButton(actions, '查询 ApplicationSet 事件（可选 API）', () => { void extraQuery<EventList>({ operation: 'applicationSetEvents', context, name: appset.name, appsetNamespace: appset.namespace }, extra, renderEvents, version, selection); });
    }
  }
  async function extraQuery<T>(command: ManagementCommand, parent: HTMLElement, render: (parent: HTMLElement, data: T) => void, version: number, selection: number): Promise<void> {
    if (hidden() || disposed) return;
    extraController?.abort(); for (const dispose of extraDisposers.splice(0)) dispose(); parent.replaceChildren();
    const controller = start(true); extraController = controller; const section = element(parent, 'section'); element(section, 'p', '正在读取附加信息…');
    try { const result = await queryTask<T>(request, command, controller.signal); if (!current(version, controller, selection)) return; section.replaceChildren(); if (response(section, result)) render(section, result.data); }
    catch { if (current(version, controller, selection)) { section.replaceChildren(); element(section, 'p', '附加信息不可用；不影响主详情，不能推断为空。'); } }
    finally { controllers.delete(controller); selectedControllers.delete(controller); }
  }
  function visibility(): void { if (hidden()) { cancel(); clearDetail(); element(status, 'p', '管理域已暂停，已有列表仅为旧快照。'); } paintAges(root, !hidden()); }
  document.addEventListener('visibilitychange', visibility); disposers.push(() => document.removeEventListener('visibilitychange', visibility));
  const Observer = document.defaultView?.IntersectionObserver;
  if (Observer) { const observer = new Observer((entries) => { intersecting = entries[0]?.isIntersecting ?? false; visibility(); }); observer.observe(root); disposers.push(() => observer.disconnect()); }
  const timer = setInterval(() => paintAges(root, !hidden()), 1000); disposers.push(() => clearInterval(timer));
  return { setVisible(value: boolean): void { active = value; visibility(); }, setConnection(next: string, networkEnabled: boolean): void { context = next; enabled = networkEnabled; reset(); button.update({ disabled: !context || !enabled }); }, dispose(): void { if (disposed) return; disposed = true; cancel(); clearDetail(); for (const dispose of disposers) dispose(); root.replaceChildren(); } };
}
