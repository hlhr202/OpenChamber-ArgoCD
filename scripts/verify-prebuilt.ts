import { lstat, readFile } from 'node:fs/promises';
import { compileBundles } from './compile.js';
import { assembleRelease } from './release.js';

// Compare in memory only. No checksum files or per-file hash inventory is emitted.
const { files } = await compileBundles();
for (const [path, bytes] of files) {
  let current: Buffer;
  try {
    const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular prebuilt file');
    current = await readFile(path);
  } catch { throw new Error(`Missing prebuilt Git asset: ${path}. Run pnpm build and commit generated files.`); }
  if (!current.equals(bytes)) throw new Error(`Stale prebuilt Git asset: ${path}. Run pnpm build and commit generated files.`);
}
await assembleRelease();
console.log('Git installation assets match source: root manifest, bundled JS, HTML/CSS/SVG and runtime notices. No hashes emitted.');
