const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { VECTRA_TOOL_DEFINITIONS } = require('../shared-core');
const { AGENT_ACTION_SCHEMA, AGENT_TOOL_DEFINITIONS } = require('../dist/agent/AgentToolCatalog.js');

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

test('every canonical core host tool has extension execution and playful progress handling', () => {
  const source = fs.readFileSync('src/agent/AgentToolRegistry.ts', 'utf8');
  for (const tool of VECTRA_TOOL_DEFINITIONS) {
    assert.match(source, new RegExp(`case '${tool.name}'`), `${tool.name} needs an extension registry handler`);
  }
  assert.match(source, /Toddler-speak on purpose/);
});
