import type { ApplicationDetail } from '../../shared/applications.js';
import type { ManifestList, ManifestSelection, ResourceComparison } from '../../shared/manifests.js';
import type { ResourceReference } from '../../shared/resources.js';
import { resourceCoordinate } from '../../shared/resources.js';
import { sanitizeKubernetes } from '../security/kubernetes.js';
import { ServiceError } from '../security/errors.js';
import { array, object, optionalObject, text } from './applications.js';
import { resourceReference } from './resources.js';

/** Canonical equality is used only on Argo's normalized/predicted pair,
 * never on raw target/live manifests. Bound work even for malicious JSON. */
function canonical(value: unknown): string {
  let nodes = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 10_000 || depth > 20) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new ServiceError('UPSTREAM_INVALID', 502);
    if (Array.isArray(value)) {
      if (value.length > 1000) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
      return value.map((item) => visit(item, depth + 1));
    }
    if (value && typeof value === 'object') {
      if (Object.keys(value).length > 1000) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, visit(item, depth + 1)]));
    }
    return value;
  };
  return JSON.stringify(visit(value, 0));
}
function parseState(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) throw new ServiceError('UPSTREAM_INVALID', 502);
  if (Buffer.byteLength(value) > 1_000_000) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new ServiceError('UPSTREAM_INVALID', 502); }
  if (parsed !== null) object(parsed);
  canonical(parsed);
  return parsed as Record<string, unknown> | null;
}
function safeState(value: Record<string, unknown> | null, kind: string): Record<string, unknown> | null { return value ? sanitizeKubernetes(value, kind) : null; }
function stateReference(manifest: Record<string, unknown>): ResourceReference {
  const metadata = object(manifest.metadata);
  const ref = resourceReference({ ...metadata, apiVersion: manifest.apiVersion, kind: manifest.kind });
  if (!ref.name && !text(metadata.generateName)) throw new ServiceError('UPSTREAM_INVALID', 502);
  if (!ref.kind || !ref.version) throw new ServiceError('UPSTREAM_INVALID', 502);
  return ref;
}
export function manifests(value: unknown, selection: ManifestSelection): ManifestList {
  const input = object(value);
  if (input.manifests === undefined && Object.keys(input).some((key) => !['namespace', 'revision', 'server', 'sourceType', 'verifyResult', 'commands'].includes(key))) throw new ServiceError('UPSTREAM_INVALID', 502);
  const seen = new Set<string>(); const warnings: string[] = [];
  const items = array(input.manifests).map((value, index) => {
    const manifest = parseState(value);
    if (!manifest) throw new ServiceError('UPSTREAM_INVALID', 502);
    const ref = stateReference(manifest); const key = resourceCoordinate(ref);
    if (seen.has(key)) warnings.push('REPEATED_RESOURCE_IDENTITY');
    seen.add(key);
    return { id: JSON.stringify([index, key]), reference: ref, manifest: sanitizeKubernetes(manifest), namespaceExplicit: Boolean(ref.namespace) };
  });
  return { items, selection: structuredClone(selection), resolvedRevision: text(input.revision), warnings: [...new Set(warnings)],
    note: "Generated desired-manifest preview, not an Argo sync comparison. Multi-source responses merge all sources; position/revision overrides do not filter the result. Scope is not inferred when Namespace is absent." };
}

function changedPaths(a: unknown, b: unknown): string[] {
  const paths: string[] = [];
  const visit = (a: unknown, b: unknown, path: string) => {
    if (canonical(a) === canonical(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) visit((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    } else paths.push(path);
    if (paths.length > 500) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
  };
  visit(a, b, ''); return paths;
}
function matchesIdentity(state: Record<string, unknown> | null, ref: ResourceReference): boolean {
  if (!state) return true;
  const metadata = optionalObject(state.metadata);
  if (metadata.name && metadata.name !== ref.name) return false;
  if (metadata.namespace && metadata.namespace !== ref.namespace) return false;
  if (state.kind && state.kind !== ref.kind) return false;
  const version = text(state.apiVersion);
  return !version || (version.includes('/') ? version.split('/')[0] : '') === ref.group;
}
export function managedResources(value: unknown): ResourceComparison[] {
  const input = object(value);
  if (input.items === undefined && Object.keys(input).length) throw new ServiceError('UPSTREAM_INVALID', 502);
  const seen = new Set<string>();
  return array(input.items).map((value): ResourceComparison => {
    const raw = object(value); const ref = resourceReference(raw); const id = resourceCoordinate(ref);
    if (!ref.name || !ref.kind || seen.has(id)) throw new ServiceError('UPSTREAM_INVALID', 502);
    seen.add(id);
    const result: ResourceComparison = { id, reference: ref, hook: raw.hook === true, status: 'unavailable', reason: 'NORMALIZED_PAIR_UNAVAILABLE', reportedModified: typeof raw.modified === 'boolean' ? raw.modified : null, live: null, target: null, normalizedLive: null, predictedLive: null, changedPaths: [] };
    try {
      const live = raw.liveState ? parseState(raw.liveState) : null;
      const target = raw.targetState ? parseState(raw.targetState) : null;
      const normalized = raw.normalizedLiveState ? parseState(raw.normalizedLiveState) : null;
      const predicted = raw.predictedLiveState ? parseState(raw.predictedLiveState) : null;
      if (![live, target, normalized, predicted].every((state) => matchesIdentity(state, ref))) { result.reason = 'RESOURCE_IDENTITY_MISMATCH'; return result; }
      result.reference.version = resourceReference({ apiVersion: (live ?? target ?? {}).apiVersion }).version;
      result.reference.uid = text(optionalObject(live?.metadata).uid);
      result.live = safeState(live, ref.kind); result.target = safeState(target, ref.kind);
      result.normalizedLive = safeState(normalized, ref.kind); result.predictedLive = safeState(predicted, ref.kind);
      if (raw.hook != null && typeof raw.hook !== 'boolean') { result.reason = 'INVALID_HOOK_FLAG'; return result; }
      if (result.hook) { result.reason = 'HOOK_EXCLUDED_FROM_ARGO_DIFF'; return result; }
      if (!raw.normalizedLiveState || !raw.predictedLiveState) return result;
      const different = canonical(normalized) !== canonical(predicted);
      if (raw.modified != null && typeof raw.modified !== 'boolean') { result.reason = 'INVALID_MODIFIED_FLAG'; return result; }
      if (raw.modified === false && different) { result.reason = 'INCONSISTENT_SERVER_COMPARISON'; return result; }
      result.status = raw.modified === true || different ? 'different' : 'equal';
      result.changedPaths = changedPaths(result.normalizedLive, result.predictedLive);
      result.reason = result.status === 'different' && !result.changedPaths.length ? 'DIFFERENCE_HIDDEN_BY_REDACTION' : 'ARGO_NORMALIZED_PREDICTED_PAIR';
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'RESPONSE_TOO_LARGE') throw error;
      result.status = 'unavailable'; result.reason = 'MALFORMED_COMPARISON_STATE';
      result.live = null; result.target = null; result.normalizedLive = null; result.predictedLive = null; result.changedPaths = [];
    }
    return result;
  });
}

export function comparisonBlocked(application: ApplicationDetail): boolean {
  return !['Synced', 'OutOfSync'].includes(application.sync) || application.conditions.some((condition) => ['ComparisonError', 'InvalidSpecError', 'UnknownError'].includes(condition.type));
}
export function supportsSourceRevisions(value: unknown): boolean {
  const input = object(value); const version = text(input.Version ?? input.version);
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?$/.exec(version);
  return Boolean(match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 11)));
}
