export type ErrorCode =
  | 'UNAUTHORIZED' | 'BAD_REQUEST' | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED'
  | 'BUSY' | 'TIMEOUT' | 'RESPONSE_TOO_LARGE' | 'INTERNAL'
  | 'CONFIG_MISSING' | 'CONFIG_INVALID' | 'CONTEXT_NOT_FOUND' | 'UNSUPPORTED'
  | 'NETWORK_DISABLED' | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'UPSTREAM_UNAVAILABLE' | 'UPSTREAM_INVALID'
  | 'CANCELLED' | 'EXPIRED' | 'RESOURCE_CHANGED' | 'CAPABILITY_UNAVAILABLE';

export type Envelope<T> = (
  | { ok: true; data: T; sampledAt: string; stale: boolean; truncated: false; expiresAt?: string; source?: 'service' | 'argo-api' | 'cache' }
  | { ok: false; error: { code: ErrorCode; message: string }; sampledAt: string }
) & { serviceInstance?: string; identityEpoch?: string };

export interface Diagnostics {
  service: 'ready';
  readOnly: true;
  runtime: string;
  platform: string;
  argoConnection: 'not-attempted';
}

export interface ContextSummary {
  name: string;
  server: string;
  user: string;
  current: boolean;
  core: boolean;
}

export interface ContextList {
  contexts: ContextSummary[];
  networkEnabled: boolean;
}

export interface Identity {
  loggedIn: boolean;
  username: string;
  issuer: string;
  groups: string[];
}

export interface QuerySnapshot<T> {
  data: T;
  sampledAt: string;
  expiresAt: string;
  stale: boolean;
  source: 'argo-api' | 'cache';
}

export const LIMITS = {
  requestTargetBytes: 2048,
  responseBytes: 2_000_000,
  taskResultBytes: 2_000_000,
  cacheEntryBytes: 2_000_000,
  concurrentRequests: 8,
  operationTimeoutMs: 5_000,
} as const;
