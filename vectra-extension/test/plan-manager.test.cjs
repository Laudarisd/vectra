const test = require('node:test');
const assert = require('node:assert/strict');
const { PlanManager } = require('../build/state/PlanManager.js');

test('PlanManager.propose creates a pending plan with mapped steps', () => {
  const plans = new PlanManager();
  const plan = plans.propose(['Read the router files', 'Add the endpoint'], 'because reasons');
  assert.equal(plan.status, 'pending');
  assert.equal(plan.revision, 1);
  assert.equal(plan.reason, 'because reasons');
  assert.deepEqual(plan.steps.map((s) => s.text), ['Read the router files', 'Add the endpoint']);
  assert.equal(plans.get(), plan);
});

test('PlanManager.propose increments revision on each new proposal', () => {
  const plans = new PlanManager();
  plans.propose(['A']);
  const second = plans.propose(['B']);
  assert.equal(second.revision, 2);
});

test('PlanManager.propose removes repeated steps before review', () => {
  const plans = new PlanManager();
  const plan = plans.propose([
    'Create the education folder',
    'Prepare README.md',
    ' create   THE education folder ',
    'Prepare README.md'
  ]);
  assert.deepEqual(plan.steps.map((step) => step.text), [
    'Create the education folder',
    'Prepare README.md'
  ]);
});

test('approve() resolves a pending waitForDecision with "approved"', async () => {
  const plans = new PlanManager();
  const plan = plans.propose(['Step 1']);
  const decision = plans.waitForDecision(plan.id);
  plans.approve();
  assert.equal(await decision, 'approved');
  assert.equal(plans.get().status, 'approved');
});

test('reject() resolves a pending waitForDecision with "rejected"', async () => {
  const plans = new PlanManager();
  const plan = plans.propose(['Step 1']);
  const decision = plans.waitForDecision(plan.id);
  plans.reject();
  assert.equal(await decision, 'rejected');
  assert.equal(plans.get().status, 'rejected');
});

test('waitForDecision resolves immediately when the plan was already decided', async () => {
  const plans = new PlanManager();
  const plan = plans.propose(['Step 1']);
  plans.approve();
  assert.equal(await plans.waitForDecision(plan.id), 'approved');
});

test('waitForDecision rejects immediately if the signal is already aborted', async () => {
  const plans = new PlanManager();
  const plan = plans.propose(['Step 1']);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(plans.waitForDecision(plan.id, controller.signal), /cancelled/i);
});

test('waitForDecision rejects when the signal aborts mid-wait, without resolving on a later approve()', async () => {
  const plans = new PlanManager();
  const plan = plans.propose(['Step 1']);
  const controller = new AbortController();
  const decision = plans.waitForDecision(plan.id, controller.signal);
  controller.abort();
  await assert.rejects(decision, /cancelled/i);
  // A late approve() after the waiter already gave up must not throw.
  assert.doesNotThrow(() => plans.approve());
});

test('reset() clears the current plan so a stale approval cannot authorize a new task', () => {
  const plans = new PlanManager();
  plans.propose(['Step 1']);
  plans.approve();
  plans.reset();
  assert.equal(plans.get(), undefined);
});

test('approve()/reject() on an already-resolved or missing plan is a no-op', () => {
  const plans = new PlanManager();
  assert.doesNotThrow(() => plans.approve());
  const plan = plans.propose(['Step 1']);
  plans.approve();
  plans.reject();
  assert.equal(plans.get().status, 'approved');
  assert.equal(plan.status, 'approved');
});
