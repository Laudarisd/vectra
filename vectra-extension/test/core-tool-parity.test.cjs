const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { VECTRA_TOOL_DEFINITIONS, describeVectraTool } = require('../build/core');
const { AGENT_ACTION_SCHEMA, AGENT_TOOL_DEFINITIONS } = require('../build/agent/ExtensionToolCatalog.js');

test('extension exposes every canonical core host tool', () => {
  assert.deepEqual(
    AGENT_TOOL_DEFINITIONS.map((tool) => tool.name),
    VECTRA_TOOL_DEFINITIONS.map((tool) => tool.name)
  );
  for (const tool of AGENT_TOOL_DEFINITIONS) {
    assert.ok(tool.displayName, `${tool.name} needs a human-readable display name`);
    assert.ok(!tool.displayName.includes('_'), `${tool.name} display name should not expose snake_case`);
  }
});

test('legacy extension schema advertises only actions its registry can execute', () => {
  assert.deepEqual(
    AGENT_ACTION_SCHEMA.properties.type.enum,
    VECTRA_TOOL_DEFINITIONS.map((tool) => tool.name)
  );
  assert.ok(!AGENT_ACTION_SCHEMA.properties.type.enum.some((name) => name.startsWith('deep_')));
});

test('every canonical core host tool has shared playful progress handling', () => {
  const source = fs.readFileSync('src/agent/ExtensionToolExecutor.ts', 'utf8');
  for (const tool of VECTRA_TOOL_DEFINITIONS) {
    assert.notEqual(describeVectraTool(tool.name, {}), 'Checking a tool step…', `${tool.name} needs shared progress text`);
  }
  assert.match(source, /Toddler-speak on purpose/);
  assert.match(source, /describeVectraTool/);
});
