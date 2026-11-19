/**
 * Accessible, zero-dependency operational dialogs for Argo CD mutations.
 * Supports keyboard Escape dismissal, abort/disposal cleanup, danger name-typing
 * confirmation, Sync options (mirroring argocd app sync, including multi-source
 * revisions and retry-limit validation), Rollback, Resource Action params, and
 * JSON/YAML manifest or patch editing.
 */
import { parse as parseYaml } from 'yaml';
import { t } from './i18n.js';
import type { PatchType, PropagationPolicy, ResourceActionItem, SyncResourceTarget } from '../shared/actions.js';
import type { ApplicationDetail } from '../shared/applications.js';
type DeploymentHistoryEntry = ApplicationDetail['history'][number];

const activeDialogs = new Set<{ doc: Document; close: () => void }>();

export function closeAllDialogs(doc?: Document): void {
  for (const entry of [...activeDialogs]) {
    if (!doc || entry.doc === doc) entry.close();
  }
}

export interface ConfirmCheckbox {
  id: string;
  label: string;
  checked?: boolean;
}

export interface ConfirmSelect {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  disabledWhenUnchecked?: string;
}

export interface ConfirmDialogOptions {
  title: string;
  description: string;
  targetLabel?: string;
  confirmLabel?: string;
  danger?: boolean;
  requireInput?: string;
  checkboxes?: ConfirmCheckbox[];
  selects?: ConfirmSelect[];
  signal?: AbortSignal;
}

export interface ConfirmDialogResult {
  confirmed: true;
  flags: Record<string, boolean>;
  selects: Record<string, string>;
}

function createModal(doc: Document, title: string, danger = false) {
  const backdrop = doc.createElement('div');
  backdrop.className = 'argocd-dialog-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', t(title));
  const box = doc.createElement('div');
  box.className = `argocd-dialog${danger ? ' argocd-dialog-danger' : ''}`;
  const heading = doc.createElement('h3');
  heading.textContent = t(title);
  const body = doc.createElement('div');
  body.className = 'argocd-dialog-body';
  const footer = doc.createElement('div');
  footer.className = 'argocd-dialog-footer';
  box.append(heading, body, footer);
  backdrop.append(box);
  doc.body.append(backdrop);
  return { backdrop, box, body, footer };
}

function bindModalDismiss<T>(doc: Document, backdrop: HTMLElement, resolve: (value: T | null) => void, signal?: AbortSignal): (result: T | null) => void {
  let settled = false;
  const finish = (result: T | null) => {
    if (settled) return;
    settled = true;
    activeDialogs.delete(entry);
    doc.removeEventListener('keydown', onKey);
    signal?.removeEventListener('abort', onAbort);
    backdrop.remove();
    resolve(result);
  };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(null); };
  const onAbort = () => finish(null);
  const entry = { doc, close: () => finish(null) };
  activeDialogs.add(entry);
  doc.addEventListener('keydown', onKey);
  signal?.addEventListener('abort', onAbort, { once: true });
  return finish;
}

function makeButton(doc: Document, label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = t(label);
  button.addEventListener('click', onClick);
  return button;
}

