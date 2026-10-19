import type { ApplicationFilters } from '../shared/applications.js';
import type { ApplicationReference, ResourceReference } from '../shared/resources.js';

export interface SplitState { width: number; collapsed: boolean; detailOpen: boolean }
export interface ResourceNavigationState {
  selected: ResourceReference | null;
  section: 'tree' | 'events' | 'monitoring';
  detailTab: 'overview' | 'events' | 'manifest';
  split: SplitState;
}
export interface ApplicationNavigationState {
  filters: ApplicationFilters;
  selected: ApplicationReference | null;
  detailTab: 'overview' | 'resources' | 'manifests' | 'windows';
  split: SplitState;
  resources: ResourceNavigationState | null;
}
export interface NavigationState {
  version: 1; directory: string; context: string;
  tab: 'applications' | 'management' | 'summary' | 'diagnostic';
  density: 'compact' | 'comfortable';
  applications: ApplicationNavigationState;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid navigation state');
  return value as Record<string, unknown>;
};
function text(value: unknown, limit = 2048): string {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u001f]/.test(value)) throw new Error('Invalid navigation text');
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error('Invalid navigation choice'); return value as T;
}
function split(value: unknown, min: number, max: number): SplitState {
  const input = object(value);
  if (typeof input.width !== 'number' || !Number.isFinite(input.width) || input.width < min || input.width > max || typeof input.collapsed !== 'boolean' || typeof input.detailOpen !== 'boolean') throw new Error('Invalid split state');
  return { width: input.width, collapsed: input.collapsed, detailOpen: input.detailOpen };
}
/** A projection, not a snapshot: no credentials, API payloads, logs or previews.
 * Ignore unknown properties rather than ever copying them into host storage. */
export function navigationState(value: unknown, directory: string): NavigationState | null {
  try {
    const input = object(value); if (input.version !== 1 || text(input.directory, 4096) !== directory) return null;
    const app = object(input.applications); const filters: ApplicationFilters = {}; const rawFilters = object(app.filters);
    for (const key of ['name', 'project', 'cluster', 'appNamespace', 'destinationNamespace', 'repo', 'sync', 'health', 'selector'] as const) {
      if (rawFilters[key] !== undefined) filters[key] = text(rawFilters[key]);
    }
    let selected: ApplicationReference | null = null;
    if (app.selected !== null) { const ref = object(app.selected); selected = { name: text(ref.name, 253), appNamespace: text(ref.appNamespace, 253) }; if (!selected.name) return null; }
    let resources: ResourceNavigationState | null = null;
    if (app.resources !== null) {
      const resource = object(app.resources); let selected: ResourceReference | null = null;
      if (resource.selected !== null) {
        const ref = object(resource.selected);
        selected = { group: text(ref.group, 253), version: text(ref.version, 253), kind: text(ref.kind, 253), namespace: text(ref.namespace, 253), name: text(ref.name, 253), uid: text(ref.uid, 253) };
        if (!selected.name || !selected.kind) return null;
      }
      resources = { selected, section: choice(resource.section, ['tree', 'events', 'monitoring']), detailTab: resource.detailTab === 'logs' ? 'overview' : choice(resource.detailTab, ['overview', 'events', 'manifest']), split: split(resource.split, 180, 360) };
    }
    const state: NavigationState = {
      version: 1, directory, context: text(input.context), tab: choice(input.tab, ['applications', 'management', 'summary', 'diagnostic']), density: choice(input.density, ['compact', 'comfortable']),
      applications: { filters, selected, detailTab: choice(app.detailTab, ['overview', 'resources', 'manifests', 'windows']), split: split(app.split, 220, 420), resources },
    };
    if (new TextEncoder().encode(JSON.stringify(state)).length > 32_000) return null;
    return state;
  } catch { return null; }
}

/** Bounded key; the full directory is checked in the value too, so a hash
 * collision cannot restore another project's state. This is not anonymization. */
export function navigationKey(directory: string): string {
  let a = 0x811c9dc5; let b = 0x9e3779b9;
  for (const byte of new TextEncoder().encode(directory)) { a = Math.imul(a ^ byte, 0x01000193); b = Math.imul(b ^ byte, 0x85ebca6b); }
  return `observer.navigation.v1.${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
