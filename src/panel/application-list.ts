import { t } from './i18n.js';
import type { ApplicationSummary } from '../shared/applications.js';

let sequence = 0;
/** Stable rows preserve scroll/focus during polling. Keyboard focus is distinct
 * from selection, but a pointer selection always moves both together. */
export function mountApplicationList(root: HTMLElement, onSelect: (id: string) => void) {
  const document = root.ownerDocument; const prefix = `observer-app-${++sequence}-`;
  root.classList.add('application-list');
  const list = document.createElement('div'); list.className = 'oc-sdk oc-sdk-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', t("Argo CD applications")); list.tabIndex = 0; root.append(list);
  let items: ApplicationSummary[] = []; let selected: string | null = null; let active: string | null = null; let emptyText = "No applications loaded";
  const rows = new Map<string, HTMLButtonElement>();
  function paintActive(): void {
    for (const [id, row] of rows) { row.dataset.active = String(id === active); row.setAttribute('aria-selected', String(id === selected)); }
    const row = active ? rows.get(active) : undefined;
    if (row) list.setAttribute('aria-activedescendant', row.id); else list.removeAttribute('aria-activedescendant');
  }
  function choose(id: string): void { active = id; paintActive(); list.focus({ preventScroll: true }); onSelect(id); }
  function paint(): void {
    const ids = new Set(items.map((app) => app.id));
    for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }
    list.querySelector('.oc-sdk-list-empty')?.remove();
    for (const [index, app] of items.entries()) {
      let row = rows.get(app.id);
      if (!row) {
        row = document.createElement('button'); row.type = 'button'; row.className = 'oc-sdk-row'; row.id = prefix + app.id; row.setAttribute('role', 'option'); row.tabIndex = -1;
        row.dataset.applicationId = app.id; row.addEventListener('click', () => choose(app.id)); rows.set(app.id, row);
        const main = document.createElement('span'); main.className = 'oc-sdk-row-main';
        for (const className of ['oc-sdk-row-title', 'oc-sdk-row-sub']) { const span = document.createElement('span'); span.className = className; main.append(span); }
        const statuses = document.createElement('span'); statuses.className = 'application-status-line'; row.append(main, statuses);
      }
      row.title = `${app.id} · Sync: ${app.sync} · Health: ${app.health}`;
      row.setAttribute('aria-label', row.title); row.dataset.health = app.health;
      const title = row.querySelector<HTMLElement>('.oc-sdk-row-title')!; title.textContent = app.id; title.title = app.id;
      const subtitle = row.querySelector<HTMLElement>('.oc-sdk-row-sub')!; subtitle.textContent = `${app.project || '—'} · ${app.destination.namespace || '—'}`; subtitle.title = `${app.project} · ${app.destination.name || app.destination.server} · ${app.destination.namespace || t("Namespace not specified")}`;
      const statuses = row.querySelector<HTMLElement>('.application-status-line')!; statuses.replaceChildren();
      for (const [text, tone] of [[`${app.conditionsCount} Conditions`, app.conditionsCount ? 'warning' : 'neutral'], [`Sync: ${app.sync}`, app.sync === 'Synced' ? 'success' : app.sync === 'OutOfSync' ? 'warning' : 'neutral'], [`Health: ${app.health}`, app.health === 'Healthy' ? 'success' : ['Degraded', 'Missing'].includes(app.health) ? 'error' : 'neutral']]) {
        const badge = document.createElement('span'); badge.className = 'application-status'; badge.textContent = text!; badge.dataset.tone = tone!; statuses.append(badge);
      }
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
    }
    if (!items.some((app) => app.id === active)) active = items.some((app) => app.id === selected) ? selected : null;
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'oc-sdk-list-empty'; empty.textContent = t(emptyText); list.append(empty); }
    paintActive();
  }
  const key = (event: KeyboardEvent) => {
    if (['Enter', ' '].includes(event.key) && active) { event.preventDefault(); choose(active); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.length) return;
    event.preventDefault(); const index = items.findIndex((app) => app.id === active);
    active = items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]!.id;
    paintActive(); rows.get(active)?.scrollIntoView?.({ block: 'nearest' });
  };
  list.addEventListener('keydown', key); paint();
  return { update(next: { items?: ApplicationSummary[]; selectedId?: string | null; emptyText?: string }): void {
    if (next.items) items = next.items;
    if (next.selectedId !== undefined) { if (next.selectedId !== selected) active = next.selectedId; selected = next.selectedId; }
    if (next.emptyText !== undefined) emptyText = next.emptyText;
    if (next.items || next.emptyText !== undefined) paint(); else paintActive();
  }, dispose(): void { list.removeEventListener('keydown', key); rows.clear(); list.remove(); } };
}
