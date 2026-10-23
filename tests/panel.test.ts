import assert from 'node:assert/strict';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { mountApplications, renderApplicationDetail, type PanelRequest } from '../src/panel/applications.js';
import { applicationCounts, applicationDetail, applicationSummary } from '../src/service/domains/applications.js';
import type { Envelope } from '../src/shared/contracts.js';
import { rawApplication } from './application-fixtures.js';
import { mountResources, renderLiveResource } from '../src/panel/resources.js';
import { liveResource, resourceEvents, resourceTree } from '../src/service/domains/resources.js';
import { otherPodRef, podRef, rawEvent, rawPod, rawTree } from './resource-fixtures.js';
import type { TaskCommand } from '../src/shared/tasks.js';
import { mountManifests } from '../src/panel/manifests.js';
import { managedResources, manifests } from '../src/service/domains/manifests.js';
import { deployment, rawComparison } from './manifest-fixtures.js';
import { mountLogs } from '../src/panel/logs.js';
import type { LogCommand, LogPage } from '../src/shared/logs.js';
import { mountManagement, mountWindowStatus } from '../src/panel/management.js';
import * as management from '../src/service/domains/management.js';
import { rawAppSet, rawCluster, rawProject, rawRepository } from './management-fixtures.js';
import type { ApplicationFilters } from '../src/shared/applications.js';
import type { ApplicationReference } from '../src/shared/resources.js';
import { EvidenceStore } from '../src/panel/evidence.js';
import { mountSummary } from '../src/panel/summary.js';
import { buildSummary, parseSummaryEvidence } from '../src/service/domains/summary.js';
import { mountWorkspace, type WorkspaceHost } from '../src/panel/workspace.js';
import { hostReady } from './host-fixtures.js';
import { applyHostReady } from '@openchamber/sdk/ui';
import type { JsonValue } from '@openchamber/sdk';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ArgoClient } from '../src/service/argocd/client.js';
import { RefreshCoordinator } from '../src/service/auth/refresh.js';
import { createService } from '../src/service/runtime/server.js';
import { ServiceGateway } from '../src/panel/gateway.js';
import { configFixture, syntheticConfig } from './helpers.js';
import { logPacket, lastPacket } from './log-fixtures.js';
import type { PanelRequestOptions } from '../src/panel/task-client.js';
import { filterChoices } from '../src/panel/application-filters.js';
import { t as translate, setLanguage } from '../src/panel/i18n.js';
import { LANGUAGES, directionFor } from '../src/shared/language.js';
import { mountResourceNavigation, navigationRows } from '../src/panel/resource-navigation.js';
import { deploymentRef } from './resource-fixtures.js';
import { navigationKey } from '../src/panel/navigation-state.js';
import { savedNavigation } from './navigation-fixtures.js';
import { chinese } from '../src/shared/locales/base.js';

const cleanups = new WeakMap<HTMLElement, Array<() => void>>();
function cleanup(root: HTMLElement, dispose: () => void): void { cleanups.get(root)!.push(dispose); }

function dom(t: TestContext): HTMLElement {
  setLanguage('zh-CN');
  const window = new Window({ url: 'https://extension.example.test' });
  Object.defineProperty(window, 'IntersectionObserver', { value: undefined, configurable: true });
  const keys = ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLStyleElement', 'HTMLButtonElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'CSS'];
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : Reflect.get(window, key), configurable: true, writable: true });
  const root = document.createElement('div'); document.body.append(root); cleanups.set(root, []);
  t.after(async () => {
    for (const dispose of cleanups.get(root)!) dispose(); cleanups.delete(root);
    await window.happyDOM.abort(); window.close();
    for (const key of keys) {
      const previous = descriptors.get(key);
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return root;
}
function success<T>(data: T): Envelope<T> { return { ok: true, data, sampledAt: '2026-10-18T00:00:00Z', stale: false, truncated: false }; }
function queryButton(root: HTMLElement): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((item) => item.textContent === '重新查询应用');
  assert.ok(button); return button;
}
function selectTrigger(root: HTMLElement, label: string): HTMLButtonElement {
  const field = [...root.querySelectorAll<HTMLElement>('.oc-sdk-select')].find((node) => node.querySelector('.oc-sdk-field-label')?.textContent === label); assert.ok(field);
  return field.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
}
function selectOptions(): HTMLElement[] { return [...document.querySelectorAll<HTMLElement>('.oc-sdk-popup [role="option"]')]; }
function listData() {
  const items = [applicationSummary(rawApplication()), applicationSummary(rawApplication('same', 'team-b'))];
  return { items, totals: applicationCounts(items), matched: applicationCounts(items) };
}

test('pointer selection synchronizes keyboard activity, repeated selection is a no-op and refresh keeps mounted details', async (t) => {
  const root = dom(t); let reads = 0; let release!: (value: Envelope<unknown>) => void; let lists = 0;
  const request: PanelRequest = async <T>(path: string, query?: Record<string, string>) => {
    if (path === '/v1/applications') { if (++lists > 1) return new Promise<Envelope<T>>((done) => { release = done as typeof release; }); return success(listData() as T); }
    reads++; return success(applicationDetail(rawApplication(query!.name, query!.appNamespace)) as T);
  };
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose()); browser.setConnection('primary', true, true); await setImmediate();
  const rows = [...root.querySelectorAll<HTMLElement>('[role="option"]')]; rows[0]!.click(); await setImmediate(); rows[1]!.click(); await setImmediate();
  assert.equal(root.querySelector('[data-active="true"]')!.getAttribute('aria-selected'), 'true');
  root.querySelector('[role="listbox"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await setImmediate(); assert.equal(reads, 2);
  const detail = root.querySelector('[aria-label="应用排障视图"]'); const selected = browser.captureNavigation().selected;
  queryButton(root).click(); assert.deepEqual(browser.captureNavigation().selected, selected); assert.equal(root.querySelector('[aria-label="应用排障视图"]'), detail);
  release(success(listData())); await setImmediate(); assert.equal(root.querySelector('[role="option"]'), rows[0]); assert.equal(root.querySelector('[aria-label="应用排障视图"]'), detail);
  assert.equal(root.querySelector('[aria-selected="true"][role="option"]')!.getAttribute('data-application-id'), 'team-b/same');
  queryButton(root).click(); release({ ok: false, sampledAt: new Date().toISOString(), error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Offline' } }); await setImmediate();
  assert.equal(root.querySelector('[aria-label="应用排障视图"]'), detail); assert.equal(root.dataset.stale, 'true');
  queryButton(root).click(); release(success({ items: [], totals: applicationCounts([]), matched: applicationCounts([]) })); await setImmediate();
  assert.equal(browser.captureNavigation().selected, null); assert.equal(root.querySelector('[aria-label="应用排障视图"]'), null);
});

test('list polling reconciles the latest user selection and does not close an app hidden by a changed health filter', async (t) => {
  const root = dom(t); let release!: (value: Envelope<unknown>) => void; let lists = 0;
  const request: PanelRequest = async <T>(path: string, query?: Record<string, string>) => {
    if (path === '/v1/applications') { if (++lists > 1) return new Promise<Envelope<T>>((done) => { release = done as typeof release; }); return success(listData() as T); }
    return success(applicationDetail(rawApplication(query!.name, query!.appNamespace)) as T);
  };
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose()); browser.setConnection('primary', true, true); await setImmediate();
  selectTrigger(root, 'Health').click(); selectOptions().find((item) => item.textContent === 'Degraded')!.click();
  root.querySelector<HTMLElement>('[role="option"]')!.click(); await setImmediate(); queryButton(root).click();
  root.querySelectorAll<HTMLElement>('[role="option"]')[1]!.click(); await setImmediate(); const detail = root.querySelector('[aria-label="应用排障视图"]');
  const next = listData(); next.items[1]!.health = 'Healthy'; release(success(next)); await setImmediate();
  assert.equal(browser.captureNavigation().selected?.appNamespace, 'team-b'); assert.equal(root.querySelector('[aria-label="应用排障视图"]'), detail);
  assert.equal(root.querySelectorAll('[role="option"]').length, 1);
});

test('resource-tree reload keeps the selected inspector until a successful snapshot proves a UID change', async (t) => {
  const root = dom(t); let changed = false;
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => {
    const command = options!.body as TaskCommand;
    return taskSuccess((command.operation === 'resourceTree' ? resourceTree(changed ? { nodes: [{ ...podRef, uid: 'replacement' }] } : rawTree()) : liveResource({ manifest: JSON.stringify(rawPod()) }, podRef)) as T);
  };
  const view = mountResources(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, 'platform'); cleanup(root, () => view.dispose()); view.setVisible(true); await setImmediate();
  root.querySelector<HTMLElement>('[role="treeitem"][data-kind="Pod"][data-namespace="team-a"]')!.click(); await setImmediate();
  const inspector = root.querySelector('[aria-label="Live 资源"]'); resourceButton(root, '重新查询').click();
  assert.equal(root.querySelector('[aria-label="Live 资源"]'), inspector); await setImmediate(); assert.equal(root.querySelector('[aria-label="Live 资源"]'), inspector); assert.equal(view.captureNavigation().selected?.uid, podRef.uid);
  changed = true; resourceButton(root, '重新查询').click(); await setImmediate(); assert.equal(view.captureNavigation().selected, null); assert.equal(root.querySelector('[aria-label="Live 资源"]'), null);
});

test('automatic refresh preserves selection and reverse-order application detail responses cannot switch it back', async (t) => {
  const root = dom(t); let now = Date.now(); let lists = 0; const pending = new Map<string, (value: Envelope<unknown>) => void>();
  const request: PanelRequest = async <T>(path: string, query?: Record<string, string>) => {
    if (path === '/v1/applications') { lists++; return success(listData() as T); }
    return new Promise<Envelope<T>>((done) => pending.set(query!.name!, done as (value: Envelope<unknown>) => void));
  };
  const browser = mountApplications(root, request, { now: () => now, tickMs: 5, refreshMs: 10 }); cleanup(root, () => browser.dispose()); browser.setConnection('primary', true, true); await setImmediate();
  const rows = root.querySelectorAll<HTMLElement>('[role="option"]'); rows[0]!.click(); rows[1]!.click();
  pending.get('same')!(success(applicationDetail(rawApplication('same', 'team-b')))); await setImmediate();
  pending.get('demo')!(success(applicationDetail(rawApplication()))); await setImmediate();
  assert.equal(browser.captureNavigation().selected?.name, 'same'); assert.match(root.querySelector('[aria-label="应用详情"]')!.textContent!, /team-b\/same/);
  const detail = root.querySelector('[aria-label="应用排障视图"]'); root.querySelector<HTMLButtonElement>('[role="switch"]')!.click(); now += 11; await delay(20);
  assert.equal(lists, 2); assert.equal(root.querySelector('[aria-label="应用排障视图"]'), detail); assert.equal(root.querySelector('[role="option"][aria-selected="true"]')!.getAttribute('data-application-id'), 'team-b/same');
});

test('application overview prioritizes conditions and unsuccessful operations while retaining collapsed configuration and history', (t) => {
  const root = dom(t); renderApplicationDetail(root, applicationDetail(rawApplication()));
  const disclosures = [...root.querySelectorAll<HTMLDetailsElement>(':scope > .application-disclosure')];
  assert.equal(disclosures.length, 3); assert.ok(disclosures.every((node) => !node.open));
  assert.match(disclosures[0]!.querySelector('summary')!.textContent!, /来源与配置/);
  assert.match(disclosures[2]!.textContent!, /previous-commit/);
  assert.match(root.querySelector('.application-operation-alert')!.textContent!, /Failed.*resource sync failed/s);
  const children = [...root.children]; const conditions = children.findIndex((node) => node.textContent?.startsWith('Conditions'));
  assert.ok(conditions >= 0 && conditions < children.indexOf(disclosures[0]!));
  assert.doesNotMatch(root.textContent!, /hidden-|repository-password/);
  const healthy = applicationDetail(rawApplication()); healthy.operation!.phase = 'Succeeded'; renderApplicationDetail(root, healthy);
  assert.equal(root.querySelector('.application-operation-alert'), null);
});

test('resource drill-down replaces only the outer sidebar and returning keeps cached resource navigation and user layout', async (t) => {
  const root = dom(t); const calls: string[] = [];
  const request: PanelRequest = async <T>(path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => {
    calls.push(path);
    if (path === '/v1/applications') return success(listData() as T);
    if (path === '/v1/application') return success(applicationDetail(rawApplication()) as T);
    const command = options!.body as TaskCommand;
    return taskSuccess((command.operation === 'resourceTree' ? resourceTree(rawTree()) : liveResource({ manifest: JSON.stringify(rawPod()) }, podRef)) as T);
  };
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose()); browser.setConnection('primary', true, true); await setImmediate();
  root.querySelector<HTMLElement>('[role="option"]')!.click(); await setImmediate();
  const outer = root.querySelector<HTMLElement>('.application-columns')!; const layout = browser.captureNavigation().split;
  const resourcesTab = () => root.querySelector<HTMLElement>('[aria-label="应用排障视图"] [data-id="resources"]')!;
  resourcesTab().click(); await setImmediate(); assert.equal(outer.dataset.detailOnly, 'true');
  assert.equal(root.dataset.resourceFocus, 'true');
  assert.equal(outer.dataset.listCollapsed, String(layout.collapsed));
  assert.equal(root.querySelectorAll('.application-current-title').length, 1);
  const heading = root.querySelector('.application-detail-header')!;
  assert.ok(heading.contains(resourceButton(root, '展开应用列表'))); assert.ok(heading.contains(root.querySelector('.application-current-title')));
  assert.equal(root.querySelector('.resource-columns')!.nextElementSibling, root.querySelector('.resource-tree-status'));
  const sample = root.querySelector<HTMLElement>('.resource-tree-status [data-resource-sample]')!;
  assert.ok(sample.title.includes('采样')); assert.doesNotMatch(sample.textContent!, /2026-|argo-api/);
  root.querySelector<HTMLElement>('[role="treeitem"][data-kind="Pod"][data-namespace="team-a"]')!.click(); await setImmediate();
  const inspector = root.querySelector('[aria-label="Live 资源"]'); const before = calls.length;
  assert.ok(inspector!.lastElementChild!.hasAttribute('data-resource-sample'));
  resourceButton(root, '展开应用列表').click(); await setImmediate();
  assert.equal(outer.dataset.detailOnly, 'false'); assert.equal(outer.dataset.detailOpen, 'false');
  assert.equal(root.dataset.resourceFocus, 'false');
  assert.equal(browser.captureNavigation().selected?.name, 'demo'); assert.equal(document.activeElement?.getAttribute('role'), 'listbox');
  resourcesTab().click(); await setImmediate();
  assert.equal(outer.dataset.detailOnly, 'true'); assert.equal(root.querySelector('[aria-label="Live 资源"]'), inspector); assert.equal(calls.length, before);
  assert.equal(browser.captureNavigation().resources?.selected?.uid, podRef.uid);
  browser.setConnection('secondary', true); assert.equal(outer.dataset.detailOnly, 'false'); assert.equal(root.querySelector('.application-current-title'), null);
  assert.ok(root.querySelector('.application-detail-toolbar')!.contains(resourceButton(root, '展开应用列表')));
});

test('application browser is manually triggered and network-disabled contexts cannot query', async (t) => {
  const root = dom(t);
  const calls: string[] = [];
  const request: PanelRequest = async <T>(path: string) => { calls.push(path); return success(listData() as T); };
  const browser = mountApplications(root, request);
  cleanup(root, () => browser.dispose());
  assert.equal(queryButton(root).disabled, true);
  browser.setConnection('primary', false); queryButton(root).click();
  await setImmediate(); assert.equal(calls.length, 0);
  browser.setConnection('primary', true);
  assert.equal(calls.length, 0);
  queryButton(root).click(); await setImmediate();
  assert.deepEqual(calls, ['/v1/applications']);
  assert.equal(root.querySelectorAll('[role="option"]').length, 2);
  assert.match(root.querySelector('.application-metrics > :last-child')!.getAttribute('title')!, /快照采样时间/);
  assert.deepEqual([...root.querySelector('.application-status-line')!.children].map((node) => node.textContent), ['1 Conditions', 'Sync: OutOfSync', 'Health: Degraded']);
});

test('filters operate locally, invalid selectors are explicit and namespaced detail query is correct', async (t) => {
  const root = dom(t);
  const calls: Array<{ path: string; query: Record<string, string> | undefined }> = [];
  const request: PanelRequest = async <T>(path: string, query?: Record<string, string>) => {
    calls.push({ path, query });
    return success((path === '/v1/applications' ? listData() : applicationDetail(rawApplication('same', 'team-b'))) as T);
  };
  const browser = mountApplications(root, request);
  cleanup(root, () => browser.dispose());
  browser.setConnection('primary', true); queryButton(root).click(); await setImmediate();
  const label = [...root.querySelectorAll('label')].find((item) => item.textContent?.startsWith('标签 selector'));
  const input = label?.querySelector('input'); assert.ok(input);
  input.value = 'env in ('; input.dispatchEvent(new Event('input'));
  assert.match(root.textContent!, /筛选无效；不是空查询结果/);
  assert.equal(root.querySelectorAll('[role="option"]').length, 0);
  input.value = 'env=production'; input.dispatchEvent(new Event('input'));
  assert.equal(root.querySelectorAll('[role="option"]').length, 2);
  assert.equal(calls.length, 1);
  const row = [...root.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((item) => item.textContent?.includes('team-b/same'));
  assert.ok(row); row.click(); await setImmediate();
  assert.deepEqual(calls[1], { path: '/v1/application', query: { context: 'primary', name: 'same', appNamespace: 'team-b' } });
  const detail = root.querySelector('[aria-label="应用详情"]'); assert.ok(detail);
  assert.match(detail.textContent!, /部署历史/); assert.match(detail.textContent!, /ComparisonError/);
  assert.match(detail.textContent!, /参数名（值不传输）/);
  assert.doesNotMatch(detail.textContent!, /hidden-|repository-password/);
});

test('late list response from another context is ignored and old data cleared', async (t) => {
  const root = dom(t);
  let resolve!: (result: Envelope<unknown>) => void;
  const deferred = new Promise<Envelope<unknown>>((done) => { resolve = done; });
  const request: PanelRequest = <T>() => deferred as Promise<Envelope<T>>;
  const browser = mountApplications(root, request);
  cleanup(root, () => browser.dispose());
  browser.setConnection('primary', true); queryButton(root).click();
  browser.setConnection('secondary', true);
  resolve(success(listData())); await setImmediate();
  assert.equal(root.querySelectorAll('[role="option"]').length, 0);
  assert.doesNotMatch(root.textContent!, /argocd\/demo/);
  assert.equal(queryButton(root).disabled, false);
});

test('late detail response cannot overwrite selection after context changes', async (t) => {
  const root = dom(t);
  let resolve!: (result: Envelope<unknown>) => void;
  const deferred = new Promise<Envelope<unknown>>((done) => { resolve = done; });
  const request: PanelRequest = async <T>(path: string) => path === '/v1/applications' ? success(listData() as T) : deferred as Promise<Envelope<T>>;
  const browser = mountApplications(root, request);
  cleanup(root, () => browser.dispose());
  browser.setConnection('primary', true); queryButton(root).click(); await setImmediate();
  root.querySelector<HTMLButtonElement>('[role="option"]')!.click();
  browser.setConnection('secondary', true);
  resolve(success(applicationDetail(rawApplication()))); await setImmediate();
  assert.equal(root.querySelector('[aria-label="应用详情"]')?.textContent, '');
});

test('authorization errors are not empty-success results and untrusted values render only as text', async (t) => {
  const root = dom(t);
  const request: PanelRequest = async () => ({ ok: false, error: { code: 'FORBIDDEN', message: 'No permission' }, sampledAt: '2026-10-18T00:00:00Z' });
  const browser = mountApplications(root, request);
  browser.setConnection('primary', true); queryButton(root).click(); await setImmediate();
  assert.match(root.textContent!, /FORBIDDEN.*没有新的有效快照/);
  browser.dispose();
  const app = rawApplication();
  app.status.conditions[0]!.message = '<img src="https://external.example.test/steal" onerror="alert(1)">';
  renderApplicationDetail(root, applicationDetail(app));
  assert.equal(root.querySelector('img'), null);
  assert.equal(root.querySelector('script'), null);
  assert.match(root.textContent!, /<img src=/);
});

test('snapshot expiry and offline fallback show original sample time; auth failures remove old data', async (t) => {
  const root = dom(t);
  let now = Date.parse('2026-10-18T00:00:00Z');
  let failure: 'UPSTREAM_UNAVAILABLE' | 'AUTH_REQUIRED' | undefined;
  const request: PanelRequest = async <T>() => failure
    ? { ok: false, error: { code: failure, message: 'Unavailable' }, sampledAt: new Date(now).toISOString() }
    : { ...success(listData() as T), expiresAt: new Date(now + 1000).toISOString(), source: 'cache' };
  const browser = mountApplications(root, request, { now: () => now, tickMs: 5 }); cleanup(root, () => browser.dispose());
  browser.setConnection('primary', true); queryButton(root).click(); await setImmediate();
  assert.equal(root.dataset.stale, 'false'); assert.match(root.querySelector('.application-metrics > :last-child')!.getAttribute('title')!, /来源 cache/);
  now += 1001; await delay(15);
  assert.equal(root.dataset.stale, 'true'); assert.match(root.textContent!, /已过期/); assert.match(root.querySelector('.application-metrics > :last-child')!.getAttribute('title')!, /2026-10-18T00:00:00Z/);
  failure = 'UPSTREAM_UNAVAILABLE'; queryButton(root).click(); await setImmediate();
  assert.equal(root.querySelectorAll('[role="option"]').length, 2);
  assert.match(root.textContent!, /UPSTREAM_UNAVAILABLE/); assert.equal(root.dataset.stale, 'true');
  failure = 'AUTH_REQUIRED'; queryButton(root).click(); await setImmediate();
  assert.equal(root.querySelectorAll('[role="option"]').length, 0);
  assert.doesNotMatch(root.textContent!, /argocd\/demo/);
});

test('automatic refresh requires opt-in and an initial snapshot, pauses hidden and resets on context change', async (t) => {
  const root = dom(t);
  let now = Date.parse('2026-10-18T00:00:00Z'); let requests = 0;
  const request: PanelRequest = async <T>() => { requests++; return success(listData() as T); };
  const browser = mountApplications(root, request, { now: () => now, tickMs: 5, refreshMs: 10 }); cleanup(root, () => browser.dispose());
  browser.setConnection('primary', true);
  const toggle = root.querySelector<HTMLButtonElement>('[role="switch"]')!;
  toggle.click(); await delay(15); assert.equal(requests, 0);
  queryButton(root).click(); await setImmediate(); assert.equal(requests, 1);
  Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));
  now += 20; await delay(15); assert.equal(requests, 1);
  Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));
  await delay(15); assert.equal(requests, 2);
  browser.setConnection('secondary', true); now += 20; await delay(15);
  assert.equal(toggle.getAttribute('aria-checked'), 'false'); assert.equal(requests, 2);
});

