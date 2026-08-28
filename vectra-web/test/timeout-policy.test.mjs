import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('all local Deep Agents paths keep the one-hour timeout', async () => {
  const source = await readFile(new URL('../server/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /compatibleChat\([^)]*timeoutMs=3_600_000/);
  assert.match(source, /compatibleToolChat\([^)]*timeoutMs=3_600_000/);
  assert.match(source, /idleTimeoutMs=isLocalProvider\|\|provider==='openaiCompatible'\?3_600_000/);
  assert.ok((source.match(/timeoutMs:idleTimeoutMs/g) || []).length >= 3);
});
