// Beginner guide: Checks that t im eo ut p ol ic y.t es t behavior stays correct as the project changes.
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

test('heavy multi-document requests use bounded context and tool-loop recovery', async () => {
  const source = await readFile(new URL('../server/server.mjs', import.meta.url), 'utf8');
  const evidence = await readFile(new URL('../server/document-pipeline/evidence.mjs', import.meta.url), 'utf8');
  assert.match(source, /attachmentContextForPrompt/);
  assert.match(evidence, /clipVisualOcrCoverage/);
  assert.match(source, /conversationAttachmentCache/);
  assert.match(source, /REPEATED_TOOL_LOOP/);
  assert.match(source, /MAX_BODY=260\*1024\*1024/);
  assert.match(source, /compactConversationMessages/);
  assert.match(source, /wantsDocumentContextReset/);
  assert.match(source, /wantsStandaloneAnswer/);
  assert.match(source, /wantsPriorContext/);
  assert.match(source, /compactCompatibleTools/);
  assert.match(source, /isOutputLengthStop/);
  assert.doesNotMatch(source, /max_tokens\s*:\s*1536/);
});
