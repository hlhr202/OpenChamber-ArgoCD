import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function runtimeNotices(metadata: Array<{ inputs: Record<string, unknown> }>): Promise<string> {
  const roots = new Map<string, string>();
  for (const meta of metadata) for (const path of Object.keys(meta.inputs)) {
    const index = path.lastIndexOf('node_modules/'); if (index === -1) continue;
    const pieces = path.slice(index + 13).split('/'); const name = pieces[0]!.startsWith('@') ? pieces.slice(0, 2).join('/') : pieces[0]!;
    roots.set(name, path.slice(0, index + 13) + name);
  }
  if (!roots.has('@openchamber/sdk') || !roots.has('yaml')) throw new Error('Missing build dependency provenance.');
  const parts = ['Third-party notices for bundled runtime dependencies (not an application license grant).'];
  for (const [name, root] of [...roots].sort(([a], [b]) => a.localeCompare(b))) {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string; license: string };
    let license = '';
    for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
      try { license = await readFile(join(root, filename), 'utf8'); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (!license) throw new Error('Missing bundled dependency license.');
    parts.push(`${name}@${pkg.version} (${pkg.license})\n${license.trim()}`);
  }
  parts.push('Argo mark: Simple Icons, CC0-1.0. Source: https://github.com/simple-icons/simple-icons/blob/develop/icons/argo.svg\nLicense: https://creativecommons.org/publicdomain/zero/1.0/\nArgo trademarks remain the property of their owners; no endorsement is implied.');
  return parts.join('\n\n--------------------\n\n') + '\n';
}
