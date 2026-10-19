import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { compileBundles } from './compile.js';

const { files, metadata } = await compileBundles();
for (const [path, bytes] of files) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
await mkdir('.build', { recursive: true });
await writeFile('.build/metafiles.json', JSON.stringify(metadata, null, 2));
console.log('Built Git-install-ready browser IIFE, host Node ESM and root runtime notices; no external npm dependencies.');
