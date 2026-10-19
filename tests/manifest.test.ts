import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { requestedGuestCapabilities } from '@openchamber/sdk';
import { parseManifestJson } from '@openchamber/sdk/schemas';

test('manifest conforms to pinned SDK and only requests Service capability', async () => {
  const text = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  const result = parseManifestJson(text);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(requestedGuestCapabilities(result.manifest.contributes), ['service']);
});
