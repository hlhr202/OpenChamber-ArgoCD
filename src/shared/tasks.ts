import type { ApplicationFilters } from './applications.js';
import type { ErrorCode, QuerySnapshot } from './contracts.js';
import type { ResourceReference } from './resources.js';
import type { ManifestSelection } from './manifests.js';
import type { ManagementCommand } from './management.js';

export type TaskCommand =
  | ManagementCommand
  | { operation: 'applications'; context: string; filters: ApplicationFilters }
  | { operation: 'application'; context: string; name: string; appNamespace: string }
  | { operation: 'resourceTree'; context: string; name: string; appNamespace: string }
  | { operation: 'resource'; context: string; name: string; appNamespace: string; resource: ResourceReference }
  | { operation: 'events'; context: string; name: string; appNamespace: string; resource?: ResourceReference }
  | { operation: 'relatedEvents'; context: string; name: string; appNamespace: string; resource: ResourceReference }
  | { operation: 'manifests'; context: string; name: string; appNamespace: string; selection: ManifestSelection }
  | { operation: 'comparison'; context: string; name: string; appNamespace: string };

export interface TaskSnapshot<T = unknown> {
  id: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
  expiresAt: string;
  result?: QuerySnapshot<T>;
  error?: { code: ErrorCode; message: string };
}
