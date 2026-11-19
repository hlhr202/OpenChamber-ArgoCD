/**
 * Accessible, zero-dependency operational dialogs for Argo CD mutations.
 * Supports keyboard Escape dismissal, danger name-typing confirmation,
 * Sync options (mirroring argocd app sync), Rollback, Resource Action params,
 * and JSON/YAML manifest or patch editing.
 */
import { parse as parseYaml } from 'yaml';
import { t } from './i18n.js';
import type { PatchType, PropagationPolicy, ResourceActionItem, SyncResourceTarget } from '../shared/actions.js';
import type { ApplicationDetail } from '../shared/applications.js';
type DeploymentHistoryEntry = ApplicationDetail['history'][number];

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

function makeButton(doc: Document, label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = t(label);
  button.addEventListener('click', onClick);
  return button;
}

export function openConfirmDialog(doc: Document, options: ConfirmDialogOptions): Promise<ConfirmDialogResult | null> {
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
    for (const item of options.checkboxes ?? []) {
      flags[item.id] = Boolean(item.checked);
      const row = doc.createElement('label');
      row.className = 'argocd-dialog-check';
      const input = doc.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(item.checked);
      input.addEventListener('change', () => { flags[item.id] = input.checked; });
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
      row.append(label, select);
      body.append(row);
    }
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
    const finish = (result: ConfirmDialogResult | null) => {
      doc.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(result);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(null); };
    doc.addEventListener('keydown', onKey);
    const cancelBtn = makeButton(doc, 'Cancel', 'argocd-btn', () => finish(null));
    confirmBtn = makeButton(doc, options.confirmLabel ?? 'Confirm', options.danger ? 'argocd-btn argocd-btn-danger' : 'argocd-btn argocd-btn-primary', () => finish({ confirmed: true, flags, selects }));
    if (options.requireInput) confirmBtn.disabled = true;
    footer.append(cancelBtn, confirmBtn);
  });
}

export interface SyncDialogResult {
  revision?: string;
  prune: boolean;
  dryRun: boolean;
  force: boolean;
  replace: boolean;
  serverSideApply: boolean;
  applyOutOfSyncOnly: boolean;
  retryLimit?: number;
  resources?: SyncResourceTarget[];
}

export function openSyncDialog(doc: Document, target: string, resources?: SyncResourceTarget[]): Promise<SyncDialogResult | null> {
  return new Promise((resolve) => {
    const { backdrop, body, footer } = createModal(doc, 'Sync application');
    const targetEl = doc.createElement('code');
    targetEl.className = 'argocd-dialog-target';
    targetEl.textContent = resources?.length ? `${target} (${resources.map((r) => `${r.kind}/${r.name}`).join(', ')})` : target;
    body.append(targetEl);

    const state: SyncDialogResult = { prune: false, dryRun: false, force: false, replace: false, serverSideApply: false, applyOutOfSyncOnly: false, ...(resources?.length ? { resources } : {}) };
    const revRow = doc.createElement('label'); revRow.className = 'argocd-dialog-field';
    const revLabel = doc.createElement('span'); revLabel.textContent = t('Target revision (optional)');
    const revInput = doc.createElement('input'); revInput.type = 'text'; revInput.placeholder = 'HEAD';
    revRow.append(revLabel, revInput); body.append(revRow);

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

    const finish = (result: SyncDialogResult | null) => { doc.removeEventListener('keydown', onKey); backdrop.remove(); resolve(result); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(null); };
    doc.addEventListener('keydown', onKey);
    footer.append(
      makeButton(doc, 'Cancel', 'argocd-btn', () => finish(null)),
      makeButton(doc, 'Sync', 'argocd-btn argocd-btn-primary', () => {
        const rev = revInput.value.trim();
        const retryRaw = retryInput.value.trim();
        finish({
          ...state,
          ...(rev ? { revision: rev } : {}),
          ...(retryRaw !== '' && Number.isInteger(Number(retryRaw)) && Number(retryRaw) >= 0 ? { retryLimit: Number(retryRaw) } : {}),
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

export function openRollbackDialog(doc: Document, target: string, history: DeploymentHistoryEntry[], initialId?: number): Promise<RollbackDialogResult | null> {
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
    const finish = (result: RollbackDialogResult | null) => { doc.removeEventListener('keydown', onKey); backdrop.remove(); resolve(result); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(null); };
    doc.addEventListener('keydown', onKey);
    footer.append(
      makeButton(doc, 'Cancel', 'argocd-btn', () => finish(null)),
      makeButton(doc, 'Rollback', 'argocd-btn argocd-btn-danger', () => finish({ id: Number(select.value), prune, dryRun })),
    );
  });
}

export function openResourceActionDialog(doc: Document, target: string, action: ResourceActionItem): Promise<Array<{ name: string; value: string }> | null> {
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
    const finish = (result: Array<{ name: string; value: string }> | null) => { doc.removeEventListener('keydown', onKey); backdrop.remove(); resolve(result); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(null); };
    doc.addEventListener('keydown', onKey);
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
}

export interface EditorDialogResult {
  object?: Record<string, unknown>;
  patch?: string;
  patchType?: PatchType;
  upsert?: boolean;
}

export function openEditorDialog(doc: Document, options: EditorDialogOptions): Promise<EditorDialogResult | null> {
  return new Promise((resolve) => {
    const { backdrop, body, footer } = createModal(doc, options.title);
    if (options.targetLabel) {
      const targetEl = doc.createElement('code'); targetEl.className = 'argocd-dialog-target'; targetEl.textContent = options.targetLabel; body.append(targetEl);
    }
    let patchType: PatchType = 'merge';
    let upsert = false;
    if (options.mode === 'patch') {
      const row = doc.createElement('label'); row.className = 'argocd-dialog-field';
      const label = doc.createElement('span'); label.textContent = t('Patch type');
      const select = doc.createElement('select');
      for (const value of ['merge', 'strategic', 'json'] as const) {
        const opt = doc.createElement('option'); opt.value = value; opt.textContent = value; select.append(opt);
      }
      select.addEventListener('change', () => { patchType = select.value as PatchType; });
      row.append(label, select); body.append(row);
    } else {
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

    const finish = (result: EditorDialogResult | null) => { doc.removeEventListener('keydown', onKey); backdrop.remove(); resolve(result); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(null); };
    doc.addEventListener('keydown', onKey);
    footer.append(
      makeButton(doc, 'Cancel', 'argocd-btn', () => finish(null)),
      makeButton(doc, options.confirmLabel ?? 'Submit', 'argocd-btn argocd-btn-primary', () => {
        try {
          const parsed = parseYaml(textarea.value) as unknown;
          if (options.mode === 'patch') {
            if (patchType === 'json' ? !Array.isArray(parsed) : (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
              throw new Error('Invalid patch structure');
            }
            finish({ patch: JSON.stringify(parsed), patchType });
          } else {
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected YAML/JSON object');
            finish({ object: parsed as Record<string, unknown>, upsert });
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
  { value: 'orphan', label: 'Non-cascading (orphan)' },
];
