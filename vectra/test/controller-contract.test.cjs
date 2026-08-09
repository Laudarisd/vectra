const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('controller preloads workspace evidence for Ask/Agent', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /request\.mode !== 'selection'/);
  assert.match(src, /this\.tools\.workspaceSummary\(\)/);
});

test('controller performs a post-tool synthesis turn instead of returning provisional tool-call message', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /Actions produce evidence\. Always give the model another turn/);
  assert.doesNotMatch(src, /if \(envelope\.done\) return \{ text: envelope\.message/);
});
