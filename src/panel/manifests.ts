import { mountButton, mountList, mountSelect, mountTextField } from './ui.js';
import { t } from './i18n.js';
import type { ApplicationDetail } from '../shared/applications.js';
import type { ComparisonList, ManifestList, ManifestSelection, ResourceComparison } from '../shared/manifests.js';
import type { Envelope } from '../shared/contracts.js';
import { queryTask, type PanelRequest } from './task-client.js';
import type { EvidenceStore } from './evidence.js';
import { mountIconButton } from './icon-button.js';
import { mountSections } from './sections.js';

function element<K extends keyof HTMLElementTagNameMap>(root: HTMLElement, tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = root.ownerDocument.createElement(tag); node.textContent = tag === 'pre' ? text : t(text); root.append(node); return node;
}
const labels = { equal: '无差异', different: '有差异', unavailable: '无法比较' } as const;
export function renderComparison(root: HTMLElement, item: ResourceComparison): void {
  element(root, 'h4', `${item.reference.kind} ${item.reference.namespace || '(cluster)'}/${item.reference.name} · ${t(labels[item.status])}`);
  element(root, 'p', t`依据：${item.reason} · server modified=${item.reportedModified ?? t('未提供')}；脱敏可能隐藏差异，不以可见字段相同否定服务端差异标记。`);
  if (item.status !== 'unavailable') element(root, 'pre', item.changedPaths.length ? t`脱敏后可见的 JSON Pointer 变化路径：\n${item.changedPaths.map((path) => path || '(root)').join('\n')}` : t(item.status === 'different' ? '存在差异，但脱敏后没有可显示的变化路径。' : '服务端规范化比较对没有差异；不是整个应用或实时集群一致性的证明。'));
  const pair = element(root, 'div'); pair.className = 'manifest-columns';
  for (const [label, value] of [['Argo normalized Live', item.normalizedLive], ['Argo predicted Live', item.predictedLive]] as const) {
    const column = element(pair, 'section'); element(column, 'h4', label); element(column, 'pre', value === null ? t('null / 不存在；字段缺失时以“无法比较”原因说明为准') : JSON.stringify(value, null, 2));
  }
  const raw = element(root, 'details'); element(raw, 'summary', '查看服务端缓存的原始 Live / Target（已脱敏；不用于本地比较结论）');
  element(raw, 'h4', 'Cached Live'); element(raw, 'pre', JSON.stringify(item.live, null, 2));
  element(raw, 'h4', 'Cached Target'); element(raw, 'pre', JSON.stringify(item.target, null, 2));
}
export function mountManifests(root: HTMLElement, request: PanelRequest, context: string, application: ApplicationDetail, evidence?: EvidenceStore) {
  const disposers: Array<() => void> = []; const controllers = new Set<AbortController>();
  let disposed = false; let visible = false; let generation = 0; let revision = ''; let position = ''; let active = 'desired';
  let manifestExpires = 0; let comparisonExpires = 0; let editTimer: ReturnType<typeof setTimeout> | undefined;
  let manifestGeneration = 0; let comparisonGeneration = 0;
  let manifestController: AbortController | undefined; let comparisonController: AbortController | undefined;
  let manifestData: ManifestList | undefined; let comparisonData: ComparisonList | undefined;
  element(root, 'h3', 'Manifest 与 Argo Diff');
  element(root, 'p', '两种独立查询：期望 Manifest 可预览指定版本；Argo Diff 只读取服务端当前保留的比较结果，不按预览 revision 重新比较，不请求强制刷新。').className = 'description';
  const nav = element(root, 'nav'); const desiredPane = element(root, 'section'); const diffPane = element(root, 'section');
  const form = element(desiredPane, 'div'); form.className = 'filter-grid';
  const revisionField = mountTextField(element(form, 'div'), { label: '期望 Manifest revision（留空使用配置版本）', value: '', onChange: (value) => { revision = value; manifestExpires = 0; revisionField.update({ value }); clearTimeout(editTimer); manifestController?.abort(); editTimer = setTimeout(() => { editTimer = undefined; void loadManifests(true); }, 300); } });
  const sourceField = mountSelect(element(form, 'div'), { label: '多源版本覆盖位置（不是结果过滤器）', value: '', disabled: !application.multipleSources,
    options: [{ id: '', label: '不覆盖，使用所有配置来源' }, ...application.sources.map((source, i) => ({ id: String(i + 1), label: `${i + 1}: ${source.name || source.ref || source.path || source.chart || source.type}` }))],
    onChange: (value) => { position = value; manifestExpires = 0; sourceField.update({ value }); clearTimeout(editTimer); editTimer = undefined; void loadManifests(true); },
  });
  const actions = element(nav, 'div'); actions.className = 'observer-toolbar';
  const manifestStatus = element(desiredPane, 'div'); manifestStatus.setAttribute('role', 'status');
  const manifestRoot = element(desiredPane, 'section'); manifestRoot.setAttribute('aria-label', t('期望 Manifest'));
  const manifestListRoot = element(manifestRoot, 'div'); const manifestDetail = element(manifestRoot, 'section');
  const comparisonStatus = element(diffPane, 'div'); comparisonStatus.setAttribute('role', 'status');
  const comparisonRoot = element(diffPane, 'section'); comparisonRoot.setAttribute('aria-label', 'Argo Diff');
  const comparisonListRoot = element(comparisonRoot, 'div'); const comparisonDetail = element(comparisonRoot, 'section');
  const reload = mountIconButton(actions, { icon: 'reload', label: '重新查询', onClick: () => { if (active === 'desired') void loadManifests(true); else void loadComparison(true); } });
  const tabs = mountSections(nav, [{ id: 'desired', label: '期望 Manifest', pane: desiredPane }, { id: 'diff', label: 'Argo Diff', pane: diffPane }], active, (id) => { stop(); active = id; if (id === 'desired') void loadManifests(); else void loadComparison(); });
  const cancelButton = mountButton(actions, { label: '停止 Manifest/Diff 查询', variant: 'ghost', onClick: () => { stop(); manifestExpires = 0; comparisonExpires = 0; for (const node of root.querySelectorAll<HTMLElement>('[data-comparison-age]')) node.dataset.expires = '0'; paintAges(); element(manifestStatus, 'p', '查询已停止；保留内容为旧快照。'); } });
  function selectManifest(id: string): void {
    const item = manifestData?.items.find((item) => item.id === id); if (!item) return;
    manifestList.update({ selectedId: id }); manifestDetail.replaceChildren();
    element(manifestDetail, 'h4', `${item.reference.kind} ${item.reference.namespace || t('(Namespace 未声明)')}/${item.reference.name || '(generateName)'}`);
    element(manifestDetail, 'p', '只读预览，已脱敏；不证明此资源已部署，也不把缺省 Namespace 推断成目标 Namespace。');
    element(manifestDetail, 'pre', JSON.stringify(item.manifest, null, 2));
  }
  const manifestList = mountList(manifestListRoot, { items: [], ariaLabel: '期望 Manifest 资源', emptyText: '尚未查询期望 Manifest', onSelect: selectManifest });
  function selectComparison(id: string): void {
    const item = comparisonData?.items.find((item) => item.id === id); if (!item) return;
    comparisonList.update({ selectedId: id }); comparisonDetail.replaceChildren(); renderComparison(comparisonDetail, item);
  }
  const comparisonList = mountList(comparisonListRoot, { items: [], ariaLabel: 'Argo Diff 资源', emptyText: '尚未查询 Argo Diff', onSelect: selectComparison });
  disposers.push(() => revisionField.dispose(), () => sourceField.dispose(), () => reload.dispose(), () => tabs.dispose(), () => cancelButton.dispose(), () => manifestList.dispose(), () => comparisonList.dispose());
  function stop(): void {
    generation++; clearTimeout(editTimer); editTimer = undefined; for (const controller of controllers) controller.abort(); controllers.clear();
    reload.update({ loading: false });
    paintAges();
  }
  function current(version: number, controller: AbortController): boolean { return !disposed && visible && version === generation && !controller.signal.aborted; }
  function show<T>(root: HTMLElement, response: Envelope<T>): response is Extract<Envelope<T>, { ok: true }> {
    root.replaceChildren();
    if (!response.ok) { element(root, 'p', `${response.error.code}: ${response.error.message}${t('；不是无差异/空 Manifest。')}`); return false; }
    const node = element(root, 'p'); node.dataset.comparisonAge = t`采样 ${response.sampledAt} · ${response.source ?? 'argo-api'}`;
    node.dataset.expires = response.stale ? '0' : String(Date.parse(response.expiresAt ?? response.sampledAt)); paintAges();
    return true;
  }
  function paintAges(): void {
    for (const node of root.querySelectorAll<HTMLElement>('[data-comparison-age]')) {
      const stale = !visible || Number(node.dataset.expires) <= Date.now(); node.className = stale ? 'snapshot-stale' : 'description';
      node.textContent = `${node.dataset.comparisonAge} · ${t(stale ? '已过期/已停止' : '有限时效快照（不是实时）')}`;
    }
  }
  async function loadManifests(force = false): Promise<void> {
    if (!visible || disposed || active !== 'desired' || root.ownerDocument.hidden) return;
    if (!force && (manifestController && controllers.has(manifestController) && !manifestController.signal.aborted || manifestData && manifestExpires > Date.now())) return;
    const selection: ManifestSelection = {};
    if (application.multipleSources && Boolean(position) !== Boolean(revision.trim())) { manifestStatus.replaceChildren(); element(manifestStatus, 'p', '覆盖多源版本时必须同时选择 source position 与 revision；未发送请求。'); return; }
    if (application.multipleSources && position) selection.sources = [{ position: Number(position), revision }];
    else if (revision.trim()) selection.revision = revision;
    manifestController?.abort(); const controller = new AbortController(); manifestController = controller; controllers.add(controller);
    const version = generation; const requestVersion = ++manifestGeneration;
    manifestData = undefined; manifestList.update({ items: [], selectedId: null }); manifestDetail.replaceChildren(); manifestStatus.replaceChildren(); element(manifestStatus, 'p', '正在生成/读取期望 Manifest…'); reload.update({ loading: true });
    try {
      const response = await queryTask<ManifestList>(request, { operation: 'manifests', context, name: application.name, appNamespace: application.appNamespace, selection }, controller.signal);
      if (!current(version, controller) || requestVersion !== manifestGeneration || !show(manifestStatus, response)) return;
      manifestData = response.data; manifestExpires = response.stale ? 0 : Date.parse(response.expiresAt ?? response.sampledAt); element(manifestStatus, 'p', response.data.note);
      element(manifestStatus, 'p', t`请求选择 ${JSON.stringify(response.data.selection)} · 服务端返回 resolved revision: ${response.data.resolvedRevision || t('未提供，不作推断')}`);
      if (response.data.warnings.length) element(manifestStatus, 'p', response.data.warnings.join(', '));
      manifestList.update({ emptyText: '服务端生成结果为空；不是“已部署”或“无差异”', items: response.data.items.map((item) => ({ id: item.id, title: `${item.reference.kind} ${item.reference.namespace || t('(Namespace 未声明)')}/${item.reference.name || '(generateName)'}`, meta: `${item.reference.group || 'core'}/${item.reference.version}` })) });
      if (manifestData.items[0]) selectManifest(manifestData.items[0].id);
    } catch { if (current(version, controller)) { manifestStatus.replaceChildren(); element(manifestStatus, 'p', 'Manifest 读取失败；不是空成功。'); } }
    finally { controllers.delete(controller); if (current(version, controller) && requestVersion === manifestGeneration) reload.update({ loading: false }); }
  }
  async function loadComparison(force = false): Promise<void> {
    if (!visible || disposed || active !== 'diff' || root.ownerDocument.hidden) return;
    if (!force && (comparisonController && controllers.has(comparisonController) && !comparisonController.signal.aborted || comparisonData && comparisonExpires > Date.now())) return;
    comparisonController?.abort(); const controller = new AbortController(); comparisonController = controller; controllers.add(controller);
    const version = generation; const requestVersion = ++comparisonGeneration;
    comparisonData = undefined; comparisonList.update({ items: [], selectedId: null }); comparisonDetail.replaceChildren(); comparisonStatus.replaceChildren(); element(comparisonStatus, 'p', '正在读取 Argo 比较缓存…'); reload.update({ loading: true });
    try {
      const response = await queryTask<ComparisonList>(request, { operation: 'comparison', context, name: application.name, appNamespace: application.appNamespace }, controller.signal);
      if (!current(version, controller) || requestVersion !== comparisonGeneration || !show(comparisonStatus, response)) return;
      comparisonData = response.data; comparisonExpires = response.stale ? 0 : Date.parse(response.expiresAt ?? response.sampledAt); element(comparisonStatus, 'p', response.data.note);
      evidence?.comparison(response);
      element(comparisonStatus, 'p', t`应用状态另行采样 ${response.data.applicationObservation.sampledAt} · reconciledAt ${response.data.applicationObservation.reconciledAt || t('未知')} · 该观察中的 revisions ${response.data.applicationObservation.comparedRevisions.join(', ') || t('未知')}`);
      if (response.data.applicationObservation.blocked) element(comparisonStatus, 'p', '采样的应用状态包含比较错误或 Sync 未知，资源比较结论全部标为无法比较。');
      comparisonList.update({ emptyText: '当前缓存未返回可比较资源；不等于应用无差异', items: response.data.items.map((item) => ({ id: item.id, title: `${item.reference.kind} ${item.reference.namespace || '(cluster)'}/${item.reference.name}`, meta: `${t(labels[item.status])} · ${item.reason}` })) });
      if (comparisonData.items[0]) selectComparison(comparisonData.items[0].id);
    } catch { if (current(version, controller)) { comparisonStatus.replaceChildren(); element(comparisonStatus, 'p', 'Argo Diff 读取失败，不能判断无差异。'); } }
    finally { controllers.delete(controller); if (current(version, controller) && requestVersion === comparisonGeneration) reload.update({ loading: false }); }
  }
  const timer = setInterval(paintAges, 1000); disposers.push(() => clearInterval(timer));
  return {
    setVisible(value: boolean): void { if (disposed || visible === value) return; visible = value; if (!value) stop(); else if (active === 'desired') void loadManifests(); else void loadComparison(); },
    dispose(): void { if (disposed) return; disposed = true; stop(); for (const dispose of disposers) dispose(); root.replaceChildren(); },
  };
}
