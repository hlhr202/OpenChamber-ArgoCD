import type { SourceSummary } from './applications.js';
import type { EventList } from './resources.js';

export type ManagementCommand =
  | { operation: 'projects' | 'repositories' | 'clusters'; context: string }
  | { operation: 'project' | 'projectWindows'; context: string; project: string }
  | { operation: 'applicationSets'; context: string; appsetNamespace?: string }
  | { operation: 'applicationSet' | 'applicationSetChildren' | 'applicationSetEvents'; context: string; name: string; appsetNamespace: string }
  | { operation: 'applicationWindows'; context: string; name: string; appNamespace: string };
export interface SyncWindow {
  kind: string; schedule: string; duration: string; timeZone: string;
  applications: string[]; namespaces: string[]; clusters: string[];
  manualSync: boolean | null; andOperator: boolean | null;
}
export interface WindowState {
  scope: 'project' | 'application'; active: SyncWindow[]; assigned: SyncWindow[] | null;
  canSync: boolean | null; note: string;
}
export interface Project {
  id: string; name: string; namespace: string; description: string; sourceRepos: string[]; sourceNamespaces: string[];
  destinations: Array<{ name: string; server: string; namespace: string }>;
  rules: Record<'clusterAllow' | 'clusterDeny' | 'namespaceAllow' | 'namespaceDeny', Array<{ group: string; kind: string }>>;
  roles: Array<{ name: string; description: string; groups: string[]; policies: string[] }>;
  syncWindows: SyncWindow[];
}
export interface ConnectionStatus { status: string; attemptedAt: string; messagePresent: boolean; summary: string }
export interface Repository { id: string; repo: string; name: string; type: string; project: string; oci: boolean | null; connection: ConnectionStatus }
export interface Cluster {
  id: string; name: string; server: string; project: string; namespaces: string[]; clusterResources: boolean | null;
  version: string; applicationsCount: number | null; resourcesCount: number | null; apisCount: number | null; lastCacheSyncTime: string;
  connection: ConnectionStatus;
}
export interface GeneratorSummary { type: string; children: GeneratorSummary[]; hasTemplate: boolean; elementsCount: number | null; hasElementsYaml: boolean }
export interface ApplicationSet {
  id: string; name: string; namespace: string; uid: string;
  generators: GeneratorSummary[]; goTemplate: boolean | null; hasTemplatePatch: boolean;
  template: { name: string; project: string; destination: { name: string; server: string; namespace: string }; sources: SourceSummary[] };
  conditions: Array<{ type: string; status: string; reason: string; messagePresent: boolean; summary: string; lastTransitionTime: string }>;
  applicationStatus: Array<{ name: string; status: string; step: string; lastTransitionTime: string }>;
}
export interface ApplicationSetChildren { items: Array<{ name: string; appNamespace: string; uid: string }>; unresolved: number; note: string }
export type ManagementData = { items: Project[] } | Project | { items: Repository[] } | { items: Cluster[] }
  | { items: ApplicationSet[]; namespaceScope: string } | ApplicationSet | ApplicationSetChildren | WindowState | EventList;