test('background query cancel stops task polling without changing Argo CD resources', async (t) => {
  const root = dom(t); const methods: string[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { method?: string }) => {
    methods.push(options?.method ?? 'GET');
    return success({ id: 'synthetic-id', state: 'running', createdAt: '2026-10-18T00:00:00Z', expiresAt: '2026-10-18T00:00:30Z' } as T);
  };
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose());
  browser.setConnection('primary', true);
  [...root.querySelectorAll('button')].find((button) => button.textContent === '后台查询应用')!.click(); await setImmediate();
  [...root.querySelectorAll('button')].find((button) => button.textContent === '取消后台查询')!.click(); await setImmediate();
  assert.deepEqual(methods, ['POST', 'DELETE']);
  assert.match(root.textContent!, /后台查询已取消/);
});

test('an explicit query works outside the viewport without a false page-hidden message', async (t) => {
  const root = dom(t);
  let notify!: (entries: Array<{ isIntersecting: boolean }>) => void;
  let disconnected = false;
  Object.defineProperty(document.defaultView!, 'IntersectionObserver', { configurable: true, value: class {
    constructor(callback: typeof notify) { notify = callback; }
    observe(): void {}
    disconnect(): void { disconnected = true; }
  } });
  let requests = 0;
  const request: PanelRequest = async <T>() => { requests++; return success(listData() as T); };
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose());
  browser.setConnection('primary', true);
  notify([{ isIntersecting: false }]);
  queryButton(root).click(); await setImmediate(); assert.equal(requests, 1); assert.doesNotMatch(root.textContent!, /页面隐藏/);
  notify([{ isIntersecting: true }]);
  queryButton(root).click(); await setImmediate(); assert.equal(requests, 2);
  browser.dispose(); assert.equal(disconnected, true);
});

function resourceButton(root: HTMLElement, label: string): HTMLButtonElement {
  const aliases: Record<string, string> = { '摘要预览': 'Summary', '应用 / 排障': 'Applications', '管理域': 'Management' };
  // Most tests assert Chinese visible labels; resolve those to the same English
  // key when exercising another host locale. This is test-only, not a runtime alias.
  const key = aliases[label] ?? Object.entries(chinese).find(([, value]) => value === label)?.[0] ?? label;
  const button = [...root.querySelectorAll('button')].find((button) => button.textContent === translate(key)); assert.ok(button, label); return button;
}
function taskSuccess<T>(data: T): Envelope<T> {
  return success({ id: 'synthetic-id', state: 'succeeded', result: { data, sampledAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15000).toISOString(), stale: false, source: 'argo-api' } } as T);
}

test('entering resources reads the tree, selection reads only Live, and tabs fetch their own content', async (t) => {
  const root = dom(t); const commands: TaskCommand[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { body?: unknown }) => {
    const command = options?.body as TaskCommand; commands.push(command);
    if (command.operation === 'resourceTree') return taskSuccess(resourceTree(rawTree()) as T);
    if (command.operation === 'events') return taskSuccess(resourceEvents({ items: [rawEvent()] }, podRef) as T);
    return taskSuccess(liveResource({ manifest: JSON.stringify(rawPod()) }, podRef) as T);
  };
  const view = mountResources(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, 'default'); cleanup(root, () => view.dispose());
  assert.equal(commands.length, 0);
  view.setVisible(true); await setImmediate();
  assert.equal(root.querySelectorAll('[role="treeitem"]').length, 3);
  assert.match(root.textContent!, /空列表不能证明已开启检测/);
  const filter = root.querySelector('input')!; filter.value = 'team-a'; filter.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(root.querySelectorAll('[role="treeitem"]').length, 2); assert.equal(commands.length, 1);
  root.querySelector<HTMLElement>('[role="treeitem"][data-kind="Pod"]')!.click(); await setImmediate();
  assert.equal(commands.length, 2); assert.equal(root.querySelector('[aria-label="资源事件"]')!.textContent, '');
  resourceButton(root, '资源事件').click(); await setImmediate();
  assert.equal(commands.length, 3); assert.equal((commands[1] as Extract<TaskCommand, { operation: 'resource' }>).appNamespace, 'argocd');
  assert.deepEqual((commands[1] as Extract<TaskCommand, { operation: 'resource' }>).resource, podRef);
  assert.match(root.textContent!, /CrashLoopBackOff/); assert.match(root.textContent!, /按资源 UID 隔离事件/);
  assert.equal(root.querySelector('img'), null); assert.match(root.textContent!, /<img src=x/);
  assert.doesNotMatch(root.textContent!, /private-env|private-command|private-arg|private-annotation/);
});

