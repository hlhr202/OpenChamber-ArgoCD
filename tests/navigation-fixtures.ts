import type { NavigationState } from '../src/panel/navigation-state.js';
import { podRef } from './resource-fixtures.js';

export function savedNavigation(directory = '/synthetic/project'): NavigationState {
  return {
    version: 1, directory, context: 'primary', tab: 'applications', density: 'comfortable',
    applications: {
      filters: { name: 'demo', project: 'platform' }, selected: { name: 'demo', appNamespace: 'argocd' }, detailTab: 'resources',
      split: { width: 328, collapsed: true, detailOpen: true },
      resources: { selected: { ...podRef }, section: 'tree', detailTab: 'events', split: { width: 260, collapsed: false, detailOpen: true } },
    },
  };
}
