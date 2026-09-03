// Beginner guide: Checks that c on tr ol le r c on tr ac t.t es t behavior stays correct as the project changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('controller preloads workspace evidence for Ask/Agent', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /request\.mode !== 'selection'/);
  assert.match(src, /type: 'workspace_summary'/);
  assert.match(src, /this\.toolRegistry\.execute/);
});

test('conversational turns answer before any workspace or tool work', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  const chatCheck = src.indexOf("classifyTurn(request.userText");
  const collect = src.indexOf('this.contextCollector.collect');
  const preload = src.indexOf("type: 'workspace_summary'");
  assert.ok(chatCheck > 0, 'controller must classify the turn');
  assert.ok(chatCheck < collect, 'chat path must short-circuit before collecting workspace context');
  assert.ok(chatCheck < preload, 'chat path must short-circuit before the workspace_summary preload');
  assert.match(src, /buildChatSystemPrompt\(\)/);
  assert.match(src, /structured: false/);
});

test('controller never shows engine internals or bare status text to the user', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.doesNotMatch(src, /Stopped a repeated tool-action loop/);
  assert.doesNotMatch(src, /Stopped after \$\{config\.maxAgentSteps\} agent steps/);
  assert.match(src, /isStatusOnlyReply/);
});

test('controller continues after tools and keeps multi-file proposals in one run', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /for \(let step = 1; step <= opts\.maxSteps; step\+\+\)/);
  assert.match(src, /maxSteps: config\.maxAgentSteps/);
  assert.match(src, /proposalIds = new Set<string>/);
  assert.doesNotMatch(src, /if \(createdProposalThisStep\)/);
});

test('controller sends parsed text once and reserves provider attachments for media', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /providerMediaAttachments\(opts\.mediaAttachments\)/);
  assert.match(src, /attachment\.kind === 'image' \|\| attachment\.kind === 'pdf'/);
});

test('controller prevents stale chat actions from hijacking a new topic', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  const context = fs.readFileSync('src/agent/ConversationContext.ts','utf8');
  assert.match(src, /ACTIVE TASK REMINDER/);
  assert.match(src, /formatRecentHistory/);
  assert.match(context, /Array\.isArray\(parsed\.actions\)/);
  assert.match(context, /Previous malformed tool response omitted/);
  assert.match(context, /classifyTurn/);
});

test('a completed write batch gets exactly one self-verification turn', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /let verificationTurnUsed = false/);
  assert.match(src, /if \(verificationTurnUsed\) \{/);
  assert.match(src, /verificationTurnUsed = true/);
  assert.match(src, /VERIFICATION STEP/);
});

test('controller suppresses repeated tool-action loops', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /attemptedActions = new Set<string>/);
  assert.match(src, /Repeated tool action suppressed/);
  assert.match(src, /duplicateOnlySteps >= 2/);
});

test('controller treats plan proposal as an approval boundary', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /proposedPlanAction = requestedActions\.find/);
  assert.match(src, /actionsToExecute = proposedPlanAction \? \[proposedPlanAction\] : requestedActions/);
});

test('Deep Agents waits for plan approval and rejects narration without a real write', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /action\.type === 'propose_plan'/);
  assert.match(src, /this\.plans\.waitForDecision\(plan\.id, opts\.signal\)/);
  assert.match(src, /PLAN APPROVED: proceed now using the real Vectra workspace tools/);
  assert.match(src, /let successfulWorkspaceMutations = 0/);
  assert.match(src, /successfulWorkspaceMutations === 0/);
  assert.match(src, /this\.resolveProposals\(\[\.\.\.opts\.proposalIds\]\)\.length === 0/);
  assert.match(src, /existingPlan\?\.status === 'approved'/);
  assert.match(src, /requestsWorkspaceMutation\(opts\.task\)/);
  assert.match(src, /No real workspace action was called/);
  assert.match(src, /preparing a safe approval plan/);
  assert.match(src, /this\.plans\.waitForDecision\(fallbackPlan\.id, opts\.signal\)/);
  assert.match(src, /use real workspace tools now; do not merely describe/);
});

test('pending proposals produce a deterministic not-written completion', () => {
  const src = fs.readFileSync('src/agent/AgentController.ts','utf8');
  assert.match(src, /Nothing in this batch has been written to disk yet/);
  assert.match(src, /Use Accept or Accept all below to apply/);
  assert.doesNotMatch(src, /\[message, suffix\]/);
});
