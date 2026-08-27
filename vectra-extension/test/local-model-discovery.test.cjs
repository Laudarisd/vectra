const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, symlink, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const {
  discoverGgufModels,
  discoverOllamaModels,
  normalizeShardPath,
  appModelDirectories,
  broadModelDirectories
} = require('../dist/models/LocalModelDiscovery.js');

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

test('local discovery follows a symlinked/junctioned models directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vectra-discovery-link-'));
  try {
    const realDirectory = join(root, 'real-models');
    await mkdir(realDirectory);
    await writeFile(join(realDirectory, 'linked-model.gguf'), Buffer.alloc(64));
    const linkPath = join(root, 'linked-models');
    try {
      await symlink(realDirectory, linkPath, 'junction');
    } catch (error) {
      // Symlink creation can require elevated privileges on some CI/Windows
      // setups; skip rather than fail the suite when the platform refuses.
      if (error.code === 'EPERM') return;
      throw error;
    }
    // A generous directory budget: extraRoots share the scan queue with the
    // app-specific cache directories (huggingface, lm-studio, jan, ...), most
    // of which won't exist on the test machine but each still costs one
    // visit before the queue reaches this root's own children.
    const models = await discoverGgufModels([root], 500, 20);
    assert.ok(models.some((model) => model.label === 'linked-model.gguf'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('broad personal folders are scanned separately from app-specific caches, not mixed into the same priority tier', () => {
  // Downloads/Documents/Desktop can be huge; keeping them out of the
  // priority tier is what stops them from starving the maxDirectories
  // budget before app caches (huggingface, lm-studio, jan, ...) are reached.
  const broad = broadModelDirectories();
  const app = appModelDirectories();
  assert.deepEqual(broad.map((entry) => entry.split(/[\\/]/).pop()).sort(), ['Desktop', 'Documents', 'Downloads']);
  for (const entry of broad) assert.ok(!app.includes(entry), `${entry} should not also appear in the priority tier`);
});

test('local discovery normalizes a selected shard to the first shard', () => {
  assert.match(normalizeShardPath('C:/models/demo-00003-of-00008.gguf'), /demo-00001-of-00008\.gguf$/);
});

test('Ollama auto-detection refuses non-local endpoints', async () => {
  assert.deepEqual(await discoverOllamaModels('https://example.com'), []);
});
