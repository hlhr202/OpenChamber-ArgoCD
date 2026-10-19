import { mountButton, mountSwitch } from './ui.js';
import { t, getLanguage } from './i18n.js';
import type { SummaryPreview } from '../shared/summary.js';
import type { EvidenceStore } from './evidence.js';
import type { PanelRequest } from './task-client.js';

export function mountSummary(root: HTMLElement, request: PanelRequest, store: EvidenceStore, options: { session: () => string | null; compose: (text: string) => Promise<void> }) {
  const document = root.ownerDocument; let generation = 0; let disposed = false; let includeLogs = false;
  const disposers: Array<() => void> = []; let previewDisposers: Array<() => void> = [];
  const element = (tag: string, text: string, parent = root) => { const node = document.createElement(tag); node.textContent = tag === 'pre' ? text : t(text); parent.append(node); return node; };
  element('h2', '排障摘要（预览后放入输入框）'); element('p', '仅汇总已查看/主动选择的有限证据。不会自动发送消息、创建会话或调用模型。原始内容不可信，脱敏不保证发现所有秘密。');
  const status = element('p', '尚无当前应用证据。'); status.setAttribute('role', 'status');
  const actions = element('div', ''); const preview = element('section', ''); preview.setAttribute('aria-label', t('排障摘要冻结预览'));
  const logs = mountSwitch(actions, { label: '包含已主动选择的日志片段（默认不含）', checked: false, onChange: (value) => { includeLogs = value; logs.update({ checked: value }); invalidate(); } });
  const button = mountButton(actions, { label: '生成脱敏摘要预览（不查询 Argo）', onClick: () => { void prepare(); } });
  function invalidate(): void { generation++; for (const dispose of previewDisposers.splice(0)) dispose(); preview.replaceChildren(); button.update({ loading: false }); }
  function update(): void { invalidate(); status.textContent = t`${store.count()} 份有限候选证据；数据变化会废弃旧预览，需再次确认。`; }
  async function prepare(): Promise<void> {
    invalidate(); const evidence = store.snapshot(includeLogs); if (!evidence) { status.textContent = t('请先选择并读取当前应用详情；没有可验证身份代次的证据。'); return; }
    const data = { ...evidence, language: getLanguage() };
    const version = generation; const session = options.session(); button.update({ loading: true });
    try {
      const result = await request<SummaryPreview>('/v1/summary', undefined, { method: 'POST', body: data });
      if (disposed || version !== generation) return;
      if (!result.ok) { status.textContent = `${result.error.code}: ${result.error.message}${t('；未写入输入框。')}`; return; }
      const text = result.data.parts.join('\n\n');
      element('p', t`冻结预览生成 ${result.data.createdAt} · ${result.data.staleRecords} 类过期证据 · 目标会话 ${session ?? t('尚无会话')}。仅确认后追加输入框，不发送。`, preview);
      element('pre', text, preview);
      const confirm = mountButton(preview, { label: '确认：追加此预览到当前聊天输入框', disabled: !session, onClick: () => {
        if (disposed || version !== generation || !session || options.session() !== session || document.hidden) { invalidate(); status.textContent = t('会话或视图已变化，请重新预览。'); return; }
        confirm.update({ disabled: true });
        // Recheck the local Service/process and credential epoch at the
        // actual user action, not just when a potentially old preview opened.
        // This is still not an atomic host-session-bound compose transaction.
        void (async () => {
          const verified = await request<SummaryPreview>('/v1/summary', undefined, { method: 'POST', body: data });
          if (disposed || version !== generation || options.session() !== session || document.hidden) return;
          if (!verified.ok || verified.data.parts.join('\n\n') !== text) { invalidate(); status.textContent = t('身份、脱敏结果或证据时效已变化，请重新预览；未写入输入框。'); return; }
          await options.compose(text);
          if (!disposed && version === generation) status.textContent = t('已追加到输入框；未发送消息或调用模型，请再次检查后由你决定是否发送。');
        })().catch(() => { if (!disposed && version === generation) { invalidate(); status.textContent = t('确认复核或宿主 compose 不可用；未确认写入成功，请重新预览。'); } });
      } });
      const cancel = mountButton(preview, { label: '取消此摘要预览', variant: 'ghost', onClick: invalidate }); previewDisposers.push(() => confirm.dispose(), () => cancel.dispose());
    } catch { if (!disposed && version === generation) status.textContent = t('摘要预览失败或身份/宿主边界变化；未写入输入框。'); }
    finally { if (version === generation) button.update({ loading: false }); }
  }
  disposers.push(() => logs.dispose(), () => button.dispose(), store.subscribe(update));
  const visibility = () => { if (document.hidden) invalidate(); };
  document.addEventListener('visibilitychange', visibility); disposers.push(() => document.removeEventListener('visibilitychange', visibility));
  return { invalidate, dispose(): void { if (disposed) return; disposed = true; invalidate(); for (const dispose of disposers) dispose(); root.replaceChildren(); } };
}