export function openConfirmDialog(doc: Document, options: ConfirmDialogOptions): Promise<ConfirmDialogResult | null> {
  if (options.signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const { backdrop, body, footer } = createModal(doc, options.title, options.danger);
    const desc = doc.createElement('p');
    desc.textContent = t(options.description);
    body.append(desc);
    if (options.targetLabel) {
      const target = doc.createElement('code');
      target.className = 'argocd-dialog-target';
      target.textContent = options.targetLabel;
      body.append(target);
    }
    const flags: Record<string, boolean> = {};
    const selectNodes = new Map<string, { el: HTMLSelectElement; dep?: string }>();
    const syncDependentSelects = () => {
      for (const { el, dep } of selectNodes.values()) {
        if (dep) el.disabled = !flags[dep];
      }
    };
    for (const item of options.checkboxes ?? []) {
      flags[item.id] = Boolean(item.checked);
      const row = doc.createElement('label');
      row.className = 'argocd-dialog-check';
      const input = doc.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(item.checked);
      input.addEventListener('change', () => { flags[item.id] = input.checked; syncDependentSelects(); });
      const text = doc.createElement('span');
      text.textContent = t(item.label);
      row.append(input, text);
      body.append(row);
    }
    const selects: Record<string, string> = {};
    for (const item of options.selects ?? []) {
      selects[item.id] = item.value;
      const row = doc.createElement('label');
      row.className = 'argocd-dialog-field';
      const label = doc.createElement('span');
      label.textContent = t(item.label);
      const select = doc.createElement('select');
      for (const opt of item.options) {
        const option = doc.createElement('option');
        option.value = opt.value;
        option.textContent = t(opt.label);
        if (opt.value === item.value) option.selected = true;
        select.append(option);
      }
      select.addEventListener('change', () => { selects[item.id] = select.value; });
      selectNodes.set(item.id, { el: select, ...(item.disabledWhenUnchecked ? { dep: item.disabledWhenUnchecked } : {}) });
      row.append(label, select);
      body.append(row);
    }
    syncDependentSelects();
    let confirmBtn!: HTMLButtonElement;
    if (options.requireInput) {
      const row = doc.createElement('label');
      row.className = 'argocd-dialog-field';
      const prompt = doc.createElement('span');
      prompt.textContent = t`Type ${options.requireInput} to confirm`;
      const input = doc.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.placeholder = options.requireInput;
      input.addEventListener('input', () => { confirmBtn.disabled = input.value.trim() !== options.requireInput; });
      row.append(prompt, input);
      body.append(row);
    }
    const finish = bindModalDismiss(doc, backdrop, resolve, options.signal);
    const cancelBtn = makeButton(doc, 'Cancel', 'argocd-btn', () => finish(null));
    confirmBtn = makeButton(doc, options.confirmLabel ?? 'Confirm', options.danger ? 'argocd-btn argocd-btn-danger' : 'argocd-btn argocd-btn-primary', () => finish({ confirmed: true, flags, selects }));
    if (options.requireInput) confirmBtn.disabled = true;
    footer.append(cancelBtn, confirmBtn);
  });
}

export interface SyncDialogOptions {
  signal?: AbortSignal;
  multipleSources?: boolean;
  sourceCount?: number;
}

export interface SyncDialogResult {
  revision?: string;
  sourcePositions?: number[];
  revisions?: string[];
  prune: boolean;
  dryRun: boolean;
  force: boolean;
  replace: boolean;
  serverSideApply: boolean;
  applyOutOfSyncOnly: boolean;
  retryLimit?: number;
  resources?: SyncResourceTarget[];
}

