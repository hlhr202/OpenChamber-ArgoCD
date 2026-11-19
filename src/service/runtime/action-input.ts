/**
 * Strict runtime input validation for operational mutation payloads, aligned
 * with argoproj/argo-cd CLI parameter checks:
 * https://github.com/argoproj/argo-cd (commit 232fa2d123c0cef71de9251860289ee9a150172e)
 */
import type {
  ActionBase, ApplicationPatchType, CanIQuery, CreateApplicationRequest, DeleteApplicationRequest, DeleteResourceRequest,
  ManagementActionRequest, PatchApplicationRequest, PatchResourceRequest, PatchType, PropagationPolicy,
  RefreshApplicationRequest, RollbackApplicationRequest, RunResourceActionRequest, SyncApplicationRequest,
  SyncResourceTarget, TerminateOperationRequest, UpdateApplicationRequest,
} from '../../shared/actions.js';
import { ServiceError } from '../security/errors.js';
import { parseResourceInput } from './resource-input.js';

const K8S_NAME = /^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/;
const K8S_NAMESPACE = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const EPOCH_RE = /^[\w-]{43}$/;
const APP_PATCH_TYPES = new Set<ApplicationPatchType>(['merge', 'json']);
const PATCH_TYPES = new Set<PatchType>(['merge', 'json', 'strategic']);
const PROPAGATION_POLICIES = new Set<PropagationPolicy>(['foreground', 'background']);

function asRecord(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('BAD_REQUEST', 400);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) throw new ServiceError('BAD_REQUEST', 400);
  return record;
}

function validContext(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw new ServiceError('BAD_REQUEST', 400);
  return value;
}

function validBase(record: Record<string, unknown>): ActionBase {
  const context = validContext(record.context);
  if (typeof record.identityEpoch !== 'string' || !EPOCH_RE.test(record.identityEpoch)) throw new ServiceError('BAD_REQUEST', 400);
  return { context, identityEpoch: record.identityEpoch };
}

function validName(value: unknown): string {
  if (typeof value !== 'string' || !K8S_NAME.test(value)) throw new ServiceError('BAD_REQUEST', 400);
  return value;
}

function validNamespace(value: unknown): string {
  if (typeof value !== 'string' || !K8S_NAMESPACE.test(value)) throw new ServiceError('BAD_REQUEST', 400);
  return value;
}

function validRevision(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw new ServiceError('BAD_REQUEST', 400);
  return value;
}

function optionalBool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ServiceError('BAD_REQUEST', 400);
  return value;
}

function validObjectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('BAD_REQUEST', 400);
  return value as Record<string, unknown>;
}

