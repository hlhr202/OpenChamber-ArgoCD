import type { ResourceReference } from './resources.js';

export interface ManifestSelection {
  revision?: string;
  sources?: Array<{ position: number; revision: string }>;
}
export interface ManifestDocument {
  id: string; reference: ResourceReference; manifest: Record<string, unknown>;
  namespaceExplicit: boolean;
}
export interface ManifestList {
  items: ManifestDocument[];
  selection: ManifestSelection;
  resolvedRevision: string;
  warnings: string[];
  note: string;
}
export type ComparisonStatus = 'equal' | 'different' | 'unavailable';
export interface ResourceComparison {
  id: string; reference: ResourceReference; hook: boolean;
  status: ComparisonStatus; reason: string; reportedModified: boolean | null;
  live: Record<string, unknown> | null; target: Record<string, unknown> | null;
  normalizedLive: Record<string, unknown> | null; predictedLive: Record<string, unknown> | null;
  changedPaths: string[];
}
export interface ComparisonList {
  items: ResourceComparison[];
  applicationObservation: { sampledAt: string; reconciledAt: string; comparedRevisions: string[]; blocked: boolean };
  note: string;
}
