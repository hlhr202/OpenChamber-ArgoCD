import { createHmac, randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import type { ContextSummary } from '../../shared/contracts.js';
import { ServiceError } from '../security/errors.js';
import { readBoundedFile } from './files.js';
import { redactResult } from '../security/redact.js';

export interface Connection {
  context: string;
  user: string;
  configPath: string;
  generation: string;
  token: string;
  refreshToken: string;
  baseUrl: string;
  core: boolean;
  insecure: boolean;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
}

export interface PathOptions {
  configPath?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => Promise<boolean>;
}

export async function cliConfigPath(options: PathOptions = {}): Promise<string> {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  if (options.configPath) return expandPath(options.configPath, home);
  if (env.ARGOCD_CONFIG_DIR) return join(expandPath(env.ARGOCD_CONFIG_DIR, home), 'config');
  const legacy = join(home, '.argocd');
  const exists = options.exists ?? (async (path) => { try { await access(path); return true; } catch { return false; } });
  // Match CLI source: existing legacy directory takes precedence over XDG.
  if (await exists(legacy)) return join(legacy, 'config');
  return join(env.XDG_CONFIG_HOME ? expandPath(env.XDG_CONFIG_HOME, home) : join(home, '.config'), 'argocd/config');
}

export function expandPath(path: string, home = homedir()): string {
  if (path.startsWith('~/')) return join(home, path.slice(2));
  if (!isAbsolute(path) || path.includes('\0')) throw new ServiceError('CONFIG_INVALID', 400);
  return resolve(path);
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('CONFIG_INVALID', 400);
  return value as Record<string, unknown>;
}

function string(value: unknown, required = true, max = 16_384): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (required && !value) || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ServiceError('CONFIG_INVALID', 400);
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new ServiceError('CONFIG_INVALID', 400);
  return value;
}

function named(values: unknown, field: string): Map<string, Record<string, unknown>> {
  if (!Array.isArray(values) || values.length > 1000) throw new ServiceError('CONFIG_INVALID', 400);
  const result = new Map<string, Record<string, unknown>>();
  for (const entry of values) {
    const item = record(entry);
    const name = string(item[field], true, 512);
    if (result.has(name)) throw new ServiceError('CONFIG_INVALID', 400);
    result.set(name, item);
  }
  return result;
}

function base64(value: unknown): Buffer | undefined {
  const text = string(value, false, 1_000_000);
  if (!text) return undefined;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new ServiceError('CONFIG_INVALID', 400);
  return Buffer.from(text, 'base64');
}

export function restBaseUrl(server: Record<string, unknown>, override?: string): string {
  const address = string(server.server, true, 2000);
  const plaintext = boolean(server['plain-text']);
  let url: URL;
  try { url = new URL(address.includes('://') ? address : `${plaintext ? 'http' : 'https'}://${address}`); }
  catch { throw new ServiceError('CONFIG_INVALID', 400); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ServiceError('CONFIG_INVALID', 400);
  if (url.protocol !== (plaintext ? 'http:' : 'https:')) throw new ServiceError('CONFIG_INVALID', 400);
  const root = override ?? (string(server['grpc-web-root-path'], false, 1000) || url.pathname);
  if (!root.startsWith('/') || root.includes('//') || /[?#\\%\u0000-\u0020]/.test(root) || root.split('/').some((p) => p === '.' || p === '..')) {
    throw new ServiceError('CONFIG_INVALID', 400);
  }
  return url.origin + (root === '/' ? '' : root.replace(/\/$/, ''));
}

export class CredentialProvider {
  private readonly fingerprintKey = randomBytes(32);
  constructor(readonly options: PathOptions & { restRootPath?: string } = {}) {}

  private async snapshot() {
    const configPath = await cliConfigPath(this.options);
    const bytes = await readBoundedFile(configPath);
    try {
      const document = parseDocument(bytes.toString('utf8'), { schema: 'core', strict: true, uniqueKeys: true, prettyErrors: false });
      if (document.errors.length || document.warnings.length) throw new Error('Invalid YAML');
      const config = record(document.toJS({ maxAliasCount: 0 }));
      const contexts = named(config.contexts, 'name');
      const servers = named(config.servers, 'server');
      const users = named(config.users, 'name');
      const current = string(config['current-context'], false, 512);
      return { configPath, contexts, servers, users, current, generation: createHmac('sha256', this.fingerprintKey).update(bytes).digest('hex') };
    } catch { throw new ServiceError('CONFIG_INVALID', 400); }
  }

  async list(): Promise<ContextSummary[]> {
    const state = await this.snapshot();
    const summaries = [...state.contexts].map(([name, context]) => {
      const server = state.servers.get(string(context.server));
      const user = string(context.user, true, 512);
      if (!server || !state.users.has(user)) throw new ServiceError('CONFIG_INVALID', 400);
      return { name, server: restBaseUrl(server, this.options.restRootPath), user, current: state.current === name, core: boolean(server.core) };
    });
    const secrets = [...state.users.values()].flatMap((user) => [string(user['auth-token'], false), string(user['refresh-token'], false)]);
    const result = redactResult(summaries, secrets);
    if (result.truncated) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
    return result.value as ContextSummary[];
  }

  async resolve(contextName: string): Promise<Connection> {
    const state = await this.snapshot();
    const context = state.contexts.get(contextName);
    if (!context) throw new ServiceError('CONTEXT_NOT_FOUND', 404);
    const server = state.servers.get(string(context.server));
    const userName = string(context.user);
    const user = state.users.get(userName);
    if (!server || !user) throw new ServiceError('CONFIG_INVALID', 400);
    if (boolean(server.core)) throw new ServiceError('UNSUPPORTED', 400);
    const connection: Connection = {
      configPath: state.configPath, context: contextName, user: userName, generation: state.generation,
      token: string(user['auth-token'], false), refreshToken: string(user['refresh-token'], false),
      baseUrl: restBaseUrl(server, this.options.restRootPath), core: false, insecure: boolean(server.insecure),
    };
    const ca = base64(server['certificate-authority-data']);
    if (ca) connection.ca = ca;
    const certPath = string(server['client-certificate'], false);
    const keyPath = string(server['client-certificate-key'], false);
    if (Boolean(certPath) !== Boolean(keyPath)) throw new ServiceError('CONFIG_INVALID', 400);
    if (certPath && keyPath) {
      [connection.cert, connection.key] = await Promise.all([
        readBoundedFile(expandPath(certPath, this.options.home)), readBoundedFile(expandPath(keyPath, this.options.home)),
      ]);
    } else {
      const cert = base64(server['client-certificate-data']);
      const key = base64(server['client-certificate-key-data']);
      if (Boolean(cert) !== Boolean(key)) throw new ServiceError('CONFIG_INVALID', 400);
      if (cert && key) { connection.cert = cert; connection.key = key; }
    }
    // Referenced certificates can rotate without changing the YAML file.
    // Include their actual bytes so callers invalidate old identity snapshots.
    connection.generation = createHmac('sha256', this.fingerprintKey)
      .update(state.generation).update(connection.ca ?? '').update(connection.cert ?? '').update(connection.key ?? '').digest('hex');
    return connection;
  }
}
