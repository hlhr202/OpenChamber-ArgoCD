import type { ApplicationSet, ApplicationSetChildren, Cluster, ConnectionStatus, GeneratorSummary, Project, Repository, SyncWindow, WindowState } from '../../shared/management.js';
import type { ResourceReference, EventList } from '../../shared/resources.js';
import { ServiceError } from '../security/errors.js';
import { array, metadataURL, number, object, optionalObject, sourceSummary, text } from './applications.js';
import { resourceEvents, resourceReference } from './resources.js';

const strings = (value: unknown) => array(value).map(text);
const flag = (value: unknown): boolean | null => {
  if (value == null) return null;
  if (typeof value !== 'boolean') throw new ServiceError('UPSTREAM_INVALID', 502);
  return value;
};
const count = (value: unknown): number | null => value == null ? null : number(typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value);
const templateText = (value: unknown) => { const input = text(value); return input.includes('{{') ? '[TEMPLATE EXPRESSION]' : input; };
function items(value: unknown): unknown[] {
  const input = object(value);
  if (input.items == null && Object.keys(input).some((key) => !['metadata', 'kind', 'apiVersion'].includes(key))) throw new ServiceError('UPSTREAM_INVALID', 502);
  return array(input.items);
}
export function syncWindow(value: unknown): SyncWindow {
  const input = object(value);
  return { kind: text(input.kind) || 'Unknown', schedule: text(input.schedule), duration: text(input.duration), timeZone: text(input.timeZone), applications: strings(input.applications), namespaces: strings(input.namespaces), clusters: array(input.clusters).map(metadataURL), manualSync: flag(input.manualSync), andOperator: flag(input.andOperator) };
}
export function windowState(value: unknown, scope: 'project' | 'application'): WindowState {
  const input = object(value);
  if (scope === 'application' && typeof input.canSync !== 'boolean') throw new ServiceError('UPSTREAM_INVALID', 502);
  if (scope === 'project' && input.windows === undefined && Object.keys(input).length) throw new ServiceError('UPSTREAM_INVALID', 502);
  return { scope, active: array(scope === 'project' ? input.windows : input.activeWindows).map(syncWindow), assigned: scope === 'application' ? array(input.assignedWindows).map(syncWindow) : null, canSync: scope === 'application' ? input.canSync as boolean : null,
    note: '仅展示服务端此份响应的窗口判定，不使用浏览器时钟重算 cron。Project 活跃窗口不等于任意应用可同步；官方 v3.1.8 的 canSync 使用手动同步窗口判定，不能外推自动同步或 RBAC 权限，也不是本扩展提供同步操作的承诺。' };
}
export function project(value: unknown): Project {
  const input = object(value); const metadata = object(input.metadata); const spec = object(input.spec); const name = text(metadata.name);
  if (!name) throw new ServiceError('UPSTREAM_INVALID', 502);
  const rule = (value: unknown) => array(value).map((value) => { const item = object(value); return { group: text(item.group), kind: text(item.kind) }; });
  return { id: name, name, namespace: text(metadata.namespace), description: text(spec.description), sourceRepos: array(spec.sourceRepos).map(metadataURL), sourceNamespaces: strings(spec.sourceNamespaces),
    destinations: array(spec.destinations).map((value) => { const item = object(value); return { name: text(item.name), server: metadataURL(item.server), namespace: text(item.namespace) }; }),
    rules: { clusterAllow: rule(spec.clusterResourceWhitelist), clusterDeny: rule(spec.clusterResourceBlacklist), namespaceAllow: rule(spec.namespaceResourceWhitelist), namespaceDeny: rule(spec.namespaceResourceBlacklist) },
    roles: array(spec.roles).map((value) => { const item = object(value); return { name: text(item.name), description: text(item.description), groups: strings(item.groups), policies: strings(item.policies) }; }), syncWindows: array(spec.syncWindows).map(syncWindow) };
}
function unique<T extends { id: string }>(values: T[]): T[] {
  if (new Set(values.map((value) => value.id)).size !== values.length) throw new ServiceError('UPSTREAM_INVALID', 502);
  return values;
}
export function projects(value: unknown): { items: Project[] } { return { items: unique(items(value).map(project)) }; }
function connection(value: unknown): ConnectionStatus {
  const input = optionalObject(value); const status = text(input.status) || 'Unknown';
  const known = ['Successful', 'Failed', 'Unknown'].includes(status);
  const messagePresent = typeof input.message === 'string' && Boolean(input.message);
  return { status: known ? status : 'Unrecognized', attemptedAt: text(input.attemptedAt), messagePresent,
    summary: messagePresent ? '服务端存在连接说明；原文可能含认证信息，未传输。' : '服务端未提供可显示的连接说明；不据此判断成功。' };
}
export function repositories(value: unknown): { items: Repository[] } {
  return { items: items(value).map((value, index) => { const input = object(value); const repo = metadataURL(input.repo); if (!repo) throw new ServiceError('UPSTREAM_INVALID', 502);
    return { id: JSON.stringify([index, repo, text(input.project)]), repo, name: text(input.name), type: text(input.type) || 'git', project: text(input.project), oci: flag(input.enableOCI), connection: connection(input.connectionState) };
  }) };
}
export function clusters(value: unknown): { items: Cluster[] } {
  return { items: items(value).map((value, index) => { const input = object(value); const info = optionalObject(input.info); const cache = optionalObject(info.cacheInfo); const server = metadataURL(input.server); const name = text(input.name);
    if (!server && !name) throw new ServiceError('UPSTREAM_INVALID', 502);
    return { id: JSON.stringify([index, server, name, text(input.project)]), server, name, project: text(input.project), namespaces: strings(input.namespaces), clusterResources: flag(input.clusterResources), version: text(info.serverVersion ?? input.serverVersion), applicationsCount: count(info.applicationsCount), resourcesCount: count(cache.resourcesCount), apisCount: count(cache.apisCount), lastCacheSyncTime: text(cache.lastCacheSyncTime), connection: connection(info.connectionState ?? input.connectionState) };
  }) };
}
export function applicationSet(value: unknown): ApplicationSet {
  const input = object(value); const metadata = object(input.metadata); const spec = object(input.spec); const status = optionalObject(input.status);
  const name = text(metadata.name); const namespace = text(metadata.namespace);
  if (!name || !namespace) throw new ServiceError('UPSTREAM_INVALID', 502);
  let nodes = 0;
  const generators = (value: unknown, depth = 0): GeneratorSummary[] => {
    if (depth > 8) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
    return array(value, 100).flatMap((value) => {
      if (++nodes > 100) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
      const input = object(value); const known = ['list', 'clusters', 'git', 'scmProvider', 'clusterDecisionResource', 'pullRequest', 'matrix', 'merge', 'plugin'];
      const types = known.filter((key) => input[key] != null);
      return (types.length ? types : ['Unknown']).map((type) => {
        const body = optionalObject(input[type]);
        return { type, children: ['matrix', 'merge'].includes(type) ? generators(body.generators, depth + 1) : [], hasTemplate: input.template != null || body.template != null, elementsCount: type === 'list' ? array(body.elements).length : null, hasElementsYaml: typeof body.elementsYaml === 'string' && Boolean(body.elementsYaml) };
      });
    });
  };
  const template = optionalObject(spec.template); const templateMetadata = optionalObject(template.metadata); const templateSpec = optionalObject(template.spec); const destination = optionalObject(templateSpec.destination);
  const sources = Array.isArray(templateSpec.sources) && templateSpec.sources.length ? array(templateSpec.sources) : templateSpec.source ? [templateSpec.source] : [];
  return { id: JSON.stringify([namespace, name]), name, namespace, uid: text(metadata.uid), generators: generators(spec.generators), goTemplate: flag(spec.goTemplate), hasTemplatePatch: spec.templatePatch != null,
    template: { name: templateText(templateMetadata.name), project: templateText(templateSpec.project), destination: { name: templateText(destination.name), server: metadataURL(templateText(destination.server)), namespace: templateText(destination.namespace) }, sources: sources.map((value) => {
      const input = object(value); return sourceSummary({ ...Object.fromEntries(['repoURL', 'path', 'chart', 'targetRevision', 'name', 'ref'].map((key) => [key, templateText(input[key])])), ...Object.fromEntries(['helm', 'kustomize', 'plugin', 'directory'].filter((key) => input[key] != null).map((key) => [key, {}])) });
    }) },
    conditions: array(status.conditions).map((value) => { const item = object(value); return { type: text(item.type), status: text(item.status) || 'Unknown', reason: text(item.reason), lastTransitionTime: text(item.lastTransitionTime), messagePresent: typeof item.message === 'string' && Boolean(item.message), summary: item.message ? '服务端协调说明可能包含生成参数或凭据；正文未传输。' : '未提供说明正文。' }; }),
    applicationStatus: array(status.applicationStatus).map((value) => { const item = object(value); return { name: text(item.application), status: text(item.status) || 'Unknown', step: text(item.step), lastTransitionTime: text(item.lastTransitionTime) }; }),
  };
}
export function applicationSets(value: unknown, namespaceScope: string): { items: ApplicationSet[]; namespaceScope: string } {
  const result = unique(items(value).map(applicationSet));
  if (namespaceScope && result.some((item) => item.namespace !== namespaceScope)) throw new ServiceError('UPSTREAM_INVALID', 502);
  return { items: result, namespaceScope: namespaceScope || 'server-default' };
}
export function applicationSetChildren(value: unknown): ApplicationSetChildren {
  const input = object(value);
  if (input.nodes == null && Object.keys(input).length) throw new ServiceError('UPSTREAM_INVALID', 502);
  let unresolved = 0;
  const result = array(input.nodes).flatMap((value) => {
    const node = resourceReference(value);
    if (node.group !== 'argoproj.io' || node.kind !== 'Application') return [];
    if (!node.name || !node.namespace) { unresolved++; return []; }
    return [{ name: node.name, appNamespace: node.namespace, uid: node.uid }];
  });
  return { items: result, unresolved, note: '关联来自服务端 ApplicationSet resource-tree；不从模板名称或缺省 Namespace 推断派生应用，不保证是完整审计记录。' };
}
export function applicationSetEvents(value: unknown, expected: ResourceReference): EventList {
  const events = resourceEvents(value, expected);
  return { ...events, scope: 'application-set', items: events.items.map((item) => ({ ...item, message: item.message ? '事件正文可能含生成参数或凭据；已在后端隐藏。' : '' })) };
}
