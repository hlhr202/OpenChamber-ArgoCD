import type { EventList, LiveResource, OrphanedMonitoring, ResourceEvent, ResourceNode, ResourceReference, ResourceTree } from '../../shared/resources.js';
import { resourceCoordinate, resourceId } from '../../shared/resources.js';
import { ServiceError } from '../security/errors.js';
import { sanitizeKubernetes } from '../security/kubernetes.js';
import { array, metadataURL, number, object, optionalObject, text } from './applications.js';

export function resourceReference(value: unknown): ResourceReference {
  const input = object(value);
  const apiVersion = text(input.apiVersion).split('/');
  if (apiVersion.length > 2) throw new ServiceError('UPSTREAM_INVALID', 502);
  return { group: text(input.group ?? (apiVersion.length === 2 ? apiVersion[0] : '')), version: text(input.version ?? apiVersion.at(-1)), kind: text(input.kind), namespace: text(input.namespace), name: text(input.name), uid: text(input.uid) };
}

export function resourceTree(value: unknown): ResourceTree {
  const input = object(value);
  if (!Object.hasOwn(input, 'nodes') && !Object.hasOwn(input, 'orphanedNodes') && Object.keys(input).some((key) => key !== 'hosts')) throw new ServiceError('UPSTREAM_INVALID', 502);
  const managed = array(input.nodes); const orphaned = array(input.orphanedNodes);
  if (managed.length + orphaned.length > 1000) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
  const parents = new Map<string, ResourceReference[]>();
  let edges = 0;
  const nodes: ResourceNode[] = [...managed.map((item) => ({ item, orphaned: false })), ...orphaned.map((item) => ({ item, orphaned: true }))].map(({ item, orphaned }) => {
    const raw = object(item); const ref = resourceReference(raw);
    if (!ref.kind || !ref.name) throw new ServiceError('UPSTREAM_INVALID', 502);
    const id = resourceId(ref);
    if (parents.has(id)) throw new ServiceError('UPSTREAM_INVALID', 502);
    const refs = array(raw.parentRefs).map(resourceReference); edges += refs.length;
    if (edges > 5000) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
    parents.set(id, refs);
    const health = optionalObject(raw.health);
    return { ...ref, id, parents: [], children: [], unresolvedParents: 0, orphaned,
      health: text(health.status) || 'Unknown', healthMessage: text(health.message), createdAt: text(raw.createdAt), images: array(raw.images).map(metadataURL) };
  });
  const byCoordinate = new Map<string, ResourceNode[]>();
  for (const node of nodes) {
    const key = resourceCoordinate(node); const existing = byCoordinate.get(key) ?? []; existing.push(node); byCoordinate.set(key, existing);
  }
  for (const node of nodes) for (const ref of parents.get(node.id)!) {
    const candidates = byCoordinate.get(resourceCoordinate(ref)) ?? [];
    const matching = ref.uid ? candidates.filter((candidate) => candidate.uid === ref.uid) : candidates;
    if (matching.length !== 1) { node.unresolvedParents++; continue; }
    const parent = matching[0]!;
    if (!node.parents.includes(parent.id)) { node.parents.push(parent.id); parent.children.push(node.id); }
  }
  const roots = nodes.filter((node) => !node.parents.length).map((node) => node.id);
  const indegrees = new Map(nodes.map((node) => [node.id, node.parents.length]));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ready = [...roots]; let visited = 0;
  while (ready.length) {
    const id = ready.pop()!; visited++;
    for (const child of byId.get(id)!.children) { const remaining = indegrees.get(child)! - 1; indegrees.set(child, remaining); if (!remaining) ready.push(child); }
  }
  const warnings: string[] = [];
  if (visited !== nodes.length) warnings.push('CYCLE_DETECTED');
  if (nodes.some((node) => node.unresolvedParents)) warnings.push('UNRESOLVED_PARENTS');
  return { nodes, roots, warnings, orphanedMonitoring: orphaned.length ? 'enabled' : 'unknown' };
}

export function orphanedMonitoring(value: unknown): OrphanedMonitoring {
  const input = object(value); const spec = object(input.spec);
  if (spec.orphanedResources == null) return { state: 'disabled', warn: null };
  const config = object(spec.orphanedResources);
  if (config.warn != null && typeof config.warn !== 'boolean') throw new ServiceError('UPSTREAM_INVALID', 502);
  return { state: 'enabled', warn: typeof config.warn === 'boolean' ? config.warn : null };
}

function podStatus(manifest: Record<string, unknown>): LiveResource['pod'] {
  if (manifest.kind !== 'Pod') return null;
  const status = optionalObject(manifest.status);
  const containers = [...array(status.initContainerStatuses), ...array(status.containerStatuses), ...array(status.ephemeralContainerStatuses)].map((value) => {
    const input = object(value); const state = optionalObject(input.state);
    const phase = state.waiting ? 'waiting' : state.terminated ? 'terminated' : state.running ? 'running' : 'unknown';
    const detail = optionalObject(state[phase]);
    return { name: text(input.name), image: metadataURL(input.image), ready: typeof input.ready === 'boolean' ? input.ready : null, restarts: input.restartCount == null ? null : number(input.restartCount), phase, reason: text(detail.reason), message: text(detail.message) };
  });
  return { phase: text(status.phase) || 'Unknown', reason: text(status.reason), message: text(status.message), containers };
}

