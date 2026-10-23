import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Identity, QuerySnapshot } from '../../shared/contracts.js';
import type { ApplicationDetail, ApplicationFilters, ApplicationList } from '../../shared/applications.js';
import { filterApplications, labelSelector } from '../../shared/filters.js';
import { CredentialProvider, type Connection } from '../auth/config.js';
import { RefreshCoordinator } from '../auth/refresh.js';
import { ServiceError } from '../security/errors.js';
import { redactResult } from '../security/redact.js';
import { operationUrl, requestJson, type ReadOperation, type ReadParameters } from './transport.js';
import { applicationCounts, applicationDetail, applicationSummaries } from '../domains/applications.js';
import { QueryCoordinator } from '../runtime/queries.js';
import type { ApplicationReference, EventList, LiveResource, OrphanedMonitoring, ResourceReference, ResourceTree } from '../../shared/resources.js';
import { resourceCoordinate, resourceId } from '../../shared/resources.js';
import { liveResource, navigationWorkload, orphanedMonitoring, resourceEvents, resourceTree } from '../domains/resources.js';
import type { ComparisonList, ManifestList, ManifestSelection } from '../../shared/manifests.js';
import { comparisonBlocked, managedResources, manifests, supportsSourceRevisions } from '../domains/manifests.js';
import { parseManifestSelection } from '../runtime/manifest-input.js';
import type { LogCommand } from '../../shared/logs.js';
import type { LogSource, NewLogLine } from '../runtime/log-sessions.js';
import { consumeLogs } from './logs.js';
import { LogRedactor } from '../security/logs.js';
import type { ManagementCommand, ManagementData } from '../../shared/management.js';
import * as management from '../domains/management.js';
import { parseManagementCommand } from '../runtime/management-input.js';
import { buildSummary, parseSummaryEvidence } from '../domains/summary.js';
import type { SummaryEvidence, SummaryPreview } from '../../shared/summary.js';
import type { Language } from '../../shared/language.js';

export class ArgoClient {
  private readonly scopes = new Map<string, string>();
  private readonly recentTokens = new Set<string>();
  private readonly epochKey = randomBytes(32);
  private closed = false;
  constructor(
    private readonly credentials: CredentialProvider,
    private readonly refresh: RefreshCoordinator | null,
    readonly networkEnabled = false,
    private readonly queries = new QueryCoordinator(),
  ) {}

  async contexts() {
    return { contexts: await this.credentials.list(), networkEnabled: this.networkEnabled };
  }