function validPatch<T extends PatchType>(patch: unknown, patchType: unknown, allowedTypes: ReadonlySet<T>): { patch: string; patchType: T } {
  if (typeof patchType !== 'string' || !allowedTypes.has(patchType as T)) throw new ServiceError('BAD_REQUEST', 400);
  if (typeof patch !== 'string' || !patch.trim() || patch.length > 200_000) throw new ServiceError('BAD_REQUEST', 400);
  let parsed: unknown;
  try { parsed = JSON.parse(patch); } catch { throw new ServiceError('BAD_REQUEST', 400); }
  if (patchType === 'json' ? !Array.isArray(parsed) : (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new ServiceError('BAD_REQUEST', 400);
  return { patch, patchType: patchType as T };
}

export function validCanISubresource(subresource: string): boolean {
  if (!subresource || subresource.length > 512 || /[\u0000-\u001f\u007f]/.test(subresource)) return false;
  if (subresource.split('/').some((part) => part === '.' || part === '..')) return false;
  const hasUrl = /^(?:[^/]+\/)?[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i.test(subresource);
  if (!hasUrl && subresource.split('/').some((part) => !part)) return false;
  return true;
}

export function parseCanIQuery(params: Record<string, string>): CanIQuery {
  const allowed = ['context', 'resource', 'action', 'subresource'];
  if (Object.keys(params).some((key) => !allowed.includes(key))) throw new ServiceError('BAD_REQUEST', 400);
  const context = validContext(params.context);
  const resource = params.resource ?? '';
  const action = params.action ?? '';
  const subresource = params.subresource ?? '';
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(resource) || !/^[a-z][A-Za-z0-9/_.:-]{0,127}$/.test(action) || action.split('/').some((part) => part === '.' || part === '..')) throw new ServiceError('BAD_REQUEST', 400);
  if (!validCanISubresource(subresource)) throw new ServiceError('BAD_REQUEST', 400);
  return { context, resource, action, subresource };
}

export function parseRefreshRequest(value: unknown): RefreshApplicationRequest {
  const record = asRecord(value, ['context', 'identityEpoch', 'name', 'appNamespace', 'mode']);
  if (record.mode !== 'normal' && record.mode !== 'hard') throw new ServiceError('BAD_REQUEST', 400);
  return { ...validBase(record), name: validName(record.name), appNamespace: validNamespace(record.appNamespace), mode: record.mode };
}

export function parseSyncRequest(value: unknown): SyncApplicationRequest {
  const record = asRecord(value, [
    'context', 'identityEpoch', 'name', 'appNamespace', 'revision', 'sourcePositions', 'revisions',
    'dryRun', 'prune', 'force', 'strategy', 'replace', 'serverSideApply', 'applyOutOfSyncOnly', 'resources', 'retryLimit',
  ]);
  const result: SyncApplicationRequest = {
    ...validBase(record),
    name: validName(record.name),
    appNamespace: validNamespace(record.appNamespace),
  };
  if (record.revision !== undefined) result.revision = validRevision(record.revision);
  if (record.sourcePositions !== undefined || record.revisions !== undefined) {
    if (record.revision !== undefined || !Array.isArray(record.sourcePositions) || !Array.isArray(record.revisions) || !record.sourcePositions.length || record.sourcePositions.length > 20 || record.sourcePositions.length !== record.revisions.length) throw new ServiceError('BAD_REQUEST', 400);
    const positions = record.sourcePositions.map((item) => {
      if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 1 || item > 20) throw new ServiceError('BAD_REQUEST', 400);
      return item;
    });
    if (new Set(positions).size !== positions.length) throw new ServiceError('BAD_REQUEST', 400);
    result.sourcePositions = positions;
    result.revisions = record.revisions.map(validRevision);
  }
  const dryRun = optionalBool(record.dryRun); if (dryRun !== undefined) result.dryRun = dryRun;
  const prune = optionalBool(record.prune); if (prune !== undefined) result.prune = prune;
  const force = optionalBool(record.force); if (force !== undefined) result.force = force;
  const replace = optionalBool(record.replace); if (replace !== undefined) result.replace = replace;
  const serverSideApply = optionalBool(record.serverSideApply); if (serverSideApply !== undefined) result.serverSideApply = serverSideApply;
  const applyOutOfSyncOnly = optionalBool(record.applyOutOfSyncOnly); if (applyOutOfSyncOnly !== undefined) result.applyOutOfSyncOnly = applyOutOfSyncOnly;
  if (record.strategy !== undefined) {
    if (record.strategy !== 'apply' && record.strategy !== 'hook') throw new ServiceError('BAD_REQUEST', 400);
    result.strategy = record.strategy;
  }
  if (record.retryLimit !== undefined) {
    if (typeof record.retryLimit !== 'number' || !Number.isSafeInteger(record.retryLimit) || record.retryLimit < 0 || record.retryLimit > 100) throw new ServiceError('BAD_REQUEST', 400);
    result.retryLimit = record.retryLimit;
  }
  if (record.resources !== undefined) {
    if (!Array.isArray(record.resources) || record.resources.length > 200) throw new ServiceError('BAD_REQUEST', 400);
    result.resources = record.resources.map((item): SyncResourceTarget => {
      const target = asRecord(item, ['group', 'kind', 'name', 'namespace']);
      if (typeof target.kind !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,127}$/.test(target.kind)) throw new ServiceError('BAD_REQUEST', 400);
      if (typeof target.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,252}$/.test(target.name)) throw new ServiceError('BAD_REQUEST', 400);
      if (target.group !== undefined && target.group !== '' && (typeof target.group !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,252}$/.test(target.group))) throw new ServiceError('BAD_REQUEST', 400);
      if (target.namespace !== undefined && target.namespace !== '' && (typeof target.namespace !== 'string' || !K8S_NAMESPACE.test(target.namespace))) throw new ServiceError('BAD_REQUEST', 400);
      return {
        ...(target.group ? { group: target.group as string } : { group: '' }),
        kind: target.kind,
        name: target.name,
        ...(target.namespace ? { namespace: target.namespace as string } : {}),
      };
    });
  }
  return result;
}

export function parseTerminateRequest(value: unknown): TerminateOperationRequest {
  const record = asRecord(value, ['context', 'identityEpoch', 'name', 'appNamespace']);
  return { ...validBase(record), name: validName(record.name), appNamespace: validNamespace(record.appNamespace) };
}

export function parseRollbackRequest(value: unknown): RollbackApplicationRequest {
  const record = asRecord(value, ['context', 'identityEpoch', 'name', 'appNamespace', 'id', 'dryRun', 'prune']);
  if (typeof record.id !== 'number' || !Number.isSafeInteger(record.id) || record.id < 0) throw new ServiceError('BAD_REQUEST', 400);
  const dryRun = optionalBool(record.dryRun);
  const prune = optionalBool(record.prune);
  return {
    ...validBase(record),
    name: validName(record.name),
    appNamespace: validNamespace(record.appNamespace),
    id: record.id,
    ...(dryRun !== undefined ? { dryRun } : {}),
    ...(prune !== undefined ? { prune } : {}),
  };
}

