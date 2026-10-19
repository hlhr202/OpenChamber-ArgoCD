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
    fields(section, { '仓库': source.repoURL, '路径 / Chart': source.path || source.chart, '目标 revision': source.targetRevision, '引用': source.ref });
    if (source.helm) fields(section, {
      'Helm release': source.helm.releaseName, 'Value files': source.helm.valueFiles.join(', '),
      '参数名（值不传输）': source.helm.parameterNames.join(', '), '文件参数名（值不传输）': source.helm.fileParameterNames.join(', '),
      '内联 values（内容不传输）': String(source.helm.hasInlineValues), 'valuesObject（内容不传输）': String(source.helm.hasValuesObject),
    });
    if (source.kustomize) fields(section, {
      'Kustomize version': source.kustomize.version, '名称前缀 / 后缀': `${source.kustomize.namePrefix} / ${source.kustomize.nameSuffix}`,
      'Namespace': source.kustomize.namespace, 'Images': source.kustomize.images.join(', '), 'Components': source.kustomize.components.join(', '),
      'Common label keys': source.kustomize.commonLabelKeys.join(', '), 'Common annotation keys': source.kustomize.commonAnnotationKeys.join(', '),
      'Patch 数量（内容不传输）': String(source.kustomize.patchCount),
    });
  }
}

export function renderApplicationDetail(root: HTMLElement, app: ApplicationDetail): void {
  root.replaceChildren();
  element('h2', `${app.appNamespace}/${app.name}`, root);
  fields(root, {
    'Sync': app.syncKnown ? app.sync : t`${app.sync}（未知状态）`,
    'Health': app.healthKnown ? app.health : t`${app.health}（未知状态）`, 'Project': app.project,
    'Application Namespace': app.appNamespace, '目标 Namespace': app.destination.namespace,
    '目标集群': app.destination.name || app.destination.server, '当前对比 revisions': app.comparedRevisions.join(', '),
    '最近保留部署 revisions': app.lastDeploymentRevisions.join(', '), '最近保留部署时间': app.lastDeploymentAt,
    'Argo 最后协调时间': app.reconciledAt,
  });
  element('h3', '来源与配置', root);
  element('p', '为避免泄漏敏感配置，Helm values/参数值、Kustomize patch/注解值及插件环境变量不传输到面板。', root).className = 'description';
  sources(root, app.sources);
  element('h3', `Conditions · ${app.conditions.length}`, root);
  if (!app.conditions.length) element('p', '无已报告的 Conditions（不等于应用一定健康）。', root);
  for (const condition of app.conditions) {
    const section = element('section', '', root);
    element('h4', `${condition.type} · ${condition.lastTransitionTime || t('时间未知')}`, section);
    element('pre', condition.message, section);
  }
  element('h3', '部署过程', root);
  if (!app.operation) element('p', '没有已报告的操作状态。', root);
  else {
    fields(root, { '阶段': app.operation.phase, '开始': app.operation.startedAt, '结束': app.operation.finishedAt, '重试次数': String(app.operation.retryCount), 'revisions': app.operation.revisions.join(', ') });
    element('pre', app.operation.message, root);
    for (const resource of app.operation.resources) {
      const section = element('details', '', root);
      element('summary', `${resource.kind} ${resource.namespace}/${resource.name} · ${resource.status || 'Unknown'}`, section);
      fields(section, { 'Group': resource.group, 'Sync phase': resource.syncPhase, 'Hook phase': resource.hookPhase });
      element('pre', resource.message, section);
    }
  }
  element('h3', '部署历史（仅服务端保留记录）', root);
  if (!app.history.length) element('p', '没有保留的部署历史。', root);
  for (const history of [...app.history].reverse()) {
    const section = element('details', '', root);
    element('summary', `#${history.id} · ${history.deployedAt || t('时间未知')} · ${history.revisions.join(', ')}`, section);
    fields(section, { '开始': history.deployStartedAt, '完成': history.deployedAt, '发起者': history.initiatedBy.automated ? t('自动') : history.initiatedBy.username });
    sources(section, history.sources);
  }
}

