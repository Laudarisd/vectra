const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('controller preloads workspace evidence for Ask/Agent', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /request\.mode !== 'selection'/);
  assert.match(src, /type: 'workspace_summary'/);
  assert.match(src, /this\.toolRegistry\.execute/);
});

test('controller continues after tools and keeps multi-file proposals in one run', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /for \(let step = 1; step <= config\.maxAgentSteps; step\+\+\)/);
  assert.match(src, /proposalIds = new Set<string>/);
  assert.doesNotMatch(src, /if \(createdProposalThisStep\)/);
});

test('controller sends parsed text once and reserves provider attachments for media', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /providerMediaAttachments\(mediaAttachments\)/);
  assert.match(src, /attachment\.kind === 'image' \|\| attachment\.kind === 'pdf'/);
});