test('resource inspector retains partial Live success when events fail and distinguishes zero events', async (t) => {
  const root = dom(t);
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { body?: unknown }) => {
    const command = options?.body as TaskCommand;
    if (command.operation === 'resourceTree') return taskSuccess(resourceTree({ nodes: [podRef] }) as T);
    if (command.operation === 'resource') return taskSuccess(liveResource({ manifest: JSON.stringify(rawPod()) }, podRef) as T);
    if (command.operation === 'events' && command.resource) return success({ id: 'synthetic-id', state: 'failed', error: { code: 'FORBIDDEN', message: 'Permission denied' } } as T);
    return taskSuccess(resourceEvents({}) as T);
  };
  const view = mountResources(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, 'default'); cleanup(root, () => view.dispose());
  view.setVisible(true); await setImmediate();
  (root.querySelector('[role="treeitem"]') as HTMLElement).click(); await setImmediate();
  assert.match(root.querySelector('[aria-label="Live 资源"]')!.textContent!, /CrashLoopBackOff/);
  resourceButton(root, '资源事件').click(); await setImmediate();
  assert.match(root.querySelector('[aria-label="资源事件"]')!.textContent!, /FORBIDDEN/);
  assert.doesNotMatch(root.querySelector('[aria-label="资源事件"]')!.textContent!, /当前查询范围没有事件/);
  resourceButton(root, '应用事件').click(); await setImmediate();
  assert.match(root.querySelector('[aria-label="应用事件"]')!.textContent!, /当前查询范围没有事件/);
});

test('hidden/disposed resource view cancels a pending task and ignores late creation result', async (t) => {
  const root = dom(t); let resolve!: (value: Envelope<unknown>) => void; const methods: string[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { method?: string }) => {
    methods.push(options?.method ?? 'GET');
    if (options?.method === 'POST') return new Promise<Envelope<T>>((done) => { resolve = done as typeof resolve; });
    return success({ id: 'synthetic-id', state: 'cancelled' } as T);
  };
  const view = mountResources(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, 'default'); cleanup(root, () => view.dispose());
  view.setVisible(true);
  view.setVisible(false); resolve(taskSuccess(resourceTree(rawTree()))); await setImmediate();
  assert.deepEqual(methods, ['POST', 'DELETE']); assert.equal(root.querySelectorAll('[role="treeitem"]').length, 0);
  view.dispose(); assert.equal(root.textContent, '');
});

test('late resource response cannot overwrite a newer namespaced node selection', async (t) => {
  const root = dom(t); let resolve!: (value: Envelope<unknown>) => void;
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { body?: unknown; method?: string }) => {
    if (options?.method === 'DELETE') return success({ id: 'synthetic-id', state: 'cancelled' } as T);
    const command = options?.body as TaskCommand;
    if (command.operation === 'resourceTree') return taskSuccess(resourceTree({ nodes: [podRef, otherPodRef] }) as T);
    if (command.operation === 'events') return taskSuccess(resourceEvents({}) as T);
    if (command.operation === 'resource' && command.resource.namespace === 'team-a') return new Promise<Envelope<T>>((done) => { resolve = done as typeof resolve; });
    return taskSuccess(liveResource({ manifest: JSON.stringify(rawPod(otherPodRef)) }, otherPodRef) as T);
  };
  const view = mountResources(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, 'default'); cleanup(root, () => view.dispose());
  view.setVisible(true); await setImmediate();
  root.querySelector<HTMLElement>('[role="treeitem"][data-namespace="team-a"]')!.click(); await setImmediate(); root.querySelector<HTMLElement>('[role="treeitem"][data-namespace="team-b"]')!.click(); await setImmediate();
  resolve(taskSuccess(liveResource({ manifest: JSON.stringify(rawPod()) }, podRef))); await setImmediate();
  const details = root.querySelector('[aria-label="资源详情与事件"]')!;
  assert.match(details.querySelector('.resource-coordinate')!.textContent!, /team-b/); assert.match(details.querySelector('.resource-identity')!.textContent!, /Pod · demo/); assert.doesNotMatch(details.textContent!, /team-a/);
});

test('compact navigation folds healthy branches, opens anomaly paths, keeps ancestors in search and never reads data on expansion', async (t) => {
  const root = dom(t); const selected: string[] = []; let filtered = 0;
  const healthy = { ...deploymentRef, name: 'healthy' }; const healthyPod = { ...podRef, name: 'healthy-pod' };
  const broken = { ...deploymentRef, namespace: 'team-b', name: 'broken', uid: 'broken' };
  const data = resourceTree({ nodes: [{ ...healthy, health: { status: 'Healthy' } }, { ...healthyPod, parentRefs: [healthy], health: { status: 'Healthy' } }, { ...broken, health: { status: 'Healthy' } }, { ...otherPodRef, parentRefs: [broken], health: { status: 'Degraded' } }] });
  const tree = mountResourceNavigation(root, (id) => { selected.push(id); tree.select(id); }, () => { filtered++; }); cleanup(root, () => tree.dispose()); tree.setTree(data);
  assert.equal(root.querySelectorAll('[role="treeitem"]').length, 3);
  const healthyRow = [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((row) => row.textContent === '▸healthy')!;
  assert.ok(healthyRow); assert.equal(healthyRow.getAttribute('aria-expanded'), 'false');
  healthyRow.querySelector<HTMLElement>('[data-toggle]')!.click(); assert.equal(root.querySelectorAll('[role="treeitem"]').length, 4); assert.equal(selected.length, 0);
  const search = root.querySelector('input')!; search.value = 'healthy-pod'; search.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(root.querySelectorAll('[role="treeitem"]').length, 2); assert.match(root.textContent!, /healthy-pod/); assert.match(root.textContent!, /healthy/);
  root.querySelector<HTMLElement>('[role="treeitem"][data-kind="Pod"]')!.click(); assert.equal(selected.length, 1);
  search.value = 'broken'; search.dispatchEvent(new Event('input', { bubbles: true })); assert.equal(filtered, 1);
  const anomalyFilter = root.querySelector<HTMLInputElement>('.resource-anomaly-filter')!;
  const menu = root.querySelector<HTMLDetailsElement>('.resource-filter-menu')!; const trigger = root.querySelector<HTMLElement>('.resource-filter-trigger')!;
  assert.equal(menu.open, false); assert.equal(anomalyFilter.checked, false); assert.equal(root.querySelector('[role="switch"]'), null);
  menu.open = true;
  search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); anomalyFilter.click(); assert.equal(anomalyFilter.checked, true); assert.equal(trigger.dataset.active, 'true');
  assert.equal(root.querySelectorAll('[role="treeitem"]').length, 2); assert.doesNotMatch(root.querySelector('[role="tree"]')!.textContent!, /healthy/);
  const first = root.querySelector<HTMLElement>('[role="treeitem"]')!; first.focus(); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal((document.activeElement as HTMLElement).dataset.kind, 'Pod'); assert.equal(selected.length, 1);
  (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); assert.equal(selected.length, 2);
  tree.setTree(data); assert.equal(anomalyFilter.checked, true);
  tree.select(data.nodes.find((node) => node.name === 'healthy-pod')!.id); assert.equal(anomalyFilter.checked, false); assert.equal(root.querySelector<HTMLElement>('.resource-filter-indicator')!.hidden, true);
  anomalyFilter.click(); anomalyFilter.click(); assert.equal(anomalyFilter.checked, false);
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(menu.open, false); assert.equal(document.activeElement, trigger);
  menu.open = true; document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); assert.equal(menu.open, false);
});

test('tree navigation is cycle-safe, preserves all DAG links and separates orphan nodes without pretending unknown is healthy', async (t) => {
  const root = dom(t); const a = { ...deploymentRef, name: 'a' }; const b = { ...deploymentRef, name: 'b', uid: 'b' };
  const data = resourceTree({ nodes: [{ ...a, parentRefs: [podRef] }, { ...b }, { ...podRef, parentRefs: [a, b] }], orphanedNodes: [{ ...otherPodRef }] });
  const rows = navigationRows(data); assert.equal(rows.length, 4); assert.equal(new Set(rows.map((row) => row.node.id)).size, 4);
  assert.equal(data.nodes.find((node) => node.kind === 'Pod' && !node.orphaned)!.parents.length, 2);
  const nav = mountResourceNavigation(root, () => {}, () => {}); cleanup(root, () => nav.dispose()); nav.setTree(data);
  assert.match(root.querySelector('.resource-tree-linked')!.textContent!, /↗2/); assert.match(root.querySelector('.resource-tree-group')!.textContent!, /孤立资源/);
  assert.equal(root.querySelectorAll('.resource-health-dot[data-tone="success"]').length, 0);
  assert.equal(root.querySelectorAll('[role="treeitem"]').length, 4); assert.equal(root.querySelectorAll('[role="treeitem"][tabindex="0"]').length, 1);
});

test('resource detail is one returnable level and retains selection, tab and scroll when returning to its tree', async (t) => {
  const root = dom(t); let reads = 0; let changes = 0;
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => {
    reads++; return taskSuccess(((options!.body as TaskCommand).operation === 'resourceTree' ? resourceTree(rawTree()) : liveResource({ manifest: JSON.stringify(rawPod()) }, podRef)) as T);
  };
  const view = mountResources(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, 'platform', { changed: () => { changes++; } }); cleanup(root, () => view.dispose()); view.setVisible(true); await setImmediate();
  const row = () => root.querySelector<HTMLElement>('[role="treeitem"][data-kind="Pod"][data-namespace="team-a"]')!;
  row().click(); await setImmediate(); const columns = root.querySelector<HTMLElement>('.resource-columns')!;
  const inspector = root.querySelector('[aria-label="Live 资源"]')!;
  assert.equal(columns.dataset.selected, 'true'); assert.ok(root.querySelector('.resource-return-path')!.contains(resourceButton(root, '展开资源列表')));
  assert.deepEqual([...inspector.querySelectorAll('.resource-facts dd')].map((node) => node.textContent), ['Pending', '0 / 1', '3']);
  assert.match(inspector.querySelector('.resource-problem')!.textContent!, /CrashLoopBackOff/);
  assert.equal(inspector.querySelector<HTMLDetailsElement>('.resource-redaction')!.open, false);
  const details = root.querySelector<HTMLElement>('[aria-label="资源详情与事件"]')!; details.scrollTop = 120;
  resourceButton(root, 'Manifest').click(); await setImmediate(); const before = reads; const changedBefore = changes;
  resourceButton(root, '展开资源列表').click(); assert.equal(columns.dataset.detailOpen, 'false'); assert.equal(view.captureNavigation().selected?.uid, podRef.uid);
  row().click(); await setImmediate(); assert.equal(columns.dataset.detailOpen, 'true'); assert.equal(view.captureNavigation().detailTab, 'manifest');
  assert.equal(root.querySelector('[aria-label="Live 资源"]'), inspector); assert.equal(details.scrollTop, 120); assert.equal(reads, before); assert.ok(changes >= changedBefore + 2);
});

test('missing container observations remain unknown rather than displaying zero restarts or readiness', async (t) => {
  const root = dom(t); const pod = rawPod(); pod.status.containerStatuses = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => taskSuccess(((options!.body as TaskCommand).operation === 'resourceTree' ? resourceTree(rawTree()) : liveResource({ manifest: JSON.stringify(pod) }, podRef)) as T);
  const view = mountResources(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, 'platform'); cleanup(root, () => view.dispose()); view.setVisible(true); await setImmediate();
  root.querySelector<HTMLElement>('[role="treeitem"][data-kind="Pod"][data-namespace="team-a"]')!.click(); await setImmediate();
  assert.deepEqual([...root.querySelectorAll('.resource-facts dd')].map((node) => node.textContent), ['Pending', '未知', '未知']);
});

