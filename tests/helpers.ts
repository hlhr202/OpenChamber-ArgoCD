import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { CredentialProvider } from '../src/service/auth/config.js';

export function syntheticConfig(server = 'https://argo.example.test') {
  return {
    'current-context': 'primary',
    contexts: [{ name: 'primary', server, user: 'operator' }, { name: 'secondary', server, user: 'viewer' }],
    servers: [{ server, 'plain-text': server.startsWith('http://'), 'grpc-web-root-path': '' }],
    users: [
      { name: 'operator', 'auth-token': 'synthetic-original', 'refresh-token': 'synthetic-refresh' },
      { name: 'viewer', 'auth-token': 'synthetic-viewer' },
    ],
  };
}

export async function configFixture(t: TestContext, config: unknown = syntheticConfig()) {
  await mkdir('.build', { recursive: true });
  const directory = await mkdtemp(resolve('.build/config-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, 'config');
  const write = async (value: unknown) => writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
  await write(config);
  return { directory, path, write, provider: new CredentialProvider({ configPath: path }) };
}
