import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, type TestContext } from 'node:test';
import { parse } from 'yaml';
import { assembleRelease, verifyRelease } from '../scripts/release.js';
import { publishPackage } from '../scripts/package-output.js';
import { zipFiles } from '../scripts/archive.js';

async function fixture(t: TestContext) {
  const base = join(tmpdir(), 'opencode'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'argocd-fixed-output-')); t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, dist: join(directory, 'dist'), release: await assembleRelease() };
}

test('packaging writes only a fixed directory/ZIP and overwrites old contents including stale files', async (t) => {
  const { dist, release } = await fixture(t);
  const first = await publishPackage(dist, release.basename, release.files, release.zip);
  assert.equal(release.basename, 'openchamber-argocd'); assert.deepEqual((await readdir(dist)).sort(), [release.basename, `${release.basename}.zip`]);
  assert.equal(release.files.size, 18); assert.equal(release.files.has('release.json'), false);
  assert.equal([...release.files.keys()].some((name) => /\.(?:sha256|md5)$/.test(name)), false);
  await writeFile(join(first.folder, 'obsolete.js'), 'old bundled file');
  await writeFile(join(first.folder, 'release.json'), '{"old":"hash inventory"}');
  const updated = new Map(release.files); const pkg = JSON.parse(updated.get('package.json')!.toString()); pkg.version = '1.0.1'; updated.set('package.json', Buffer.from(JSON.stringify(pkg))); updated.set('README.md', Buffer.from('Updated documentation.'));
  const second = await publishPackage(dist, release.basename, updated, zipFiles(updated));
  assert.equal(second.folder, first.folder); assert.equal(second.archive, first.archive);
  await assert.rejects(readFile(join(first.folder, 'obsolete.js')), { code: 'ENOENT' }); await assert.rejects(readFile(join(first.folder, 'release.json')), { code: 'ENOENT' });
  assert.equal((await readFile(join(first.folder, 'README.md'), 'utf8')), 'Updated documentation.');
  assert.equal(JSON.parse(verifyRelease(await readFile(first.archive)).get('package.json')!.toString()).version, '1.0.1');
  assert.deepEqual((await readdir(dist)).sort(), [release.basename, `${release.basename}.zip`]);
});

test('staging failure leaves both old outputs untouched and preserves unrelated dist files', async (t) => {
  const { dist, release } = await fixture(t); const previous = await publishPackage(dist, release.basename, release.files, release.zip);
  await writeFile(join(dist, 'user-notes.txt'), 'keep');
  await assert.rejects(publishPackage(dist, release.basename, release.files, Buffer.from('invalid ZIP')));
  assert.ok((await readFile(previous.archive)).equals(release.zip)); assert.ok((await readFile(join(previous.folder, 'panel/main.js'))).equals(release.files.get('panel/main.js')!));
  assert.equal(await readFile(join(dist, 'user-notes.txt'), 'utf8'), 'keep');
  assert.equal((await readdir(dist)).some((name) => name.startsWith('.package-')), false);
});

test('a failed second promotion rolls back the directory and ZIP as a pair', async (t) => {
  const { dist, release } = await fixture(t); const previous = await publishPackage(dist, release.basename, release.files, release.zip);
  const updated = new Map(release.files); updated.set('README.md', Buffer.from('This candidate must not replace the previous pair.'));
  const failZip: typeof rename = async (from, to) => { if (String(from).endsWith('candidate.zip')) throw new Error('Synthetic rename failure'); await rename(from, to); };
  await assert.rejects(publishPackage(dist, release.basename, updated, zipFiles(updated), failZip), /Synthetic rename failure/);
  assert.ok((await readFile(previous.archive)).equals(release.zip)); assert.ok((await readFile(join(previous.folder, 'README.md'))).equals(release.files.get('README.md')!));
  assert.equal((await readdir(dist)).some((name) => name.startsWith('.package-')), false);
});