test('resource tabs reuse valid selected snapshots, defer log sessions and auto-read a changed container with follow off', async (t) => {
  const root = dom(t); const commands: string[] = []; const logCommands: LogCommand[] = [];
  const pod = rawPod(); pod.spec.containers.push({ ...pod.spec.containers[0]!, name: 'sidecar' });
  const request: PanelRequest = async <T>(path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => {
    if (path === '/v1/logs') { if (options?.method === 'POST') logCommands.push(options.body as LogCommand); return success(logPage() as T); }
    const command = options?.body as TaskCommand; commands.push(command.operation);
    return taskSuccess((command.operation === 'resourceTree' ? resourceTree({ nodes: [podRef] }) : command.operation === 'resource' ? liveResource({ manifest: JSON.stringify(pod) }, podRef) : resourceEvents({ items: [rawEvent()] }, podRef)) as T);
  };
  const view = mountResources(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, 'default'); cleanup(root, () => view.dispose());
  assert.equal(commands.length, 0); view.setVisible(true); await setImmediate();
  assert.equal(root.querySelector('.resource-columns [role="separator"]')!.getAttribute('aria-valuenow'), '220');
  root.querySelector<HTMLElement>('[role="treeitem"]')!.click(); await setImmediate(); root.querySelector<HTMLElement>('[role="treeitem"]')!.click(); await setImmediate();
  assert.deepEqual(commands, ['resourceTree', 'resource']); assert.equal(logCommands.length, 0);
  resourceButton(root, '展开资源列表').click(); assert.equal(root.querySelector<HTMLElement>('.resource-columns')!.dataset.detailOpen, 'false');
  root.querySelector<HTMLElement>('[role="treeitem"]')!.click(); await setImmediate(); assert.equal(commands.length, 2);
  resourceButton(root, 'Manifest').click(); await setImmediate(); assert.match(root.querySelector('[aria-label="Live Manifest"]')!.textContent!, /REDACTED/); assert.equal(commands.length, 2);
  resourceButton(root, '资源事件').click(); await setImmediate(); resourceButton(root, '概览').click(); resourceButton(root, '资源事件').click(); await setImmediate(); assert.deepEqual(commands, ['resourceTree', 'resource', 'events']);
  resourceButton(root, '日志').click(); await setImmediate(); assert.equal(logCommands.length, 1); assert.equal(logCommands[0]!.follow, false);
  selectTrigger(root, '日志容器（含 init / ephemeral）').click(); selectOptions().find((option) => option.textContent === 'sidecar')!.click(); await setImmediate();
  assert.equal(logCommands.length, 2); assert.equal(logCommands[1]!.container, 'sidecar'); assert.equal(logCommands[1]!.follow, false);
  resourceButton(root, '概览').click(); resourceButton(root, '日志').click(); await setImmediate(); assert.equal(logCommands.length, 2);
});

test('a failed Live reload is visible on the active Manifest tab rather than leaving an apparently current old object', async (t) => {
  const root = dom(t); let fail = false;
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => {
    const command = options?.body as TaskCommand;
    if (command.operation === 'resourceTree') return taskSuccess(resourceTree({ nodes: [podRef] }) as T);
    if (fail) throw new Error('Synthetic disconnected transport');
    return taskSuccess(liveResource({ manifest: JSON.stringify(rawPod()) }, podRef) as T);
  };
  const view = mountResources(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, 'default'); cleanup(root, () => view.dispose()); view.setVisible(true); await setImmediate();
  root.querySelector<HTMLElement>('[role="treeitem"]')!.click(); await setImmediate(); resourceButton(root, 'Manifest').click(); await setImmediate();
  assert.match(root.querySelector('[aria-label="Live Manifest"]')!.textContent!, /apiVersion/);
  fail = true; resourceButton(root, '重新查询资源详情').click(); await setImmediate();
  assert.match(root.querySelector('[aria-label="Live Manifest"]')!.textContent!, /此部分读取失败/); assert.doesNotMatch(root.querySelector('[aria-label="Live Manifest"]')!.textContent!, /apiVersion/);
});

test('rapid log container changes retire old starts and ignore late log session creation', async (t) => {
  const root = dom(t); const posts: string[] = []; const deleted: string[] = []; let finish!: (value: Envelope<LogPage>) => void;
  const request: PanelRequest = async <T>(_path: string, query?: Record<string, string>, options?: PanelRequestOptions) => {
    if (options?.method === 'DELETE') { deleted.push(query!.id!); return success(logPage() as T); }
    if (options?.method === 'POST') { const command = options.body as LogCommand; posts.push(command.container); if (command.container === 'main') return new Promise<Envelope<T>>((resolve) => { finish = resolve as typeof finish; }); return success(logPage({ id: command.container, lines: [{ ...logPage().lines[0]!, content: command.container }] }) as T); }
    return success(logPage() as T);
  };
  const view = mountLogs(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, podRef, ['main', 'sidecar', 'init']); cleanup(root, () => view.dispose()); view.setVisible(true); await setImmediate();
  selectTrigger(root, '日志容器（含 init / ephemeral）').click(); selectOptions().find((node) => node.textContent === 'sidecar')!.click();
  selectTrigger(root, '日志容器（含 init / ephemeral）').click(); selectOptions().find((node) => node.textContent === 'init')!.click(); await setImmediate();
  finish(success(logPage({ id: 'retired-main' }))); await setImmediate();
  assert.deepEqual(posts, ['main', 'init']); assert.ok(deleted.includes('retired-main')); assert.equal(root.querySelector('[aria-label="日志内容"]')!.textContent!.includes('warning'), false); assert.match(root.querySelector('[aria-label="日志内容"]')!.textContent!, /init/);
});

test('invalid log edits issue no request, valid edits debounce and time controls remain mutually exclusive', async (t) => {
  const root = dom(t); const commands: LogCommand[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => { if (options?.method === 'POST') commands.push(options.body as LogCommand); return success(logPage() as T); };
  const view = mountLogs(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, podRef, ['main']); cleanup(root, () => view.dispose());
  const inputs = root.querySelectorAll('input'); inputs[0]!.value = '0'; inputs[0]!.dispatchEvent(new Event('input', { bubbles: true })); view.setVisible(true); await setImmediate();
  assert.equal(commands.length, 0); assert.match(root.textContent!, /日志参数无效/);
  inputs[0]!.value = '2'; inputs[0]!.dispatchEvent(new Event('input', { bubbles: true })); inputs[0]!.value = '20'; inputs[0]!.dispatchEvent(new Event('input', { bubbles: true })); await delay(340);
  assert.equal(commands.length, 1); assert.equal(commands[0]!.tailLines, 20);
  inputs[2]!.value = '2026-10-18T00:00:00.123456789Z'; inputs[2]!.dispatchEvent(new Event('input', { bubbles: true })); await delay(340);
  assert.equal(commands.length, 2); assert.equal(commands[1]!.sinceSeconds, undefined); assert.equal(commands[1]!.sinceTime, '2026-10-18T00:00:00.123456789Z'); assert.equal(inputs[1]!.value, '');
});

test('leaving following logs stops the stream and returning never automatically reconnects or restores follow', async (t) => {
  const root = dom(t); const follows: boolean[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => {
    if (options?.method === 'POST') { const follow = (options.body as LogCommand).follow; follows.push(follow); return success(logPage({ id: `log-${follows.length}`, state: follow ? 'streaming' : 'completed', lines: [], nextCursor: 0, headCursor: 0 }) as T); }
    return success(logPage() as T);
  };
  const view = mountLogs(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, podRef, ['main'], { pollMs: 60000 }); cleanup(root, () => view.dispose()); view.setVisible(true); await setImmediate();
  root.querySelector<HTMLElement>('[role="switch"]')!.click(); await setImmediate(); assert.deepEqual(follows, [false, true]);
  view.setVisible(false); await setImmediate(); view.setVisible(true); await setImmediate(); assert.deepEqual(follows, [false, true]); assert.equal(root.querySelector('[role="switch"]')!.getAttribute('aria-checked'), 'false');
  view.reload(); await setImmediate(); assert.deepEqual(follows, [false, true, false]);
});

test('Manifest preview is on demand and revision choices never turn into an unrequested historical Diff', async (t) => {
  const root = dom(t); const commands: TaskCommand[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { body?: unknown }) => {
    const command = options?.body as TaskCommand; commands.push(command);
    if (command.operation === 'manifests') return taskSuccess(manifests({ manifests: [JSON.stringify({ ...deployment(), spec: { text: '<img src=x onerror=alert(1)>' } })] }, command.selection) as T);
    return taskSuccess({ items: managedResources({ items: [rawComparison()] }), applicationObservation: { sampledAt: 'sample-time', reconciledAt: '', comparedRevisions: ['server-revision'], blocked: false }, note: '服务端规范化比较' } as T);
  };
  const view = mountManifests(root, request, 'primary', applicationDetail(rawApplication())); cleanup(root, () => view.dispose());
  assert.equal(commands.length, 0);
  const input = root.querySelector('input')!; input.value = 'historical/preview'; input.dispatchEvent(new Event('input', { bubbles: true }));
  view.setVisible(true); await setImmediate();
  assert.deepEqual((commands[0] as Extract<TaskCommand, { operation: 'manifests' }>).selection, { revision: 'historical/preview' });
  (root.querySelector('[aria-label="期望 Manifest 资源"] [role="option"]') as HTMLElement).click();
  assert.equal(root.querySelector('img'), null); assert.match(root.textContent!, /<img src=x/);
  resourceButton(root, 'Argo Diff').click(); await setImmediate();
  assert.deepEqual(commands[1], { operation: 'comparison', context: 'primary', name: 'demo', appNamespace: 'argocd' });
  (root.querySelector('[aria-label="Argo Diff 资源"] [role="option"]') as HTMLElement).click();
  assert.match(root.textContent!, /Argo normalized Live/); assert.match(root.textContent!, /Argo predicted Live/); assert.match(root.textContent!, /\/spec\/replicas/);
});

test('multi-source UI requires paired source position and revision and clearly labels combined output', async (t) => {
  const root = dom(t); const commands: TaskCommand[] = [];
  const raw = rawApplication();
  const app = applicationDetail({ ...raw, spec: { ...raw.spec, sources: [raw.spec.source, { repoURL: 'https://example.test/values', ref: 'values', targetRevision: 'main' }] } });
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { body?: unknown }) => {
    const command = options?.body as Extract<TaskCommand, { operation: 'manifests' }>; commands.push(command);
    return taskSuccess(manifests({ manifests: [JSON.stringify(deployment())] }, command.selection) as T);
  };
  const view = mountManifests(root, request, 'primary', app); cleanup(root, () => view.dispose());
  const input = root.querySelector('input')!; input.value = 'values/new'; input.dispatchEvent(new Event('input', { bubbles: true }));
  view.setVisible(true); await setImmediate(); assert.equal(commands.length, 0); assert.match(root.textContent!, /必须同时选择/);
  root.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click();
  [...root.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.startsWith('2:'))!.click();
  await setImmediate();
  assert.deepEqual((commands[0] as Extract<TaskCommand, { operation: 'manifests' }>).selection, { sources: [{ position: 2, revision: 'values/new' }] });
  assert.match(root.textContent!, /合并所有来源/); assert.match(root.textContent!, /不是结果过滤器/);
});

test('comparison UI preserves equal/different/unavailable as distinct states and does not hide transport failures', async (t) => {
  const root = dom(t); let fail = false;
  const base = managedResources({ items: [rawComparison()] })[0]!;
  const request: PanelRequest = async <T>() => fail
    ? { ok: false, error: { code: 'FORBIDDEN', message: 'Denied' }, sampledAt: 'sample' }
    : taskSuccess({ items: [base, { ...base, id: 'equal', status: 'equal', reason: 'ARGO_NORMALIZED_PREDICTED_PAIR' }, { ...base, id: 'unknown', status: 'unavailable', reason: 'NORMALIZED_PAIR_UNAVAILABLE' }], applicationObservation: { sampledAt: 'sample', reconciledAt: '', comparedRevisions: [], blocked: false }, note: 'cached' } as T);
  const view = mountManifests(root, request, 'primary', applicationDetail(rawApplication())); cleanup(root, () => view.dispose());
  resourceButton(root, 'Argo Diff').click(); view.setVisible(true); await setImmediate();
  const list = root.querySelector('[aria-label="Argo Diff 资源"]')!;
  assert.match(list.textContent!, /无差异/); assert.match(list.textContent!, /有差异/); assert.match(list.textContent!, /无法比较/);
  fail = true; resourceButton(root, '重新查询').click(); await setImmediate();
  assert.equal(list.querySelectorAll('[role="option"]').length, 0); assert.match(root.textContent!, /FORBIDDEN/); assert.match(root.textContent!, /不是无差异/);
});

test('hiding a Manifest/Diff view cancels pending creation and ignores the late result', async (t) => {
  const root = dom(t); const methods: string[] = []; let resolve!: (value: Envelope<unknown>) => void;
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { method?: string }) => {
    methods.push(options?.method ?? 'GET');
    if (options?.method === 'POST') return new Promise<Envelope<T>>((done) => { resolve = done as typeof resolve; });
    return success({ id: 'synthetic-id', state: 'cancelled' } as T);
  };
  const view = mountManifests(root, request, 'primary', applicationDetail(rawApplication())); cleanup(root, () => view.dispose());
  view.setVisible(true); view.setVisible(false);
  resolve(taskSuccess(manifests({ manifests: [JSON.stringify(deployment())] }, {}))); await setImmediate();
  assert.deepEqual(methods, ['POST', 'DELETE']); assert.equal(root.querySelectorAll('[role="option"]').length, 0);
});

function logPage(extra: Partial<LogPage> = {}): LogPage {
  return { id: 'synthetic-log-id', state: 'completed', createdAt: 'sample', expiresAt: 'expiry', lastReceivedAt: 'sample', lines: [{ cursor: 1, content: 'warning <img src=x onerror=alert(1)>', timestamp: 'time', pod: 'demo', truncated: false }, { cursor: 2, content: 'error second line', timestamp: 'time', pod: 'demo', truncated: false }], nextCursor: 2, headCursor: 2, oldestCursor: 1, droppedLines: 0, truncatedLines: 0, gap: false, continuity: 'not-guaranteed', ...extra };
}
test('entering logs reads a bounded historical fragment, local filtering and copy still require no model calls', async (t) => {
  const root = dom(t); let calls = 0; const copies: string[] = [];
  const request: PanelRequest = async <T>() => { calls++; return success(logPage() as T); };
  const view = mountLogs(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, podRef, ['main'], { copy: async (text) => { copies.push(text); } }); cleanup(root, () => view.dispose());
  assert.equal(calls, 0); view.setVisible(true); await setImmediate();
  assert.match(root.querySelector('[aria-label="日志内容"]')!.textContent!, /<img src=x/); assert.equal(root.querySelector('img'), null); assert.equal(copies.length, 0);
  const callsBeforeFilter = calls; const filter = [...root.querySelectorAll('label')].find((label) => label.textContent?.startsWith('本地文本过滤'))!.querySelector('input')!;
  filter.value = 'error second'; filter.dispatchEvent(new Event('input', { bubbles: true })); assert.equal(calls, callsBeforeFilter);
  assert.doesNotMatch(root.querySelector('[aria-label="日志内容"]')!.textContent!, /warning/);
  resourceButton(root, '预览后复制日志').click(); assert.equal(copies.length, 0);
  filter.value = 'warning'; filter.dispatchEvent(new Event('input', { bubbles: true }));
  resourceButton(root, '确认复制此预览').click(); await setImmediate(); assert.equal(copies.length, 1); assert.match(copies[0]!, /error second line/); assert.doesNotMatch(copies[0]!, /warning/);
});

test('previous container UI disables follow and sends fixed structured log options', async (t) => {
  const root = dom(t); const commands: LogCommand[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { method?: string; body?: unknown }) => { if (options?.method === 'POST') commands.push(options.body as LogCommand); return success(logPage() as T); };
  const view = mountLogs(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, podRef, ['main']); cleanup(root, () => view.dispose());
  const toggles = root.querySelectorAll<HTMLButtonElement>('[role="switch"]'); toggles[0]!.click(); toggles[1]!.click();
  assert.equal(toggles[0]!.getAttribute('aria-checked'), 'false');
  view.setVisible(true); await setImmediate();
  assert.equal(commands[0]?.follow, false); assert.equal(commands[0]?.previous, true); assert.equal(commands[0]?.container, 'main'); assert.deepEqual(commands[0]?.resource, podRef);
});

test('hidden log view cancels creation on late ID arrival and stops polling', async (t) => {
  const root = dom(t); const methods: string[] = []; let resolve!: (value: Envelope<unknown>) => void;
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { method?: string }) => { methods.push(options?.method ?? 'GET'); if (options?.method === 'POST') return new Promise<Envelope<T>>((done) => { resolve = done as typeof resolve; }); return success(logPage() as T); };
  const view = mountLogs(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, podRef, ['main']); cleanup(root, () => view.dispose());
  view.setVisible(true); await setImmediate(); view.setVisible(false); resolve(success(logPage())); await setImmediate();
  assert.deepEqual(methods, ['POST', 'DELETE']); assert.equal(root.querySelector('[aria-label="日志内容"]')!.textContent, '');
});

