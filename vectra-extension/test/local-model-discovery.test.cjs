const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const {
  discoverGgufModels,
  discoverOllamaModels,
  normalizeShardPath
} = require('../dist/services/LocalModelDiscovery.js');

test('local discovery finds GGUF models while excluding projectors and later shards', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vectra-discovery-'));
  try {
    await Promise.all([
      writeFile(join(directory, 'model.gguf'), Buffer.alloc(64)),
      writeFile(join(directory, 'sharded-00001-of-00002.gguf'), Buffer.alloc(32)),
      writeFile(join(directory, 'sharded-00002-of-00002.gguf'), Buffer.alloc(32)),
      writeFile(join(directory, 'mmproj-model-f16.gguf'), Buffer.alloc(16))
    ]);
    const models = await discoverGgufModels([directory], 1, 20);
    assert.deepEqual(models.map((model) => model.label).sort(), [
      'model.gguf',
      'sharded-00001-of-00002.gguf'
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('local discovery normalizes a selected shard to the first shard', () => {
  assert.match(normalizeShardPath('C:/models/demo-00003-of-00008.gguf'), /demo-00001-of-00008\.gguf$/);
});

test('Ollama auto-detection refuses non-local endpoints', async () => {
  assert.deepEqual(await discoverOllamaModels('https://example.com'), []);
});
