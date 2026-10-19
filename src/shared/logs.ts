import type { ErrorCode } from './contracts.js';
import type { ResourceReference } from './resources.js';

export interface LogCommand {
  context: string; name: string; appNamespace: string; resource: ResourceReference;
  container: string; tailLines: number; follow: boolean; previous: boolean;
  sinceSeconds?: number; sinceTime?: string; untilTime?: string;
}
export interface LogLine { cursor: number; content: string; timestamp: string; pod: string; truncated: boolean }
export interface LogPage {
  id: string; state: 'starting' | 'streaming' | 'completed' | 'disconnected' | 'failed' | 'stopped';
  createdAt: string; expiresAt: string; lastReceivedAt: string;
  lines: LogLine[]; nextCursor: number; headCursor: number; oldestCursor: number; gap: boolean;
  droppedLines: number; truncatedLines: number;
  continuity: 'not-guaranteed';
  error?: { code: ErrorCode; message: string };
}

export function logTimestamp(value: string): bigint | null {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0 || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return BigInt(Math.floor(ms / 1000)) * 1_000_000_000n + BigInt((value.split('.')[1]?.replace('Z', '') ?? '').padEnd(9, '0'));
}
