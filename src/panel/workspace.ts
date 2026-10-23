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
  let navigationRevision = 0; let suppressNavigation = false; let pendingRestore: NavigationState | undefined; let pendingInitialLoad = false;
  const statusSurface = ready.surface === 'status'; const storageOptions = { scope: ready.features?.deviceStorage ? 'device' as const : 'instance' as const };
  const heading = element('header'); heading.className = 'observer-heading'; element('h1', 'Argo CD', heading); element('span', "Read only", heading).className = 'read-only-label';
  const more = document.createElement('details'); more.className = 'workspace-more'; heading.append(more);
  const moreLabel = element('summary', 'Applications', more);
  const nav = element('nav', '', more); nav.className = 'workspace-navigation'; nav.setAttribute('aria-label', t("Argo CD navigation"));
  const connection = element('section'); connection.className = 'observer-toolbar connection-toolbar'; connection.setAttribute('aria-label', t("Argo CD connection")); connection.setAttribute('role', 'toolbar');
  const contextRoot = element('div', '', connection); contextRoot.className = 'context-select';
  const applicationActions = element('div', '', connection); applicationActions.className = 'application-actions';
  const noticeRoot = element('div'); noticeRoot.hidden = !initialNotice;
  const notice = mountBanner(noticeRoot, { tone: 'info', title: initialNotice || "Connection notice", body: '' });
  function showNotice(title: string, body: string, tone: 'info' | 'error' = 'error'): void { noticeRoot.hidden = false; notice.update({ tone, title, body }); }
  const applications = element('section'); applications.setAttribute('aria-label', t("Application observations"));
  const management = element('section'); management.setAttribute('aria-label', t("Management observations")); const summary = element('section'); summary.setAttribute('aria-label', t("Troubleshooting summary"));
  const diagnostic = element('section'); diagnostic.className = 'diagnostic-view'; diagnostic.setAttribute('aria-label', t('Diagnostic'));
  element('h2', 'Diagnostic', diagnostic);
  element('p', "Connection checks and advanced options. No deployment, CLI configuration or login changes.", diagnostic).className = 'description';
  const diagnosticActions = element('div', '', diagnostic); diagnosticActions.className = 'observer-toolbar'; diagnosticActions.setAttribute('role', 'toolbar'); diagnosticActions.setAttribute('aria-label', t("Diagnostic toolbar"));
  const contextStatus = element('p', "Contexts have not been loaded.", diagnostic); contextStatus.setAttribute('role', 'status');
  const output = element('pre', '', diagnostic); output.setAttribute('aria-label', t("Service diagnostics"));
  const navigation = !statusSurface && ready.directory ? navigationStorage(host.storage, ready.directory, Boolean(ready.features?.deviceStorage), () => { if (!disposed) contextStatus.textContent = t("Preferences could not be saved. Using in-memory settings."); }) : undefined;
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
    moreLabel.textContent = t(({ applications: 'Applications', management: 'Management', summary: 'Summary', diagnostic: 'Diagnostic' } as Record<string, string>)[id]!); more.open = false;
    queueMicrotask(() => { if (!disposed && !more.open && nav.contains(document.activeElement)) moreLabel.focus(); });
    applicationBrowser.setVisible(id === 'applications'); managementBrowser.setVisible(id === 'management'); applicationActions.hidden = id !== 'applications';
    if (id !== 'summary') summaryBrowser.invalidate();
    if (id !== 'diagnostic') { preferences.module = id as ViewPreferences['module']; persist(); }
    else persistNavigation();
  });
  const density = mountSelect(densityRoot, { label: "Density", value: preferences.density, options: [{ id: 'compact', label: t("Compact") }, { id: 'comfortable', label: t("Comfortable") }], onChange: (value) => { preferences.density = value as ViewPreferences['density']; density.update({ value }); root.dataset.density = preferences.density; persist(); } });
  const select = mountSelect(contextRoot, { label: 'Context', placeholder: "Load contexts, then select a connection", value: '', options: [], disabled: true, searchable: true, searchPlaceholder: "Search contexts…", onChange: (value) => { revision++; selectedContext = value; select.update({ value }); output.textContent = ''; updateConnection(true); persistNavigation(); } });
  const loadButton = mountIconButton(diagnosticActions, { icon: 'contexts', label: "Load contexts", tooltip: "Load CLI contexts and show applications for the current connection", onClick: () => { navigationRevision++; pendingRestore = undefined; pendingInitialLoad = false; void loadContexts(); } });
  const checkButton = mountIconButton(diagnosticActions, { icon: 'check', label: "Check host Service", tooltip: "Check the Service process (no Argo CD request)", onClick: () => { void check(); } });
  if (ready.surface !== 'page' && host.openSurface) {
    const pageButton = mountIconButton(diagnosticActions, { icon: 'page', label: "Open full page", onClick: () => {
      void host.openSurface!('page').catch(() => { if (!disposed) showNotice("The host could not open the full page", "You can continue using this read-only panel.", 'info'); });
    } }); disposers.push(() => pageButton.dispose());
  }
  root.dataset.density = preferences.density; applicationBrowser.setVisible(true); managementBrowser.setVisible(false);
  if (statusSurface) { nav.hidden = true; element('p', "Read-only application snapshot · no automatic polling").className = 'description'; }
  function persist(): void {
    preferencesVersion++; if (disposed || statusSurface || suppressNavigation) return;
    void host.storage.set('observer.view.v1', { density: preferences.density, module: preferences.module }, storageOptions).catch(() => { if (!disposed) contextStatus.textContent = t("Preferences could not be saved. Using in-memory settings."); });
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
    contextStatus.textContent = !selected ? t("Load contexts first.") : selected.core ? t("Kubernetes core mode is unsupported. Select another context.") : !contexts.networkEnabled ? t("Update and re-enable the extension. The old Service does not allow application reads.") : t`Connection: ${selected.name} · existing CLI credentials · no login or renewal`;
    if (loadApplications) { if (enabled) noticeRoot.hidden = true; else showNotice("This connection is unavailable", contextStatus.textContent); }
  }
  async function loadContexts(saved?: NavigationState, initial = false): Promise<void> {
    const restoreRevision = navigationRevision;
    const version = ++revision; loadButton.update({ loading: true }); contexts = { contexts: [], networkEnabled: false }; select.update({ disabled: true, options: [], value: '' }); updateConnection(); output.textContent = '';
    try { const result = await request<ContextList>('/v1/contexts'); if (disposed || version !== revision || (saved || initial) && restoreRevision !== navigationRevision) return;
      if (!result.ok) { showNotice("Cannot load contexts", result.error.message); return; }
      contexts = result.data;
      const wanted = saved?.context ?? selectedContext;
      selectedContext = contexts.contexts.some((item) => item.name === wanted) ? wanted : contexts.contexts.find((item) => item.current)?.name ?? contexts.contexts[0]?.name ?? '';
      suppressNavigation = true;
      try {
        select.update({ value: selectedContext, options: contexts.contexts.map((item) => ({ id: item.name, label: item.name, ...(item.core ? { hint: t("Core mode is unsupported") } : {}) })), disabled: !contexts.contexts.length });
        updateConnection(!saved || saved.tab === 'applications', saved?.context === selectedContext ? saved.applications : undefined);
        if (saved) { tabs.select(saved.tab); if (saved.tab !== 'applications') applicationBrowser.loadWhenVisible(); }
      } finally { suppressNavigation = false; }
      persistNavigation();
    } catch { if (!disposed && version === revision) showNotice("Host connection or authorization unavailable", "Check the Service and extension authorization, then reload contexts."); }
    finally { if (!disposed) loadButton.update({ loading: false }); }
  }
  async function check(): Promise<void> {
    const version = ++diagnosticRevision; checkButton.update({ loading: true }); output.textContent = '';
    try { const result = await request<Diagnostics>('/v1/diagnostics'); if (disposed || version !== diagnosticRevision) return;
      output.textContent = result.ok ? JSON.stringify({ ...result.data, sampledAt: result.sampledAt }, null, 2) : `${result.error.code}: ${result.error.message}`;
    } catch { if (!disposed && version === diagnosticRevision) output.textContent = t("Host Service unavailable. Check extension authorization and host settings."); }
    finally { if (!disposed) checkButton.update({ loading: false }); }
  }
  if (restored) {
    contexts = structuredClone(restored.contexts); selectedContext = restored.selectedContext;
    select.update({ value: selectedContext, options: contexts.contexts.map((item) => ({ id: item.name, label: item.name, ...(item.core ? { hint: t("Core mode is unsupported") } : {}) })), disabled: !contexts.contexts.length }); updateConnection(); applicationBrowser.restoreState(restored.applications);
    preferences.density = restored.density; density.update({ value: preferences.density }); root.dataset.density = preferences.density; tabs.select(restored.tab);
  }
  const initialNavigationRevision = navigationRevision;
  if (!statusSurface && !restored && autoRestore) void (navigation?.load() ?? Promise.resolve(null)).then((state) => {
    if (disposed || navigationRevision !== initialNavigationRevision) return;
    if (!state?.context) { if (document.hidden) pendingInitialLoad = true; else void loadContexts(undefined, true); return; }
    suppressNavigation = true; preferencesVersion++;
    try {
      preferences.density = state.density; density.update({ value: preferences.density }); root.dataset.density = preferences.density;
      applicationBrowser.restoreNavigation(state.applications); tabs.select(state.tab);
    } finally { suppressNavigation = false; }
    if (state.context) { if (document.hidden) pendingRestore = state; else void loadContexts(state); }
  });
  const resumeRestore = (): void => { if (document.hidden) { void navigation?.flush(); return; } if (disposed) return; if (pendingRestore) { const state = pendingRestore; pendingRestore = undefined; void loadContexts(state); } else if (pendingInitialLoad) { pendingInitialLoad = false; if (navigationRevision === initialNavigationRevision) void loadContexts(undefined, true); } };
  document.addEventListener('visibilitychange', resumeRestore); disposers.push(() => document.removeEventListener('visibilitychange', resumeRestore));
  const closeMore = (event: KeyboardEvent): void => { if (event.key === 'Escape' && more.open) { more.open = false; moreLabel.focus(); } };
  more.addEventListener('keydown', closeMore); disposers.push(() => more.removeEventListener('keydown', closeMore));
  disposers.push(() => summaryBrowser.dispose(), () => applicationBrowser.dispose(), () => managementBrowser.dispose(), () => tabs.dispose(), () => density.dispose(), () => select.dispose(), () => notice.dispose(), () => loadButton.dispose(), () => checkButton.dispose(), nameFields(root));
  return { flushPersistence(): Promise<void> { return navigation?.flush() ?? Promise.resolve(); }, captureState(): WorkspaceState { return { contexts: structuredClone(contexts), selectedContext, applications: applicationBrowser.captureState(), tab: activeTab, density: preferences.density }; }, setSession(next: SessionSnapshot | null): void { if (next?.id !== session?.id) { summaryBrowser.invalidate(); void navigation?.flush(); } session = next; }, dispose(): void { if (disposed) return; navigation?.close(); disposed = true; revision++; diagnosticRevision++; for (const dispose of disposers) dispose(); store.reset(); root.replaceChildren(); } };
}
