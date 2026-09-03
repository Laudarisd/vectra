// Beginner guide: Checks that p ro po sa l e ff ec ts.t es t behavior stays correct as the project changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'vscode') return { workspace: {}, window: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { ExtensionToolExecutor } = require('../build/agent/ExtensionToolExecutor.js');
Module._load = originalLoad;

function executor() {
  const workspace = {
    readWholeFile: async () => ({ exists: false, content: '' }),
    execute: async () => 'read-only result'
  };
  const patches = {
    getPendingForPath: () => undefined,
    proposeFile: async (path, content, reason) => ({ id: 'proposal-1', path, content, reason, kind: 'create' }),
    list: () => []
  };
  const plans = { get: () => ({ status: 'approved' }) };
  const pathOperations = { createDirectory: async (path) => `Created directory ${path}.` };
  return new ExtensionToolExecutor(workspace, patches, {}, {}, {}, plans, {}, pathOperations);
}

test('a file proposal is not classified as a real workspace mutation', async () => {
  const result = await executor().execute(
    { type: 'create_file', path: 'src/new.ts', content: 'export {};' },
    { mode: 'agent', mediaAttachments: [] }
  );
  assert.equal(result.effect, 'proposal');
  assert.deepEqual(result.proposalIds, ['proposal-1']);
  assert.match(result.observation, /Nothing has been written to disk/);
});

test('a confirmed directory operation is classified as a real workspace mutation', async () => {
  const result = await executor().execute(
    { type: 'create_directory', path: 'src/generated' },
    { mode: 'agent', mediaAttachments: [] }
  );
  assert.equal(result.effect, 'workspace');
  assert.deepEqual(result.proposalIds, []);
  assert.match(result.observation, /Created directory src\/generated/);
});
