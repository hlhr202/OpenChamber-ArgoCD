import type { TaskCommand } from '../../shared/tasks.js';
import type { QuerySnapshot } from '../../shared/contracts.js';
import type { ArgoClient } from '../argocd/client.js';
import { isManagement } from './management-input.js';

export function executeTask(api: ArgoClient, command: TaskCommand, signal: AbortSignal): Promise<QuerySnapshot<unknown>> {
  if (isManagement(command)) return api.managementSnapshot(command, signal);
  if (command.operation === 'applications') return api.applicationsSnapshot(command.context, command.filters, signal);
  const app = { name: command.name, appNamespace: command.appNamespace };
  switch (command.operation) {
    case 'application': return api.applicationSnapshot(command.context, command.name, command.appNamespace, signal);
    case 'resourceTree': return api.resourceTreeSnapshot(command.context, app, signal);
    case 'resource': return api.resourceSnapshot(command.context, app, command.resource, signal);
    case 'events': return api.eventsSnapshot(command.context, app, signal, command.resource);
    case 'relatedEvents': return api.relatedEventsSnapshot(command.context, app, signal, command.resource);
    case 'manifests': return api.manifestsSnapshot(command.context, app, command.selection, signal);
    case 'comparison': return api.comparisonSnapshot(command.context, app, signal);
  }
}
