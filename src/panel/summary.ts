import { mountButton, mountSwitch } from './ui.js';
import { t, getLanguage } from './i18n.js';
import type { SummaryPreview } from '../shared/summary.js';
import type { EvidenceStore } from './evidence.js';
import type { PanelRequest } from './task-client.js';

export function mountSummary(root: HTMLElement, request: PanelRequest, store: EvidenceStore, options: { session: () => string | null; compose: (text: string) => Promise<void> }) {
  const document = root.ownerDocument; let generation = 0; let disposed = false; let includeLogs = false;
  const disposers: Array<() => void> = []; let previewDisposers: Array<() => void> = [];
  const element = (tag: string, text: string, parent = root) => { const node = document.createElement(tag); node.textContent = tag === 'pre' ? text : t(text); parent.append(node); return node; };
  element('h2', "Troubleshooting summary (preview, then append to composer)"); element('p', "Only limited viewed/selected evidence is included. No automatic message sending, session creation or model call. Source content is untrusted; redaction cannot detect every secret.");
  const status = element('p', "No evidence for the current application."); status.setAttribute('role', 'status');
  const actions = element('div', ''); const preview = element('section', ''); preview.setAttribute('aria-label', t("Frozen troubleshooting summary preview"));
  const logs = mountSwitch(actions, { label: "Include explicitly selected log fragments (excluded by default)", checked: false, onChange: (value) => { includeLogs = value; logs.update({ checked: value }); invalidate(); } });
  const button = mountButton(actions, { label: "Preview redacted summary (no Argo query)", onClick: () => { void prepare(); } });
  function invalidate(): void { generation++; for (const dispose of previewDisposers.splice(0)) dispose(); preview.replaceChildren(); button.update({ loading: false }); }
  function update(): void { invalidate(); status.textContent = t`${store.count()} limited candidate records. Data changes invalidate the preview and require confirmation again.`; }
  async function prepare(): Promise<void> {
    invalidate(); const evidence = store.snapshot(includeLogs); if (!evidence) { status.textContent = t("Select and read application details first; no evidence with a verifiable identity epoch is available."); return; }
    const data = { ...evidence, language: getLanguage() };
    const version = generation; const session = options.session(); button.update({ loading: true });
    try {
      const result = await request<SummaryPreview>('/v1/summary', undefined, { method: 'POST', body: data });
      if (disposed || version !== generation) return;
      if (!result.ok) { status.textContent = `${result.error.code}: ${result.error.message}${t("; not added to the composer.")}`; return; }
      const text = result.data.parts.join('\n\n');
      element('p', t`Preview frozen at ${result.data.createdAt} · ${result.data.staleRecords} stale categories · Target session ${session ?? t("No session")}. Confirm to append to the composer; do not send.`, preview);
      element('pre', text, preview);
      const confirm = mountButton(preview, { label: "Confirm: append this preview to the current composer", disabled: !session, onClick: () => {
        if (disposed || version !== generation || !session || options.session() !== session || document.hidden) { invalidate(); status.textContent = t("Session or view changed. Preview again."); return; }
        confirm.update({ disabled: true });
        // Recheck the local Service/process and credential epoch at the
        // actual user action, not just when a potentially old preview opened.
        // This is still not an atomic host-session-bound compose transaction.
        void (async () => {
          const verified = await request<SummaryPreview>('/v1/summary', undefined, { method: 'POST', body: data });
          if (disposed || version !== generation || options.session() !== session || document.hidden) return;
          if (!verified.ok || verified.data.parts.join('\n\n') !== text) { invalidate(); status.textContent = t("Identity, redaction or evidence freshness changed. Preview again; nothing was added to the composer."); return; }
          await options.compose(text);
          if (!disposed && version === generation) status.textContent = t("Appended to the composer; no message sent or model called. Check again and decide whether to send.");
        })().catch(() => { if (!disposed && version === generation) { invalidate(); status.textContent = t("Confirmation recheck or host compose unavailable. Successful insertion is unconfirmed; preview again."); } });
      } });
      const cancel = mountButton(preview, { label: "Cancel this summary preview", variant: 'ghost', onClick: invalidate }); previewDisposers.push(() => confirm.dispose(), () => cancel.dispose());
    } catch { if (!disposed && version === generation) status.textContent = t("Summary preview failed or identity/host boundary changed; nothing was added to the composer."); }
    finally { if (version === generation) button.update({ loading: false }); }
  }
  disposers.push(() => logs.dispose(), () => button.dispose(), store.subscribe(update));
  const visibility = () => { if (document.hidden) invalidate(); };
  document.addEventListener('visibilitychange', visibility); disposers.push(() => document.removeEventListener('visibilitychange', visibility));
  return { invalidate, dispose(): void { if (disposed) return; disposed = true; invalidate(); for (const dispose of disposers) dispose(); root.replaceChildren(); } };
}