  private async read<T = unknown>(context: string, operation: ReadOperation, signal: AbortSignal, project: (value: unknown) => T = (value) => value as T, parameters: ReadParameters = {}): Promise<{ data: T; scope: string }> {
    if (this.closed || signal.aborted) throw new ServiceError('CANCELLED', 499);
    if (!this.networkEnabled) throw new ServiceError('NETWORK_DISABLED', 403);
    let connection = await this.credentials.resolve(context);
    try {
      const data = await requestJson(connection, operation, signal, parameters);
      if ((await this.credentials.resolve(context)).generation !== connection.generation) throw new ServiceError('AUTH_REQUIRED', 401);
      return { data: this.safe(project(data), connection) as T, scope: this.connectionScope(connection) };
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== 'AUTH_REQUIRED' || signal.aborted) throw error;
    }
    const latest = await this.credentials.resolve(context);
    if (latest.generation === connection.generation) {
      if (!this.refresh) throw new ServiceError('AUTH_REQUIRED', 401);
      await this.refresh.refresh(latest, signal);
    }
    connection = await this.credentials.resolve(context);
    const data = await requestJson(connection, operation, signal, parameters);
    // Never display data fetched for a credential snapshot that is no longer
    // current. This is deliberately conservative, including non-token changes.
    if ((await this.credentials.resolve(context)).generation !== connection.generation) throw new ServiceError('AUTH_REQUIRED', 401);
    return { data: this.safe(project(data), connection) as T, scope: this.connectionScope(connection) };
  }

  private connectionScope(connection: Connection): string {
    this.rememberTokens(connection);
    return createHash('sha256').update(JSON.stringify([connection.configPath, connection.baseUrl, connection.context, connection.user, connection.generation])).digest('hex');
  }

  async scope(context: string): Promise<string> {
    if (this.closed) throw new ServiceError('CANCELLED', 499);
    if (!this.networkEnabled) throw new ServiceError('NETWORK_DISABLED', 403);
    const connection = await this.credentials.resolve(context);
    const scope = this.connectionScope(connection);
    const previous = this.scopes.get(context);
    if (previous && previous !== scope) this.queries.invalidateScope(previous);
    if (!this.scopes.has(context) && this.scopes.size >= 128) {
      const oldest = this.scopes.keys().next().value!;
      this.queries.invalidateScope(this.scopes.get(oldest)!); this.scopes.delete(oldest);
    }
    this.scopes.set(context, scope);
    return scope;
  }
  publicEpoch(scope: string): string { return createHmac('sha256', this.epochKey).update(scope).digest('base64url'); }
  async summary(context: string, expectedEpoch: string, value: unknown, language: Language = 'zh-CN'): Promise<SummaryPreview> {
    const scope = await this.scope(context);
    if (this.publicEpoch(scope) !== expectedEpoch) throw new ServiceError('EXPIRED', 410);
    const evidence = parseSummaryEvidence(value); const connection = await this.credentials.resolve(context);
    const clean = this.safe(evidence, connection) as SummaryEvidence;
    if (scope !== await this.scope(context)) throw new ServiceError('EXPIRED', 410);
    const preview = this.safe(buildSummary(context, clean, Date.now(), language), connection) as SummaryPreview;
    preview.characters = preview.parts.join('\n\n').length;
    return preview;
  }

  private async snapshot<T>(context: string, operation: ReadOperation, signal: AbortSignal, project: (value: unknown) => T, parameters: ReadParameters = {}, variant = ''): Promise<QuerySnapshot<T>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const scope = await this.scope(context);
      const snapshot = await this.queries.run(scope, JSON.stringify([operation, parameters, variant]),
        (sharedSignal) => this.read(context, operation, sharedSignal, project, parameters), signal);
      const current = await this.scope(context);
      if (scope !== current) this.queries.invalidateScope(scope);
      // A successful CLI renewal may legitimately change scope during this
      // load. Return its verified response without a third upstream request,
      // but never cache it under the pre-renewal scope.
      if (snapshot.data.scope === current) return { ...snapshot, data: snapshot.data.data, stale: this.queries.expired(snapshot) };
      this.queries.invalidateScope(scope);
    }
    throw new ServiceError('AUTH_REQUIRED', 401);
  }

  private safe(data: unknown, connection: Connection): unknown {
    this.rememberTokens(connection);
    const result = redactResult(data, [...this.recentTokens,
      connection.key?.toString('utf8') ?? '', connection.cert?.toString('utf8') ?? '']);
    if (result.truncated) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
    return result.value;
  }
  private rememberTokens(connection: Connection): void {
    for (const value of [connection.token, connection.refreshToken]) if (value) {
      this.recentTokens.delete(value); this.recentTokens.add(value);
    }
    while (this.recentTokens.size > 16) this.recentTokens.delete(this.recentTokens.values().next().value!);
  }

  async identity(context: string, signal: AbortSignal): Promise<Identity> {
    const { data: value } = await this.read(context, 'identity', signal);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('UPSTREAM_INVALID', 502);
    const input = value as Record<string, unknown>;
    if (typeof input.loggedIn !== 'boolean' || typeof input.username !== 'string' || (input.groups !== undefined && !Array.isArray(input.groups))) throw new ServiceError('UPSTREAM_INVALID', 502);
    if (!input.loggedIn) throw new ServiceError('AUTH_REQUIRED', 401);
    return {
      loggedIn: true, username: input.username.slice(0, 512),
      issuer: typeof input.iss === 'string' ? input.iss.slice(0, 1000) : '',
      groups: Array.isArray(input.groups) ? input.groups.filter((g): g is string => typeof g === 'string').slice(0, 100).map((g) => g.slice(0, 512)) : [],
    };
  }

  async applications(context: string, filters: ApplicationFilters, signal: AbortSignal): Promise<ApplicationList> {
    return (await this.applicationsSnapshot(context, filters, signal)).data;
  }

  async applicationsSnapshot(context: string, filters: ApplicationFilters, signal: AbortSignal): Promise<QuerySnapshot<ApplicationList>> {
    try { labelSelector(filters.selector ?? ''); }
    catch { throw new ServiceError('BAD_REQUEST', 400); }
    const snapshot = await this.snapshot(context, 'applications', signal, applicationSummaries);
    const matched = filterApplications(snapshot.data, filters);
    return { ...snapshot, data: { items: matched, totals: applicationCounts(snapshot.data), matched: applicationCounts(matched) } };
  }

  async application(context: string, name: string, appNamespace: string, signal: AbortSignal): Promise<ApplicationDetail> {
    return (await this.applicationSnapshot(context, name, appNamespace, signal)).data;
  }

  async applicationSnapshot(context: string, name: string, appNamespace: string, signal: AbortSignal): Promise<QuerySnapshot<ApplicationDetail>> {
    const snapshot = await this.snapshot(context, 'application', signal, (value) => {
      const result = applicationDetail(value);
      if (result.name !== name || result.appNamespace !== appNamespace) throw new ServiceError('UPSTREAM_INVALID', 502);
      return result;
    }, { name, appNamespace });
    return snapshot;
  }

  async resourceTreeSnapshot(context: string, app: ApplicationReference, signal: AbortSignal): Promise<QuerySnapshot<ResourceTree>> {
    const scope = await this.scope(context); const snapshot = await this.baseTree(context, app, signal);
    const candidates = snapshot.data.nodes.filter((node) => node.group === 'apps' && ['Deployment', 'ReplicaSet'].includes(node.kind));
    const facts = new Map<string, Awaited<ReturnType<typeof this.navigationFacts>>['data']>();
    await this.bounded(candidates.slice(0, 64), signal, async (node) => {
      try { const result = await this.navigationFacts(context, app, node, signal); facts.set(node.id, result.data); this.mergeAge(snapshot, result); }
      catch (error) { this.checkFatal(error, signal); snapshot.data.warnings.push(`WORKLOAD_DETAILS_UNAVAILABLE:${node.kind}/${node.name}`); }
    });
    if (candidates.length > 64) snapshot.data.warnings.push('WORKLOAD_DETAILS_LIMIT');
    for (const deployment of candidates.filter((node) => node.kind === 'Deployment')) {
      const target = facts.get(deployment.id)?.templateKey;
      const sets = candidates.filter((node) => node.kind === 'ReplicaSet' && node.parents.includes(deployment.id));
      const matching = sets.filter((node) => target && facts.get(node.id)?.templateKey === target).sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.name.localeCompare(b.name));
      for (const node of sets) { const detail = facts.get(node.id); if (!detail) continue;
        node.replicaSet = { revision: detail.revision, desired: detail.workload?.desired ?? null, replicas: detail.workload?.replicas ?? null, current: target && detail.templateKey && matching.length && sets.every((node) => facts.get(node.id)?.templateKey) ? matching[0]?.id === node.id : null };
      }
    }
    if (scope !== await this.scope(context)) throw new ServiceError('AUTH_REQUIRED', 401);
    return snapshot;
  }

  private baseTree(context: string, app: ApplicationReference, signal: AbortSignal) {
    return this.snapshot(context, 'resourceTree', signal, resourceTree, { ...app });
  }
  private navigationFacts(context: string, app: ApplicationReference, resource: ResourceReference, signal: AbortSignal) {
    return this.snapshot(context, 'resource', signal, (value) => navigationWorkload(value, resource, (text) => createHmac('sha256', this.epochKey).update(text).digest('hex')),
      { ...app, group: resource.group, version: resource.version, kind: resource.kind, namespace: resource.namespace, resourceName: resource.name }, `navigation:${resource.uid}`);
  }
  private async bounded<T>(items: T[], signal: AbortSignal, work: (item: T) => Promise<void>) {
    let next = 0; let failed = false;
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
      while (!failed && next < items.length) {
        if (signal.aborted) throw new ServiceError('CANCELLED', 499);
        const item = items[next++]!;
        try { await work(item); } catch (error) { failed = true; throw error; }
      }
    }));
  }
  private checkFatal(error: unknown, signal: AbortSignal) {
    if (signal.aborted || error instanceof ServiceError && ['AUTH_REQUIRED', 'NETWORK_DISABLED', 'CONTEXT_NOT_FOUND', 'CANCELLED'].includes(error.code)) throw error;
  }
  private mergeAge(target: QuerySnapshot<unknown>, source: QuerySnapshot<unknown>) {
    if (source.sampledAt < target.sampledAt) target.sampledAt = source.sampledAt;
    if (source.expiresAt < target.expiresAt) target.expiresAt = source.expiresAt;
    target.stale ||= source.stale;
  }

  private async verifyResource(context: string, app: ApplicationReference, resource: ResourceReference, signal: AbortSignal): Promise<void> {
    const tree = await this.baseTree(context, app, signal);
    const matching = tree.data.nodes.filter((node) => resourceCoordinate(node) === resourceCoordinate(resource) && (!resource.uid || node.uid === resource.uid));
    if (matching.length !== 1) throw new ServiceError('RESOURCE_CHANGED', 409);
  }

  async resourceSnapshot(context: string, app: ApplicationReference, resource: ResourceReference, signal: AbortSignal): Promise<QuerySnapshot<LiveResource>> {
    const parameters = { ...app, group: resource.group, kind: resource.kind, version: resource.version, namespace: resource.namespace, resourceName: resource.name };
    operationUrl('https://validation.invalid', 'resource', parameters);
    await this.verifyResource(context, app, resource, signal);
    return this.snapshot(context, 'resource', signal, (value) => liveResource(value, resource), parameters, JSON.stringify(resource));
  }

  async eventsSnapshot(context: string, app: ApplicationReference, signal: AbortSignal, resource?: ResourceReference): Promise<QuerySnapshot<EventList>> {
    const parameters = resource ? { ...app, resourceName: resource.name, namespace: resource.namespace, resourceUID: resource.uid } : { ...app };
    operationUrl('https://validation.invalid', 'events', parameters);
    if (resource) await this.verifyResource(context, app, resource, signal);
    return this.snapshot(context, 'events', signal, (value) => resourceEvents(value, resource), parameters, JSON.stringify(resource ?? null));
  }

  async relatedEventsSnapshot(context: string, app: ApplicationReference, signal: AbortSignal, resource: ResourceReference): Promise<QuerySnapshot<EventList>> {
    if (resource.group !== 'apps' || resource.kind !== 'Deployment' || !resource.uid) throw new ServiceError('BAD_REQUEST', 400);
    const scope = await this.scope(context); const tree = await this.baseTree(context, app, signal);
    const nodes = new Map(tree.data.nodes.map((node) => [node.id, node])); const root = nodes.get(resourceId(resource));
    if (!root) throw new ServiceError('RESOURCE_CHANGED', 409);
    const seen = new Set<string>(); const pending = [root.id]; const members: typeof tree.data.nodes = [];
    while (pending.length) { const id = pending.shift()!; if (seen.has(id)) continue; seen.add(id); const node = nodes.get(id); if (!node || node.orphaned !== root.orphaned) continue; members.push(node); pending.push(...node.children); }
    const data: EventList = { scope: 'related', instanceScoped: true, excludedCount: 0, items: [], related: { total: members.length, omitted: Math.max(0, members.length - 64), resources: [] } };
    const result: QuerySnapshot<EventList> = { ...tree, data }; const events = new Map<string, EventList['items'][number]>();
    await this.bounded(members.slice(0, 64), signal, async (node) => {
      const entry: NonNullable<EventList['related']>['resources'][number] = { resource: { group: node.group, version: node.version, kind: node.kind, namespace: node.namespace, name: node.name, uid: node.uid } };
      try { const sample = await this.eventsSnapshot(context, app, signal, entry.resource); this.mergeAge(result, sample); data.excludedCount += sample.data.excludedCount; for (const event of sample.data.items) events.set(JSON.stringify([event.namespace, event.id]), event); }
      catch (error) { this.checkFatal(error, signal); entry.eventsError = error instanceof ServiceError ? error.code : 'UPSTREAM_INVALID'; }
      if (node.kind === 'Pod' && node.group === '') {
        try { const sample = await this.resourceSnapshot(context, app, entry.resource, signal); this.mergeAge(result, sample); entry.pod = sample.data.pod; }
        catch (error) { this.checkFatal(error, signal); entry.liveError = error instanceof ServiceError ? error.code : 'UPSTREAM_INVALID'; }
      }
      data.related!.resources.push(entry);
    });
    data.items = [...events.values()].sort((a, b) => (Date.parse(b.lastTime) || 0) - (Date.parse(a.lastTime) || 0));
    data.related!.resources.sort((a, b) => resourceId(a.resource).localeCompare(resourceId(b.resource)));
    if (scope !== await this.scope(context)) throw new ServiceError('AUTH_REQUIRED', 401);
    return result;
  }

  async orphanedMonitoringSnapshot(context: string, project: string, signal: AbortSignal): Promise<QuerySnapshot<OrphanedMonitoring>> {
    return this.snapshot(context, 'orphanedMonitoring', signal, orphanedMonitoring, { project });
  }

  async manifestsSnapshot(context: string, app: ApplicationReference, selection: ManifestSelection, signal: AbortSignal): Promise<QuerySnapshot<ManifestList>> {
    selection = parseManifestSelection(selection);
    const scope = await this.scope(context);
    const application = await this.applicationSnapshot(context, app.name, app.appNamespace, signal);
    if ((selection.revision && application.data.multipleSources) || (selection.sources && (!application.data.multipleSources || selection.sources.some((source) => source.position > application.data.sources.length)))) throw new ServiceError('BAD_REQUEST', 400);
    if (selection.sources) {
      const version = await this.snapshot(context, 'version', signal, supportsSourceRevisions);
      if (!version.data) throw new ServiceError('CAPABILITY_UNAVAILABLE', 422);
    }
    const parameters: ReadParameters = { ...app, ...(selection.revision ? { revision: selection.revision } : {}), ...(selection.sources ? { sourcePositions: selection.sources.map((source) => source.position), revisions: selection.sources.map((source) => source.revision) } : {}) };
    const result = await this.snapshot(context, 'manifests', signal, (value) => manifests(value, selection), parameters);
    if (scope !== await this.scope(context)) throw new ServiceError('AUTH_REQUIRED', 401);
    return result;
  }

  async comparisonSnapshot(context: string, app: ApplicationReference, signal: AbortSignal): Promise<QuerySnapshot<ComparisonList>> {
    const scope = await this.scope(context);
    const observation = await this.applicationSnapshot(context, app.name, app.appNamespace, signal);
    const snapshot = await this.snapshot(context, 'managedResources', signal, managedResources, { ...app });
    if (scope !== await this.scope(context)) throw new ServiceError('AUTH_REQUIRED', 401);
    const blocked = comparisonBlocked(observation.data);
    return { ...snapshot, data: {
      items: snapshot.data.map((item) => blocked ? { ...item, status: 'unavailable' as const, reason: 'APPLICATION_COMPARISON_UNAVAILABLE' } : item),
      applicationObservation: { sampledAt: observation.sampledAt, reconciledAt: observation.data.reconciledAt, comparedRevisions: observation.data.comparedRevisions, blocked },
      note: '服务端缓存的 normalizedLiveState / predictedLiveState 比较；沿用 Argo 忽略规则、归一化与比较策略，不重新执行客户端 raw Live/Target 比较。不是指定历史 revision 的 Diff；与应用状态为非原子采样，不承诺实际实时或完整 UI 一致性。敏感内容脱敏可能隐藏可见差异。',
    } };
  }

  logSource(command: LogCommand, scope: string): LogSource {
    const validate = async (signal: AbortSignal) => {
      if (await this.scope(command.context) !== scope) throw new ServiceError('AUTH_REQUIRED', 401);
      const { resource } = command;
      const result = await this.read(command.context, 'resource', signal, (value) => liveResource(value, resource), { name: command.name, appNamespace: command.appNamespace, resourceName: resource.name, namespace: resource.namespace, kind: resource.kind, group: resource.group, version: resource.version });
      const spec = result.data.manifest.spec;
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new ServiceError('UPSTREAM_INVALID', 502);
      const fields = spec as Record<string, unknown>;
      const containers = [fields.containers, fields.initContainers, fields.ephemeralContainers].flatMap((value) => Array.isArray(value) ? value : []);
      if (!containers.some((value) => value && typeof value === 'object' && (value as Record<string, unknown>).name === command.container)) throw new ServiceError('NOT_FOUND', 404);
      if (await this.scope(command.context) !== scope) throw new ServiceError('AUTH_REQUIRED', 401);
    };
    return { validate, run: async (signal, push, opened) => {
      await this.verifyResource(command.context, { name: command.name, appNamespace: command.appNamespace }, command.resource, signal);
      await validate(signal);
      const connection = await this.credentials.resolve(command.context);
      if (this.connectionScope(connection) !== scope) throw new ServiceError('AUTH_REQUIRED', 401);
      const redactor = new LogRedactor([...this.recentTokens, connection.key?.toString('utf8') ?? '', connection.cert?.toString('utf8') ?? '']);
      return consumeLogs(connection, command, signal, (line) => push(this.safe({ ...line, ...redactor.clean(line.content) }, connection) as NewLogLine), opened);
    } };
  }

  async managementSnapshot(input: ManagementCommand, signal: AbortSignal): Promise<QuerySnapshot<ManagementData>> {
    const command = parseManagementCommand(input); const context = command.context;
    switch (command.operation) {
      case 'projects': return this.snapshot(context, 'projects', signal, management.projects);
      case 'repositories': return this.snapshot(context, 'repositories', signal, management.repositories);
      case 'clusters': return this.snapshot(context, 'clusters', signal, management.clusters);
      case 'project': return this.snapshot(context, 'project', signal, (value) => {
        const result = management.project(value); if (result.name !== command.project) throw new ServiceError('UPSTREAM_INVALID', 502); return result;
      }, { project: command.project });
      case 'projectWindows': return this.snapshot(context, 'projectWindows', signal, (value) => management.windowState(value, 'project'), { project: command.project });
      case 'applicationWindows': return this.snapshot(context, 'applicationWindows', signal, (value) => management.windowState(value, 'application'), { name: command.name, appNamespace: command.appNamespace });
      case 'applicationSets': return this.snapshot(context, 'applicationSets', signal, (value) => management.applicationSets(value, command.appsetNamespace ?? ''), command.appsetNamespace ? { appsetNamespace: command.appsetNamespace } : {});
      case 'applicationSet': return this.snapshot(context, 'applicationSet', signal, (value) => {
        const result = management.applicationSet(value); if (result.name !== command.name || result.namespace !== command.appsetNamespace) throw new ServiceError('UPSTREAM_INVALID', 502); return result;
      }, { name: command.name, appsetNamespace: command.appsetNamespace });
      case 'applicationSetChildren': return this.snapshot(context, 'applicationSetChildren', signal, management.applicationSetChildren, { name: command.name, appsetNamespace: command.appsetNamespace });
      case 'applicationSetEvents': {
        const scope = await this.scope(context);
        const parent = await this.snapshot(context, 'applicationSet', signal, (value) => {
          const result = management.applicationSet(value); if (result.name !== command.name || result.namespace !== command.appsetNamespace) throw new ServiceError('UPSTREAM_INVALID', 502); return result;
        }, { name: command.name, appsetNamespace: command.appsetNamespace });
        if (parent.data.name !== command.name || parent.data.namespace !== command.appsetNamespace || !parent.data.uid) throw new ServiceError('UPSTREAM_INVALID', 502);
        const expected = { group: 'argoproj.io', version: 'v1alpha1', kind: 'ApplicationSet', name: command.name, namespace: command.appsetNamespace, uid: parent.data.uid };
        const result = await this.snapshot(context, 'applicationSetEvents', signal, (value) => management.applicationSetEvents(value, expected), { name: command.name, appsetNamespace: command.appsetNamespace }, parent.data.uid);
        if (scope !== await this.scope(context)) throw new ServiceError('AUTH_REQUIRED', 401);
        return result;
      }
    }
  }

  close(): void { this.closed = true; this.queries.close(); this.scopes.clear(); this.recentTokens.clear(); }
}