const optionalNumber = (value: unknown): number | null => value == null ? null : number(value);
export function workloadStatus(manifest: Record<string, unknown>): LiveResource['workload'] {
  if (!['Deployment', 'ReplicaSet'].includes(String(manifest.kind))) return undefined;
  const spec = optionalObject(manifest.spec); const status = optionalObject(manifest.status); const metadata = optionalObject(manifest.metadata);
  return { desired: optionalNumber(spec.replicas), replicas: optionalNumber(status.replicas), ready: optionalNumber(status.readyReplicas), updated: optionalNumber(status.updatedReplicas), available: optionalNumber(status.availableReplicas), generation: optionalNumber(metadata.generation), observedGeneration: optionalNumber(status.observedGeneration),
    conditions: array(status.conditions).map((value) => { const item = object(value); return { type: text(item.type), status: text(item.status), reason: text(item.reason), message: text(item.message) }; }) };
}

/** Canonical template comparison must happen before annotation/env redaction. Only a
 * keyed digest leaves this projection; raw templates never enter navigation data. */
export function navigationWorkload(value: unknown, expected: ResourceReference, fingerprint: (value: string) => string) {
  const live = liveResource(value, expected);
  const manifest = object(JSON.parse(object(value).manifest as string)); const spec = optionalObject(manifest.spec);
  const metadata = optionalObject(manifest.metadata); const annotations = optionalObject(metadata.annotations);
  const template = optionalObject(spec.template); const templateMetadata = optionalObject(template.metadata); const labels = { ...optionalObject(templateMetadata.labels) }; delete labels['pod-template-hash'];
  let visited = 0;
  const stable = (value: unknown, depth = 0): unknown => {
    if (++visited > 10_000 || depth > 20) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
    return Array.isArray(value) ? value.map((item) => stable(item, depth + 1)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item, depth + 1)])) : value;
  };
  const revision = annotations['deployment.kubernetes.io/revision'];
  return { workload: live.workload, revision: typeof revision === 'string' && /^\d+$/.test(revision) && Number.isSafeInteger(Number(revision)) ? Number(revision) : null,
    templateKey: spec.template ? fingerprint(JSON.stringify(stable({ ...template, metadata: { ...templateMetadata, labels } }))) : null };
}

export function liveResource(value: unknown, expected: ResourceReference): LiveResource {
  const input = object(value);
  if (typeof input.manifest !== 'string') throw new ServiceError('UPSTREAM_INVALID', 502);
  let manifest: Record<string, unknown>;
  try { manifest = object(JSON.parse(input.manifest)); } catch { throw new ServiceError('UPSTREAM_INVALID', 502); }
  const metadata = object(manifest.metadata);
  if (manifest.kind !== expected.kind || text(metadata.name) !== expected.name || text(metadata.namespace) !== expected.namespace || text(manifest.apiVersion) !== (expected.group ? `${expected.group}/${expected.version}` : expected.version)) throw new ServiceError('UPSTREAM_INVALID', 502);
  if (expected.uid && metadata.uid !== expected.uid) throw new ServiceError('RESOURCE_CHANGED', 409);
  const workload = workloadStatus(manifest);
  return {
    reference: { ...expected, uid: text(metadata.uid) },
    pod: podStatus(manifest), manifest: sanitizeKubernetes(manifest), ...(workload ? { workload } : {}),
    redactionNotice: "Secret contents, annotation values, literal environment values and command/args are withheld. Other custom fields receive best-effort redaction; not all secrets can be detected.",
  };
}

export function resourceEvents(value: unknown, expected?: ResourceReference): EventList {
  const input = object(value);
  if (!Object.hasOwn(input, 'items') && Object.keys(input).some((key) => !['kind', 'apiVersion', 'metadata'].includes(key))) throw new ServiceError('UPSTREAM_INVALID', 502);
  const all: ResourceEvent[] = array(input.items).map((value) => {
    const item = object(value); const metadata = object(item.metadata); const series = optionalObject(item.series);
    const source = optionalObject(item.source); const resource = resourceReference(item.involvedObject ?? item.regarding ?? {});
    const name = text(metadata.name); const namespace = text(metadata.namespace);
    if (!name) throw new ServiceError('UPSTREAM_INVALID', 502);
    return {
      id: text(metadata.uid) || JSON.stringify([namespace, name]), namespace, resource,
      type: text(item.type) || 'Unknown', reason: text(item.reason), message: text(item.message ?? item.note),
      firstTime: text(item.firstTimestamp || item.eventTime || item.deprecatedFirstTimestamp), lastTime: text(series.lastObservedTime || item.lastTimestamp || item.eventTime || item.deprecatedLastTimestamp),
      count: series.count != null ? number(series.count) : item.count != null ? number(item.count) : item.deprecatedCount != null ? number(item.deprecatedCount) : null,
      source: text(item.reportingController || item.reportingComponent || source.component || optionalObject(item.deprecatedSource).component),
    };
  });
  const items = expected ? all.filter((event) => resourceCoordinate(event.resource) === resourceCoordinate(expected) && (!expected.uid || event.resource.uid === expected.uid)) : all;
  items.sort((a, b) => (Date.parse(b.lastTime) || 0) - (Date.parse(a.lastTime) || 0));
  return { items, excludedCount: all.length - items.length, instanceScoped: Boolean(expected?.uid), scope: expected ? 'resource' : 'application' };
}
