const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('resolved human-in-the-loop cards disappear automatically', () => {
  const source = fs.readFileSync('src/ui/ChatViewProvider.ts', 'utf8');

  assert.match(source, /await this\.patches\.accept\(message\.id\);\s*this\.patches\.clearCompleted\(\);/);
  assert.match(source, /this\.patches\.reject\(message\.id\);\s*this\.patches\.clearCompleted\(\);/);
  assert.match(source, /await this\.patches\.acceptAllPending\(\);\s*this\.patches\.clearCompleted\(\);/);
  assert.match(source, /this\.patches\.rejectAllPending\(\);\s*this\.patches\.clearCompleted\(\);/);
  assert.match(source, /plan: activePlan\?\.status === 'pending' \? activePlan : undefined/);
});

test('plan approval is inline, checklist styled, and auto-collapses after a decision', () => {
  const script = fs.readFileSync('media/main.js', 'utf8');
  const styles = fs.readFileSync('media/main.css', 'utf8');

  assert.match(script, /renderPlans\(card\)/);
  assert.match(script, /archiveResolvedPlan\(\{ \.\.\.plan, status: decision \}\)/);
  assert.match(script, /collapsedPlanIds\.add\(plan\.id\)/);
  assert.match(script, /plan-step-check/);
  assert.match(styles, /\.inline-plan-header/);
  assert.match(styles, /\.plan-step-check/);
});

test('plan cards expose explicit minimize and cancellation controls', () => {
  const host = fs.readFileSync('src/ui/ChatViewProvider.ts', 'utf8');
  const script = fs.readFileSync('media/main.js', 'utf8');

  assert.match(script, /minimize\.title = collapsed \? 'Expand plan' : 'Minimize plan'/);
  assert.match(script, /cancel\.title = plan\.status === 'pending' \? 'Cancel this task' : 'Dismiss this plan'/);
  assert.match(script, /vscode\.postMessage\(\{ type: 'cancelPlan' \}\)/);
  assert.match(host, /case 'cancelPlan':[\s\S]*this\.plans\.reject\(\);[\s\S]*this\.abortController\?\.abort\(\);/);
});