export function openSyncDialog(doc: Document, target: string, resources?: SyncResourceTarget[], options: SyncDialogOptions = {}): Promise<SyncDialogResult | null> {
  if (options.signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const { backdrop, body, footer } = createModal(doc, 'Sync application');
    const targetEl = doc.createElement('code');
    targetEl.className = 'argocd-dialog-target';
    targetEl.textContent = resources?.length ? `${target} (${resources.map((r) => `${r.kind}/${r.name}`).join(', ')})` : target;
    body.append(targetEl);

    const state: SyncDialogResult = { prune: false, dryRun: false, force: false, replace: false, serverSideApply: false, applyOutOfSyncOnly: false, ...(resources?.length ? { resources } : {}) };
    let revInput: HTMLInputElement | undefined;
    const sourceInputs: Array<{ position: number; input: HTMLInputElement }> = [];

    if (options.multipleSources && (options.sourceCount ?? 0) > 0) {
      const count = Math.min(options.sourceCount!, 20);
      for (let i = 1; i <= count; i++) {
        const row = doc.createElement('label'); row.className = 'argocd-dialog-field';
        const label = doc.createElement('span'); label.textContent = `${t('Target revision (optional)')} #${i}`;
        const input = doc.createElement('input'); input.type = 'text'; input.placeholder = 'HEAD';
        sourceInputs.push({ position: i, input });
        row.append(label, input); body.append(row);
      }
    } else if (!options.multipleSources) {
      const revRow = doc.createElement('label'); revRow.className = 'argocd-dialog-field';
      const revLabel = doc.createElement('span'); revLabel.textContent = t('Target revision (optional)');
      revInput = doc.createElement('input'); revInput.type = 'text'; revInput.placeholder = 'HEAD';
      revRow.append(revLabel, revInput); body.append(revRow);
    }

    const retryRow = doc.createElement('label'); retryRow.className = 'argocd-dialog-field';
    const retryLabel = doc.createElement('span'); retryLabel.textContent = t('Retry limit (optional)');
    const retryInput = doc.createElement('input'); retryInput.type = 'number'; retryInput.min = '0'; retryInput.max = '100'; retryInput.placeholder = '0';
    retryRow.append(retryLabel, retryInput); body.append(retryRow);

    for (const [key, label] of [
      ['prune', 'Prune'],
      ['dryRun', 'Dry run'],
      ['force', 'Force'],
      ['replace', 'Replace'],
      ['serverSideApply', 'Server-Side Apply'],
      ['applyOutOfSyncOnly', 'Apply Out-Of-Sync Only'],
    ] as const) {
      const row = doc.createElement('label'); row.className = 'argocd-dialog-check';
      const input = doc.createElement('input'); input.type = 'checkbox';
      input.addEventListener('change', () => { state[key] = input.checked; });
      const span = doc.createElement('span'); span.textContent = t(label);
      row.append(input, span); body.append(row);
    }

    const errorEl = doc.createElement('p');
    errorEl.className = 'argocd-dialog-error';
    errorEl.hidden = true;
    body.append(errorEl);

    const finish = bindModalDismiss(doc, backdrop, resolve, options.signal);
    footer.append(
      makeButton(doc, 'Cancel', 'argocd-btn', () => finish(null)),
      makeButton(doc, 'Sync', 'argocd-btn argocd-btn-primary', () => {
        const retryRaw = retryInput.value.trim();
        let retryLimit: number | undefined;
        if (retryRaw !== '') {
          const parsedRetry = Number(retryRaw);
          if (!/^\d+$/.test(retryRaw) || !Number.isSafeInteger(parsedRetry) || parsedRetry < 0 || parsedRetry > 100) {
            errorEl.textContent = t('Invalid retry limit (0–100).');
            errorEl.hidden = false;
            return;
          }
          retryLimit = parsedRetry;
        }
        const rev = revInput?.value.trim() ?? '';
        const selectedSources = sourceInputs
          .map(({ position, input }) => ({ position, revision: input.value.trim() }))
          .filter((entry) => entry.revision !== '');
        finish({
          ...state,
          ...(rev ? { revision: rev } : {}),
          ...(selectedSources.length ? {
            sourcePositions: selectedSources.map((s) => s.position),
            revisions: selectedSources.map((s) => s.revision),
          } : {}),
          ...(retryLimit !== undefined ? { retryLimit } : {}),
        });
      }),
    );
  });
}

export interface RollbackDialogResult {
  id: number;
  prune: boolean;
  dryRun: boolean;
}

export function openRollbackDialog(doc: Document, target: string, history: DeploymentHistoryEntry[], initialId?: number, signal?: AbortSignal): Promise<RollbackDialogResult | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const entries = [...history].reverse();
    const { backdrop, body, footer } = createModal(doc, 'Rollback application', true);
    const targetEl = doc.createElement('code'); targetEl.className = 'argocd-dialog-target'; targetEl.textContent = target; body.append(targetEl);
    const row = doc.createElement('label'); row.className = 'argocd-dialog-field';
    const label = doc.createElement('span'); label.textContent = t('Revision history');
    const select = doc.createElement('select');
    for (const item of entries) {
      const opt = doc.createElement('option');
      opt.value = String(item.id);
      opt.textContent = `#${item.id} · ${item.deployedAt || t('Time unknown')} · ${item.revisions.join(', ')}`;
      if (initialId !== undefined && Number(item.id) === initialId) opt.selected = true;
      select.append(opt);
    }
    row.append(label, select); body.append(row);
    let prune = false; let dryRun = false;
    for (const [id, text] of [['prune', 'Prune'], ['dryRun', 'Dry run']] as const) {
      const checkRow = doc.createElement('label'); checkRow.className = 'argocd-dialog-check';
      const input = doc.createElement('input'); input.type = 'checkbox';
      input.addEventListener('change', () => { if (id === 'prune') prune = input.checked; else dryRun = input.checked; });
      const span = doc.createElement('span'); span.textContent = t(text);
      checkRow.append(input, span); body.append(checkRow);
    }
    const finish = bindModalDismiss(doc, backdrop, resolve, signal);
    footer.append(
      makeButton(doc, 'Cancel', 'argocd-btn', () => finish(null)),
      makeButton(doc, 'Rollback', 'argocd-btn argocd-btn-danger', () => finish({ id: Number(select.value), prune, dryRun })),
    );
  });
}