export function mountApplications(root: HTMLElement, request: PanelRequest, options: { now?: () => number; tickMs?: number; refreshMs?: number; copy?: (text: string) => Promise<void>; evidence?: EvidenceStore; toolbar?: HTMLElement; diagnosticRoot?: HTMLElement; changed?: () => void } = {}) {
  const document = root.ownerDocument;
  root.classList.add('applications-view');
  const actions = options.toolbar ?? element('div', '', root); actions.classList.add('observer-toolbar'); actions.setAttribute('role', 'toolbar'); actions.setAttribute('aria-label', t('应用工具栏'));
  const advanced = element('details', '', options.diagnosticRoot ?? root); element('summary', '更多查询选项', advanced);
  const advancedActions = element('div', '', advanced);
  const status = element('p', '加载 contexts 后自动显示应用。', root);
  status.setAttribute('role', 'status');
  const filterRoot = element('details', '', root);
  filterRoot.open = true; filterRoot.className = 'application-filters';
  element('summary', '筛选应用', filterRoot);
  const clearRoot = element('div', '', filterRoot); clearRoot.className = 'filter-clear';
  const filterGrid = element('div', '', filterRoot);
  filterGrid.className = 'filter-grid';
  const metrics = element('div', '', root); metrics.className = 'application-metrics';
  const counts = element('span', '', metrics);
  const snapshotStatus = element('span', '', metrics);
  const columns = element('div', '', root);
  const split = mountSplitView(columns, { changed: () => options.changed?.() }); const listRoot = split.list; const detailRoot = split.detail;
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
  const queryButton = mountIconButton(actions, { icon: 'reload', label: '重新查询应用', tooltip: '重新读取应用列表，不触发 Argo 强制刷新', disabled: true, onClick: () => { void load(false, true); } });
  const backgroundButton = mountButton(advancedActions, { label: '后台查询应用', disabled: true, variant: 'secondary', onClick: () => { void load(true); } });
  const cancelButton = mountButton(advancedActions, { label: '取消后台查询', disabled: true, variant: 'ghost', onClick: () => {
    generation++; activeTask?.abort(); activeTask = undefined; busy = false; forceStale = true;
    queryButton.update({ loading: false }); backgroundButton.update({ loading: false }); cancelButton.update({ disabled: true });
    status.textContent = t('后台查询已取消；现有快照不代表当前状态。'); paintSnapshot();
  } });
  const autoSwitch = mountSwitch(advancedActions, { label: '每 15 秒自动更新（仅可见时）', checked: false, disabled: true,
    onChange: (value) => { setAutomatic(value); },
  });
  const autoButton = mountIconButton(actions, { icon: 'clock', label: '自动更新应用', tooltip: '自动更新：关闭（每 15 秒，仅可见时）', pressed: false, disabled: true, onClick: () => setAutomatic(!automatic) });
  function setAutomatic(value: boolean): void { automatic = value; autoSwitch.update({ checked: value }); autoButton.update({ pressed: value, tooltip: t`自动更新：${t(value ? '开启' : '关闭')}（每 15 秒，仅可见时）` }); }
  const list = mountApplicationList(listRoot, (id) => { pendingNavigation = undefined; void detail(id); });
  const clearButton = mountIconButton(clearRoot, { icon: 'reset', label: '清空筛选', onClick: () => { pendingNavigation = undefined; for (const key of Object.keys(filters)) delete filters[key as keyof ApplicationFilters]; for (const update of filterUpdates.values()) update(''); updateChoices(); paint(); options.changed?.(); } });
  disposers.push(() => queryButton.dispose(), () => backgroundButton.dispose(), () => cancelButton.dispose(), () => autoSwitch.dispose(), () => autoButton.dispose(), () => clearButton.dispose(), () => list.dispose(), () => split.dispose(), () => advanced.remove());

  const nameField = mountTextField(element('div', '', filterGrid), { label: '名称（包含）', placeholder: '搜索应用…', value: '', onChange: (value) => { pendingNavigation = undefined; filters.name = value; nameField.update({ value }); paint(); options.changed?.(); } });
  disposers.push(() => nameField.dispose()); filterUpdates.set('name', (value) => nameField.update({ value }));
  const choiceFields = new Map<ChoiceFilter, ReturnType<typeof mountSelect>>();
  for (const [key, label] of [['project', 'Project'], ['cluster', '集群'], ['appNamespace', 'Application Namespace'], ['destinationNamespace', '目标 Namespace'], ['repo', '仓库'], ['sync', 'Sync'], ['health', 'Health'], ['selector', '标签']] as const) {
    const field = mountSelect(element('div', '', filterGrid), {
      label, value: '', options: [{ id: '', label: '全部' }], searchable: true, searchPlaceholder: t`搜索${t(label)}…`,
      onChange: (value) => { pendingNavigation = undefined; filters[key] = value; field.update({ value }); if (key === 'selector') expressionField.update({ value }); paint(); options.changed?.(); },
    });
    choiceFields.set(key, field); disposers.push(() => field.dispose());
    filterUpdates.set(key, (value) => field.update({ value }));
  }
  const expressionRoot = element('details', '', filterRoot); expressionRoot.className = 'advanced-label-filter'; element('summary', '高级标签表达式', expressionRoot);
  const expressionField = mountTextField(element('div', '', expressionRoot), { label: '标签 selector（高级）', placeholder: '例如 env in (production,staging)…', value: '', onChange: (value) => { pendingNavigation = undefined; filters.selector = value; expressionField.update({ value }); updateChoices(); paint(); options.changed?.(); } });
  disposers.push(() => expressionField.dispose()); filterUpdates.set('selector', (value) => { expressionField.update({ value }); choiceFields.get('selector')?.update({ value }); });
  function updateChoices(): void {
    for (const [key, field] of choiceFields) {
      const values = filterChoices(applications, key); const value = filters[key] ?? '';
      if (value && !values.some((item) => item.id === value)) values.push({ id: value, label: value, hint: t('当前筛选值') });
      field.update({ value, options: [{ id: '', label: '全部' }, ...values] });
    }
  }

  function clear(): void {
    detailGeneration++;
    applications = []; selected = ''; split.reset(); updateChoices();
    snapshot = null; forceStale = false; paintSnapshot();
    detailSnapshot = null; detailAgeNode = undefined;
    list.update({ items: [], selectedId: null, emptyText: '尚无当前查询结果' });
    counts.textContent = '';
    clearDetail();
  }
  function clearDetail(): void {
    selectedReference = null; openingNavigation = undefined;
    resourceView?.dispose(); resourceView = undefined;
    manifestView?.dispose(); manifestView = undefined;
    windowView?.dispose(); windowView = undefined;
    detailTabs?.dispose(); detailTabs = undefined; options.evidence?.reset(context);
    detailRoot.replaceChildren(); detailSnapshot = null; detailAgeNode = undefined;
  }
  function paint(): void {
    let visible: ApplicationSummary[];
    try { visible = filterApplications(applications, filters); }
    catch {
      detailGeneration++; selected = ''; clearDetail();
      list.update({ items: [], selectedId: null, emptyText: '标签筛选无效，请检查 selector' });
      counts.textContent = t('筛选无效；不是空查询结果。'); split.reset(); return;
    }
    if (!visible.some((app) => app.id === selected)) { selected = ''; detailGeneration++; clearDetail(); }
    counts.textContent = t`当前筛选 ${visible.length} / 已查询 ${applications.length} · OutOfSync ${visible.filter((app) => app.sync === 'OutOfSync').length} · Degraded/Missing ${visible.filter((app) => ['Degraded', 'Missing'].includes(app.health)).length} · 未知状态 ${visible.filter((app) => !app.healthKnown || !app.syncKnown || app.health === 'Unknown').length} · 有 Conditions ${visible.filter((app) => app.conditionsCount).length}`;
    list.update({ selectedId: selected || null, emptyText: '当前查询范围内没有匹配的应用', items: visible });
  }
  function paintSnapshot(): void {
    if (!snapshot) { snapshotStatus.textContent = ''; snapshotStatus.removeAttribute('title'); root.dataset.stale = 'true'; }
    else {
      const stale = forceStale || Date.parse(snapshot.expiresAt) <= now() || hidden();
      root.dataset.stale = String(stale);
      snapshotStatus.className = stale ? 'snapshot-stale' : 'description';
      snapshotStatus.textContent = `${t(stale ? '已过期' : '快照')} · ${formatTime(snapshot.sampledAt)}`;
      snapshotStatus.title = t`快照采样时间 ${snapshot.sampledAt} · 来源 ${snapshot.source} · ${t(stale ? '未确认当前状态' : '不是持续实时状态')}`;
    }
    if (detailSnapshot && detailAgeNode) {
      const old = hidden() || forceStale || Date.parse(detailSnapshot.expiresAt) <= now();
      detailAgeNode.className = old ? 'snapshot-stale' : 'description';
      detailAgeNode.textContent = t`详情采样时间 ${detailSnapshot.sampledAt} · 来源 ${detailSnapshot.source} · ${t(old ? '已过期' : '有限时效快照')}`;
    }
  }
  function invalidateSensitive(code: string): boolean {
    return ['AUTH_REQUIRED', 'FORBIDDEN', 'NETWORK_DISABLED', 'CONFIG_MISSING', 'CONFIG_INVALID', 'CONTEXT_NOT_FOUND', 'UNSUPPORTED'].includes(code);
  }
  async function load(background = false, navigation = false): Promise<void> {
    if (!enabled || !context || (navigation ? document.hidden : hidden()) || busy) return;
    const version = ++generation;
    detailGeneration++; selected = ''; clearDetail();
    busy = true; lastAttemptAt = now(); forceStale = true; paintSnapshot();
    queryButton.update({ loading: !background }); backgroundButton.update({ loading: background });
    activeTask = background ? new AbortController() : undefined;
    cancelButton.update({ disabled: !background });
    status.textContent = t('正在读取应用；不触发 Argo 强制刷新。');
    status.hidden = false;
    try {
      const response = background
        ? await queryTask<ApplicationList>(request, { operation: 'applications', context, filters: {} }, activeTask!.signal)
        : await request<ApplicationList>('/v1/applications', { context });
      if (version !== generation) return;
      if (!response.ok) {
        if (invalidateSensitive(response.error.code)) clear();
        status.textContent = `${response.error.code}: ${response.error.message}${t('（没有新的有效快照）')}`; return;
      }
      applications = response.data.items; updateChoices();
      snapshot = { sampledAt: response.sampledAt, expiresAt: response.expiresAt ?? new Date(Date.parse(response.sampledAt) + 15_000).toISOString(), source: response.source ?? 'argo-api' };
      forceStale = response.stale;
      status.textContent = ''; status.hidden = true;
      paint();
      restoreSelection();
    } catch { if (version === generation) status.textContent = t('查询失败，检查宿主连接/授权；不能据此判断应用健康。'); }
    finally { if (version === generation) {
      busy = false; activeTask = undefined;
      queryButton.update({ loading: false }); backgroundButton.update({ loading: false }); cancelButton.update({ disabled: true }); paintSnapshot();
    } }
  }
  async function detail(id: string, reference?: ApplicationReference, navigation = false, restore?: ApplicationNavigationState): Promise<void> {
    const app = applications.find((item) => item.id === id) ?? (reference ? { ...reference, id } : undefined);
    if (!app || !enabled || (navigation ? document.hidden : hidden())) return;
    selected = id; list.update({ selectedId: id }); split.openDetail();
    const version = ++detailGeneration;
    clearDetail(); element('p', '正在读取详情…', detailRoot);
    selectedReference = { name: app.name, appNamespace: app.appNamespace }; openingNavigation = restore;
    detailTab = restore?.detailTab ?? 'overview'; if (restore) split.restoreState(restore.split);
    options.changed?.();
    options.evidence?.reset(context, { name: app.name, appNamespace: app.appNamespace });
    try {
      const response = await request<ApplicationDetail>('/v1/application', { context, name: app.name, appNamespace: app.appNamespace });
      if (version !== detailGeneration) return;
      detailRoot.replaceChildren();
      if (!response.ok) { element('p', `${response.error.code}: ${response.error.message}`, detailRoot); return; }
      const nav = element('nav', '', detailRoot); nav.setAttribute('aria-label', t('应用排障视图'));
      const overview = element('section', '', detailRoot); const resources = element('section', '', detailRoot); const manifests = element('section', '', detailRoot); const windows = element('section', '', detailRoot);
      renderApplicationDetail(overview, response.data); options.evidence?.app(response);
      detailSnapshot = { sampledAt: response.sampledAt, expiresAt: response.expiresAt ?? new Date(Date.parse(response.sampledAt) + 15_000).toISOString(), source: response.source ?? 'argo-api' };
      detailAgeNode = element('p', '', detailRoot); paintSnapshot();
      resourceView = mountResources(resources, request, context, { name: app.name, appNamespace: app.appNamespace }, response.data.project, { ...(options.copy ? { copy: options.copy } : {}), ...(options.evidence ? { evidence: options.evidence } : {}), ...(restore?.resources ? { initialState: restore.resources } : {}), changed: () => options.changed?.() });
      manifestView = mountManifests(manifests, request, context, response.data, options.evidence);
      windowView = mountWindowStatus(windows, request, { operation: 'applicationWindows', context, name: app.name, appNamespace: app.appNamespace });
      openingNavigation = undefined;
      detailTabs = mountSections(nav, [{ id: 'overview', label: '应用概览', pane: overview }, { id: 'resources', label: '资源 / 事件 / 日志', pane: resources }, { id: 'manifests', label: 'Manifest / Diff', pane: manifests }, { id: 'windows', label: '同步窗口', pane: windows }], detailTab, (id) => { detailTab = id; syncDetailVisibility(); options.changed?.(); });
      syncDetailVisibility();
    } catch { if (version === detailGeneration) { detailRoot.replaceChildren(); element('p', '详情读取失败；不会显示上一应用的数据。', detailRoot); } }
  }
  function syncDetailVisibility(): void {
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
      if (enabled && context) status.textContent = t('已暂停更新。');
    } else if (!paused && wasPaused && enabled && context) {
      status.textContent = t(snapshot ? '已恢复显示；当前为上次读取的应用。' : '可以重新查询应用。');
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
      status.hidden = Boolean(snapshot); if (!snapshot) status.textContent = t('请选择可用的 context。');
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
      status.textContent = t(enabled ? '正在准备应用列表。' : '请选择可用的 context。');
      if (restore) restoreNavigation(restore);
      if (loadApplications && enabled && context) {
        if (document.hidden || !active) pendingContextLoad = true; else void load(false, true);
      }
    },
    dispose(): void { if (disposed) return; disposed = true; generation++; detailGeneration++; activeTask?.abort(); resourceView?.dispose(); manifestView?.dispose(); windowView?.dispose(); detailTabs?.dispose(); options.evidence?.reset(); for (const dispose of disposers) dispose(); root.replaceChildren(); },
  };
}
