/**
 * Shared operational action DTOs modeled after the upstream Argo CD CLI and
 * gRPC-gateway REST API:
 * - https://github.com/argoproj/argo-cd (commit 232fa2d123c0cef71de9251860289ee9a150172e)
 * - cmd/argocd/commands/app.go, app_actions.go, app_resources.go,
 *   applicationset.go, project.go, repo.go, cluster.go, account.go
 * - server/application/application.proto, server/account/account.proto
 */
import type { ResourceReference } from './resources.js';

export interface CanIQuery {
  context: string;
  resource: string;
  action: string;
  subresource: string;
}

export interface CanIResult {
  allowed: boolean;
}

export interface ActionBase {
  context: string;
  identityEpoch: string;
}

export interface RefreshApplicationRequest extends ActionBase {
  name: string;
  appNamespace: string;
  mode: 'normal' | 'hard';
}

export interface SyncResourceTarget {
  group?: string;
  kind: string;
  name: string;
  namespace?: string;
}

export interface SyncApplicationRequest extends ActionBase {
  name: string;
  appNamespace: string;
  revision?: string;
  sourcePositions?: number[];
  revisions?: string[];
  dryRun?: boolean;
  prune?: boolean;
  force?: boolean;
  strategy?: 'apply' | 'hook';
  replace?: boolean;
  serverSideApply?: boolean;
  applyOutOfSyncOnly?: boolean;
  resources?: SyncResourceTarget[];
  retryLimit?: number;
}

export interface TerminateOperationRequest extends ActionBase {
  name: string;
  appNamespace: string;
}

export interface RollbackApplicationRequest extends ActionBase {
  name: string;
  appNamespace: string;
  id: number;
  dryRun?: boolean;
  prune?: boolean;
}

export type ApplicationPatchType = 'merge' | 'json';
export type PatchType = 'merge' | 'json' | 'strategic';

export interface CreateApplicationRequest extends ActionBase {
  application: Record<string, unknown>;
  upsert?: boolean;
  validate?: boolean;
}

export interface UpdateApplicationRequest extends ActionBase {
  name: string;
  appNamespace: string;
  application: Record<string, unknown>;
  validate?: boolean;
}

export interface PatchApplicationRequest extends ActionBase {
  name: string;
  appNamespace: string;
  patch: string;
  patchType: ApplicationPatchType;
}

export type PropagationPolicy = 'foreground' | 'background';

export interface DeleteApplicationRequest extends ActionBase {
  name: string;
  appNamespace: string;
  cascade?: boolean;
  propagationPolicy?: PropagationPolicy;
}

export interface ResourceActionParam {
  name: string;
  default?: string;
  type?: string;
}

export interface ResourceActionItem {
  name: string;
  displayName: string;
  iconClass: string;
  disabled: boolean;
  params: ResourceActionParam[];
}

export interface ResourceActionList {
  actions: ResourceActionItem[];
}

export interface RunResourceActionRequest extends ActionBase {
  name: string;
  appNamespace: string;
  resource: ResourceReference;
  action: string;
  parameters?: Array<{ name: string; value: string }>;
}

export interface DeleteResourceRequest extends ActionBase {
  name: string;
  appNamespace: string;
  resource: ResourceReference;
  force?: boolean;
  orphan?: boolean;
}

export interface PatchResourceRequest extends ActionBase {
  name: string;
  appNamespace: string;
  resource: ResourceReference;
  patch: string;
  patchType: PatchType;
}

export type ManagementActionRequest =
  | (ActionBase & { operation: 'createApplicationSet'; applicationSet: Record<string, unknown>; upsert?: boolean })
  | (ActionBase & { operation: 'deleteApplicationSet'; name: string; appsetNamespace: string })
  | (ActionBase & { operation: 'createProject'; project: Record<string, unknown>; upsert?: boolean })
  | (ActionBase & { operation: 'updateProject'; name: string; project: Record<string, unknown> })
  | (ActionBase & { operation: 'deleteProject'; name: string })
  | (ActionBase & { operation: 'validateRepository'; repo: string; type?: string; project?: string })
  | (ActionBase & { operation: 'deleteRepository'; repo: string; appProject?: string })
  | (ActionBase & { operation: 'invalidateClusterCache'; server: string; idType?: 'server' | 'name' })
  | (ActionBase & { operation: 'deleteCluster'; server: string; idType?: 'server' | 'name' });

export interface ActionResult<T = unknown> {
  operation: string;
  accepted: boolean;
  fallbackUsed?: boolean;
  data?: T;
}