export function parseCreateApplicationRequest(value: unknown): CreateApplicationRequest {
  const record = asRecord(value, ['context', 'identityEpoch', 'application', 'upsert', 'validate']);
  const application = validObjectPayload(record.application);
  const metadata = validObjectPayload(application.metadata);
  validName(metadata.name);
  if (metadata.namespace !== undefined) validNamespace(metadata.namespace);
  const upsert = optionalBool(record.upsert);
  const validate = optionalBool(record.validate);
  return { ...validBase(record), application, ...(upsert !== undefined ? { upsert } : {}), ...(validate !== undefined ? { validate } : {}) };
}

export function parseUpdateApplicationRequest(value: unknown): UpdateApplicationRequest {
  const record = asRecord(value, ['context', 'identityEpoch', 'name', 'appNamespace', 'application', 'validate']);
  const name = validName(record.name);
  const appNamespace = validNamespace(record.appNamespace);
  const application = validObjectPayload(record.application);
  const metadata = validObjectPayload(application.metadata);
  if (metadata.name !== undefined && validName(metadata.name) !== name) throw new ServiceError('BAD_REQUEST', 400);
  if (metadata.namespace !== undefined && validNamespace(metadata.namespace) !== appNamespace) throw new ServiceError('BAD_REQUEST', 400);
  const validate = optionalBool(record.validate);
  return {
    ...validBase(record),
    name,
    appNamespace,
    application: { ...application, metadata: { ...metadata, name, namespace: appNamespace } },
    ...(validate !== undefined ? { validate } : {}),
  };
}

export function parsePatchApplicationRequest(value: unknown): PatchApplicationRequest {
  const record = asRecord(value, ['context', 'identityEpoch', 'name', 'appNamespace', 'patch', 'patchType']);
  return {
    ...validBase(record),
    name: validName(record.name),
    appNamespace: validNamespace(record.appNamespace),
    ...validPatch(record.patch, record.patchType, APP_PATCH_TYPES),
  };
}

export function parseDeleteApplicationRequest(value: unknown): DeleteApplicationRequest {
  const record = asRecord(value, ['context', 'identityEpoch', 'name', 'appNamespace', 'cascade', 'propagationPolicy']);
  const cascade = optionalBool(record.cascade);
  if (record.propagationPolicy !== undefined && (typeof record.propagationPolicy !== 'string' || !PROPAGATION_POLICIES.has(record.propagationPolicy as PropagationPolicy))) throw new ServiceError('BAD_REQUEST', 400);
  if (cascade === false && record.propagationPolicy !== undefined) throw new ServiceError('BAD_REQUEST', 400);
  return {
    ...validBase(record),
    name: validName(record.name),
    appNamespace: validNamespace(record.appNamespace),
    ...(cascade !== undefined ? { cascade } : {}),
    ...(record.propagationPolicy !== undefined ? { propagationPolicy: record.propagationPolicy as PropagationPolicy } : {}),
  };
}

function validMutatedResource(raw: unknown) {
  const resource = parseResourceInput(raw, 'resource');
  if (!resource.uid) throw new ServiceError('BAD_REQUEST', 400);
  return resource;
}

export function parseRunResourceActionRequest(value: unknown): RunResourceActionRequest {
  const record = asRecord(value, ['context', 'identityEpoch', 'name', 'appNamespace', 'resource', 'action', 'parameters']);
  if (typeof record.action !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/.test(record.action)) throw new ServiceError('BAD_REQUEST', 400);
  const resource = validMutatedResource(record.resource);
  let parameters: Array<{ name: string; value: string }> | undefined;
  if (record.parameters !== undefined) {
    if (!Array.isArray(record.parameters) || record.parameters.length > 50) throw new ServiceError('BAD_REQUEST', 400);
    parameters = record.parameters.map((item) => {
      const entry = asRecord(item, ['name', 'value']);
      if (typeof entry.name !== 'string' || !entry.name || entry.name.length > 128 || /[\u0000-\u001f\u007f]/.test(entry.name)) throw new ServiceError('BAD_REQUEST', 400);
      if (typeof entry.value !== 'string' || entry.value.length > 4096) throw new ServiceError('BAD_REQUEST', 400);
      return { name: entry.name, value: entry.value };
    });
  }
  return {
    ...validBase(record),
    name: validName(record.name),
    appNamespace: validNamespace(record.appNamespace),
    resource,
    action: record.action,
    ...(parameters ? { parameters } : {}),
  };
}

