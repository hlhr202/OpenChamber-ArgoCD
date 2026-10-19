/** Explicitly invoked, read-only live preflight. Not run by check/package.
 * Uses only the existing current CLI context; never CLI network calls,
 * refresh, login, config writes, settings writes or arbitrary URL inputs. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { CredentialProvider, cliConfigPath } from '../src/service/auth/config.js';
import { readBoundedFile } from '../src/service/auth/files.js';
import { cliEnvironment } from '../src/service/auth/refresh.js';
import { requestJson, type ReadOperation, type ReadParameters } from '../src/service/argocd/transport.js';
import { applicationSummaries, applicationCounts } from '../src/service/domains/applications.js';
import { publicError, ServiceError } from '../src/service/security/errors.js';

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== '--confirm-read-only')) throw new Error('Only --confirm-read-only is accepted.');
const network = args.includes('--confirm-read-only');
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), mode: network ? 'explicit-live-read-only' : 'local-preflight-no-network', writesRequested: 0, cliNetworkCalls: 0, refreshOrLoginAllowed: false };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let path: string | undefined; let before: { digest: string; mtimeMs: number; size: number } | undefined;
async function fingerprint(file: string) { const data = await readBoundedFile(file); const metadata = await stat(file); return { digest: digest(data), mtimeMs: metadata.mtimeMs, size: metadata.size }; }
try {
  const cli = await promisify(execFile)('argocd', ['version', '--client', '--short'], { env: cliEnvironment(process.env), timeout: 5000, maxBuffer: 16_000 });
  report.cliVersion = cli.stdout.match(/\bv\d+\.\d+\.\d+(?:[+.-][A-Za-z0-9.-]+)?/)?.[0] ?? 'unrecognized-version';
  path = await cliConfigPath(); before = await fingerprint(path);
  const provider = new CredentialProvider(); const contexts = await provider.list(); const selected = contexts.find((item) => item.current);
  report.contextCount = contexts.length; report.currentContextAvailable = Boolean(selected);
  if (!selected || selected.core) throw new ServiceError(selected ? 'UNSUPPORTED' : 'CONTEXT_NOT_FOUND', 400);
  const connection = await provider.resolve(selected.name);
  report.connection = { transport: new URL(connection.baseUrl).protocol === 'https:' ? 'https' : 'http', tlsVerification: new URL(connection.baseUrl).protocol !== 'https:' ? 'not-applicable' : connection.insecure ? 'disabled-in-existing-config' : 'enabled', customCA: Boolean(connection.ca), clientCertificate: Boolean(connection.cert), existingTokenPresent: Boolean(connection.token), restRootConfigured: new URL(connection.baseUrl).pathname !== '/' };
  if (network) {
    const permitted = new Set<ReadOperation>(['version', 'identity', 'applications']); const calls: string[] = []; report.fixedGetOperations = calls;
    const read = async (operation: ReadOperation, parameters: ReadParameters = {}) => {
      if (!permitted.has(operation)) throw new ServiceError('BAD_REQUEST', 400);
      if ((await provider.resolve(selected.name)).generation !== connection.generation) throw new ServiceError('AUTH_REQUIRED', 401);
      calls.push(operation); const result = await requestJson(connection, operation, AbortSignal.timeout(10000), parameters);
      if ((await provider.resolve(selected.name)).generation !== connection.generation) throw new ServiceError('AUTH_REQUIRED', 401);
      return result;
    };
    const version = await read('version') as { Version?: unknown };
    report.serverVersion = typeof version?.Version === 'string' && /^v?\d+\.\d+\.\d+(?:[+.-][A-Za-z0-9.-]+)?$/.test(version.Version) ? version.Version : 'unrecognized-version';
    const identity = await read('identity') as { loggedIn?: unknown; groups?: unknown };
    if (identity?.loggedIn !== true) throw new ServiceError('AUTH_REQUIRED', 401);
    report.identity = { loggedIn: true, reportedGroupCount: Array.isArray(identity.groups) ? identity.groups.length : 0 };
    const applications = applicationSummaries(await read('applications'));
    report.applications = applicationCounts(applications);
    report.liveResult = 'read-only-api-preflight-passed';
  }
} catch (error) {
  report.result = 'stopped-without-login-or-renewal'; report.errorCode = error instanceof ServiceError ? publicError(error).code : 'LOCAL_PREFLIGHT_UNAVAILABLE'; process.exitCode = 1;
} finally {
  if (path && before) {
    try { const after = await fingerprint(path); report.originalConfigUnchanged = JSON.stringify(before) === JSON.stringify(after); if (!report.originalConfigUnchanged) { report.result = 'external-config-change-observed'; process.exitCode = 1; } }
    catch { report.originalConfigUnchanged = 'unable-to-recheck'; process.exitCode = 1; }
  }
  report.completedAt = new Date().toISOString(); console.log(JSON.stringify(report, null, 2));
}
