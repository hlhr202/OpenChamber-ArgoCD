import { mountList } from './ui.js';
import { t } from './i18n.js';
import type { ApplicationSummary } from '../shared/applications.js';

export function mountApplicationList(root: HTMLElement, onSelect: (id: string) => void) {
  root.classList.add('application-list'); let items: ApplicationSummary[] = [];
  const list = mountList(root, { items: [], ariaLabel: 'Argo CD 应用', emptyText: '尚未查询应用', onSelect });
  function decorate(): void {
    const rows = root.querySelectorAll<HTMLElement>('[role="option"]');
    rows.forEach((row, index) => {
      const app = items[index]; if (!app) return;
      row.dataset.applicationId = app.id; row.title = app.id;
      row.querySelector<HTMLElement>('.oc-sdk-row-title')!.title = app.id;
      row.querySelector<HTMLElement>('.oc-sdk-row-sub')!.title = `${app.project} · ${app.destination.name || app.destination.server} · ${app.destination.namespace || t('未指定 Namespace')}`;
      const statuses = root.ownerDocument.createElement('span'); statuses.className = 'application-status-line';
      for (const [text, tone] of [[`${app.conditionsCount} Conditions`, app.conditionsCount ? 'warning' : 'neutral'], [`Sync: ${app.sync}`, app.sync === 'Synced' ? 'success' : app.sync === 'OutOfSync' ? 'warning' : 'neutral'], [`Health: ${app.health}`, app.health === 'Healthy' ? 'success' : ['Degraded', 'Missing'].includes(app.health) ? 'error' : 'neutral']]) {
        const badge = root.ownerDocument.createElement('span'); badge.className = 'application-status'; badge.textContent = text!; badge.dataset.tone = tone!; statuses.append(badge);
      }
      row.append(statuses);
    });
  }
  return { update(next: { items?: ApplicationSummary[]; selectedId?: string | null; emptyText?: string }): void {
    if (next.items) items = next.items;
    list.update({ ...next, items: items.map((app) => ({ id: app.id, title: app.id, subtitle: `${app.project || '—'} · ${app.destination.name || app.destination.server || '—'} · ${app.destination.namespace || '—'}` })) }); decorate();
  }, dispose: () => list.dispose() };
}
