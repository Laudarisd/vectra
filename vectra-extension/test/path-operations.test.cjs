const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('path operations stay workspace-bound, collision-safe, and confirmed', () => {
  const source = fs.readFileSync('src/workspace/WorkspacePathOperations.ts', 'utf8');
  assert.match(source, /resolveWorkspacePath/);
  assert.match(source, /Destination already exists/);
  assert.match(source, /showWarningMessage/);
  assert.match(source, /overwrite: false/);
  assert.match(source, /useTrash: true/);
  assert.match(source, /Directory is not empty/);
  assert.match(source, /Workspace root folders cannot be changed/);
  assert.match(source, /cannot be moved or copied inside itself/);
});

test('path operation tools are plan-gated and denied to subagents', () => {
  const source = fs.readFileSync('src/agent/ExtensionToolExecutor.ts', 'utf8');
  for (const name of ['create_directory', 'rename_path', 'move_path', 'copy_path', 'delete_directory']) {
    assert.match(source, new RegExp(`'${name}'`));
  }
  assert.match(source, /VECTRA_WRITE_OR_EXECUTE_TOOL_NAMES/);
  assert.match(source, /VECTRA_SUBAGENT_DENIED_TOOL_NAMES/);
  assert.match(source, /Pending file proposals must be accepted or rejected/);
});