test('log cursor polling advances, surfaces gaps/disconnection and requires explicit reconnect', async (t) => {
  const root = dom(t); const cursors: string[] = [];
  const request: PanelRequest = async <T>(_path: string, query?: Record<string, string>, options?: { method?: string }) => {
    if (options?.method === 'POST') return success(logPage({ state: 'starting', lines: [], nextCursor: 0, headCursor: 0 }) as T);
    if (options?.method === 'DELETE') return success(logPage({ state: 'stopped' }) as T);
    cursors.push(query!.after!); return success((cursors.length === 1 ? logPage({ state: 'streaming', gap: true, droppedLines: 2 }) : logPage({ state: 'disconnected', lines: [], error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Disconnected' } })) as T);
  };
  const view = mountLogs(root, request, 'primary', { name: 'demo', appNamespace: 'argocd' }, podRef, ['main'], { pollMs: 1 }); cleanup(root, () => view.dispose());
  view.setVisible(true); await delay(20);
  assert.deepEqual(cursors, ['0', '2']); assert.match(root.textContent!, /disconnected/); assert.match(root.textContent!, /连续性不保证/);
});

function chooseManagement(root: HTMLElement, label: string): void {
  root.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click();
  [...root.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent === label)!.click();
}
test('management domains load only on demand, navigate explicit child namespaces, and show unsupported events separately', async (t) => {
  const root = dom(t); const operations: string[] = []; const navigated: ApplicationReference[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { body?: unknown }) => {
    const command = options?.body as { operation: string }; operations.push(command.operation);
    if (command.operation === 'applicationSets') return taskSuccess(management.applicationSets({ items: [rawAppSet()] }, '') as T);
    if (command.operation === 'applicationSet') return taskSuccess(management.applicationSet(rawAppSet()) as T);
    if (command.operation === 'applicationSetChildren') return taskSuccess(management.applicationSetChildren({ nodes: [{ group: 'argoproj.io', kind: 'Application', name: 'same', namespace: 'team-b' }] }) as T);
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Not available' }, sampledAt: 'sample' };
  };
  const view = mountManagement(root, request, { application: (reference) => navigated.push(reference) }); cleanup(root, () => view.dispose());
  view.setConnection('primary', false); resourceButton(root, '查询管理域（只读）').click(); await setImmediate(); assert.equal(operations.length, 0);
  view.setConnection('primary', true); assert.equal(operations.length, 0); resourceButton(root, '查询管理域（只读）').click(); await setImmediate();
  (root.querySelector('[aria-label="管理域条目"] [role="option"]') as HTMLElement).click(); await setImmediate();
  assert.doesNotMatch(root.textContent!, /opaque-/); assert.match(root.textContent!, /matrix/);
  resourceButton(root, '查询派生应用关联').click(); await setImmediate(); resourceButton(root, '查看应用 team-b/same').click();
  assert.equal(navigated[0]?.appNamespace, 'team-b'); assert.equal(navigated[0]?.name, 'same');
  resourceButton(root, '查询 ApplicationSet 事件（可选 API）').click(); await setImmediate();
  assert.match(root.textContent!, /NOT_FOUND/); assert.match(root.textContent!, /可能不支持/); assert.match(root.textContent!, /GenerationError/);
  assert.deepEqual(operations, ['applicationSets', 'applicationSet', 'applicationSetChildren', 'applicationSetEvents']);
});

test('Project/repository/cluster views retain safe metadata and navigate through app filters', async (t) => {
  const root = dom(t); const filters: ApplicationFilters[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { body?: unknown }) => {
    const command = options?.body as { operation: string };
    const data = command.operation === 'projects' ? management.projects({ items: [rawProject()] }) : command.operation === 'project' ? management.project(rawProject()) : command.operation === 'projectWindows' ? management.windowState({ windows: [] }, 'project') : command.operation === 'repositories' ? management.repositories({ items: [rawRepository()] }) : management.clusters({ items: [rawCluster()] });
    return taskSuccess(data as T);
  };
  const view = mountManagement(root, request, { applications: (value) => filters.push(value) }); cleanup(root, () => view.dispose()); view.setConnection('primary', true);
  chooseManagement(root, 'Project'); resourceButton(root, '查询管理域（只读）').click(); await setImmediate(); (root.querySelector('[aria-label="管理域条目"] [role="option"]') as HTMLElement).click(); await setImmediate();
  assert.match(root.textContent!, /proj:platform:viewer/); resourceButton(root, '查看关联 Project 应用').click(); assert.deepEqual(filters[0], { project: 'platform' });
  resourceButton(root, '查询 Project 活跃同步窗口').click(); await setImmediate(); assert.match(root.textContent!, /不是应用 canSync 判定/);
  chooseManagement(root, '仓库'); resourceButton(root, '查询管理域（只读）').click(); await setImmediate(); (root.querySelector('[aria-label="管理域条目"] [role="option"]') as HTMLElement).click();
  resourceButton(root, '查看关联仓库应用').click(); assert.deepEqual(filters[1], { repo: 'ssh://git.example.test/team/repo' }); assert.doesNotMatch(root.textContent!, /opaque-/);
  chooseManagement(root, '集群'); resourceButton(root, '查询管理域（只读）').click(); await setImmediate(); (root.querySelector('[aria-label="管理域条目"] [role="option"]') as HTMLElement).click();
  resourceButton(root, '查看关联集群应用').click(); assert.deepEqual(filters[2], { cluster: 'https://kubernetes.example.test' }); assert.doesNotMatch(root.textContent!, /opaque-/);
});

test('management context changes cancel late tasks and leave the new context with no old-domain data', async (t) => {
  const root = dom(t); let resolve!: (value: Envelope<unknown>) => void; const methods: string[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { method?: string }) => { methods.push(options?.method ?? 'GET'); if (options?.method === 'POST') return new Promise<Envelope<T>>((done) => { resolve = done as typeof resolve; }); return success({ id: 'synthetic-id', state: 'cancelled' } as T); };
  const view = mountManagement(root, request); cleanup(root, () => view.dispose()); view.setConnection('primary', true);
  resourceButton(root, '查询管理域（只读）').click(); view.setConnection('secondary', true); resolve(taskSuccess(management.applicationSets({ items: [rawAppSet()] }, ''))); await setImmediate();
  assert.deepEqual(methods, ['POST', 'DELETE']); assert.equal(root.querySelectorAll('[aria-label="管理域条目"] [role="option"]').length, 0); assert.match(root.textContent!, /secondary/);
});

test('entering the application sync-window tab reads server status and preserves explicit false', async (t) => {
  const root = dom(t); let calls = 0;
  const request: PanelRequest = async <T>() => { calls++; return taskSuccess(management.windowState({ canSync: false, activeWindows: [], assignedWindows: [] }, 'application') as T); };
  const view = mountWindowStatus(root, request, { operation: 'applicationWindows', context: 'primary', name: 'demo', appNamespace: 'argocd' }); cleanup(root, () => view.dispose());
  assert.equal(calls, 0); view.setVisible(true); await setImmediate(); assert.match(root.textContent!, /canSync: false/); assert.match(root.textContent!, /不使用浏览器时钟/);
});

test('management application references open namespaced details without needing a prior list snapshot', async (t) => {
  const root = dom(t); const calls: Array<{ path: string; query?: Record<string, string> }> = [];
  const request: PanelRequest = async <T>(path: string, query?: Record<string, string>) => { calls.push({ path, ...(query ? { query } : {}) }); return success(applicationDetail(rawApplication('same', 'team-b')) as T); };
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose()); browser.setConnection('primary', true);
  browser.openReference({ name: 'same', appNamespace: 'team-b' }); await setImmediate();
  assert.deepEqual(calls, [{ path: '/v1/application', query: { context: 'primary', name: 'same', appNamespace: 'team-b' } }]);
  assert.match(root.querySelector('.application-detail-age')!.getAttribute('title')!, /详情采样时间/); assert.match(root.textContent!, /team-b/);
});

test('management filter navigation updates controls and performs one ordinary application query', async (t) => {
  const root = dom(t); const calls: string[] = [];
  const raw = rawApplication('other', 'team-b'); raw.spec.project = 'other-project';
  const items = [applicationSummary(rawApplication()), applicationSummary(raw)];
  const request: PanelRequest = async <T>(path: string) => { calls.push(path); return success({ items, totals: applicationCounts(items), matched: applicationCounts(items) } as T); };
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose()); browser.setConnection('primary', true);
  browser.search({ project: 'platform' }); await setImmediate(); assert.deepEqual(calls, ['/v1/applications']);
  const field = selectTrigger(root, 'Project');
  assert.equal(field.textContent, 'platform'); assert.equal(root.querySelectorAll('[role="option"]').length, 1); assert.match(root.textContent!, /argocd\/demo/);
});

function evidenceStore(): EvidenceStore {
  const store = new EvidenceStore(); store.reset('primary', { name: 'demo', appNamespace: 'argocd' });
  store.app({ ...success(applicationDetail(rawApplication())), identityEpoch: 'a'.repeat(43) } as Extract<Envelope<ReturnType<typeof applicationDetail>>, { ok: true }>); return store;
}
test('summary is frozen, revalidated locally and only appended after an explicit confirmation', async (t) => {
  const root = dom(t); const store = evidenceStore(); const composed: string[] = []; let reads = 0; let session = 'chat-a';
  const request: PanelRequest = async <T>(path: string, _query?: Record<string, string>, options?: { body?: unknown }) => {
    assert.equal(path, '/v1/summary'); reads++; const input = options?.body as { context: string; evidence: unknown };
    return success(buildSummary(input.context, parseSummaryEvidence(input.evidence)) as T);
  };
  const view = mountSummary(root, request, store, { session: () => session, compose: async (text) => { composed.push(text); } }); cleanup(root, () => view.dispose());
  assert.equal(reads, 0); resourceButton(root, '生成脱敏摘要预览（不查询 Argo）').click(); await setImmediate(); assert.equal(reads, 1); assert.equal(composed.length, 0);
  assert.match(root.querySelector('[aria-label="排障摘要冻结预览"]')!.textContent!, /argocd\/demo/);
  resourceButton(root, '确认：追加此预览到当前聊天输入框').click(); await setImmediate(); assert.equal(composed.length, 1); assert.match(composed[0]!, /未发送|不可信/);
  resourceButton(root, '生成脱敏摘要预览（不查询 Argo）').click(); await setImmediate(); session = 'chat-b'; resourceButton(root, '确认：追加此预览到当前聊天输入框').click(); await setImmediate(); assert.equal(composed.length, 1); assert.match(root.textContent!, /会话或视图已变化/);
});

test('summary evidence changes discard previews and logs require explicit selection plus inclusion', async (t) => {
  const root = dom(t); const store = evidenceStore(); let records: string[] = [];
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { body?: unknown }) => {
    const input = options?.body as { context: string; evidence: unknown }; const evidence = parseSummaryEvidence(input.evidence); records = evidence.records.map((item) => item.kind); return success(buildSummary(input.context, evidence) as T);
  };
  const view = mountSummary(root, request, store, { session: () => 'chat', compose: async () => assert.fail() }); cleanup(root, () => view.dispose());
  store.logs({ context: 'primary', application: { name: 'demo', appNamespace: 'argocd' }, sampledAt: new Date().toISOString(), lines: ['log fragment'], note: 'selected' });
  resourceButton(root, '生成脱敏摘要预览（不查询 Argo）').click(); await setImmediate(); assert.equal(records.includes('logs'), false);
  root.querySelector<HTMLButtonElement>('[role="switch"]')!.click(); assert.equal(root.querySelectorAll('[aria-label="排障摘要冻结预览"] button').length, 0);
  resourceButton(root, '生成脱敏摘要预览（不查询 Argo）').click(); await setImmediate(); assert.equal(records.includes('logs'), true);
  store.reset('other'); assert.equal(root.querySelector('[aria-label="排障摘要冻结预览"]')!.textContent, '');
});

test('application detail navigation has labeled panels and pauses hidden views without extra queries', async (t) => {
  const root = dom(t); let calls = 0;
  const request: PanelRequest = async <T>(path: string) => { calls++; return path === '/v1/tasks' ? taskSuccess(resourceTree(rawTree()) as T) : success(applicationDetail(rawApplication()) as T); };
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose()); browser.setConnection('primary', true); browser.openReference({ name: 'demo', appNamespace: 'argocd' }); await setImmediate();
  const nav = root.querySelector('[aria-label="应用排障视图"]')!; const tabs = nav.querySelectorAll<HTMLElement>('[role="tab"]');
  assert.equal(tabs.length, 4); const first = tabs[0]!; const pane = root.querySelector<HTMLElement>(`#${first.getAttribute('aria-controls')}`)!; assert.equal(pane.hidden, false); assert.equal(pane.getAttribute('aria-labelledby'), first.id);
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await setImmediate(); assert.equal(nav.querySelector('[aria-selected="true"]')!.textContent, '资源 / 事件 / 日志'); assert.equal(calls, 2);
});

