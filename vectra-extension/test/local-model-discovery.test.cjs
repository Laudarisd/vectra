// Beginner guide: Checks that l oc al m od el d is co ve ry.t es t behavior stays correct as the project changes.
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
  broadModelDirectories,
  storageModelDirectories
} = require('../build/models/LocalModelDiscovery.js');

const nested = (...parts) => join(...parts);

test('local discovery finds GGUF models while excluding projectors and later shards', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vectra-discovery-'));
  try {
    await Promise.all([
      writeFile(join(directory, 'model.gguf'), Buffer.alloc(64)),
      writeFile(join(directory, 'sharded-00001-of-00002.gguf'), Buffer.alloc(32)),
      writeFile(join(directory, 'sharded-00002-of-00002.gguf'), Buffer.alloc(32)),
      writeFile(join(directory, 'mmproj-model-f16.gguf'), Buffer.alloc(16))
    ]);
    const models = await discoverGgufModels({ roots: [directory], maxDirectories: 1, limit: 20, includeDefaults: false });
    assert.deepEqual(models.map((model) => model.label).sort(), [
      'model.gguf',
      'sharded-00001-of-00002.gguf'
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('automatic discovery includes arbitrary home folders and mounted storage roots', () => {
  const roots = storageModelDirectories();
  assert.ok(roots.length > 0);
  assert.ok(roots.some((entry) => entry === require('node:os').homedir()));
  if (process.platform === 'win32') assert.ok(roots.some((entry) => /^[A-Z]:\\$/i.test(entry)));
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
    const models = await discoverGgufModels({ roots: [root], maxDirectories: 500, limit: 20, includeDefaults: false });
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

test('local discovery can be cancelled before a broad filesystem scan starts', async () => {
  const controller = new AbortController();
  controller.abort();
  const models = await discoverGgufModels({
    roots: [require('node:os').homedir()],
    maxDirectories: 20_000,
    limit: 500,
    signal: controller.signal
  });
  assert.deepEqual(models, []);
});

test('Ollama auto-detection refuses non-local endpoints', async () => {
  assert.deepEqual(await discoverOllamaModels('https://example.com'), []);
});

test('the .cache directory is never skipped because the Hugging Face hub lives there', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vectra-discovery-cache-'));
  try {
    const hub = nested(root, '.cache', 'huggingface', 'hub', 'models--org--repo', 'snapshots', 'abc123');
    await mkdir(hub, { recursive: true });
    await writeFile(join(hub, 'cached-model.gguf'), Buffer.alloc(64));
    const models = await discoverGgufModels({ roots: [root], includeDefaults: false, limit: 20 });
    assert.ok(models.some((model) => model.label === 'cached-model.gguf'), 'a model under .cache must still be discoverable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('maxDepth bounds how far below a root the walk descends', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vectra-discovery-depth-'));
  try {
    const deep = nested(root, 'a', 'b', 'c', 'd', 'e');
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, 'deep-model.gguf'), Buffer.alloc(64));
    const shallow = await discoverGgufModels({ roots: [root], includeDefaults: false, maxDepth: 2, limit: 20 });
    assert.equal(shallow.length, 0, 'depth 2 must not reach a model five levels down');
    const full = await discoverGgufModels({ roots: [root], includeDefaults: false, maxDepth: 8, limit: 20 });
    assert.ok(full.some((model) => model.label === 'deep-model.gguf'), 'depth 8 must reach it');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a time budget bounds the walk in wall-clock terms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vectra-discovery-budget-'));
  try {
    // A wide, deep tree so an unbounded walk would take far longer than the budget.
    for (let branch = 0; branch < 12; branch++) {
      await mkdir(nested(root, `branch-${branch}`, 'x', 'y', 'z'), { recursive: true });
    }
    const started = Date.now();
    await discoverGgufModels({ roots: [root], includeDefaults: false, timeBudgetMs: 200, limit: 500 });
    assert.ok(Date.now() - started < 1_500, 'a 200ms budget must not run for over a second');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('package and toolchain caches are skipped while sibling models are still found', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vectra-discovery-skip-'));
  try {
    await mkdir(join(root, 'site-packages'), { recursive: true });
    await writeFile(nested(root, 'site-packages', 'vendored.gguf'), Buffer.alloc(64));
    await writeFile(join(root, 'real-model.gguf'), Buffer.alloc(64));
    const models = await discoverGgufModels({ roots: [root], includeDefaults: false, limit: 20 });
    const labels = models.map((model) => model.label);
    assert.ok(labels.includes('real-model.gguf'));
    assert.ok(!labels.includes('vendored.gguf'), 'site-packages must not be descended into');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a self-referential junction terminates instead of looping', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vectra-discovery-loop-'));
  try {
    await writeFile(join(root, 'loop-model.gguf'), Buffer.alloc(64));
    const inner = join(root, 'inner');
    await mkdir(inner);
    try {
      // Points back at its own ancestor: identity by path alone would recurse forever.
      await symlink(root, join(inner, 'back'), 'junction');
    } catch (error) {
      if (error.code === 'EPERM') return;
      throw error;
    }
    const started = Date.now();
    const models = await discoverGgufModels({ roots: [root], includeDefaults: false, maxDepth: 8, limit: 50 });
    assert.ok(Date.now() - started < 5_000, 'a junction cycle must not stall the walk');
    assert.ok(models.some((model) => model.label === 'loop-model.gguf'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
