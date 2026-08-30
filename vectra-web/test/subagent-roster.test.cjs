const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VECTRA_TOOL_DEFINITIONS,
  VECTRA_SUBAGENT_ROLES,
  buildVectraSubagentSpecs
} = require('../core');

const EXPECTED_ROLE_NAMES = ['planner', 'researcher', 'coder', 'tester', 'reviewer', 'security', 'documentation'];

test('Vectra defines exactly the seven specialized subagent roles from TASKS.md', () => {
  assert.deepEqual(VECTRA_SUBAGENT_ROLES.map((role) => role.name).sort(), [...EXPECTED_ROLE_NAMES].sort());
  for (const role of VECTRA_SUBAGENT_ROLES) {
    assert.ok(role.description, `${role.name} needs a description`);
    assert.ok(role.systemPrompt, `${role.name} needs a system prompt`);
    assert.ok(role.allowedRisk.length > 0, `${role.name} needs at least one allowed risk level`);
  }
});

test('every subagent role tool set excludes coordination-risk tools and delegate_task', () => {
  const specs = buildVectraSubagentSpecs(VECTRA_TOOL_DEFINITIONS, async () => 'ok', true);
  const byRisk = new Map(VECTRA_TOOL_DEFINITIONS.map((item) => [item.name, item.risk]));
  for (const spec of specs) {
    const names = spec.tools.map((tool) => tool.name.replace(/^vectra_/, ''));
    assert.ok(!names.includes('delegate_task'), `${spec.name} must never see delegate_task`);
    for (const name of names) {
      const risk = byRisk.get(name);
      if (!risk) continue; // discovery/attachment-only tools have no canonical entry here
      assert.notEqual(risk, 'coordination', `${spec.name} must never see coordination-risk tool ${name}`);
    }
  }
});

test('read-only roles (reviewer, security) never receive write or execute tools', () => {
  const specs = buildVectraSubagentSpecs(VECTRA_TOOL_DEFINITIONS, async () => 'ok', true);
  const byRisk = new Map(VECTRA_TOOL_DEFINITIONS.map((item) => [item.name, item.risk]));
  for (const roleName of ['reviewer', 'security']) {
    const spec = specs.find((item) => item.name === roleName);
    const names = spec.tools.map((tool) => tool.name.replace(/^vectra_/, ''));
    for (const name of names) {
      const risk = byRisk.get(name);
      assert.ok(risk !== 'write' && risk !== 'execute', `${roleName} must not receive ${name} (${risk})`);
    }
  }
});

test('tester receives execute but not write tools; coder receives write but not execute tools', () => {
  const specs = buildVectraSubagentSpecs(VECTRA_TOOL_DEFINITIONS, async () => 'ok', true);
  const byRisk = new Map(VECTRA_TOOL_DEFINITIONS.map((item) => [item.name, item.risk]));
  const risksOf = (roleName) => specs.find((item) => item.name === roleName).tools
    .map((tool) => byRisk.get(tool.name.replace(/^vectra_/, '')))
    .filter(Boolean);
  assert.ok(risksOf('tester').includes('execute'));
  assert.ok(!risksOf('tester').includes('write'));
  assert.ok(risksOf('coder').includes('write'));
  assert.ok(!risksOf('coder').includes('execute'));
});

test('a role tool call dispatches to the gated executor with the bare tool name', async () => {
  const calls = [];
  const specs = buildVectraSubagentSpecs(VECTRA_TOOL_DEFINITIONS, async (name, input) => { calls.push({ name, input }); return 'done'; }, true);
  const coder = specs.find((item) => item.name === 'coder');
  const create = coder.tools.find((tool) => tool.name === 'vectra_create_file');
  assert.equal(await create.execute({ path: 'a.txt', content: 'hi' }, {}), 'done');
  assert.deepEqual(calls, [{ name: 'create_file', input: { path: 'a.txt', content: 'hi' } }]);
});

test('discovery-mode role isolation holds even through vectra_invoke_tool', async () => {
  const specs = buildVectraSubagentSpecs(VECTRA_TOOL_DEFINITIONS, async () => 'ok', false);
  const reviewer = specs.find((item) => item.name === 'reviewer');
  const search = reviewer.tools.find((tool) => tool.name === 'vectra_search_tools');
  const invoke = reviewer.tools.find((tool) => tool.name === 'vectra_invoke_tool');
  // create_file is a real Vectra capability, but never part of the reviewer role's
  // own closure -- it must be unreachable regardless of what the model requests.
  assert.throws(() => invoke.execute({ name: 'create_file', arguments: { path: 'x', content: 'y' } }, {}), /Unknown Vectra capability|Search for/);
  const found = await search.execute({ query: 'read file' }, {});
  assert.ok(found.tools.every((tool) => tool.risk !== 'write' && tool.risk !== 'execute'));
});
