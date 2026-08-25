import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverLocalRuntimes, searchGgufModels } from '../lib/local-discovery.mjs';

test('local runtime discovery reads OpenAI-compatible model listings', async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'vision-local' }, { id: 'code-local' }] }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const port = server.address().port;
    const runtimes = await discoverLocalRuntimes([{ name: 'Test runtime', baseUrl: `http://127.0.0.1:${port}/v1`, discoveryUrl: `http://127.0.0.1:${port}/v1/models` }]);
    const runtime = runtimes.find((item) => item.name === 'Test runtime');
    assert.deepEqual(runtime.models, ['code-local', 'vision-local']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GGUF search is bounded and excludes vision projectors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vectra-model-search-'));
  try {
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', 'Qwen-Code-Q4.gguf'), '');
    await writeFile(join(root, 'nested', 'mmproj-Qwen.gguf'), '');
    assert.deepEqual(await searchGgufModels({ roots: [root], query: 'code' }), [join(root, 'nested', 'Qwen-Code-Q4.gguf')]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GGUF search follows a symlinked/junctioned models directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vectra-model-search-link-'));
  try {
    const realDirectory = join(root, 'real-models');
    await mkdir(realDirectory);
    await writeFile(join(realDirectory, 'linked-model.gguf'), '');
    const linkPath = join(root, 'linked-models');
    try {
      await symlink(realDirectory, linkPath, 'junction');
    } catch (error) {
      // Symlink creation can require elevated privileges on some CI/Windows
      // setups; skip rather than fail the suite when the platform refuses.
      if (error.code === 'EPERM') return;
      throw error;
    }
    const results = await searchGgufModels({ roots: [root] });
    assert.ok(results.includes(join(linkPath, 'linked-model.gguf')), 'should find the model through the symlinked directory');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
