import type { ApplicationDetail } from '../shared/applications.js';
import type { Envelope } from '../shared/contracts.js';
import type { ComparisonList } from '../shared/manifests.js';
import type { ApplicationReference, EventList, LiveResource, ResourceTree } from '../shared/resources.js';
import type { LogSelection, SummaryEvidence, SummaryKind, SummaryRecord } from '../shared/summary.js';

type Sample<T> = Extract<Envelope<T>, { ok: true }>;
const excerpt = (value: string, max = 180) => value.length > max ? `${value.slice(0, max - 10)} [excerpt]` : value;
/** Bounded, memory-only, selected evidence. Never stores full manifests,
 * generator values, repository credentials or the complete log ring. */
export class EvidenceStore {
  private context = ''; private application: ApplicationReference | undefined; private epoch = '';
  private readonly records = new Map<SummaryKind, SummaryRecord>(); private readonly listeners = new Set<() => void>();
  private resourceRecord: SummaryRecord | undefined;
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(): void { for (const listener of this.listeners) listener(); }
  reset(context = '', application?: ApplicationReference): void { this.context = context; this.application = application; this.epoch = ''; this.records.clear(); this.resourceRecord = undefined; this.changed(); }
  clearResource(): void { this.records.delete('events'); this.records.delete('logs'); this.resourceRecord = undefined; this.changed(); }
  clearResources(): void { this.records.delete('resources'); this.clearResource(); }
  clearLogs(): void { this.records.delete('logs'); this.changed(); }
  private set<T>(kind: SummaryKind, sample: Sample<T>, lines: string[]): void {
    if (!this.application || !sample.identityEpoch) return;
    if (this.epoch && sample.identityEpoch !== this.epoch) { this.reset(); return; }
    this.epoch = sample.identityEpoch;
    this.records.set(kind, { kind, sampledAt: sample.sampledAt, expiresAt: sample.expiresAt ?? sample.sampledAt, stale: sample.stale, source: sample.source ?? 'argo-api', lines: lines.slice(0, 20).map((line) => excerpt(line, 400)) }); this.changed();
  }
  app(sample: Sample<ApplicationDetail>): void {
    const app = sample.data;
    if (!this.application || app.name !== this.application.name || app.appNamespace !== this.application.appNamespace) { this.reset(); return; }
    this.set('application', sample, [JSON.stringify({ name: app.name, namespace: app.appNamespace, project: app.project, sync: app.sync, health: app.health, comparedRevisions: app.comparedRevisions.slice(0, 4), operation: app.operation?.phase ?? 'not-reported' })]);
    this.set('conditions', sample, [`${app.conditions.length} reported Conditions; not a health guarantee`, ...app.conditions.slice(0, 5).map((item) => JSON.stringify({ type: item.type, message: excerpt(item.message), at: item.lastTransitionTime }))]);
  }
  tree(sample: Sample<ResourceTree>): void {
    this.set('resources', sample, [`${sample.data.nodes.length} returned nodes; warnings: ${sample.data.warnings.join(',') || 'none reported'}`, ...sample.data.nodes.filter((node) => node.health !== 'Healthy').slice(0, 6).map((node) => JSON.stringify({ kind: node.kind, namespace: node.namespace, name: node.name, health: node.health, orphaned: node.orphaned }))]);
  }
  live(sample: Sample<LiveResource>): void {
    if (!this.application || !sample.identityEpoch || this.epoch !== sample.identityEpoch) return;
    const value = sample.data;
    this.resourceRecord = { kind: 'resources', sampledAt: sample.sampledAt, expiresAt: sample.expiresAt ?? sample.sampledAt, source: sample.source ?? 'argo-api', stale: sample.stale, lines: [JSON.stringify({ selected: { kind: value.reference.kind, namespace: value.reference.namespace, name: value.reference.name, uid: value.reference.uid }, pod: value.pod?.phase ?? 'not-a-pod' }), ...(value.pod?.containers ?? []).slice(0, 3).map((item) => JSON.stringify({ container: item.name, phase: item.phase, ready: item.ready, restarts: item.restarts, reason: item.reason }))].map((line) => excerpt(line, 400)) }; this.changed();
  }
  events(sample: Sample<EventList>): void { this.set('events', sample, [`${sample.data.items.length} events in ${sample.data.scope} scope; retained events only; excluded ${sample.data.excludedCount}`, ...sample.data.items.slice(0, 4).map((item) => JSON.stringify({ type: item.type, reason: item.reason, count: item.count, at: item.lastTime, message: excerpt(item.message, 120) }))]); }
  comparison(sample: Sample<ComparisonList>): void { this.set('diff', sample, [`server cached comparison; blocked=${sample.data.applicationObservation.blocked}; not a historical revision comparison`, ...sample.data.items.slice(0, 6).map((item) => JSON.stringify({ kind: item.reference.kind, namespace: item.reference.namespace, name: item.reference.name, status: item.status, reason: item.reason, visiblePaths: item.changedPaths.slice(0, 2) }))]); }
  logs(selection: LogSelection): void {
    if (!this.application || this.context !== selection.context || this.application.name !== selection.application.name || this.application.appNamespace !== selection.application.appNamespace || !this.epoch) return;
    this.records.set('logs', { kind: 'logs', sampledAt: selection.sampledAt, expiresAt: selection.sampledAt, source: 'selected-log-fragment', stale: true, lines: [excerpt(selection.note, 400), ...selection.lines.slice(0, 10).map((line) => excerpt(line, 400))] }); this.changed();
  }
  snapshot(includeLogs = false): { context: string; identityEpoch: string; evidence: SummaryEvidence } | null {
    if (!this.application || !this.epoch || !this.records.has('application')) return null;
    const records = [...this.records.values()].filter((record) => includeLogs || record.kind !== 'logs').map((record) => structuredClone(record));
    if (this.resourceRecord) records.push({ ...structuredClone(this.resourceRecord), kind: 'resources' });
    // Keep unique categories. Selected Live and tree evidence retain their
    // distinct sampling metadata as quoted lines, not a fake shared sample.
    const resource = records.filter((record) => record.kind === 'resources');
    if (resource.length > 1) {
      const tree = resource[0]!; const live = resource[1]!;
      tree.lines.push(`Selected Live sampled separately at ${live.sampledAt}; expires ${live.expiresAt}; source ${live.source}`, ...live.lines);
      tree.stale ||= live.stale || Date.parse(live.expiresAt) <= Date.now(); records.splice(records.indexOf(live), 1);
    }
    return structuredClone({ context: this.context, identityEpoch: this.epoch, evidence: { application: this.application, records } });
  }
  count(): number { return this.records.size + (this.resourceRecord ? 1 : 0); }
}