function persistentHost(initial?: unknown) {
  const values = new Map<string, JsonValue>(); if (initial) values.set(navigationKey(hostReady().directory!), JSON.parse(JSON.stringify(initial)));
  const accesses: Array<{ key: string; scope: string | undefined }> = [];
  const host: WorkspaceHost = {
    storage: {
      get: async (key, options) => { accesses.push({ key, scope: options?.scope }); return values.get(key); },
      set: async (key, value, options) => { accesses.push({ key, scope: options?.scope }); values.set(key, structuredClone(value)); },
      delete: async () => assert.fail(), keys: async () => [...values.keys()],
    }, writeClipboard: async () => assert.fail(), compose: async () => assert.fail(),
  };
  return { host, values, accesses };
}

test('normal startup falls back to the CLI current context for missing, empty or unavailable navigation storage', async (t) => {
  const root = dom(t);
  for (const mode of ['missing', 'empty', 'failure', 'directoryless']) {
    const saved = savedNavigation(); saved.context = '';
    const { host } = persistentHost(mode === 'empty' ? saved : undefined); const calls: Array<{ path: string; context?: string }> = [];
    if (mode === 'failure') host.storage.get = async () => { throw new Error('Storage unavailable'); };
    const request: PanelRequest = async <T>(path: string, query?: Record<string, string>) => {
      calls.push({ path, ...(query?.context ? { context: query.context } : {}) });
      return success((path === '/v1/contexts' ? { contexts: [{ name: 'first', current: false, core: false }, { name: 'current', current: true, core: false }], networkEnabled: true } : listData()) as T);
    };
    const view = mountWorkspace(root, request, host, { ...hostReady(), ...(mode === 'directoryless' ? { directory: null } : {}) }); await setImmediate();
    assert.deepEqual(calls, [{ path: '/v1/contexts' }, { path: '/v1/applications', context: 'current' }], mode);
    assert.equal(selectTrigger(root, 'Context').textContent, 'current'); assert.equal(root.querySelector<HTMLDetailsElement>('.workspace-more')!.open, false);
    view.dispose();
  }
});

test('first startup while hidden defers all reads until visible and starts only once', async (t) => {
  const root = dom(t); const { host } = persistentHost(); const calls: string[] = [];
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  const request: PanelRequest = async <T>(path: string) => { calls.push(path); return success((path === '/v1/contexts' ? { contexts: [{ name: 'primary', current: true, core: false }], networkEnabled: true } : listData()) as T); };
  const view = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => view.dispose()); await setImmediate(); assert.deepEqual(calls, []);
  Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); await setImmediate(); document.dispatchEvent(new Event('visibilitychange')); await setImmediate();
  assert.deepEqual(calls, ['/v1/contexts', '/v1/applications']);
});

test('project navigation restores fresh data, selection/tabs/layout, and survives session changes and panel remounts without storing payloads', async (t) => {
  const root = dom(t); const { host, values, accesses } = persistentHost(savedNavigation()); const calls: string[] = [];
  const request: PanelRequest = async <T>(path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => {
    calls.push(path);
    if (path === '/v1/contexts') return success({ contexts: [{ name: 'primary', current: true, core: false }, { name: 'secondary', current: false, core: false }], networkEnabled: true } as T);
    if (path === '/v1/applications') return success(listData() as T);
    if (path === '/v1/application') return success(applicationDetail(rawApplication()) as T);
    assert.equal(path, '/v1/tasks'); const command = options!.body as TaskCommand;
    return taskSuccess((command.operation === 'resourceTree' ? resourceTree(rawTree()) : command.operation === 'events' ? resourceEvents({ items: [rawEvent()] }, podRef) : liveResource({ manifest: JSON.stringify(rawPod()) }, podRef)) as T);
  };
  const first = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => first.dispose()); await setImmediate();
  assert.deepEqual(calls, ['/v1/contexts', '/v1/applications', '/v1/application', '/v1/tasks', '/v1/tasks']);
  assert.equal(selectTrigger(root, 'Context').textContent, 'primary'); assert.equal(selectTrigger(root, 'Project').textContent, 'platform');
  assert.equal(root.dataset.density, 'comfortable');
  assert.equal(root.querySelector('.application-columns')!.getAttribute('data-list-collapsed'), 'true');
  assert.equal(root.querySelector('[role="separator"]')!.getAttribute('aria-valuenow'), '328');
  assert.equal(root.querySelector('.resource-columns [role="separator"]')!.getAttribute('aria-valuenow'), '260');
  assert.equal(root.querySelector('[role="treeitem"][aria-selected="true"]')!.getAttribute('data-kind'), 'Pod');
  assert.match(root.querySelector('[aria-label="资源事件"]')!.textContent!, /BackOff/);
  root.querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const beforeSession = calls.length; first.setSession({ id: 'another-session', title: 'Another chat', busy: false }); await first.flushPersistence();
  assert.equal(calls.length, beforeSession); assert.match(root.querySelector('[aria-label="资源事件"]')!.textContent!, /BackOff/);
  const stored = JSON.stringify(values.get(navigationKey(hostReady().directory!)));
  assert.match(stored, /"width":344/); assert.match(stored, /"selected":\{"name":"demo","appNamespace":"argocd"\}/);
  assert.doesNotMatch(stored, /CrashLoopBackOff|BackOff|private-|"(?:manifest|conditions|sources|credentials|sampledAt)":|synthetic-session|another-session/);
  assert.ok(accesses.every((entry) => entry.scope === 'device'));
  first.dispose(); const second = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => second.dispose()); await setImmediate();
  assert.equal(calls.length, beforeSession * 2); assert.equal(root.querySelector('[role="separator"]')!.getAttribute('aria-valuenow'), '344');
  assert.match(root.querySelector('[aria-label="资源事件"]')!.textContent!, /BackOff/);
  assert.equal(root.querySelectorAll('[aria-label="冻结排障摘要预览"] button').length, 0);
});

test('saved log tabs restore the Pod overview without starting or reconnecting logs', async (t) => {
  const root = dom(t); const initial = savedNavigation(); const modified = JSON.parse(JSON.stringify(initial)); modified.applications.resources.detailTab = 'logs';
  const { host } = persistentHost(modified); const commands: string[] = [];
  const request: PanelRequest = async <T>(path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => {
    if (path === '/v1/contexts') return success({ contexts: [{ name: 'primary', current: true, core: false }], networkEnabled: true } as T);
    if (path === '/v1/applications') return success(listData() as T);
    if (path === '/v1/application') return success(applicationDetail(rawApplication()) as T);
    assert.equal(path, '/v1/tasks'); const command = options!.body as TaskCommand; commands.push(command.operation);
    return taskSuccess((command.operation === 'resourceTree' ? resourceTree(rawTree()) : liveResource({ manifest: JSON.stringify(rawPod()) }, podRef)) as T);
  };
  const workspace = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => workspace.dispose()); await setImmediate();
  assert.deepEqual(commands, ['resourceTree', 'resource']); assert.match(root.querySelector('[aria-label="Live 资源"]')!.textContent!, /CrashLoopBackOff/);
  assert.equal(root.querySelector('[aria-label="资源事件"]')!.textContent, '');
});

test('navigation storage is directory-isolated, unavailable on status surfaces, and uses instance scope only when device storage is not advertised', async (t) => {
  const root = dom(t); const { host, accesses } = persistentHost(savedNavigation()); let requests = 0;
  const request: PanelRequest = async <T>() => { requests++; return success({ contexts: [], networkEnabled: true } as T); };
  const other = mountWorkspace(root, request, host, { ...hostReady(), directory: '/another-project' }); await setImmediate(); other.dispose();
  assert.equal(requests, 1); assert.ok(accesses.some((entry) => entry.key === navigationKey('/another-project')));
  accesses.length = 0; const status = mountWorkspace(root, request, host, { ...hostReady(), surface: 'status' }); await setImmediate(); status.dispose(); assert.equal(accesses.length, 0);
  const old = mountWorkspace(root, request, host, { ...hostReady(), directory: '/older-host-project', features: {} }); cleanup(root, () => old.dispose()); await setImmediate();
  root.querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await old.flushPersistence();
  assert.ok(accesses.every((entry) => entry.scope === 'instance')); assert.equal(requests, 2);
});

test('late storage restore cannot overwrite fresh user filters, nor populate a disposed panel', async (t) => {
  const root = dom(t); let resolve!: (state: JsonValue) => void; let requests = 0;
  const { host } = persistentHost(); host.storage.get = async (key) => key === 'observer.view.v1' ? undefined : new Promise((done) => { resolve = done; });
  const request: PanelRequest = async <T>() => { requests++; return success({} as T); };
  const workspace = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => workspace.dispose()); await setImmediate();
  const input = root.querySelector<HTMLInputElement>('.application-search input')!; input.value = 'user-changed'; input.dispatchEvent(new Event('input', { bubbles: true }));
  resolve(JSON.parse(JSON.stringify(savedNavigation()))); await setImmediate(); assert.equal(input.value, 'user-changed'); assert.equal(requests, 0);
  workspace.dispose(); const next = mountWorkspace(root, request, host, hostReady()); await setImmediate(); next.dispose(); resolve(JSON.parse(JSON.stringify(savedNavigation()))); await setImmediate(); assert.equal(root.textContent, ''); assert.equal(requests, 0);
});

test('saved navigation waits while hidden and does not restore removed applications or a recreated resource UID', async (t) => {
  const root = dom(t); const { host } = persistentHost(savedNavigation()); const calls: string[] = []; let changedUid = true;
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  const request: PanelRequest = async <T>(path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => {
    calls.push(path);
    if (path === '/v1/contexts') return success({ contexts: [{ name: 'primary', current: true, core: false }], networkEnabled: true } as T);
    if (path === '/v1/applications') return success((changedUid ? listData() : { items: [], totals: applicationCounts([]), matched: applicationCounts([]) }) as T);
    if (path === '/v1/application') return success(applicationDetail(rawApplication()) as T);
    const command = options!.body as TaskCommand; assert.equal(command.operation, 'resourceTree'); return taskSuccess(resourceTree({ nodes: [{ ...podRef, uid: 'new-instance' }] }) as T);
  };
  const workspace = mountWorkspace(root, request, host, hostReady()); await setImmediate(); assert.equal(calls.length, 0);
  Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); await setImmediate();
  assert.deepEqual(calls, ['/v1/contexts', '/v1/applications', '/v1/application', '/v1/tasks']); assert.equal(root.querySelector('[role="treeitem"][aria-selected="true"]'), null);
  workspace.dispose(); changedUid = false; const next = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => next.dispose()); await setImmediate();
  assert.deepEqual(calls.slice(4), ['/v1/contexts', '/v1/applications']); assert.equal(root.querySelector('[aria-label="应用详情"]')!.textContent, '');
});

test('a saved non-application tab defers application reads until that tab is entered', async (t) => {
  const root = dom(t); const saved = savedNavigation(); saved.tab = 'diagnostic'; saved.applications.detailTab = 'overview';
  const { host } = persistentHost(saved); const calls: string[] = [];
  const request: PanelRequest = async <T>(path: string) => {
    calls.push(path);
    return success((path === '/v1/contexts' ? { contexts: [{ name: 'primary', current: true, core: false }], networkEnabled: true } : path === '/v1/applications' ? listData() : applicationDetail(rawApplication())) as T);
  };
  const workspace = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => workspace.dispose()); await setImmediate();
  assert.deepEqual(calls, ['/v1/contexts']); assert.equal(root.querySelector('.workspace-navigation [aria-selected="true"]')!.textContent, translate('Diagnostic'));
  resourceButton(root, 'Applications').click(); await setImmediate();
  assert.deepEqual(calls, ['/v1/contexts', '/v1/applications', '/v1/application']); assert.match(root.querySelector('[aria-label="应用详情"]')!.textContent!, /argocd\/demo/);
});

test('a newer user navigation wins over pending restored contexts, and sensitive-boundary mounts do not auto-restore', async (t) => {
  const root = dom(t); const { host } = persistentHost(savedNavigation()); let finish!: (result: Envelope<unknown>) => void; let calls = 0;
  const request: PanelRequest = async <T>() => { calls++; return new Promise<Envelope<T>>((resolve) => { finish = resolve as typeof finish; }); };
  const workspace = mountWorkspace(root, request, host, hostReady()); await setImmediate(); assert.equal(calls, 1);
  resourceButton(root, 'Diagnostic').click();
  finish(success({ contexts: [{ name: 'primary', current: true, core: false }], networkEnabled: true })); await setImmediate();
  assert.equal(root.querySelector('.workspace-navigation [aria-selected="true"]')!.textContent, translate('Diagnostic')); assert.equal(calls, 1);
  workspace.dispose(); const boundary = mountWorkspace(root, request, host, hostReady(), 'Boundary changed', { autoRestore: false }); cleanup(root, () => boundary.dispose()); await setImmediate(); assert.equal(calls, 1);
});

test('a removed saved context does not apply old filters or resource selection to the CLI current context', async (t) => {
  const root = dom(t); const { host } = persistentHost(savedNavigation()); const queries: Array<Record<string, string> | undefined> = [];
  const request: PanelRequest = async <T>(path: string, query?: Record<string, string>) => {
    queries.push(query);
    assert.ok(path === '/v1/contexts' || path === '/v1/applications');
    return success((path === '/v1/contexts' ? { contexts: [{ name: 'secondary', current: true, core: false }], networkEnabled: true } : listData()) as T);
  };
  const workspace = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => workspace.dispose()); await setImmediate();
  assert.deepEqual(queries, [undefined, { context: 'secondary' }]); assert.equal(selectTrigger(root, 'Project').textContent, '全部');
  assert.equal(root.querySelector('[aria-label="应用详情"]')!.textContent, '');
});

