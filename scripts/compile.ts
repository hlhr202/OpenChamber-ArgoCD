import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { relative } from 'node:path';
import { runtimeNotices } from './notices.js';

/** Shared in-memory compilation: writing and release verification use identical inputs. */
export async function compileBundles() {
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  const results = await Promise.all([
    build({ entryPoints: ['src/panel/main.ts'], outfile: 'panel/main.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022', metafile: true, legalComments: 'none', write: false }),
    build({
      entryPoints: ['src/service/main.ts'], outfile: 'service/main.js', bundle: true, platform: 'node', format: 'esm', target: 'node22', metafile: true, legalComments: 'none', write: false,
      banner: { js: 'import { createRequire as __hostCreateRequire } from "node:module"; const require = __hostCreateRequire(import.meta.url);' },
    }),
  ]);
  const files = new Map<string, Buffer>();
  for (const [index, result] of results.entries()) {
    for (const output of Object.values(result.metafile.outputs)) for (const dependency of output.imports) {
      if (dependency.external && (index === 0 || !builtins.has(dependency.path))) throw new Error('Build contains an unsupported external dependency.');
    }
    for (const output of result.outputFiles) files.set(relative(process.cwd(), output.path).replaceAll('\\', '/'), Buffer.from(output.contents));
  }
  const metadata = results.map((result) => result.metafile);
  files.set('THIRD_PARTY_NOTICES.txt', Buffer.from(await runtimeNotices(metadata)));
  return { files, metadata };
}
