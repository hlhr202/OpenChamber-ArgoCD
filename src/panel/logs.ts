import { mountButton, mountSelect, mountSwitch, mountTextField } from './ui.js';
import { t } from './i18n.js';
import type { LogCommand, LogLine, LogPage } from '../shared/logs.js';
import type { ApplicationReference, ResourceReference } from '../shared/resources.js';
import type { PanelRequest } from './task-client.js';
import type { LogSelection } from '../shared/summary.js';
import { mountIconButton } from './icon-button.js';

function element<K extends keyof HTMLElementTagNameMap>(root: HTMLElement, tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = root.ownerDocument.createElement(tag); node.textContent = tag === 'pre' ? text : t(text); root.append(node); return node;
}
export function mountLogs(root: HTMLElement, request: PanelRequest, context: string, app: ApplicationReference, resource: ResourceReference, containers: string[], options: { copy?: (text: string) => Promise<void>; pollMs?: number; selected?: (selection: LogSelection) => void; clearSelection?: () => void } = {}) {
  let disposed = false; let visible = false; let generation = 0; let session: string | undefined; let editTimer: ReturnType<typeof setTimeout> | undefined; let needsRead = true;
  let controller: AbortController | undefined; let lines: LogLine[] = []; let clientDropped = 0; let started = false; let hadGap = false;
  let container = containers[0] ?? ''; let follow = false; let previous = false; let filter = '';
  const values = { tailLines: '100', sinceSeconds: '3600', sinceTime: '', untilTime: '' };
  const disposers: Array<() => void> = [];
  element(root, 'h4', 'Pod / 容器日志');
  element(root, 'p', '仅内存中的有界日志片段，不是长期存储。连续查看可能断流或丢失；重新连接可能重叠/重复，不承诺无缝连续或自动识别所有秘密。').className = 'description';
  const form = element(root, 'div'); form.className = 'filter-grid';
  const containerField = mountSelect(element(form, 'div'), { label: '日志容器（含 init / ephemeral）', value: container, options: containers.map((name) => ({ id: name, label: name })), onChange: (value) => { container = value; containerField.update({ value }); lines = []; paint(); changed(); } });
  disposers.push(() => containerField.dispose());
  const fields = new Map<string, ReturnType<typeof mountTextField>>();
  for (const [key, label] of [['tailLines', 'tail 行数（1–1000）'], ['sinceSeconds', '最近秒数（1–604800；与开始时间互斥）'], ['sinceTime', '开始时间（UTC RFC3339；填此项需清空秒数）'], ['untilTime', '结束时间（UTC RFC3339；可空）']] as const) {
    const field = mountTextField(element(form, 'div'), { label, value: values[key], onChange: (value) => { values[key] = value; field.update({ value }); if (value && (key === 'sinceSeconds' || key === 'sinceTime')) { const opposite = key === 'sinceSeconds' ? 'sinceTime' : 'sinceSeconds'; values[opposite] = ''; fields.get(opposite)?.update({ value: '' }); } changed(300); } }); fields.set(key, field); disposers.push(() => field.dispose());
  }
  const followField = mountSwitch(form, { label: '连续查看（默认关闭）', checked: false, onChange: (value) => { follow = value; followField.update({ checked: value }); if (value) { previous = false; previousField.update({ checked: false }); } changed(); } });
  const previousField = mountSwitch(form, { label: 'previous：前一次容器实例（仅历史查询）', checked: false, onChange: (value) => { previous = value; previousField.update({ checked: value }); if (value) { follow = false; followField.update({ checked: false }); } changed(); } });
  const filterField = mountTextField(form, { label: '本地文本过滤（只过滤当前保留片段，不发送上游）', value: '', onChange: (value) => { filter = value; filterField.update({ value }); paint(); } });
  disposers.push(() => followField.dispose(), () => previousField.dispose(), () => filterField.dispose());
  const actions = element(root, 'div'); actions.className = 'observer-toolbar'; const status = element(root, 'p', '打开日志标签后读取近期片段；连续查看默认关闭。'); status.setAttribute('role', 'status');
  const stats = element(root, 'p'); const output = element(root, 'pre'); output.setAttribute('aria-label', t('日志内容'));
  const preview = element(root, 'section'); preview.setAttribute('aria-label', t('日志复制预览'));
  const startButton = mountIconButton(actions, { icon: 'reload', label: '重新查询日志', disabled: !container, onClick: () => { void start(); } });
  const stopButton = mountButton(actions, { label: '停止日志', variant: 'secondary', onClick: () => { void stop(); } });
  const previewButton = mountButton(actions, { label: '预览后复制日志', variant: 'ghost', onClick: () => showPreview() });
  const summaryButton = mountButton(actions, { label: '将过滤后的前 10 行加入摘要候选（不发送）', variant: 'ghost', disabled: !options.selected, onClick: () => {
    const selected = shown().slice(0, 10); if (!selected.length) { status.textContent = t('没有可加入摘要的已保留日志。'); return; }
    options.selected?.({ context, application: app, sampledAt: new Date().toISOString(), lines: selected.map((line) => `${line.timestamp} ${line.content}`), note: t`Pod ${resource.namespace}/${resource.name} UID=${resource.uid}; container=${container}; ${stats.textContent}; ${status.textContent}; 这是选择时刻，不是每行事件发生时间。` });
    status.textContent = t('有限日志选段已加入候选；摘要默认仍不含日志，需选择包含、预览并另行确认。');
  } });
  disposers.push(() => startButton.dispose(), () => stopButton.dispose(), () => previewButton.dispose(), () => summaryButton.dispose());
  let previewDisposers: Array<() => void> = [];
  const shown = () => lines.filter((line) => line.content.toLowerCase().includes(filter.toLowerCase()));
  const asText = (items: LogLine[]) => items.map((line) => `${line.timestamp} ${line.pod} ${line.content}${line.truncated ? t(' [行已截断]') : ''}`).join('\n');
  function clearPreview(): void { for (const dispose of previewDisposers) dispose(); previewDisposers = []; preview.replaceChildren(); }
  function showPreview(): void {
    clearPreview(); const content = asText(shown());
    if (!content) { element(preview, 'p', '没有可复制的已保留日志。'); return; }
    const text = `Context: ${context}\nApplication: ${app.appNamespace}/${app.name}\nPod: ${resource.namespace}/${resource.name} UID=${resource.uid}\nContainer: ${container}\n${status.textContent}\n${stats.textContent}\n\n${content}`;
    if (text.length > 32000) { element(preview, 'p', '当前片段超过 32,000 字符复制上限，请先本地过滤；未复制或自动截取。'); return; }
    element(preview, 'p', '确认前请人工检查敏感内容：这是冻结的预览，仅复制这一段，不自动发送给 AI；缓冲淘汰/断流/本地过滤可能造成不完整。'); element(preview, 'pre', text);
    const confirm = mountButton(preview, { label: '确认复制此预览', disabled: !options.copy, onClick: () => {
      confirm.update({ disabled: true }); void options.copy?.(text).then(() => { if (!disposed) element(preview, 'p', '已复制预览；未发送给 AI。'); }).catch(() => { if (!disposed) element(preview, 'p', '宿主剪贴板不可用，未确认复制成功。'); });
    } });
    const cancel = mountButton(preview, { label: '取消复制', variant: 'ghost', onClick: clearPreview });
    previewDisposers.push(() => confirm.dispose(), () => cancel.dispose());
    if (!options.copy) element(preview, 'p', '当前宿主没有提供剪贴板写入能力。');
  }
  function paint(): void { output.textContent = asText(shown()); }
  function changed(ms = 0): void {
    clearTimeout(editTimer); needsRead = true; void stop(); options.clearSelection?.();
    if (!visible || disposed) return;
    if (ms) editTimer = setTimeout(() => { editTimer = undefined; void start(); }, ms); else void start();
  }
  async function close(id: string): Promise<void> { try { await request('/v1/logs', { context, id }, { method: 'DELETE' }); } catch { /* authoritative server lease will expire */ } }
  async function stop(): Promise<void> {
    generation++; controller?.abort(); controller = undefined; const old = session; session = undefined; clearPreview(); startButton.update({ loading: false });
    if (!disposed) status.textContent = t('已停止/暂停日志；现有内容仅为先前片段，不是实时流。');
    if (old) await close(old);
  }
  function accept(page: LogPage): void {
    hadGap ||= page.gap;
    lines.push(...page.lines);
    const size = (line: LogLine) => new TextEncoder().encode(JSON.stringify(line)).length;
    let bytes = lines.reduce((total, line) => total + size(line), 0);
    while (lines.length > 1000 || bytes > 256000) { const line = lines.shift()!; bytes -= size(line); clientDropped++; }
    stats.textContent = t`片段最新接收 ${page.lastReceivedAt || t('尚无')} · 租约/保留到 ${page.expiresAt} · 游标 ${page.nextCursor}/${page.headCursor} · 服务端淘汰 ${page.droppedLines} 行 · 行截断 ${page.truncatedLines} · 本地淘汰 ${clientDropped} 行${hadGap ? t(' · 游标缺口：部分日志已丢失') : ''} · 连续性不保证`;
    status.textContent = t`日志状态 ${page.state}${page.error ? ` · ${page.error.code}: ${t(page.error.message)}` : ''}；空片段不证明容器无异常。`;
    paint();
  }
  async function delay(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, options.pollMs ?? 500); signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done();
    });
  }
  async function start(): Promise<void> {
    if (!visible || disposed || root.ownerDocument.hidden || !container) return;
    clearTimeout(editTimer); editTimer = undefined;
    const stopping = stop(); const version = generation; await stopping;
    if (!visible || disposed || version !== generation) return;
    const validTime = (value: string) => !value || /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value));
    if (!/^\d+$/.test(values.tailLines) || Number(values.tailLines) < 1 || Number(values.tailLines) > 1000 || values.sinceSeconds && (!/^\d+$/.test(values.sinceSeconds) || Number(values.sinceSeconds) < 1 || Number(values.sinceSeconds) > 604800) || !validTime(values.sinceTime) || !validTime(values.untilTime) || values.sinceTime && values.untilTime && Date.parse(values.untilTime) < Date.parse(values.sinceTime)) { status.textContent = t('日志参数无效；请检查行数和时间范围。'); return; }
    const local = new AbortController(); controller = local; needsRead = false;
    lines = []; clientDropped = 0; hadGap = false; output.textContent = ''; stats.textContent = ''; clearPreview(); startButton.update({ loading: true });
    options.clearSelection?.();
    if (started) status.textContent = t('重新读取会开始新片段，不保证与旧片段衔接或去重。'); else status.textContent = t('正在创建日志会话…'); started = true;
    const command: LogCommand = { context, ...app, resource, container, tailLines: Number(values.tailLines), follow, previous,
      ...(values.sinceSeconds ? { sinceSeconds: Number(values.sinceSeconds) } : {}), ...(values.sinceTime ? { sinceTime: values.sinceTime } : {}), ...(values.untilTime ? { untilTime: values.untilTime } : {}) };
    let id: string | undefined;
    try {
      const response = await request<LogPage>('/v1/logs', undefined, { method: 'POST', body: command });
      if (!response.ok) { if (version === generation) status.textContent = `${response.error.code}: ${response.error.message}`; return; }
      id = response.data.id;
      if (version !== generation || local.signal.aborted) return;
      session = id; accept(response.data); let cursor = response.data.nextCursor; let page = response.data;
      while (version === generation && visible && !local.signal.aborted) {
        if (!['starting', 'streaming'].includes(page.state) && cursor >= page.headCursor) break;
        await delay(local.signal); if (local.signal.aborted) break;
        const result = await request<LogPage>('/v1/logs', { context, id, after: String(cursor) });
        if (version !== generation || local.signal.aborted) break;
        if (!result.ok) { status.textContent = `${result.error.code}: ${result.error.message}${t('；轮询已停止，不能保证连续性。')}`; break; }
        page = result.data; accept(page); cursor = page.nextCursor;
      }
    } catch { if (version === generation) status.textContent = t('宿主日志连接失败，轮询已停止；可手动重新连接，可能出现缺口或重复。'); }
    finally {
      if (id) await close(id);
      if (version === generation) { session = undefined; controller = undefined; startButton.update({ loading: false }); }
    }
  }
  return {
    reload(): void { void start(); },
    setVisible(value: boolean): void { if (disposed || value === visible) return; visible = value; if (!value) { clearTimeout(editTimer); editTimer = undefined; void stop(); follow = false; followField.update({ checked: false }); } else if (needsRead) void start(); },
    dispose(): void { if (disposed) return; disposed = true; clearTimeout(editTimer); void stop(); for (const dispose of disposers) dispose(); root.replaceChildren(); },
  };
}