test('workspace preferences are harmless enums and theme reapplication preserves mounted controls and inputs', async (t) => {
  const root = dom(t); const writes: JsonValue[] = []; let requests = 0;
  const host: WorkspaceHost = { storage: { get: async () => ({ density: 'comfortable', module: 'management' }), set: async (_key, value) => { writes.push(value); }, delete: async () => {}, keys: async () => [] }, writeClipboard: async () => assert.fail(), compose: async () => assert.fail() };
  const request: PanelRequest = async <T>() => { requests++; return success({} as T); };
  const ready = hostReady(); applyHostReady(ready, document.documentElement); const workspace = mountWorkspace(root, request, host, ready, '', { autoRestore: false }); cleanup(root, () => workspace.dispose());
  await setImmediate(); assert.equal(root.dataset.density, 'comfortable'); assert.equal(requests, 0); assert.ok(writes.every((value) => Object.keys(value!).every((key) => ['density', 'module'].includes(key))));
  assert.ok([...root.querySelectorAll('input')].every((input) => input.hasAttribute('aria-label')));
  const input = root.querySelector('input')!; input.value = 'keep-user-input'; const buttons = root.querySelectorAll('button').length;
  applyHostReady(hostReady('dark'), document.documentElement); workspace.setSession(ready.session);
  assert.equal(input.value, 'keep-user-input'); assert.equal(root.querySelectorAll('button').length, buttons); assert.equal(document.documentElement.dataset.ocTheme, 'dark');
});

test('disposing a workspace prevents pending host context responses from repopulating a replacement view', async (t) => {
  const root = dom(t); let resolve!: (value: Envelope<unknown>) => void;
  const host: WorkspaceHost = { storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] }, writeClipboard: async () => {}, compose: async () => assert.fail() };
  const request: PanelRequest = async <T>() => new Promise<Envelope<T>>((done) => { resolve = done as typeof resolve; });
  const workspace = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => workspace.dispose()); resourceButton(root, '加载 contexts').click(); workspace.dispose();
  resolve(success({ contexts: [{ name: 'old-secret-context', current: true, core: false, server: 'server', user: 'user' }], networkEnabled: true })); await setImmediate(); assert.equal(root.textContent, '');
});

test('load contexts selects the CLI current context and shows applications without extra steps; switching drops late responses', async (t) => {
  const root = dom(t); const calls: Array<{ path: string; context?: string }> = []; let finish!: (value: Envelope<unknown>) => void;
  const host: WorkspaceHost = { storage: { get: async () => ({ density: 'compact', module: 'summary' }), set: async () => {}, delete: async () => {}, keys: async () => [] }, writeClipboard: async () => {}, compose: async () => assert.fail() };
  const request: PanelRequest = async <T>(path: string, query?: Record<string, string>) => {
    calls.push({ path, ...(query?.context ? { context: query.context } : {}) });
    if (path === '/v1/contexts') return success({ contexts: [{ name: 'primary', current: true, core: false, server: 'server', user: 'user' }, { name: 'secondary', current: false, core: false, server: 'server', user: 'user' }], networkEnabled: true } as T);
    assert.equal(path, '/v1/applications');
    if (query?.context === 'primary') return new Promise<Envelope<T>>((done) => { finish = done as typeof finish; });
    const items = [applicationSummary(rawApplication('secondary-app'))]; return success({ items, totals: applicationCounts(items), matched: applicationCounts(items) } as T);
  };
  const workspace = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => workspace.dispose()); await setImmediate();
  assert.equal(calls.length, 2); assert.equal(root.querySelector('[aria-label="Argo CD 主导航"] [aria-selected="true"]')!.textContent, translate('Applications'));
  assert.deepEqual(calls, [{ path: '/v1/contexts' }, { path: '/v1/applications', context: 'primary' }]);
  root.querySelector<HTMLButtonElement>('[aria-label="Argo CD 连接"] button[aria-haspopup="listbox"]')!.click();
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === 'secondary')!.click(); await setImmediate();
  assert.equal(calls.at(-1)?.context, 'secondary'); assert.match(root.querySelector('[aria-label="Argo CD 应用"]')!.textContent!, /secondary-app/);
  finish(success(listData())); await setImmediate(); assert.doesNotMatch(root.querySelector('[aria-label="Argo CD 应用"]')!.textContent!, /argocd\/demo/);
  assert.doesNotMatch(root.textContent!, /页面隐藏/);
  assert.equal(root.querySelector<HTMLElement>(`[aria-label="${translate('Diagnostic')}"]`)!.hidden, true);
});

test('context selection waits while the document is hidden and loads once when visible', async (t) => {
  const root = dom(t); const calls: string[] = [];
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  const request: PanelRequest = async <T>(_path: string, query?: Record<string, string>) => { calls.push(query!.context!); return success(listData() as T); };
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose());
  browser.setConnection('primary', true, true); assert.equal(calls.length, 0);
  browser.setConnection('secondary', true, true);
  Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); await setImmediate();
  assert.deepEqual(calls, ['secondary']); assert.doesNotMatch(root.textContent!, /页面隐藏/);
});

test('expanded searchable dropdowns use the full snapshot, keep options when filtered, and clear without network', async (t) => {
  const root = dom(t); const other = rawApplication('other', 'team-b'); other.spec.project = 'other-project'; other.spec.destination.namespace = 'other-ns';
  const items = [applicationSummary(rawApplication()), applicationSummary(other)]; let calls = 0;
  const request: PanelRequest = async <T>() => { calls++; return success({ items, totals: applicationCounts(items), matched: applicationCounts(items) } as T); };
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose()); browser.setConnection('primary', true, true); await setImmediate();
  assert.equal(root.querySelector<HTMLDetailsElement>('.application-filters')!.open, false);
  assert.equal(root.querySelectorAll('.filter-grid .oc-sdk-select').length, 8); assert.equal(root.querySelectorAll('.application-search input').length, 1);
  selectTrigger(root, 'Project').click(); assert.deepEqual(selectOptions().map((node) => node.textContent), ['全部', 'other-project', 'platform']);
  selectOptions().find((node) => node.textContent === 'platform')!.click(); assert.equal(root.querySelectorAll('[aria-label="Argo CD 应用"] [role="option"]').length, 1);
  selectTrigger(root, 'Project').click(); assert.ok(selectOptions().some((node) => node.textContent === 'other-project'));
  const search = document.querySelector<HTMLInputElement>('.oc-sdk-popup input')!; search.value = 'other'; search.dispatchEvent(new Event('input', { bubbles: true }));
  assert.deepEqual(selectOptions().map((node) => node.textContent), ['other-project']); selectOptions()[0]!.click();
  assert.match(root.querySelector('[aria-label="Argo CD 应用"]')!.textContent!, /team-b\/other/);
  resourceButton(root, '清空筛选').click(); assert.equal(selectTrigger(root, 'Project').textContent, '全部'); assert.equal(root.querySelectorAll('[aria-label="Argo CD 应用"] [role="option"]').length, 2); assert.equal(calls, 1);
  assert.deepEqual(filterChoices(items, 'cluster').map((item) => [item.id, item.label]), [['https://kubernetes.example.test', 'production']]);
  assert.deepEqual(filterChoices(items, 'selector').map((item) => item.id), ['env=production', 'team=platform']);
});

test('context changes clear old dropdown values/candidates and snapshot metadata, including unsupported connections', async (t) => {
  const root = dom(t); let calls = 0;
  const request: PanelRequest = async <T>() => { calls++; return success(listData() as T); };
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose()); browser.setConnection('primary', true, true); await setImmediate();
  selectTrigger(root, 'Project').click(); selectOptions().find((node) => node.textContent === 'platform')!.click();
  assert.equal(selectTrigger(root, 'Project').textContent, 'platform');
  browser.setConnection('secondary', false, true); assert.equal(selectTrigger(root, 'Project').textContent, '全部');
  selectTrigger(root, 'Project').click(); assert.deepEqual(selectOptions().map((node) => node.textContent), ['全部']); selectOptions()[0]!.click();
  assert.equal(root.querySelector('.application-metrics > :last-child')!.hasAttribute('title'), false); assert.equal(root.querySelectorAll('[aria-label="Argo CD 应用"] [role="option"]').length, 0); assert.equal(calls, 1);
});

test('three-line app rows, bounded keyboard/pointer resizing and collapse/back controls retain the selected detail', async (t) => {
  const root = dom(t); const request: PanelRequest = async <T>(path: string) => success((path === '/v1/applications' ? listData() : applicationDetail(rawApplication())) as T);
  const browser = mountApplications(root, request); cleanup(root, () => browser.dispose()); browser.setConnection('primary', true, true); await setImmediate();
  const row = root.querySelector<HTMLElement>('[aria-label="Argo CD 应用"] [role="option"]')!;
  assert.equal(row.children.length, 2); assert.equal(row.children[0]!.children.length, 2); assert.equal(row.children[1]!.className, 'application-status-line'); assert.equal(row.children[1]!.children.length, 3); assert.match(row.title, /^argocd\/demo/);
  row.click(); await setImmediate(); const columns = root.querySelector<HTMLElement>('.application-columns')!; assert.equal(columns.dataset.detailOpen, 'true');
  const divider = root.querySelector<HTMLElement>('[role="separator"]')!; assert.equal(divider.getAttribute('aria-valuenow'), '280');
  divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); assert.equal(divider.getAttribute('aria-valuenow'), '296');
  divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); assert.equal(divider.getAttribute('aria-valuenow'), '420');
  const pointer = (type: string, x: number) => { const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperties(event, { button: { value: 0 }, pointerId: { value: 1 }, clientX: { value: x } }); divider.dispatchEvent(event); };
  pointer('pointerdown', 100); pointer('pointermove', -1000); assert.equal(divider.getAttribute('aria-valuenow'), '220'); pointer('pointercancel', -1000); assert.equal(columns.classList.contains('is-resizing'), false);
  resourceButton(root, '收起应用列表').click(); assert.equal(columns.dataset.listCollapsed, 'true'); assert.match(root.querySelector('[aria-label="应用详情"]')!.textContent!, /argocd\/demo/);
  resourceButton(root, '展开应用列表').click(); assert.equal(columns.dataset.listCollapsed, 'false'); assert.equal(columns.dataset.detailOpen, 'false');
  assert.equal(root.querySelector('[aria-label="Argo CD 应用"] [aria-selected="true"]')!.getAttribute('data-application-id'), 'argocd/demo');
});

test('Diagnostic is an isolated tab; toolbar icon tooltips work with keyboard and leave no nodes after unmount', async (t) => {
  const root = dom(t); const calls: string[] = [];
  const host: WorkspaceHost = { storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] }, writeClipboard: async () => {}, compose: async () => assert.fail() };
  const request: PanelRequest = async <T>(path: string) => { calls.push(path); return success({ service: 'ready', readOnly: true } as T); };
  const workspace = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => workspace.dispose());
  assert.deepEqual([...root.querySelectorAll('[aria-label="Argo CD 主导航"] [role="tab"]')].map((node) => node.textContent), ['Applications', 'Management', 'Summary', 'Diagnostic'].map(translate));
  const load = resourceButton(root, '加载 contexts'); assert.equal(load.getAttribute('aria-label'), '加载 contexts'); assert.equal(load.querySelector('svg')!.getAttribute('aria-hidden'), 'true');
  load.focus(); assert.match(document.querySelector('[role="tooltip"]')!.textContent!, /加载 CLI contexts/); load.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(document.querySelector('[role="tooltip"]'), null);
  resourceButton(root, 'Diagnostic').click(); assert.equal(root.querySelector<HTMLElement>(`[aria-label="${translate('Diagnostic')}"]`)!.hidden, false); assert.equal(root.querySelector<HTMLElement>('[aria-label="应用观测"]')!.hidden, true); assert.equal(calls.length, 0);
  resourceButton(root, '检查宿主 Service').click(); await setImmediate(); assert.deepEqual(calls, ['/v1/diagnostics']); assert.match(root.querySelector('[aria-label="Service 诊断结果"]')!.textContent!, /ready/);
  resourceButton(root, 'Applications').click(); load.focus(); workspace.dispose(); assert.equal(document.querySelector('[role="tooltip"]'), null);
});

test('English host locale localizes chrome, keeps API data opaque, and switches language without another query', async (t) => {
  const root = dom(t); const calls: string[] = []; const saved: Array<{ key: string; value: JsonValue }> = [];
  const host: WorkspaceHost = { storage: { get: async () => undefined, set: async (key, value) => { saved.push({ key, value }); }, delete: async () => {}, keys: async () => [] }, writeClipboard: async () => {}, compose: async () => assert.fail() };
  const request: PanelRequest = async <T>(path: string) => {
    calls.push(path); return success((path === '/v1/contexts' ? { contexts: [{ name: 'primary', current: true, core: false, server: 'server', user: 'user' }], networkEnabled: true } : path === '/v1/applications' ? listData() : applicationDetail(rawApplication())) as T);
  };
  const ready = { ...hostReady(), locale: 'en-US' }; const workspace = mountWorkspace(root, request, host, ready); cleanup(root, () => workspace.dispose()); await setImmediate();
  assert.equal(document.documentElement.lang, 'en');
  assert.deepEqual(calls, ['/v1/contexts', '/v1/applications']); assert.equal(root.querySelector<HTMLDetailsElement>('.application-filters')!.open, false);
  assert.match(root.textContent!, /Showing 2 \/ 2/); assert.doesNotMatch(root.textContent!, /\p{Script=Han}/u);
  selectTrigger(root, 'Project').click(); selectOptions().find((item) => item.textContent === 'platform')!.click();
  workspace.setHostLocale('zh-CN'); await setImmediate();
  assert.equal(document.documentElement.lang, 'zh-CN'); assert.match(root.textContent!, /当前筛选 2/); assert.equal(selectTrigger(root, 'Project').textContent, 'platform'); assert.equal(calls.length, 2);
  assert.ok(saved.every((item) => item.key === 'observer.view.v1' || item.key === navigationKey(ready.directory!)));
  assert.ok(saved.filter((item) => item.key === 'observer.view.v1').every((item) => !JSON.stringify(item.value).includes('primary')));
  workspace.setHostLocale('fr-FR'); assert.equal(document.documentElement.lang, 'fr'); assert.ok(root.textContent!.includes(translate("Read only")));
  workspace.setHostLocale('not-a-known-locale'); assert.equal(document.documentElement.lang, 'en'); assert.equal(calls.length, 2);
  root.querySelector<HTMLElement>('[aria-label="Argo CD applications"] [role="option"]')!.click(); await setImmediate(); assert.match(root.querySelector('[aria-label="Application details"]')!.textContent!, /Sources and configuration/);
  assert.doesNotMatch(root.querySelector('[aria-label="Application details"]')!.textContent!, /\p{Script=Han}/u);
});

