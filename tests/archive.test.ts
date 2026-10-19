import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, readReleaseZip, zipFiles } from '../scripts/archive.js';
import { scanReleaseFile } from '../scripts/release.js';
import { RELEASE_FILES } from '../scripts/release.js';
import { readFile } from 'node:fs/promises';
import { parseManifestJson } from '@openchamber/sdk/schemas';

test('stored release ZIP is deterministic, bounded, CRC checked and root-relative', () => {
  const files = new Map([['package.json', Buffer.from('{"type":"module"}')], ['panel/main.js', Buffer.from('hello')]]);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const first = zipFiles(files); assert.ok(first.equals(zipFiles(new Map([...files].reverse())))); assert.deepEqual(readReleaseZip(first), files);
  const corrupt = Buffer.from(first); corrupt[45] = corrupt[45]! ^ 1; assert.throws(() => readReleaseZip(corrupt));
  for (const name of ['../config', '/absolute', 'x/../../secret', 'x\\secret', './package.json', 'x//file']) assert.throws(() => zipFiles(new Map([[name, Buffer.from('bad')]])));
  assert.throws(() => readReleaseZip(Buffer.alloc(30))); assert.throws(() => zipFiles(new Map([['large', Buffer.alloc(8 * 1024 * 1024 + 1)]])));
});

test('the visible right-side panel declares an inert, bundled Argo SVG rather than a generic icon', async () => {
  const source = await readFile('package.json', 'utf8'); const manifest = JSON.parse(source);
  assert.equal(parseManifestJson(source).ok, true);
  const panel = manifest.openchamber.contributes.panel;
  assert.equal(panel.icon, 'panel/argocd.svg'); assert.equal(panel.entry, 'panel/index.html');
  assert.ok((RELEASE_FILES as readonly string[]).includes(panel.icon));
  const svg = await readFile(panel.icon, 'utf8');
  assert.match(svg, /<svg[^>]*viewBox="0 0 24 24"/); assert.match(svg, /<title>Argo CD<\/title>/); assert.match(svg, /<path d="/);
  assert.doesNotMatch(svg, /<(?:script|style|foreignObject|image|use)\b|\bon\w+\s*=|\b(?:href|src)\s*=/i);
  assert.match(svg, /Simple Icons \(CC0-1.0\)/);
});

test('release sentinel scanner rejects credentials and non-release files without printing their contents', () => {
  for (const value of ['synthetic-original', 'synthetic-argo-token', '-----BEGIN RSA PRIVATE KEY-----\nPRIVATE\n-----END RSA PRIVATE KEY-----', 'eyJabc.def.ghi']) assert.throws(() => scanReleaseFile('panel/main.js', Buffer.from(value)), (error: Error) => !error.message.includes(value));
  for (const name of ['node_modules/pkg/file.js', 'tests/data.json', '.env', 'src/main.ts', 'session.log', 'material.pem']) assert.throws(() => scanReleaseFile(name, Buffer.from('safe')));
  assert.doesNotThrow(() => scanReleaseFile('service/main.js', Buffer.from('const credentialPattern = /token/;')));
});
