import type { ApplicationSummary } from '../shared/applications.js';

export type ChoiceFilter = 'project' | 'appNamespace' | 'destinationNamespace' | 'cluster' | 'repo' | 'selector' | 'sync' | 'health';
/** Always derive from the full loaded snapshot, never from filtered rows.
 * Cluster URLs are values, not destinations for requests. */
export function filterChoices(items: readonly ApplicationSummary[], key: ChoiceFilter): Array<{ id: string; label: string; hint?: string }> {
  const choices = new Map<string, { id: string; label: string; hint?: string }>();
  const add = (id: string, label = id, hint?: string) => { if (id && !choices.has(id)) choices.set(id, { id, label, ...(hint ? { hint } : {}) }); };
  for (const item of items) {
    if (key === 'cluster') add(item.destination.server || item.destination.name, item.destination.name || item.destination.server, item.destination.name ? item.destination.server : undefined);
    else if (key === 'repo') for (const source of item.sources) add(source.repoURL);
    else if (key === 'destinationNamespace') add(item.destination.namespace);
    else if (key === 'selector') for (const [name, value] of Object.entries(item.labels)) add(`${name}=${value}`);
    else add(item[key]);
  }
  return [...choices.values()].sort((a, b) => a.label.localeCompare(b.label));
}
