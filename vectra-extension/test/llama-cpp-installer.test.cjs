const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { findServerExecutable } = require('../build/runtime/llama/LlamaCppInstaller.js');

test('findServerExecutable recovers a nested Vectra llama.cpp install', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vectra-llama-install-'));
  try {
    const bin = join(root, 'b1234', 'bin');
    await mkdir(bin, { recursive: true });
    const executable = join(bin, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    await writeFile(executable, '');
    assert.equal(await findServerExecutable(root, 5), executable);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
