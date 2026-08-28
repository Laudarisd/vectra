import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('local Deep Agents requests keep the 900-second timeout', async () => {
  const source = await readFile(new URL('../server/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /compatibleChat\([^)]*timeoutMs=900_000/);
  assert.match(source, /compatibleToolChat\([^)]*timeoutMs=900_000/);
  assert.ok((source.match(/timeoutMs:idleTimeoutMs/g) || []).length >= 3);
});
