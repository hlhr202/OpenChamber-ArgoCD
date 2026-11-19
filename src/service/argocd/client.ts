import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Identity, QuerySnapshot } from '../../shared/contracts.js';
import type { ApplicationDetail, ApplicationFilters, ApplicationList } from '../../shared/applications.js';
import { filterApplications, labelSelector } from '../../shared/filters.js';
import { CredentialProvider, type Connection } from '../auth/config.js';
import { RefreshCoordinator } from '../auth/refresh.js';
import { ServiceError } from '../security/errors.js';
import { redactResult } from '../security/redact.js';
import { mutateJson, operationUrl, requestJson, type ReadOperation, type ReadParameters, type WriteOperation, type WriteParameters } from './transport.js';
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
import type {
  ActionResult, CanIQuery, CanIResult, CreateApplicationRequest, DeleteApplicationRequest,
  DeleteResourceRequest, ManagementActionRequest, PatchApplicationRequest, PatchResourceRequest,
  RefreshApplicationRequest, ResourceActionItem, ResourceActionList, RollbackApplicationRequest,
  RunResourceActionRequest, SyncApplicationRequest, TerminateOperationRequest, UpdateApplicationRequest,
} from '../../shared/actions.js';

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

  async canI(query: CanIQuery, signal: AbortSignal): Promise<CanIResult> {
    const { data } = await this.read(query.context, 'canI', signal, (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('UPSTREAM_INVALID', 502);
      const raw = (value as { value?: unknown }).value;
      if (raw !== 'yes' && raw !== 'no') throw new ServiceError('UPSTREAM_INVALID', 502);
      return { allowed: raw === 'yes' };
    }, { rbacResource: query.resource, rbacAction: query.action, rbacSubresource: query.subresource });
    return data;
  }

  async resourceActions(context: string, app: ApplicationReference, resource: ResourceReference, signal: AbortSignal): Promise<ResourceActionList> {
    const parameters: ReadParameters = { ...app, group: resource.group, kind: resource.kind, version: resource.version, namespace: resource.namespace, resourceName: resource.name };
    operationUrl('https://validation.invalid', 'resourceActions', parameters);
    await this.verifyResource(context, app, resource, signal);
    const { data } = await this.read(context, 'resourceActions', signal, (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('UPSTREAM_INVALID', 502);
      const list = (value as { actions?: unknown }).actions;
      if (list !== undefined && !Array.isArray(list)) throw new ServiceError('UPSTREAM_INVALID', 502);
      const actions: ResourceActionItem[] = (Array.isArray(list) ? list : []).flatMap((item): ResourceActionItem[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const rec = item as Record<string, unknown>;
        if (typeof rec.name !== 'string' || !rec.name) return [];
        const params = Array.isArray(rec.params) ? rec.params.flatMap((param) => {
          if (!param || typeof param !== 'object' || Array.isArray(param)) return [];
          const p = param as Record<string, unknown>;
          if (typeof p.name !== 'string' || !p.name) return [];
          return [{ name: p.name, ...(typeof p.default === 'string' ? { default: p.default } : {}), ...(typeof p.type === 'string' ? { type: p.type } : {}) }];
        }) : [];
        return [{
          name: rec.name,
          displayName: typeof rec.displayName === 'string' && rec.displayName ? rec.displayName : rec.name,
          iconClass: typeof rec.iconClass === 'string' ? rec.iconClass : '',
          disabled: Boolean(rec.disabled),
          params,
        }];
      });
      return { actions };
    }, parameters);
    return data;
  }

  /**
   * Non-cached, non-retried write path. Verifies identityEpoch before dispatch
   * and invalidates cached observations for the scope upon completion.
   */
  private async mutate<T = unknown>(
    context: string,
    expectedEpoch: string,
    operation: WriteOperation,
    signal: AbortSignal,
    parameters: WriteParameters = {},
    body?: unknown,
    project: (value: unknown) => T = (value) => value as T,
  ): Promise<T> {
    if (this.closed || signal.aborted) throw new ServiceError('CANCELLED', 499);
    if (!this.networkEnabled) throw new ServiceError('NETWORK_DISABLED', 403);
    const scope = await this.scope(context);
    if (this.publicEpoch(scope) !== expectedEpoch) throw new ServiceError('EXPIRED', 410);
    const connection = await this.credentials.resolve(context);
    if (this.connectionScope(connection) !== scope) throw new ServiceError('EXPIRED', 410);
    const raw = await mutateJson(connection, operation, signal, parameters, body);
    this.queries.invalidateScope(scope);
    return this.safe(project(raw), connection) as T;
  }

  async refreshApplication(req: RefreshApplicationRequest, signal: AbortSignal): Promise<ActionResult<ApplicationDetail>> {
    const data = await this.mutate(req.context, req.identityEpoch, 'refreshApplication', signal, { name: req.name, appNamespace: req.appNamespace, refresh: req.mode }, undefined, applicationDetail);
    return { operation: 'refresh', accepted: true, data };
  }

  /** Mirrors argoproj/argo-cd cmd/argocd/commands/app.go NewApplicationSyncCommand. */
  async syncApplication(req: SyncApplicationRequest, signal: AbortSignal): Promise<ActionResult<ApplicationDetail>> {
    const syncOptionsItems: string[] = [];
    if (req.replace) syncOptionsItems.push('Replace=true');
    if (req.serverSideApply) syncOptionsItems.push('ServerSideApply=true');
    if (req.applyOutOfSyncOnly) syncOptionsItems.push('ApplyOutOfSyncOnly=true');
    const body: Record<string, unknown> = {
      name: req.name,
      appNamespace: req.appNamespace,
      ...(req.revision !== undefined ? { revision: req.revision } : {}),
      ...(req.revisions && req.sourcePositions ? { revisions: req.revisions, sourcePositions: req.sourcePositions } : {}),
      ...(req.dryRun !== undefined ? { dryRun: req.dryRun } : {}),
      ...(req.prune !== undefined ? { prune: req.prune } : {}),
      ...(req.resources?.length ? { resources: req.resources } : {}),
      ...(syncOptionsItems.length ? { syncOptions: { items: syncOptionsItems } } : {}),
      ...(req.retryLimit !== undefined ? { retryStrategy: { limit: req.retryLimit } } : {}),
    };
    if (req.strategy === 'apply') body.strategy = { apply: { force: Boolean(req.force) } };
    else if (req.strategy === 'hook' || req.force) body.strategy = { hook: { force: Boolean(req.force) } };
    const data = await this.mutate(req.context, req.identityEpoch, 'syncApplication', signal, { name: req.name, appNamespace: req.appNamespace }, body, applicationDetail);
    return { operation: 'sync', accepted: true, data };
  }

  async terminateOperation(req: TerminateOperationRequest, signal: AbortSignal): Promise<ActionResult> {
    await this.mutate(req.context, req.identityEpoch, 'terminateOperation', signal, { name: req.name, appNamespace: req.appNamespace });
    return { operation: 'terminate', accepted: true };
  }

  async rollbackApplication(req: RollbackApplicationRequest, signal: AbortSignal): Promise<ActionResult<ApplicationDetail>> {
    const body: Record<string, unknown> = {
      name: req.name,
      appNamespace: req.appNamespace,
      id: req.id,
      ...(req.dryRun !== undefined ? { dryRun: req.dryRun } : {}),
      ...(req.prune !== undefined ? { prune: req.prune } : {}),
    };
    const data = await this.mutate(req.context, req.identityEpoch, 'rollbackApplication', signal, { name: req.name, appNamespace: req.appNamespace }, body, applicationDetail);
    return { operation: 'rollback', accepted: true, data };
  }

  async createApplication(req: CreateApplicationRequest, signal: AbortSignal): Promise<ActionResult<ApplicationDetail>> {
    const data = await this.mutate(req.context, req.identityEpoch, 'createApplication', signal, {
      ...(req.upsert !== undefined ? { upsert: req.upsert } : {}),
      ...(req.validate !== undefined ? { validate: req.validate } : {}),
    }, req.application, applicationDetail);
    return { operation: 'createApplication', accepted: true, data };
  }

  async updateApplication(req: UpdateApplicationRequest, signal: AbortSignal): Promise<ActionResult<ApplicationDetail>> {
    const data = await this.mutate(req.context, req.identityEpoch, 'updateApplication', signal, {
      name: req.name, appNamespace: req.appNamespace,
      ...(req.validate !== undefined ? { validate: req.validate } : {}),
    }, req.application, applicationDetail);
    return { operation: 'updateApplication', accepted: true, data };
  }

  async patchApplication(req: PatchApplicationRequest, signal: AbortSignal): Promise<ActionResult<ApplicationDetail>> {
    const body = { name: req.name, appNamespace: req.appNamespace, patch: req.patch, patchType: req.patchType };
    const data = await this.mutate(req.context, req.identityEpoch, 'patchApplication', signal, { name: req.name, appNamespace: req.appNamespace }, body, applicationDetail);
    return { operation: 'patchApplication', accepted: true, data };
  }

  async deleteApplication(req: DeleteApplicationRequest, signal: AbortSignal): Promise<ActionResult> {
    await this.mutate(req.context, req.identityEpoch, 'deleteApplication', signal, {
      name: req.name, appNamespace: req.appNamespace,
      ...(req.cascade !== undefined ? { cascade: req.cascade } : {}),
      ...(req.propagationPolicy ? { propagationPolicy: req.propagationPolicy } : {}),
    });
    return { operation: 'deleteApplication', accepted: true };
  }

  /** Mirrors argoproj/argo-cd cmd/argocd/commands/app_actions.go RunResourceActionV2 -> V1 fallback. */
  async runResourceAction(req: RunResourceActionRequest, signal: AbortSignal): Promise<ActionResult> {
    const app = { name: req.name, appNamespace: req.appNamespace };
    await this.verifyResource(req.context, app, req.resource, signal);
    const v2Body: Record<string, unknown> = {
      name: req.name,
      appNamespace: req.appNamespace,
      namespace: req.resource.namespace,
      resourceName: req.resource.name,
      version: req.resource.version,
      group: req.resource.group,
      kind: req.resource.kind,
      action: req.action,
      ...(req.parameters?.length ? { resourceActionParameters: req.parameters } : {}),
    };
    try {
      await this.mutate(req.context, req.identityEpoch, 'runResourceActionV2', signal, app, v2Body);
      return { operation: 'resourceAction', accepted: true, fallbackUsed: false };
    } catch (error) {
      if (!(error instanceof ServiceError) || !['NOT_FOUND', 'CAPABILITY_UNAVAILABLE'].includes(error.code)) throw error;
      if (req.parameters?.length) throw new ServiceError('CAPABILITY_UNAVAILABLE', 501);
      await this.mutate(req.context, req.identityEpoch, 'runResourceActionV1', signal, {
        ...app,
        namespace: req.resource.namespace,
        resourceName: req.resource.name,
        version: req.resource.version,
        group: req.resource.group,
        kind: req.resource.kind,
      }, req.action);
      return { operation: 'resourceAction', accepted: true, fallbackUsed: true };
    }
  }

  async deleteResource(req: DeleteResourceRequest, signal: AbortSignal): Promise<ActionResult> {
    const app = { name: req.name, appNamespace: req.appNamespace };
    await this.verifyResource(req.context, app, req.resource, signal);
    await this.mutate(req.context, req.identityEpoch, 'deleteResource', signal, {
      ...app,
      namespace: req.resource.namespace,
      resourceName: req.resource.name,
      version: req.resource.version,
      group: req.resource.group,
      kind: req.resource.kind,
      ...(req.force !== undefined ? { force: req.force } : {}),
      ...(req.orphan !== undefined ? { orphan: req.orphan } : {}),
    });
    return { operation: 'deleteResource', accepted: true };
  }

  async patchResource(req: PatchResourceRequest, signal: AbortSignal): Promise<ActionResult<LiveResource>> {
    const app = { name: req.name, appNamespace: req.appNamespace };
    await this.verifyResource(req.context, app, req.resource, signal);
    const data = await this.mutate(req.context, req.identityEpoch, 'patchResource', signal, {
      ...app,
      namespace: req.resource.namespace,
      resourceName: req.resource.name,
      version: req.resource.version,
      group: req.resource.group,
      kind: req.resource.kind,
      patchType: req.patchType,
    }, req.patch, (value) => liveResource(value, req.resource));
    return { operation: 'patchResource', accepted: true, data };
  }

  async managementAction(req: ManagementActionRequest, signal: AbortSignal): Promise<ActionResult> {
    switch (req.operation) {
      case 'createApplicationSet': {
        const data = await this.mutate(req.context, req.identityEpoch, 'createApplicationSet', signal, { ...(req.upsert !== undefined ? { upsert: req.upsert } : {}) }, req.applicationSet, management.applicationSet);
        return { operation: req.operation, accepted: true, data };
      }
      case 'deleteApplicationSet':
        await this.mutate(req.context, req.identityEpoch, 'deleteApplicationSet', signal, { name: req.name, appsetNamespace: req.appsetNamespace });
        return { operation: req.operation, accepted: true };
      case 'createProject': {
        const data = await this.mutate(req.context, req.identityEpoch, 'createProject', signal, { ...(req.upsert !== undefined ? { upsert: req.upsert } : {}) }, { project: req.project, ...(req.upsert !== undefined ? { upsert: req.upsert } : {}) }, management.project);
        return { operation: req.operation, accepted: true, data };
      }
      case 'updateProject': {
        const data = await this.mutate(req.context, req.identityEpoch, 'updateProject', signal, { project: req.name }, { project: req.project }, management.project);
        return { operation: req.operation, accepted: true, data };
      }
      case 'deleteProject':
        await this.mutate(req.context, req.identityEpoch, 'deleteProject', signal, { project: req.name });
        return { operation: req.operation, accepted: true };
      case 'validateRepository':
        await this.mutate(req.context, req.identityEpoch, 'validateRepository', signal, { repo: req.repo, ...(req.type ? { repoType: req.type } : {}), ...(req.project ? { project: req.project } : {}) }, {});
        return { operation: req.operation, accepted: true };
      case 'deleteRepository':
        await this.mutate(req.context, req.identityEpoch, 'deleteRepository', signal, { repo: req.repo, ...(req.appProject ? { appProject: req.appProject } : {}) });
        return { operation: req.operation, accepted: true };
      case 'invalidateClusterCache':
        await this.mutate(req.context, req.identityEpoch, 'invalidateClusterCache', signal, { server: req.server });
        return { operation: req.operation, accepted: true };
      case 'deleteCluster':
        await this.mutate(req.context, req.identityEpoch, 'deleteCluster', signal, { server: req.server });
        return { operation: req.operation, accepted: true };
    }
  }

  close(): void { this.closed = true; this.queries.close(); this.scopes.clear(); this.recentTokens.clear(); }
}
