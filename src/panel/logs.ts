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
  element(root, 'h4', "Pod / container logs");
  element(root, 'p', "Bounded in-memory fragments, not long-term storage. Following may disconnect or lose lines; reconnecting may overlap or duplicate data. Seamless continuity or detection of every secret is not guaranteed.").className = 'description';
  const form = element(root, 'div'); form.className = 'filter-grid';
  const containerField = mountSelect(element(form, 'div'), { label: "Log container (including init / ephemeral)", value: container, options: containers.map((name) => ({ id: name, label: name })), onChange: (value) => { container = value; containerField.update({ value }); lines = []; paint(); changed(); } });
  disposers.push(() => containerField.dispose());
  const fields = new Map<string, ReturnType<typeof mountTextField>>();
  for (const [key, label] of [['tailLines', "Tail lines (1–1000)"], ['sinceSeconds', "Recent seconds (1–604800; mutually exclusive with start time)"], ['sinceTime', "Start time (UTC RFC3339; clear recent seconds)"], ['untilTime', "End time (UTC RFC3339; optional)"]] as const) {
    const field = mountTextField(element(form, 'div'), { label, value: values[key], onChange: (value) => { values[key] = value; field.update({ value }); if (value && (key === 'sinceSeconds' || key === 'sinceTime')) { const opposite = key === 'sinceSeconds' ? 'sinceTime' : 'sinceSeconds'; values[opposite] = ''; fields.get(opposite)?.update({ value: '' }); } changed(300); } }); fields.set(key, field); disposers.push(() => field.dispose());
  }
  const followField = mountSwitch(form, { label: "Follow logs (off by default)", checked: false, onChange: (value) => { follow = value; followField.update({ checked: value }); if (value) { previous = false; previousField.update({ checked: false }); } changed(); } });
  const previousField = mountSwitch(form, { label: "Previous container instance (historical queries only)", checked: false, onChange: (value) => { previous = value; previousField.update({ checked: value }); if (value) { follow = false; followField.update({ checked: false }); } changed(); } });
  const filterField = mountTextField(form, { label: "Local text filter (retained fragment only; not sent upstream)", value: '', onChange: (value) => { filter = value; filterField.update({ value }); paint(); } });
  disposers.push(() => followField.dispose(), () => previousField.dispose(), () => filterField.dispose());
  const actions = element(root, 'div'); actions.className = 'observer-toolbar'; const status = element(root, 'p', "Opening the Logs tab reads a recent fragment; following is off by default."); status.setAttribute('role', 'status');
  const stats = element(root, 'p'); const output = element(root, 'pre'); output.setAttribute('aria-label', t("Log content"));
  const preview = element(root, 'section'); preview.setAttribute('aria-label', t("Log copy preview"));
  const startButton = mountIconButton(actions, { icon: 'reload', label: "Reload logs", disabled: !container, onClick: () => { void start(); } });
  const stopButton = mountButton(actions, { label: "Stop logs", variant: 'secondary', onClick: () => { void stop(); } });
  const previewButton = mountButton(actions, { label: "Preview logs before copying", variant: 'ghost', onClick: () => showPreview() });
  const summaryButton = mountButton(actions, { label: "Add the first 10 filtered lines to summary candidates (do not send)", variant: 'ghost', disabled: !options.selected, onClick: () => {
    const selected = shown().slice(0, 10); if (!selected.length) { status.textContent = t("No retained log lines to add."); return; }
    options.selected?.({ context, application: app, sampledAt: new Date().toISOString(), lines: selected.map((line) => `${line.timestamp} ${line.content}`), note: t`Pod ${resource.namespace}/${resource.name} UID=${resource.uid}; container=${container}; ${stats.textContent}; ${status.textContent}; this is the selection time, not the event time of every line.` });
    status.textContent = t("A limited log fragment was added. Logs remain excluded by default; include, preview and confirm separately.");
  } });
  disposers.push(() => startButton.dispose(), () => stopButton.dispose(), () => previewButton.dispose(), () => summaryButton.dispose());
  let previewDisposers: Array<() => void> = [];
  const shown = () => lines.filter((line) => line.content.toLowerCase().includes(filter.toLowerCase()));
  const asText = (items: LogLine[]) => items.map((line) => `${line.timestamp} ${line.pod} ${line.content}${line.truncated ? t(" [line truncated]") : ''}`).join('\n');
  function clearPreview(): void { for (const dispose of previewDisposers) dispose(); previewDisposers = []; preview.replaceChildren(); }
  function showPreview(): void {
    clearPreview(); const content = asText(shown());
    if (!content) { element(preview, 'p', "No retained logs to copy."); return; }
    const text = `Context: ${context}\nApplication: ${app.appNamespace}/${app.name}\nPod: ${resource.namespace}/${resource.name} UID=${resource.uid}\nContainer: ${container}\n${status.textContent}\n${stats.textContent}\n\n${content}`;
    if (text.length > 32000) { element(preview, 'p', "The fragment exceeds the 32,000-character copy limit. Filter locally first; nothing was copied or automatically clipped."); return; }
    element(preview, 'p', "Check sensitive content manually. This frozen preview is the only text to be copied; it is not sent to AI. Eviction, disconnects and local filtering may make it incomplete."); element(preview, 'pre', text);
    const confirm = mountButton(preview, { label: "Confirm copying this preview", disabled: !options.copy, onClick: () => {
      confirm.update({ disabled: true }); void options.copy?.(text).then(() => { if (!disposed) element(preview, 'p', "Preview copied; not sent to AI."); }).catch(() => { if (!disposed) element(preview, 'p', "Host clipboard unavailable; successful copying is unconfirmed."); });
    } });
    const cancel = mountButton(preview, { label: "Cancel copy", variant: 'ghost', onClick: clearPreview });
    previewDisposers.push(() => confirm.dispose(), () => cancel.dispose());
    if (!options.copy) element(preview, 'p', "This host does not provide clipboard writing.");
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
    if (!disposed) status.textContent = t("Logs stopped/paused; existing content is a previous fragment, not a live stream.");
    if (old) await close(old);
  }
  function accept(page: LogPage): void {
    hadGap ||= page.gap;
    lines.push(...page.lines);
    const size = (line: LogLine) => new TextEncoder().encode(JSON.stringify(line)).length;
    let bytes = lines.reduce((total, line) => total + size(line), 0);
    while (lines.length > 1000 || bytes > 256000) { const line = lines.shift()!; bytes -= size(line); clientDropped++; }
    stats.textContent = t`Last received ${page.lastReceivedAt || t("None yet")} · Lease/retention until ${page.expiresAt} · Cursor ${page.nextCursor}/${page.headCursor} · Server evicted ${page.droppedLines} lines · Truncated ${page.truncatedLines} · Client evicted ${clientDropped} lines${hadGap ? t(" · Cursor gap: some logs were lost") : ''} · Continuity not guaranteed`;
    status.textContent = t`Log state ${page.state}${page.error ? ` · ${page.error.code}: ${t(page.error.message)}` : ''}; an empty fragment does not prove the container is healthy.`;
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
    if (!/^\d+$/.test(values.tailLines) || Number(values.tailLines) < 1 || Number(values.tailLines) > 1000 || values.sinceSeconds && (!/^\d+$/.test(values.sinceSeconds) || Number(values.sinceSeconds) < 1 || Number(values.sinceSeconds) > 604800) || !validTime(values.sinceTime) || !validTime(values.untilTime) || values.sinceTime && values.untilTime && Date.parse(values.untilTime) < Date.parse(values.sinceTime)) { status.textContent = t("Invalid log options. Check the line count and time range."); return; }
    const local = new AbortController(); controller = local; needsRead = false;
    lines = []; clientDropped = 0; hadGap = false; output.textContent = ''; stats.textContent = ''; clearPreview(); startButton.update({ loading: true });
    options.clearSelection?.();
    if (started) status.textContent = t("Reading again starts a new fragment; continuity or deduplication against the previous fragment is not guaranteed."); else status.textContent = t("Creating log session…"); started = true;
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
        if (!result.ok) { status.textContent = `${result.error.code}: ${result.error.message}${t("; polling stopped and continuity is not guaranteed.")}`; break; }
        page = result.data; accept(page); cursor = page.nextCursor;
      }
    } catch { if (version === generation) status.textContent = t("Host log connection failed; polling stopped. Reconnect manually; gaps or duplicates are possible."); }
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
