import { homedir } from 'node:os';
import { join } from 'node:path';
import { CredentialProvider, expandPath, record } from '../auth/config.js';
import { readBoundedFile } from '../auth/files.js';
import { ArgoClient } from '../argocd/client.js';
import { ServiceError } from '../security/errors.js';

export async function hostClient(settingsPath?: string): Promise<ArgoClient> {
  const root = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const path = settingsPath ?? join(root, 'openchamber-argocd-observer/settings.json');
  let settings: Record<string, unknown> = {};
  try { settings = record(JSON.parse((await readBoundedFile(path, 8000)).toString('utf8'))); }
  catch (error) {
    if (!(error instanceof ServiceError && error.code === 'CONFIG_MISSING')) throw new ServiceError('CONFIG_INVALID', 400);
  }
  if (Object.keys(settings).some((key) => !['configPath', 'cliPath', 'restRootPath', 'networkEnabled'].includes(key))) throw new ServiceError('CONFIG_INVALID', 400);
  if (settings.networkEnabled !== undefined && typeof settings.networkEnabled !== 'boolean') throw new ServiceError('CONFIG_INVALID', 400);
  const options: { configPath?: string; restRootPath?: string } = {};
  if (settings.configPath !== undefined) {
    if (typeof settings.configPath !== 'string') throw new ServiceError('CONFIG_INVALID', 400);
    options.configPath = expandPath(settings.configPath);
  }
  if (settings.restRootPath !== undefined) {
    if (typeof settings.restRootPath !== 'string') throw new ServiceError('CONFIG_INVALID', 400);
    options.restRootPath = settings.restRootPath;
  }
  if (settings.cliPath !== undefined) {
    if (typeof settings.cliPath !== 'string') throw new ServiceError('CONFIG_INVALID', 400);
    expandPath(settings.cliPath); // Legacy setting accepted, never executed.
  }
  // Selecting a context is the user's read-only connection action. Legacy
  // networkEnabled is no longer a second setup gate. Never log in or renew:
  // even ordinary CLI renewal could write back the user's configuration.
  return new ArgoClient(new CredentialProvider(options), null, true);
}