test('packaging refuses symlinked outputs and never follows them into another directory', async (t) => {
  const { directory, dist, release } = await fixture(t); await mkdir(dist);
  const outside = join(directory, 'user-data'); await mkdir(outside); await writeFile(join(outside, 'keep.txt'), 'keep');
  await symlink(outside, join(dist, release.basename));
  await assert.rejects(publishPackage(dist, release.basename, release.files, release.zip), /symlinked/);
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep');
  const linkedDist = join(directory, 'linked-dist'); await symlink(outside, linkedDist);
  await assert.rejects(publishPackage(linkedDist, release.basename, release.files, release.zip), /real directory/);
});

test('packaging does not replace an unrelated directory even when its name matches the fixed output', async (t) => {
  const { dist, release } = await fixture(t); const target = join(dist, release.basename); await mkdir(target, { recursive: true });
  await writeFile(join(target, 'package.json'), JSON.stringify({ name: 'another-extension' })); await writeFile(join(target, 'user-work.txt'), 'keep');
  await assert.rejects(publishPackage(dist, release.basename, release.files, release.zip), /not this extension/);
  assert.equal(await readFile(join(target, 'user-work.txt'), 'utf8'), 'keep'); assert.equal((await readdir(dist)).some((name) => name.startsWith('.package-')), false);
});

test('a package lock prevents concurrent replacements of the same fixed outputs', async (t) => {
  const { dist, release } = await fixture(t); let entered!: () => void; let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; }); const gate = new Promise<void>((resolve) => { resume = resolve; });
  const pause: typeof rename = async (from, to) => { if (String(from).endsWith('candidate')) { entered(); await gate; } await rename(from, to); };
  const first = publishPackage(dist, release.basename, release.files, release.zip, pause); await waiting;
  try { await assert.rejects(publishPackage(dist, release.basename, release.files, release.zip), /Another package operation/); }
  finally { resume(); await first; }
  assert.deepEqual((await readdir(dist)).sort(), [release.basename, `${release.basename}.zip`]);
});

test('Git publishing validates committed assets before rebuilding and only prepares draft tag releases', async () => {
  const workflow = parse(await readFile('.github/workflows/extension.yml', 'utf8'));
  assert.equal(workflow.permissions.contents, 'read'); assert.deepEqual(workflow.on.push.tags, ['v*']);
  const steps = workflow.jobs.build.steps as Array<{ run?: string }>;
  assert.ok(steps.findIndex((step) => step.run === 'pnpm verify:release') < steps.findIndex((step) => step.run === 'pnpm package'));
  assert.ok(steps.some((step) => step.run?.includes('git ls-files --error-unmatch panel/main.js service/main.js THIRD_PARTY_NOTICES.txt')));
  const publish = workflow.jobs['draft-release']; assert.match(publish.if, /github.event_name == 'push'/); assert.equal(publish.permissions.contents, 'write');
  assert.ok(publish.steps.some((step: { run?: string }) => step.run?.includes('--verify-tag --draft')));
  assert.ok(workflow.jobs.build.steps.some((step: { with?: { path?: string } }) => step.with?.path === 'dist/openchamber-argocd.zip'));
  assert.ok(publish.steps.some((step: { run?: string }) => step.run?.includes('dist/openchamber-argocd.zip')));
  const pkg = JSON.parse(await readFile('package.json', 'utf8')); assert.equal(pkg.private, false); assert.equal(pkg.scripts['verify:release'], 'tsx scripts/verify-prebuilt.ts');
});

test('release preserves public package identity, version, description and stable extension panel ID', async () => {
  const { files, basename } = await assembleRelease(); const root = JSON.parse(await readFile('package.json', 'utf8'));
  const packaged = JSON.parse(files.get('package.json')!.toString());
  assert.equal(basename, 'openchamber-argocd'); assert.equal(root.name, basename); assert.equal(root.version, '1.2.0'); assert.equal(root.private, false);
  for (const key of ['name', 'version', 'private', 'description', 'license']) assert.deepEqual(packaged[key], root[key]);
  assert.match(root.description, /context switching.*application filtering.*logs.*events.*diffs/);
  assert.equal(packaged.openchamber.contributes.panel.id, 'argocd-observer');
});
