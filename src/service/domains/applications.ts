import type { ApplicationCounts, ApplicationDetail, ApplicationSummary, OperationResource, SourceDetail, SourceSummary } from '../../shared/applications.js';
import { ServiceError } from '../security/errors.js';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('UPSTREAM_INVALID', 502);
  return value as Record<string, unknown>;
}
export function optionalObject(value: unknown): Record<string, unknown> { return value == null ? {} : object(value); }
export function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new ServiceError('UPSTREAM_INVALID', 502);
  if (value.length > 4096) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
  return value;
}
export function array(value: unknown, max = 1000): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ServiceError('UPSTREAM_INVALID', 502);
  if (value.length > max) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
  return value;
}
function strings(value: unknown): string[] { return array(value).map(text); }
export function number(value: unknown): number {
  if (value == null) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ServiceError('UPSTREAM_INVALID', 502);
  return value;
}
function pairs(value: unknown): Record<string, string> {
  const input = optionalObject(value);
  if (Object.keys(input).length > 1000) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, text(value)]));
}

// Repository/destination URLs are metadata, not a channel for embedded auth.
export function metadataURL(value: unknown): string {
  const input = text(value);
  const negation = /^!+/.exec(input)?.[0];
  if (negation) return `${negation}${metadataURL(input.slice(negation.length))}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return input.replace(/^[^\s/@]+@/, '');
  try {
    const url = new URL(input);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { throw new ServiceError('UPSTREAM_INVALID', 502); }
}

export function sourceSummary(value: unknown, hint: unknown = ''): SourceSummary {
  const input = object(value);
  return {
    repoURL: metadataURL(input.repoURL), path: text(input.path), chart: text(input.chart),
    targetRevision: text(input.targetRevision), name: text(input.name), ref: text(input.ref),
    type: text(hint) || (input.helm || input.chart ? 'Helm' : input.kustomize ? 'Kustomize' : input.plugin ? 'Plugin' : input.directory || input.path ? 'Directory' : 'Unknown'),
  };
}

function sourceDetail(value: unknown, hint: unknown = ''): SourceDetail {
  const input = object(value);
  const helm = input.helm == null ? null : object(input.helm);
  const kustomize = input.kustomize == null ? null : object(input.kustomize);
  return {
    ...sourceSummary(input, hint),
    // Never transfer arbitrary Helm values or parameter values. Even an
    // innocent parameter name can hold a credential; names are sufficient
    // for the initial configuration view and the UI explains the omission.
    helm: helm ? {
      releaseName: text(helm.releaseName), valueFiles: strings(helm.valueFiles),
      parameterNames: array(helm.parameters).map((p) => text(object(p).name)),
      fileParameterNames: array(helm.fileParameters).map((p) => text(object(p).name)),
      hasInlineValues: Boolean(helm.values), hasValuesObject: helm.valuesObject != null,
    } : null,
    kustomize: kustomize ? {
      version: text(kustomize.version), namePrefix: text(kustomize.namePrefix), nameSuffix: text(kustomize.nameSuffix),
      namespace: text(kustomize.namespace), images: strings(kustomize.images).map(metadataURL), components: strings(kustomize.components),
      commonLabelKeys: Object.keys(optionalObject(kustomize.commonLabels)),
      commonAnnotationKeys: Object.keys(optionalObject(kustomize.commonAnnotations)), patchCount: array(kustomize.patches).length,
    } : null,
  };
}

function sourceInputs(input: Record<string, unknown>): unknown[] {
  const sources = array(input.sources);
  return sources.length ? sources : input.source == null ? [] : [input.source];
}
function revisions(input: Record<string, unknown>): string[] {
  const multiple = strings(input.revisions);
  return multiple.length ? multiple : input.revision ? [text(input.revision)] : [];
}

export function applicationSummary(value: unknown): ApplicationSummary {
  const input = object(value);
  const metadata = object(input.metadata);
  const spec = object(input.spec);
  const status = optionalObject(input.status);
  const sync = optionalObject(status.sync);
  const health = optionalObject(status.health);
  const destination = optionalObject(spec.destination);
  const name = text(metadata.name);
  const appNamespace = text(metadata.namespace);
  if (!name || !appNamespace) throw new ServiceError('UPSTREAM_INVALID', 502);
  const syncStatus = text(sync.status);
  const healthStatus = text(health.status);
  const hints = strings(status.sourceTypes);
  const history = array(status.history);
  const lastDeployment = optionalObject(history.at(-1));
  return {
    id: `${appNamespace}/${name}`, name, appNamespace, project: text(spec.project),
    destination: { server: metadataURL(destination.server), name: text(destination.name), namespace: text(destination.namespace) },
    labels: pairs(metadata.labels),
    sync: syncStatus || 'Unknown', health: healthStatus || 'Unknown',
    syncKnown: ['Synced', 'OutOfSync', 'Unknown'].includes(syncStatus),
    healthKnown: ['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown'].includes(healthStatus),
    comparedRevisions: revisions(sync), lastDeploymentRevisions: revisions(lastDeployment), lastDeploymentAt: text(lastDeployment.deployedAt),
    sources: sourceInputs(spec).map((source, i) => sourceSummary(source, hints[i] ?? status.sourceType)),
    multipleSources: Array.isArray(spec.sources) && spec.sources.length > 0,
    conditionsCount: array(status.conditions).length,
    operationPhase: text(optionalObject(status.operationState).phase), reconciledAt: text(status.reconciledAt),
  };
}

function resource(value: unknown): OperationResource {
  const input = object(value);
  return {
    group: text(input.group), kind: text(input.kind), namespace: text(input.namespace), name: text(input.name),
    status: text(input.status), syncPhase: text(input.syncPhase), hookPhase: text(input.hookPhase), message: text(input.message),
  };
}

export function applicationDetail(value: unknown): ApplicationDetail {
  const input = object(value);
  const summary = applicationSummary(input);
  const spec = object(input.spec);
  const status = optionalObject(input.status);
  const state = status.operationState == null ? null : object(status.operationState);
  const result = optionalObject(state?.syncResult);
  const hints = strings(status.sourceTypes);
  return {
    ...summary,
    sources: sourceInputs(spec).map((source, i) => sourceDetail(source, hints[i] ?? status.sourceType)),
    conditions: array(status.conditions).map((condition) => {
      const item = object(condition);
      return { type: text(item.type), message: text(item.message), lastTransitionTime: text(item.lastTransitionTime) };
    }),
    operation: state ? {
      phase: text(state.phase) || 'Unknown', message: text(state.message), startedAt: text(state.startedAt),
      finishedAt: text(state.finishedAt), retryCount: number(state.retryCount), revisions: revisions(result),
      resources: array(result.resources).map(resource),
    } : null,
    history: array(status.history).map((history) => {
      const item = object(history);
      const initiatedBy = optionalObject(item.initiatedBy);
      return {
        id: String(number(item.id)), revisions: revisions(item), deployedAt: text(item.deployedAt), deployStartedAt: text(item.deployStartedAt),
        initiatedBy: { username: text(initiatedBy.username), automated: initiatedBy.automated === true },
        sources: sourceInputs(item).map((source) => sourceDetail(source)),
      };
    }),
  };
}

export function applicationSummaries(value: unknown): ApplicationSummary[] {
  const input = object(value);
  // Kubernetes omits empty items as null in some versions. Other shapes are
  // errors, never silently converted into an apparently healthy empty list.
  if (!Object.hasOwn(input, 'items')) throw new ServiceError('UPSTREAM_INVALID', 502);
  const items = array(input.items).map(applicationSummary);
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new ServiceError('UPSTREAM_INVALID', 502);
  return items;
}

export function applicationCounts(items: ApplicationSummary[]): ApplicationCounts {
  return {
    total: items.length,
    outOfSync: items.filter((item) => item.sync === 'OutOfSync').length,
    unhealthy: items.filter((item) => ['Degraded', 'Missing'].includes(item.health)).length,
    unknown: items.filter((item) => !item.healthKnown || !item.syncKnown || item.health === 'Unknown' || item.sync === 'Unknown').length,
    withConditions: items.filter((item) => item.conditionsCount > 0).length,
  };
}
