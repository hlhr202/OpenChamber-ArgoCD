import type { HostClient, HostReadyContext, JsonValue, SessionSnapshot } from '@openchamber/sdk';
import { mountBanner, mountSelect } from './ui.js';
import type { ContextList, Diagnostics } from '../shared/contracts.js';
import { mountApplications } from './applications.js';
import { mountManagement } from './management.js';
import { EvidenceStore } from './evidence.js';
import { mountSections } from './sections.js';
import { mountSummary } from './summary.js';
import { viewPreferences, type ViewPreferences } from './preferences.js';
import type { PanelRequest } from './task-client.js';
import { nameFields } from './accessibility.js';
import { mountIconButton } from './icon-button.js';
import { t, setLanguage, languageFor, directionFor } from './i18n.js';
import { navigationState, type NavigationState, type ApplicationNavigationState } from './navigation-state.js';
import { navigationStorage } from './navigation-storage.js';

type WorkspaceState = { contexts: ContextList; selectedContext: string; applications: ReturnType<ReturnType<typeof mountApplications>['captureState']>; tab: string; density: ViewPreferences['density'] };

export type WorkspaceHost = Pick<HostClient, 'storage' | 'writeClipboard' | 'compose'> & Partial<Pick<HostClient, 'openSurface'>>;
export function mountWorkspace(root: HTMLElement, request: PanelRequest, host: WorkspaceHost, ready: HostReadyContext, initialNotice = '', options: { autoRestore?: boolean } = {}) {
  let disposed = false; let locale = ready.locale; let session = ready.session;
  let view: ReturnType<typeof mountWorkspaceView>;
  function render(state?: WorkspaceState): void {
    const language = languageFor(locale); setLanguage(language); root.ownerDocument.documentElement.lang = language; root.ownerDocument.documentElement.dir = directionFor(language);
    view = mountWorkspaceView(root, request, host, { ...ready, locale, session }, initialNotice, state, options.autoRestore !== false);
  }
  render();
  return { setSession(next: SessionSnapshot | null): void { session = next; view.setSession(next); },
    flushPersistence(): Promise<void> { return view.flushPersistence(); },
    setHostLocale(next: string): void { if (disposed || locale === next) return; const changed = languageFor(locale) !== languageFor(next); locale = next; if (changed) { const state = view.captureState(); view.dispose(); render(state); } },
    dispose(): void { if (disposed) return; disposed = true; view.dispose(); } };
}
function mountWorkspaceView(root: HTMLElement, request: PanelRequest, host: WorkspaceHost, ready: HostReadyContext, initialNotice: string, restored?: WorkspaceState, autoRestore = true) {
  const document = root.ownerDocument; root.replaceChildren(); root.dataset.surface = ready.surface; root.classList.add('observer-workspace');
  const element = (tag: string, text = '', parent = root) => { const node = document.createElement(tag); node.textContent = tag === 'pre' ? text : t(text); parent.append(node); return node; };
  const disposers: Array<() => void> = []; const store = new EvidenceStore();
  let disposed = false; let revision = 0; let diagnosticRevision = 0; let selectedContext = ''; let contexts: ContextList = { contexts: [], networkEnabled: false };
  let session: SessionSnapshot | null = ready.session; let preferencesVersion = 0; const preferences: ViewPreferences = { density: 'compact', module: 'applications' };
  let navigationRevision = 0; let suppressNavigation = false; let pendingRestore: NavigationState | undefined;
  const statusSurface = ready.surface === 'status'; const storageOptions = { scope: ready.features?.deviceStorage ? 'device' as const : 'instance' as const };
  const heading = element('header'); heading.className = 'observer-heading'; element('h1', 'Argo CD', heading); element('span', '只读', heading).className = 'read-only-label';
  const nav = element('nav'); nav.className = 'workspace-navigation'; nav.setAttribute('aria-label', t('Argo CD 主导航'));
  const connection = element('section'); connection.className = 'observer-toolbar connection-toolbar'; connection.setAttribute('aria-label', t('Argo CD 连接')); connection.setAttribute('role', 'toolbar');
  const contextActions = element('div', '', connection); const contextRoot = element('div', '', connection); contextRoot.className = 'context-select';
  const applicationActions = element('div', '', connection); applicationActions.className = 'application-actions';
  const noticeRoot = element('div'); noticeRoot.hidden = !initialNotice;
  const notice = mountBanner(noticeRoot, { tone: 'info', title: initialNotice || '连接提示', body: '' });
  function showNotice(title: string, body: string, tone: 'info' | 'error' = 'error'): void { noticeRoot.hidden = false; notice.update({ tone, title, body }); }
  const applications = element('section'); applications.setAttribute('aria-label', t('应用观测'));
  const management = element('section'); management.setAttribute('aria-label', t('管理域观测')); const summary = element('section'); summary.setAttribute('aria-label', t('排障摘要'));
  const diagnostic = element('section'); diagnostic.className = 'diagnostic-view'; diagnostic.setAttribute('aria-label', t('Diagnostic'));
  element('h2', 'Diagnostic', diagnostic);
  element('p', '连接检查与高级选项。不修改部署、CLI 配置或登录状态。', diagnostic).className = 'description';
  const diagnosticActions = element('div', '', diagnostic); diagnosticActions.className = 'observer-toolbar'; diagnosticActions.setAttribute('role', 'toolbar'); diagnosticActions.setAttribute('aria-label', t('诊断工具栏'));
  const contextStatus = element('p', '尚未加载 contexts。', diagnostic); contextStatus.setAttribute('role', 'status');
  const output = element('pre', '', diagnostic); output.setAttribute('aria-label', t('Service 诊断结果'));
  const navigation = !statusSurface && ready.directory ? navigationStorage(host.storage, ready.directory, Boolean(ready.features?.deviceStorage), () => { if (!disposed) contextStatus.textContent = t('视图偏好未持久化，继续使用本次设置。'); }) : undefined;
  const densityRoot = element('div', '', diagnostic);
  let activeTab = 'applications';
  const applicationBrowser = mountApplications(applications, request, { copy: (text) => host.writeClipboard(text), evidence: store, toolbar: applicationActions, diagnosticRoot: diagnostic, changed: persistNavigation });
  const managementBrowser = mountManagement(management, request, {
    applications: (filters) => { tabs.select('applications'); applicationBrowser.search(filters); },
    application: (reference) => { tabs.select('applications'); applicationBrowser.openReference(reference); },
  });
  const summaryBrowser = mountSummary(summary, request, store, { session: () => session?.id ?? null, compose: (text) => host.compose({ text, mode: 'append' }) });
  const tabs = mountSections(nav, [{ id: 'applications', label: 'Applications', pane: applications }, { id: 'management', label: 'Management', pane: management }, { id: 'summary', label: 'Summary', pane: summary }, { id: 'diagnostic', label: 'Diagnostic', pane: diagnostic }], 'applications', (id) => {
    activeTab = id;
    applicationBrowser.setVisible(id === 'applications'); managementBrowser.setVisible(id === 'management'); applicationActions.hidden = id !== 'applications';
    if (id !== 'summary') summaryBrowser.invalidate();
    if (id !== 'diagnostic') { preferences.module = id as ViewPreferences['module']; persist(); }
    else persistNavigation();
  });
  const density = mountSelect(densityRoot, { label: '视图密度', value: preferences.density, options: [{ id: 'compact', label: t('紧凑') }, { id: 'comfortable', label: t('宽松') }], onChange: (value) => { preferences.density = value as ViewPreferences['density']; density.update({ value }); root.dataset.density = preferences.density; persist(); } });
  const select = mountSelect(contextRoot, { label: 'Context', placeholder: '加载 contexts 后选择连接', value: '', options: [], disabled: true, searchable: true, searchPlaceholder: '搜索 context…', onChange: (value) => { revision++; selectedContext = value; select.update({ value }); output.textContent = ''; updateConnection(true); persistNavigation(); } });
  const loadButton = mountIconButton(contextActions, { icon: 'contexts', label: '加载 contexts', tooltip: '加载 CLI contexts，并显示当前连接的应用', onClick: () => { navigationRevision++; pendingRestore = undefined; void loadContexts(); } });
  const checkButton = mountIconButton(diagnosticActions, { icon: 'check', label: '检查宿主 Service', tooltip: '检查 Service 进程（不查询 Argo CD）', onClick: () => { void check(); } });
  if (ready.surface !== 'page' && host.openSurface) {
    const pageButton = mountIconButton(diagnosticActions, { icon: 'page', label: '打开完整页面', onClick: () => {
      void host.openSurface!('page').catch(() => { if (!disposed) showNotice('此宿主未打开完整页面', '可继续使用当前只读面板。', 'info'); });
    } }); disposers.push(() => pageButton.dispose());
  }
  root.dataset.density = preferences.density; applicationBrowser.setVisible(true); managementBrowser.setVisible(false);
  if (statusSurface) { nav.hidden = true; element('p', '只读应用快照 · 不自动轮询').className = 'description'; }
  function persist(): void {
    preferencesVersion++; if (disposed || statusSurface || suppressNavigation) return;
    void host.storage.set('observer.view.v1', { density: preferences.density, module: preferences.module }, storageOptions).catch(() => { if (!disposed) contextStatus.textContent = t('视图偏好未持久化，继续使用本次设置。'); });
    persistNavigation();
  }
  function persistNavigation(): void {
    if (disposed || suppressNavigation || statusSurface || !ready.directory) return;
    navigationRevision++; pendingRestore = undefined;
    const state = navigationState({ version: 1, directory: ready.directory, context: selectedContext, tab: activeTab, density: preferences.density, applications: applicationBrowser.captureNavigation() }, ready.directory);
    if (state) navigation?.save(state);
  }
  const loadingVersion = preferencesVersion;
  if (!statusSurface && !restored) void host.storage.get('observer.view.v1', storageOptions).then((value: JsonValue | undefined) => {
    if (disposed || loadingVersion !== preferencesVersion || value === undefined) return;
    preferences.density = viewPreferences(value).density; density.update({ value: preferences.density }); root.dataset.density = preferences.density;
  }).catch(() => {});
  function updateConnection(loadApplications = false, restore?: ApplicationNavigationState): void {
    const selected = contexts.contexts.find((item) => item.name === selectedContext); const enabled = contexts.networkEnabled && Boolean(selected) && !selected?.core;
    if (loadApplications) tabs.select('applications');
    applicationBrowser.setConnection(selectedContext, enabled, loadApplications, restore); managementBrowser.setConnection(selectedContext, enabled); store.reset(selectedContext);
    contextStatus.textContent = !selected ? t('请先加载 contexts。') : selected.core ? t('此 context 使用 core 模式，暂不支持。请选择其他连接。') : !contexts.networkEnabled ? t('请更新扩展并重新启用，旧版 Service 不允许读取应用。') : t`当前连接：${selected.name} · 已有 CLI 登录态 · 不登录/续期`;
    if (loadApplications) { if (enabled) noticeRoot.hidden = true; else showNotice('无法使用此连接', contextStatus.textContent); }
  }
  async function loadContexts(saved?: NavigationState): Promise<void> {
    const restoreRevision = navigationRevision;
    const version = ++revision; loadButton.update({ loading: true }); contexts = { contexts: [], networkEnabled: false }; select.update({ disabled: true, options: [], value: '' }); updateConnection(); output.textContent = '';
    try { const result = await request<ContextList>('/v1/contexts'); if (disposed || version !== revision || saved && restoreRevision !== navigationRevision) return;
      if (!result.ok) { showNotice('无法加载 contexts', result.error.message); return; }
      contexts = result.data;
      const wanted = saved?.context ?? selectedContext;
      selectedContext = contexts.contexts.some((item) => item.name === wanted) ? wanted : contexts.contexts.find((item) => item.current)?.name ?? contexts.contexts[0]?.name ?? '';
      suppressNavigation = true;
      try {
        select.update({ value: selectedContext, options: contexts.contexts.map((item) => ({ id: item.name, label: item.name, ...(item.core ? { hint: t('core 模式暂不支持') } : {}) })), disabled: !contexts.contexts.length });
        updateConnection(!saved || saved.tab === 'applications', saved?.context === selectedContext ? saved.applications : undefined);
        if (saved) { tabs.select(saved.tab); if (saved.tab !== 'applications') applicationBrowser.loadWhenVisible(); }
      } finally { suppressNavigation = false; }
      persistNavigation();
    } catch { if (!disposed && version === revision) showNotice('宿主连接或授权不可用', '检查 Service 和扩展授权后重新加载 contexts。'); }
    finally { if (!disposed) loadButton.update({ loading: false }); }
  }
  async function check(): Promise<void> {
    const version = ++diagnosticRevision; checkButton.update({ loading: true }); output.textContent = '';
    try { const result = await request<Diagnostics>('/v1/diagnostics'); if (disposed || version !== diagnosticRevision) return;
      output.textContent = result.ok ? JSON.stringify({ ...result.data, sampledAt: result.sampledAt }, null, 2) : `${result.error.code}: ${result.error.message}`;
    } catch { if (!disposed && version === diagnosticRevision) output.textContent = t('宿主 Service 不可用，请检查扩展授权与宿主配置。'); }
    finally { if (!disposed) checkButton.update({ loading: false }); }
  }
  if (restored) {
    contexts = structuredClone(restored.contexts); selectedContext = restored.selectedContext;
    select.update({ value: selectedContext, options: contexts.contexts.map((item) => ({ id: item.name, label: item.name, ...(item.core ? { hint: t('core 模式暂不支持') } : {}) })), disabled: !contexts.contexts.length }); updateConnection(); applicationBrowser.restoreState(restored.applications);
    preferences.density = restored.density; density.update({ value: preferences.density }); root.dataset.density = preferences.density; tabs.select(restored.tab);
  }
  const initialNavigationRevision = navigationRevision;
  if (navigation && !restored && autoRestore) void navigation.load().then((state) => {
    if (!state || disposed || navigationRevision !== initialNavigationRevision) return;
    suppressNavigation = true; preferencesVersion++;
    try {
      preferences.density = state.density; density.update({ value: preferences.density }); root.dataset.density = preferences.density;
      applicationBrowser.restoreNavigation(state.applications); tabs.select(state.tab);
    } finally { suppressNavigation = false; }
    if (state.context) { if (document.hidden) pendingRestore = state; else void loadContexts(state); }
  });
  const resumeRestore = (): void => { if (document.hidden) { void navigation?.flush(); return; } if (!disposed && pendingRestore) { const state = pendingRestore; pendingRestore = undefined; void loadContexts(state); } };
  document.addEventListener('visibilitychange', resumeRestore); disposers.push(() => document.removeEventListener('visibilitychange', resumeRestore));
  disposers.push(() => summaryBrowser.dispose(), () => applicationBrowser.dispose(), () => managementBrowser.dispose(), () => tabs.dispose(), () => density.dispose(), () => select.dispose(), () => notice.dispose(), () => loadButton.dispose(), () => checkButton.dispose(), nameFields(root));
  return { flushPersistence(): Promise<void> { return navigation?.flush() ?? Promise.resolve(); }, captureState(): WorkspaceState { return { contexts: structuredClone(contexts), selectedContext, applications: applicationBrowser.captureState(), tab: activeTab, density: preferences.density }; }, setSession(next: SessionSnapshot | null): void { if (next?.id !== session?.id) { summaryBrowser.invalidate(); void navigation?.flush(); } session = next; }, dispose(): void { if (disposed) return; navigation?.close(); disposed = true; revision++; diagnosticRevision++; for (const dispose of disposers) dispose(); store.reset(); root.replaceChildren(); } };
}