export function openResourceActionDialog(doc: Document, target: string, action: ResourceActionItem, signal?: AbortSignal): Promise<Array<{ name: string; value: string }> | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const { backdrop, body, footer } = createModal(doc, 'Run resource action');
    const targetEl = doc.createElement('code'); targetEl.className = 'argocd-dialog-target'; targetEl.textContent = `${target} · ${action.displayName || action.name}`; body.append(targetEl);
    const inputs = new Map<string, HTMLInputElement>();
    for (const param of action.params) {
      const row = doc.createElement('label'); row.className = 'argocd-dialog-field';
      const label = doc.createElement('span'); label.textContent = param.name;
      const input = doc.createElement('input'); input.type = 'text'; input.value = param.default ?? '';
      inputs.set(param.name, input);
      row.append(label, input); body.append(row);
    }
    const finish = bindModalDismiss(doc, backdrop, resolve, signal);
    footer.append(
      makeButton(doc, 'Cancel', 'argocd-btn', () => finish(null)),
      makeButton(doc, 'Run action', 'argocd-btn argocd-btn-primary', () => finish([...inputs.entries()].map(([name, input]) => ({ name, value: input.value })))),
    );
  });
}

export interface EditorDialogOptions {
  title: string;
  targetLabel?: string;
  initialText: string;
  mode: 'object' | 'patch';
  confirmLabel?: string;
  allowUpsert?: boolean;
  patchTypes?: PatchType[];
  signal?: AbortSignal;
}

export interface EditorDialogResult {
  object?: Record<string, unknown>;
  patch?: string;
  patchType?: PatchType;
  upsert?: boolean;
}

export function openEditorDialog(doc: Document, options: EditorDialogOptions): Promise<EditorDialogResult | null> {
  if (options.signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const { backdrop, body, footer } = createModal(doc, options.title);
    if (options.targetLabel) {
      const targetEl = doc.createElement('code'); targetEl.className = 'argocd-dialog-target'; targetEl.textContent = options.targetLabel; body.append(targetEl);
    }
    const allowedPatchTypes = options.patchTypes?.length ? options.patchTypes : (['merge', 'strategic', 'json'] as const);
    let patchType: PatchType = allowedPatchTypes[0]!;
    let upsert = false;
    if (options.mode === 'patch') {
      const row = doc.createElement('label'); row.className = 'argocd-dialog-field';
      const label = doc.createElement('span'); label.textContent = t('Patch type');
      const select = doc.createElement('select');
      for (const value of allowedPatchTypes) {
        const opt = doc.createElement('option'); opt.value = value; opt.textContent = value; select.append(opt);
      }
      select.addEventListener('change', () => { patchType = select.value as PatchType; });
      row.append(label, select); body.append(row);
    } else if (options.allowUpsert !== false) {
      const row = doc.createElement('label'); row.className = 'argocd-dialog-check';
      const input = doc.createElement('input'); input.type = 'checkbox';
      input.addEventListener('change', () => { upsert = input.checked; });
      const span = doc.createElement('span'); span.textContent = t('Upsert if already exists');
      row.append(input, span); body.append(row);
    }
    const textarea = doc.createElement('textarea');
    textarea.className = 'argocd-dialog-editor';
    textarea.rows = 14;
    textarea.value = options.initialText;
    const errorEl = doc.createElement('p');
    errorEl.className = 'argocd-dialog-error';
    errorEl.hidden = true;
    body.append(textarea, errorEl);

    const finish = bindModalDismiss(doc, backdrop, resolve, options.signal);
    footer.append(
      makeButton(doc, 'Cancel', 'argocd-btn', () => finish(null)),
      makeButton(doc, options.confirmLabel ?? 'Submit', 'argocd-btn argocd-btn-primary', () => {
        try {
          const parsed = parseYaml(textarea.value, { maxAliasCount: 32 }) as unknown;
          if (options.mode === 'patch') {
            if (patchType === 'json' ? !Array.isArray(parsed) : (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
              throw new Error('Invalid patch structure');
            }
            finish({ patch: JSON.stringify(parsed), patchType });
          } else {
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected YAML/JSON object');
            finish({ object: parsed as Record<string, unknown>, ...(options.allowUpsert !== false ? { upsert } : {}) });
          }
        } catch {
          errorEl.textContent = t('Invalid JSON or YAML content.');
          errorEl.hidden = false;
        }
      }),
    );
  });
}

export const PROPAGATION_POLICY_OPTIONS: Array<{ value: PropagationPolicy; label: string }> = [
  { value: 'foreground', label: 'Foreground' },
  { value: 'background', label: 'Background' },
];
