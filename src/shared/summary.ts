export const SUMMARY_KINDS = ['application', 'conditions', 'resources', 'events', 'diff', 'logs'] as const;
export type SummaryKind = typeof SUMMARY_KINDS[number];
export interface SummaryRecord {
  kind: SummaryKind; sampledAt: string; expiresAt: string; source: string; stale: boolean;
  lines: string[];
}
export interface SummaryEvidence { application: { name: string; appNamespace: string }; records: SummaryRecord[] }
export interface SummaryPreview { parts: string[]; createdAt: string; characters: number; staleRecords: number }
export interface LogSelection {
  context: string; application: { name: string; appNamespace: string };
  sampledAt: string; lines: string[]; note: string;
}