export function parseDeleteResourceRequest(value: unknown): DeleteResourceRequest {
  const record = asRecord(value, ['context', 'identityEpoch', 'name', 'appNamespace', 'resource', 'force', 'orphan']);
  const force = optionalBool(record.force);
  const orphan = optionalBool(record.orphan);
  return {
    ...validBase(record),
    name: validName(record.name),
    appNamespace: validNamespace(record.appNamespace),
    resource: validMutatedResource(record.resource),
    ...(force !== undefined ? { force } : {}),
    ...(orphan !== undefined ? { orphan } : {}),
  };
}

export function parsePatchResourceRequest(value: unknown): PatchResourceRequest {
  const record = asRecord(value, ['context', 'identityEpoch', 'name', 'appNamespace', 'resource', 'patch', 'patchType']);
  return {
    ...validBase(record),
    name: validName(record.name),
    appNamespace: validNamespace(record.appNamespace),
    resource: validMutatedResource(record.resource),
    ...validPatch(record.patch, record.patchType, PATCH_TYPES),
  };
}

function validUrlLike(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) throw new ServiceError('BAD_REQUEST', 400);
  return value;
}

export function parseManagementActionRequest(value: unknown): ManagementActionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('BAD_REQUEST', 400);
  const operation = (value as { operation?: unknown }).operation;
  switch (operation) {
    case 'createApplicationSet': {
      const record = asRecord(value, ['operation', 'context', 'identityEpoch', 'applicationSet', 'upsert']);
      const applicationSet = validObjectPayload(record.applicationSet);
      const metadata = validObjectPayload(applicationSet.metadata);
      validName(metadata.name);
      if (metadata.namespace !== undefined) validNamespace(metadata.namespace);
      const upsert = optionalBool(record.upsert);
      return { operation, ...validBase(record), applicationSet, ...(upsert !== undefined ? { upsert } : {}) };
    }
    case 'deleteApplicationSet': {
      const record = asRecord(value, ['operation', 'context', 'identityEpoch', 'name', 'appsetNamespace']);
      return { operation, ...validBase(record), name: validName(record.name), appsetNamespace: validNamespace(record.appsetNamespace) };
    }
    case 'createProject': {
      const record = asRecord(value, ['operation', 'context', 'identityEpoch', 'project', 'upsert']);
      const project = validObjectPayload(record.project);
      const metadata = validObjectPayload(project.metadata);
      validName(metadata.name);
      const upsert = optionalBool(record.upsert);
      return { operation, ...validBase(record), project, ...(upsert !== undefined ? { upsert } : {}) };
    }
    case 'updateProject': {
      const record = asRecord(value, ['operation', 'context', 'identityEpoch', 'name', 'project']);
      const name = validName(record.name);
      const project = validObjectPayload(record.project);
      if (project.metadata !== undefined) {
        const meta = validObjectPayload(project.metadata);
        if (meta.name !== undefined && validName(meta.name) !== name) throw new ServiceError('BAD_REQUEST', 400);
      }
      return { operation, ...validBase(record), name, project };
    }
    case 'deleteProject': {
      const record = asRecord(value, ['operation', 'context', 'identityEpoch', 'name']);
      return { operation, ...validBase(record), name: validName(record.name) };
    }
    case 'validateRepository': {
      const record = asRecord(value, ['operation', 'context', 'identityEpoch', 'repo', 'type', 'project']);
      if (record.type !== undefined && (typeof record.type !== 'string' || !/^[a-z0-9-]{1,32}$/.test(record.type))) throw new ServiceError('BAD_REQUEST', 400);
      if (record.project !== undefined && record.project !== '') validName(record.project);
      return {
        operation, ...validBase(record), repo: validUrlLike(record.repo),
        ...(record.type ? { type: record.type as string } : {}),
        ...(record.project ? { project: record.project as string } : {}),
      };
    }
    case 'deleteRepository': {
      const record = asRecord(value, ['operation', 'context', 'identityEpoch', 'repo', 'appProject']);
      if (record.appProject !== undefined && record.appProject !== '') validName(record.appProject);
      return {
        operation, ...validBase(record), repo: validUrlLike(record.repo),
        ...(record.appProject ? { appProject: record.appProject as string } : {}),
      };
    }
    case 'invalidateClusterCache':
    case 'deleteCluster': {
      const record = asRecord(value, ['operation', 'context', 'identityEpoch', 'server', 'idType']);
      if (record.idType !== undefined && record.idType !== 'server' && record.idType !== 'name') throw new ServiceError('BAD_REQUEST', 400);
      return {
        operation, ...validBase(record), server: validUrlLike(record.server),
        ...(record.idType ? { idType: record.idType } : {}),
      };
    }
    default:
      throw new ServiceError('BAD_REQUEST', 400);
  }
}
