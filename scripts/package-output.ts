import { lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyRelease, verifyReleaseDirectory, writeReleaseDirectory } from './release.js';

async function present(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return false; }
}

/** Stages the complete pair before replacement. A failed promotion rolls back
 * both targets; unrelated/historical dist entries are never deleted. */
export async function publishPackage(dist: string, name: string, files: ReadonlyMap<string, Buffer>, zip: Buffer, move: typeof rename = rename) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid package output name.');
  await mkdir(dist, { recursive: true });
  const root = await lstat(dist); if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Release output must be a real directory.');
  const lock = join(dist, '.package-lock');
  try { await mkdir(lock); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another package operation is running, or a previous lock needs inspection.'); throw error; }
  let stage: string | undefined; let preserveStage = false;
  try {
    const folder = join(dist, name); const archive = `${folder}.zip`;
    for (const [path, directory] of [[folder, true], [archive, false]] as const) if (await present(path)) {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('Refusing an unexpected or symlinked release target.');
      if (directory && JSON.parse(await readFile(join(path, 'package.json'), 'utf8')).name !== name) throw new Error('Existing output is not this extension.');
    }
    stage = await mkdtemp(join(dist, '.package-stage-'));
    const candidateFolder = join(stage, 'candidate'); const candidateZip = join(stage, 'candidate.zip');
    await writeReleaseDirectory(candidateFolder, files); await writeFile(candidateZip, zip, { flag: 'wx' });
    await verifyReleaseDirectory(candidateFolder, files); verifyRelease(await readFile(candidateZip), files);
    const targets = [{ candidate: candidateFolder, target: folder, backup: join(stage, 'previous'), hadOld: false, installed: false }, { candidate: candidateZip, target: archive, backup: join(stage, 'previous.zip'), hadOld: false, installed: false }];
    try {
      for (const item of targets) {
        if (await present(item.target)) { await move(item.target, item.backup); item.hadOld = true; }
        await move(item.candidate, item.target); item.installed = true;
      }
    } catch (error) {
      const failures: unknown[] = [];
      for (const item of [...targets].reverse()) {
        try { if (item.installed) await rm(item.target, { recursive: true, force: true }); if (item.hadOld) await rename(item.backup, item.target); }
        catch (rollback) { failures.push(rollback); }
      }
      if (failures.length) { preserveStage = true; throw new AggregateError([error, ...failures], `Replacement and rollback failed; previous outputs are retained in ${stage}.`); }
      throw error;
    }
    return { folder, archive };
  } finally {
    try { if (stage && !preserveStage) await rm(stage, { recursive: true, force: true }); }
    finally { await rmdir(lock); }
  }
}
