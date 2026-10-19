import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assembleRelease, verifyRelease, verifyReleaseDirectory, writeReleaseDirectory } from './release.js';
import { zipFiles } from './archive.js';

const first = await assembleRelease(); const second = await assembleRelease(); assert.ok(first.zip.equals(second.zip), 'Identical inputs must produce identical ZIP bytes.');
const files = verifyRelease(first.zip);
const manifest = JSON.parse(files.get('package.json')!.toString());
assert.equal(manifest.openchamber.contributes.panel.icon, 'panel/argocd.svg');
assert.ok(files.has(manifest.openchamber.contributes.panel.icon), 'The rail icon must be present in the extracted package.');
assert.match(files.get('THIRD_PARTY_NOTICES.txt')!.toString(), /Argo mark: Simple Icons, CC0-1.0/);
for (const path of ['panel/main.js', 'service/main.js']) assert.doesNotMatch(files.get(path)!.toString(), /translate\.googleapis\.com/, 'No runtime translation transport may be bundled.');
const altered = new Map(files); altered.set('panel/main.js', Buffer.from('tampered')); assert.throws(() => verifyRelease(zipFiles(altered), files), /prepared build/);
const extra = new Map(files); extra.set('unlisted.txt', Buffer.from('extra')); assert.throws(() => verifyRelease(zipFiles(extra)), /inventory/);
assert.equal(files.has('release.json'), false); assert.equal([...files.keys()].some((name) => /\.(?:sha256|md5)$/.test(name)), false);
const root = join(tmpdir(), 'opencode'); await mkdir(root, { recursive: true }); const directory = await mkdtemp(join(root, 'argocd-release-'));
let child: ReturnType<typeof spawn> | undefined;
try {
  await writeReleaseDirectory(directory, files);
  await verifyReleaseDirectory(directory, files);
  child = spawn(process.execPath, ['--import', 'tsx', 'scripts/smoke.ts', join(directory, 'service/main.js')], { stdio: 'inherit' });
  const exited = once(child, 'exit'); const error = once(child, 'error').then(([reason]) => { throw reason; });
  const result = await Promise.race([exited, error, delay(30000, undefined, { ref: false }).then(() => { throw new Error('Packaged Service smoke timed out.'); })]); assert.equal(result[0], 0);
  console.log(`Release archive checked: ${files.size} allowlisted files, deterministic ZIP, no hash inventory/checksum files, credential sentinel scan, extracted Service smoke. Not a real host install.`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await rm(directory, { recursive: true, force: true });
}
