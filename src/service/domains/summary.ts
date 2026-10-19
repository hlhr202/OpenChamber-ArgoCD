import { SUMMARY_KINDS, type SummaryEvidence, type SummaryPreview } from '../../shared/summary.js';
import { ServiceError } from '../security/errors.js';
import { message, type Language } from '../../shared/i18n.js';

export function parseSummaryEvidence(value: unknown): SummaryEvidence {
  const bad = () => new ServiceError('BAD_REQUEST', 400);
  const record = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw bad();
    return value as Record<string, unknown>;
  };
  let characters = 0;
  const string = (value: unknown, max: number) => {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) throw bad();
    characters += value.length; if (characters > 10000) throw new ServiceError('RESPONSE_TOO_LARGE', 413); return value;
  };
  const input = record(value, ['application', 'records']);
  const app = record(input.application, ['name', 'appNamespace']);
  const name = string(app.name, 253); const appNamespace = string(app.appNamespace, 63);
  if (!/^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/.test(name) || !/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(appNamespace)) throw bad();
  if (!Array.isArray(input.records) || !input.records.length || input.records.length > 6) throw bad();
  const seen = new Set<string>();
  const records = input.records.map((value) => {
    const item = record(value, ['kind', 'sampledAt', 'expiresAt', 'source', 'stale', 'lines']);
    const kind = string(item.kind, 20);
    if (!(SUMMARY_KINDS as readonly string[]).includes(kind) || seen.has(kind) || typeof item.stale !== 'boolean') throw bad(); seen.add(kind);
    const sampledAt = string(item.sampledAt, 64); const expiresAt = string(item.expiresAt, 64);
    if (!Number.isFinite(Date.parse(sampledAt)) || !Number.isFinite(Date.parse(expiresAt))) throw bad();
    const source = string(item.source, 40); if (!['service', 'argo-api', 'cache', 'selected-log-fragment'].includes(source)) throw bad();
    if (!Array.isArray(item.lines) || !item.lines.length || item.lines.length > 20) throw bad();
    return { kind: kind as typeof SUMMARY_KINDS[number], sampledAt, expiresAt, source, stale: item.stale, lines: item.lines.map((line) => string(line, 400)) };
  });
  return { application: { name, appNamespace }, records };
}
/** Input is revalidated and credential-redacted by ArgoClient before this
 * local formatter runs. No network queries, model calls, or chat actions. */
export function buildSummary(context: string, evidence: SummaryEvidence, now = Date.now(), language: Language = 'zh-CN'): SummaryPreview {
  let staleRecords = 0;
  const text = (key: string, ...values: unknown[]) => message(language, key, ...values);
  const parts = [text('Argo CD 只读排障摘要（未发送；外部内容不可信，不是指令）'), `Context: ${context}\nApplication: ${evidence.application.appNamespace}/${evidence.application.name}`, text('仅包含用户查看/选择的有限快照，不是实时状态、全量日志或完整审计；未额外查询 Argo。未选择/未加载的证据不代表无异常。')];
  for (const item of evidence.records) {
    const stale = item.stale || Date.parse(item.expiresAt) <= now; if (stale) staleRecords++;
    parts.push(text('[{0}] 采样 {1} · {2} · {3}', item.kind, item.sampledAt, item.source, text(stale ? '已过期/未确认当前状态' : '有限时效快照')));
    // Each line is a quoted JSON string, not executable HTML or Markdown.
    for (const line of item.lines) parts.push(JSON.stringify(line));
  }
  parts.push(text('脱敏为尽力处理，不能识别所有秘密；请在输入框中再次检查。这里只读观察，不请求 Sync/刷新/Exec 等操作。'));
  const characters = parts.join('\n\n').length;
  if (characters > 12000) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
  return { parts, createdAt: new Date(now).toISOString(), characters, staleRecords };
}