test('localization does not translate fetched event/log/manifest text that happens to equal a UI message', async (t) => {
  const root = dom(t); setLanguage('en');
  const base = rawPod(); const pod = { ...base, status: { ...base.status, message: '只读' } };
  renderLiveResource(root, liveResource({ manifest: JSON.stringify(pod) }, podRef));
  assert.ok([...root.querySelectorAll('p')].some((node) => node.textContent === '只读'));
  const app = rawApplication(); app.spec.project = '只读'; app.status.conditions[0]!.message = '只读'; renderApplicationDetail(root, applicationDetail(app));
  assert.ok([...root.querySelectorAll('dd')].some((node) => node.textContent === '只读'));
  assert.ok([...root.querySelectorAll('pre')].some((node) => node.textContent === '只读')); assert.equal(root.querySelector('script'), null);
});

test('all host languages apply live, ignore legacy language preferences and persist no independent language', async (t) => {
  const root = dom(t); const keys: string[] = []; let calls = 0;
  const host: WorkspaceHost = { storage: { get: async (key) => { keys.push(key); return key === 'observer.language.v1' ? 'en' : { density: 'comfortable', module: 'applications' }; }, set: async (key) => { assert.ok(key === 'observer.view.v1' || key === navigationKey(hostReady().directory!)); }, delete: async () => assert.fail(), keys: async () => [] }, writeClipboard: async () => {}, compose: async () => assert.fail() };
  const request: PanelRequest = async <T>() => { calls++; return success({ contexts: [], networkEnabled: true } as T); };
  const workspace = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => workspace.dispose()); await setImmediate();
  assert.equal(root.dataset.density, 'comfortable');
  assert.deepEqual(keys, ['observer.view.v1', navigationKey(hostReady().directory!)]); assert.equal(root.querySelector('.language-select'), null);
  for (const locale of LANGUAGES) {
    workspace.setHostLocale(locale); await setImmediate();
    assert.equal(document.documentElement.lang, locale); assert.equal(document.documentElement.dir, directionFor(locale));
    assert.ok(root.textContent!.includes(translate("Read only"))); assert.equal(root.dataset.density, 'comfortable'); assert.equal(calls, 1);
  }
  workspace.setHostLocale('unknown-language'); assert.equal(document.documentElement.lang, 'en'); assert.equal(document.documentElement.dir, 'ltr');
});

test('RTL host locales mirror tab navigation and splitter movement and localize SDK empty search without touching options', async (t) => {
  const root = dom(t);
  const host: WorkspaceHost = { storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] }, writeClipboard: async () => {}, compose: async () => assert.fail() };
  const request: PanelRequest = async <T>() => success({} as T);
  const workspace = mountWorkspace(root, request, host, { ...hostReady(), locale: 'ar' }); cleanup(root, () => workspace.dispose());
  const first = root.querySelector<HTMLElement>('.workspace-navigation [role="tab"]')!;
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(root.querySelector('.workspace-navigation [aria-selected="true"]')!.textContent, translate('Management'));
  root.querySelector<HTMLElement>('.workspace-navigation [aria-selected="true"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(root.querySelector('.workspace-navigation [aria-selected="true"]')!.textContent, translate('Applications'));
  const divider = root.querySelector<HTMLElement>('[role="separator"]')!;
  divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); assert.equal(divider.getAttribute('aria-valuenow'), '296');
  const pointer = (type: string, x: number) => { const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperties(event, { button: { value: 0 }, pointerId: { value: 1 }, clientX: { value: x } }); divider.dispatchEvent(event); };
  pointer('pointerdown', 100); pointer('pointermove', 60); assert.equal(divider.getAttribute('aria-valuenow'), '336'); pointer('pointercancel', 60);
  selectTrigger(root, 'Project').click(); const search = document.querySelector<HTMLInputElement>('.oc-sdk-popup input')!;
  search.value = 'no-such-project'; search.dispatchEvent(new Event('input', { bubbles: true })); await setImmediate();
  assert.equal(document.querySelector('.oc-sdk-popup-empty')!.textContent, translate("No matches"));
  workspace.dispose(); assert.equal(document.querySelector('.oc-sdk-popup'), null);
});

test('language changes retire frozen summary confirmation without querying Argo or composing stale text', async (t) => {
  const root = dom(t); const paths: string[] = []; let composed = 0;
  const host: WorkspaceHost = { storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] }, writeClipboard: async () => {}, compose: async () => { composed++; } };
  const request: PanelRequest = async <T>(path: string, _query?: Record<string, string>, options?: PanelRequestOptions) => {
    paths.push(path); const input = options?.body as { context: string; evidence: unknown; language: 'en' | 'zh-CN' };
    const value = path === '/v1/contexts' ? { contexts: [{ name: 'primary', current: true, core: false, server: 'server', user: 'user' }], networkEnabled: true }
      : path === '/v1/applications' ? listData() : path === '/v1/application' ? applicationDetail(rawApplication()) : buildSummary(input.context, parseSummaryEvidence(input.evidence), Date.now(), input.language);
    return { ...success(value as T), identityEpoch: 'a'.repeat(43) };
  };
  const workspace = mountWorkspace(root, request, host, hostReady()); cleanup(root, () => workspace.dispose()); await setImmediate();
  root.querySelector<HTMLElement>('[aria-label="Argo CD 应用"] [role="option"]')!.click(); await setImmediate();
  resourceButton(root, 'Summary').click(); resourceButton(root, '生成脱敏摘要预览（不查询 Argo）').click(); await setImmediate();
  const oldConfirm = resourceButton(root, '确认：追加此预览到当前聊天输入框'); const before = paths.length;
  workspace.setHostLocale('en'); await setImmediate(); oldConfirm.click(); await setImmediate();
  assert.equal(paths.length, before); assert.equal(composed, 0); assert.equal(root.querySelector('[aria-label="Frozen troubleshooting summary preview"]')!.textContent, '');
  assert.equal(root.querySelector('[aria-selected="true"]')!.textContent, 'Summary'); assert.equal(selectTrigger(root, 'Context').textContent, 'primary');
  assert.deepEqual(paths, ['/v1/contexts', '/v1/applications', '/v1/application', '/v1/summary']);
});

test('summary confirmation rechecks Service/identity and refuses changed or expired evidence before compose', async (t) => {
  const root = dom(t); const store = evidenceStore(); let calls = 0; let composed = 0;
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { body?: unknown }) => {
    calls++; if (calls > 1) return { ok: false, sampledAt: new Date().toISOString(), error: { code: 'EXPIRED', message: 'Identity no longer matches.' } };
    const input = options?.body as { context: string; evidence: unknown }; return success(buildSummary(input.context, parseSummaryEvidence(input.evidence)) as T);
  };
  const view = mountSummary(root, request, store, { session: () => 'chat', compose: async () => { composed++; } }); cleanup(root, () => view.dispose());
  resourceButton(root, '生成脱敏摘要预览（不查询 Argo）').click(); await setImmediate();
  resourceButton(root, '确认：追加此预览到当前聊天输入框').click(); await setImmediate(); assert.equal(calls, 2); assert.equal(composed, 0); assert.match(root.textContent!, /重新预览；未写入/);
  assert.equal(root.querySelector('[aria-label="排障摘要冻结预览"]')!.textContent, '');
});

test('session change during the confirmation recheck cannot compose into another chat', async (t) => {
  const root = dom(t); const store = evidenceStore(); let calls = 0; let session = 'chat-a'; let finish!: () => void;
  const request: PanelRequest = async <T>(_path: string, _query?: Record<string, string>, options?: { body?: unknown }) => {
    calls++; if (calls === 2) await new Promise<void>((resolve) => { finish = resolve; });
    const input = options?.body as { context: string; evidence: unknown }; return success(buildSummary(input.context, parseSummaryEvidence(input.evidence)) as T);
  };
  const view = mountSummary(root, request, store, { session: () => session, compose: async () => assert.fail('Must not compose into changed session.') }); cleanup(root, () => view.dispose());
  resourceButton(root, '生成脱敏摘要预览（不查询 Argo）').click(); await setImmediate();
  resourceButton(root, '确认：追加此预览到当前聊天输入框').click(); session = 'chat-b'; view.invalidate(); finish(); await setImmediate(); assert.equal(calls, 2);
});

test('offline end-to-end workspace traverses real Service/tasks/log stream and composes only the selected redacted summary', async (t) => {
  const root = dom(t); const upstreamRequests: string[] = []; let hostReads = 0; const composed: string[] = [];
  const upstream = createServer((req, res) => {
    upstreamRequests.push(req.url!); assert.equal(req.method, 'GET'); assert.doesNotMatch(req.url!, /refresh|\/sync$/);
    res.setHeader('content-type', 'application/json'); const url = new URL(req.url!, 'http://localhost'); let value: unknown;
    if (url.pathname.endsWith('/logs')) { res.end(logPacket('synthetic-original <img src=x> log fragment') + lastPacket); return; }
    if (url.pathname.endsWith('/resource-tree')) value = rawTree();
    else if (url.pathname.endsWith('/resource')) value = { manifest: JSON.stringify(rawPod()) };
    else if (url.pathname.endsWith('/events')) value = { items: [rawEvent()] };
    else if (url.pathname.endsWith('/managed-resources')) value = { items: [rawComparison()] };
    else if (url.pathname === '/api/v1/applications') value = { items: [rawApplication()] };
    else if (url.pathname === '/api/v1/applications/demo') value = rawApplication();
    else if (url.pathname === '/api/v1/projects') value = { items: [rawProject()] };
    else { res.statusCode = 404; value = {}; }
    res.end(JSON.stringify(value));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { upstream.close(() => resolve()); upstream.closeAllConnections(); }));
  const fixture = await configFixture(t, syntheticConfig(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`));
  const api = new ArgoClient(fixture.provider, new RefreshCoordinator(async () => assert.fail()), true); const service = createService({ token: 'synthetic-e2e-host', client: async () => api });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve)); t.after(() => service.close());
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const transport: PanelRequest = async <T>(path: string, query?: Record<string, string>, options?: PanelRequestOptions) => {
    hostReads++; const result = await fetch(base + path + (query ? '?' + new URLSearchParams(query) : ''), { method: options?.method ?? 'GET', headers: { authorization: 'Bearer synthetic-e2e-host', 'content-type': 'application/json' }, ...(options?.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
    return await result.json() as Envelope<T>;
  };
  const gateway = new ServiceGateway(transport, () => assert.fail('No identity boundary should change in this synthetic scenario.'));
  const host: WorkspaceHost = { storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] }, writeClipboard: async () => assert.fail(), compose: async (request) => { assert.equal(request.mode, 'append'); composed.push(request.text); } };
  const workspace = mountWorkspace(root, gateway.bind(), host, hostReady()); cleanup(root, () => workspace.dispose());
  const until = async (condition: () => boolean) => { for (let i = 0; i < 300; i++) { if (condition()) return; await delay(10); } assert.fail('Expected synthetic UI state not reached.'); };
  assert.equal(hostReads, 0); resourceButton(root, '加载 contexts').click();
  await until(() => Boolean(root.querySelector('[aria-label="Argo CD 应用"] [role="option"]')));
  assert.equal(upstreamRequests.length, 1); // No identity/self-test/manual-query step.
  root.querySelector<HTMLElement>('[aria-label="Argo CD 应用"] [role="option"]')!.click(); await until(() => root.textContent!.includes('应用概览'));
  resourceButton(root, '资源 / 事件 / 日志').click();
  await until(() => Boolean(root.querySelector('[role="treeitem"][data-kind="Pod"]')));
  root.querySelector<HTMLElement>('[role="treeitem"][data-kind="Pod"]')!.click(); await until(() => root.textContent!.includes('CrashLoopBackOff'));
  resourceButton(root, '资源事件').click(); await until(() => root.textContent!.includes('按资源 UID 隔离事件'));
  resourceButton(root, '日志').click(); await until(() => root.querySelector('[aria-label="日志内容"]')?.textContent?.includes('log fragment') ?? false);
  resourceButton(root, '将过滤后的前 10 行加入摘要候选（不发送）').click();
  resourceButton(root, 'Manifest / Diff').click(); resourceButton(root, 'Argo Diff').click(); await until(() => root.textContent!.includes('应用状态另行采样'));
  resourceButton(root, '摘要预览').click();
  const logSwitch = [...root.querySelectorAll<HTMLElement>('[role="switch"]')].find((item) => item.textContent?.includes('包含已主动选择的日志'))!; logSwitch.click();
  const readsBefore = upstreamRequests.length; resourceButton(root, '生成脱敏摘要预览（不查询 Argo）').click(); await until(() => root.querySelector('[aria-label="排障摘要冻结预览"] button') !== null);
  assert.equal(composed.length, 0); resourceButton(root, '确认：追加此预览到当前聊天输入框').click(); await until(() => composed.length === 1);
  assert.equal(upstreamRequests.length, readsBefore); assert.ok(['application', 'conditions', 'resources', 'events', 'diff', 'logs'].every((kind) => composed[0]!.includes(`[${kind}]`)));
  assert.match(composed[0]!, /REDACTED/); assert.doesNotMatch(composed[0]!, /synthetic-original|private-env|private-command|private-annotation|hidden-values/); assert.equal(root.querySelector('img'), null);
  workspace.dispose(); gateway.invalidate(); await delay(30); const stopped = hostReads; await delay(650); assert.equal(hostReads, stopped);
});
