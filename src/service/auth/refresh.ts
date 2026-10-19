import { execFile } from 'node:child_process';
import type { Connection } from './config.js';
import { ServiceError } from '../security/errors.js';

const allowedEnv = new Set(['PATH', 'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'WINDIR']);
export function cliEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => allowedEnv.has(key.toUpperCase()) && value !== undefined));
}

export function refreshArguments(connection: Connection): string[] {
  return ['account', 'get-user-info', '--output=json', '--prompts-enabled=false',
    `--config=${connection.configPath}`, `--argocd-context=${connection.context}`];
}

export type RefreshRunner = (connection: Connection, signal: AbortSignal) => Promise<void>;

export function cliRefreshRunner(binary = 'argocd'): RefreshRunner {
  return (connection, signal) => new Promise((resolve, reject) => {
    execFile(binary, refreshArguments(connection), {
      env: cliEnvironment(process.env), signal, timeout: 3000,
      killSignal: 'SIGKILL', maxBuffer: 64_000, windowsHide: true,
    }, (error) => {
      // CLI stdout/stderr may contain claims, server details or credentials.
      // Do not log or return either stream, including error.message.
      if (error) reject(new ServiceError('AUTH_REQUIRED', 401));
      else resolve();
    });
  });
}

export class RefreshCoordinator {
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly attemptedAt = new Map<string, number>();
  constructor(private readonly runner: RefreshRunner, private readonly cooldownMs = 30_000) {}

  async refresh(connection: Connection, signal: AbortSignal): Promise<void> {
    const key = JSON.stringify([connection.configPath, connection.user, connection.baseUrl]);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    if (!connection.refreshToken || Date.now() - (this.attemptedAt.get(key) ?? 0) < this.cooldownMs) throw new ServiceError('AUTH_REQUIRED', 401);
    if (this.inflight.size >= 8) throw new ServiceError('BUSY', 429);
    if (this.attemptedAt.size >= 128) this.attemptedAt.delete(this.attemptedAt.keys().next().value!);
    this.attemptedAt.set(key, Date.now());
    const operation = Promise.resolve().then(() => this.runner(connection, signal)).catch(() => {
      throw new ServiceError('AUTH_REQUIRED', 401);
    });
    this.inflight.set(key, operation);
    try { await operation; }
    finally { this.inflight.delete(key); }
  }
}
