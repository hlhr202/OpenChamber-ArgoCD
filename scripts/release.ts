import { lstat, readFile, realpath, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseManifestJson } from '@openchamber/sdk/schemas';
import { zipFiles, readReleaseZip } from './archive.js';

export const RELEASE_FILES = ['README.md', 'docs/README.de.md', 'docs/README.fr.md', 'docs/README.nl.md', 'docs/README.zh-CN.md', 'docs/README.zh-TW.md', 'docs/README.uk.md', 'docs/README.es.md', 'docs/README.pt-BR.md', 'docs/README.ko.md', 'docs/README.pl.md', 'docs/README.ja.md', 'docs/README.tr.md', 'docs/README.ar.md', 'docs/README.he.md', 'LICENSE', 'plan.md', 'roadmap.md', 'docs/applications-desktop.png', 'docs/applications-mobile.png', 'docs/validation.md', 'docs/diff-semantics.md', 'docs/operations.md', 'docs/compatibility.md', 'panel/index.html', 'panel/argocd.svg', 'panel/style.css', 'panel/main.js', 'service/main.js', 'THIRD_PARTY_NOTICES.txt'] as const;
const forbidden = [/-----BEGIN [^-]*PRIVATE KEY-----/, /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/, /synthetic-original|synthetic-rotated|synthetic-argo-token|synthetic-host|smoke-test-only|hidden-values|hidden-parameter|hidden-inline|private-key-sentinel|secret-data-sentinel/];
export function scanReleaseFile(name: string, bytes: Buffer): void {
  const text = bytes.toString('utf8');
  if (forbidden.some((pattern) => pattern.test(text)) || /(?:node_modules|\.config|\.env|tests|scripts|src|\.gpt-tmp|\.grok-tmp|\.build)(?:\/|$)/.test(name) || /\.(?:log|map|ts|pem|key|sha256|md5)$/.test(name)) throw new Error('Release contains a forbidden path or secret sentinel.');
}
async function releaseFile(path: string): Promise<Buffer> {
  const root = await realpath('.'); const absolute = resolve(path); const actual = await realpath(absolute);
  if (!actual.startsWith(root + '/') || (await lstat(absolute)).isSymbolicLink() || !(await lstat(absolute)).isFile()) throw new Error('Release asset must be a regular project file.');
  const bytes = await readFile(absolute); scanReleaseFile(path, bytes); return bytes;
}
interface InstallManifest { openchamber?: { contributes?: { panel?: { entry?: string; icon?: string }; service?: { entry?: string }; statusSection?: { entry?: string } } } }
function validateEntries(pkg: InstallManifest, files: ReadonlyMap<string, Buffer>): void {
  const contributes = pkg.openchamber?.contributes;
  for (const path of [contributes?.panel?.entry, contributes?.service?.entry, contributes?.statusSection?.entry, contributes?.panel?.icon]) {
    if (typeof path !== 'string' || !files.has(path)) throw new Error('Declared extension entry is not bundled.');
  }
  const html = files.get(contributes!.panel!.entry!)!.toString();
  if (!html.includes('src="main.js"') || !html.includes('href="style.css"') || !files.has('panel/main.js') || !files.has('panel/style.css')) throw new Error('Missing panel build assets.');
}
export async function assembleRelease() {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  if (!/^[a-z0-9-]+$/.test(pkg.name) || !/^\d+\.\d+\.\d+$/.test(pkg.version) || typeof pkg.private !== 'boolean') throw new Error('Invalid extension package identity.');
  if (!parseManifestJson(JSON.stringify(pkg)).ok || pkg.type !== 'module' || ['preinstall', 'install', 'postinstall', 'prepare'].some((key) => pkg.scripts?.[key])) throw new Error('Invalid Git manifest, ESM package type or unexpected install hook.');
  const manifest = { name: pkg.name, version: pkg.version, private: pkg.private, description: pkg.description, license: pkg.license, type: 'module', engines: pkg.engines, openchamber: pkg.openchamber };
  const files = new Map<string, Buffer>([['package.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]]);
  for (const path of RELEASE_FILES) files.set(path, await releaseFile(path));
  validateEntries(pkg, files);
  for (const [name, bytes] of files) scanReleaseFile(name, bytes);
  const zip = zipFiles(files); verifyRelease(zip, files);
  return { files, zip, basename: pkg.name };
}
export function verifyRelease(zip: Buffer, expectedFiles?: ReadonlyMap<string, Buffer>): Map<string, Buffer> {
  const files = readReleaseZip(zip); const expected = new Set<string>([...RELEASE_FILES, 'package.json']);
  if (files.size !== expected.size || [...files.keys()].some((name) => !expected.has(name))) throw new Error('Unexpected release inventory.');
  for (const [name, bytes] of files) {
    scanReleaseFile(name, bytes);
    if (expectedFiles && !expectedFiles.get(name)?.equals(bytes)) throw new Error('Release differs from prepared build.');
  }
  const manifest = files.get('package.json')!.toString(); if (!parseManifestJson(manifest).ok) throw new Error('Invalid packaged manifest.');
  const pkg = JSON.parse(manifest); if (pkg.dependencies || pkg.scripts || typeof pkg.private !== 'boolean') throw new Error('Release requires unexpected install steps or has an invalid private flag.');
  validateEntries(pkg, files); return files;
}
export async function writeReleaseDirectory(directory: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  for (const [name, bytes] of files) { await mkdir(dirname(join(directory, name)), { recursive: true }); await writeFile(join(directory, name), bytes, { flag: 'wx' }); }
}
export async function verifyReleaseDirectory(directory: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  const found = new Set<string>();
  async function walk(prefix: string): Promise<void> {
    for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Release directory contains a symlink.');
      if (entry.isDirectory()) { if (![...files.keys()].some((path) => path.startsWith(name + '/'))) throw new Error('Unexpected release directory.'); await walk(name); }
      else { const expected = files.get(name); if (!entry.isFile() || !expected || !(await readFile(join(directory, name))).equals(expected)) throw new Error('Release directory differs from prepared build.'); found.add(name); }
    }
  }
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Release directory must not be a symlink.');
  await walk(''); if (found.size !== files.size) throw new Error('Release directory is incomplete.');
}
