const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLlamaRuntimeProfile, parseLlamaServerFlags } = require('../build/runtime/llama/LlamaRuntimeProfile.js');

const FLAGS = parseLlamaServerFlags('--fit --flash-attn --parallel --cache-prompt --cache-reuse --jinja --spec-type --metrics --cache-type-k --cache-type-v --cpu-moe');

test('resident GPU profile keeps context and enables prompt reuse', () => {
  const profile = buildLlamaRuntimeProfile({
    hardware: { gpus: [{}], maxVramMiB: 16384, cpuCores: 12, totalRamMiB: 32768, platform: 'win32' },
    modelBytes: 5 * 1024 ** 3,
    requestedContextSize: 16384,
    deviceMode: 'auto', gpuLayers: 'auto', splitMode: 'layer', cpuMoe: false, noMmap: false, supportedFlags: FLAGS
  });
  assert.equal(profile.mode, 'gpu-resident');
  assert.equal(profile.contextSize, 16384);
  assert.ok(profile.args.includes('--cache-prompt'));
  assert.ok(profile.args.includes('--jinja'));
  assert.deepEqual(profile.args.slice(profile.args.indexOf('--spec-type'), profile.args.indexOf('--spec-type') + 2), ['--spec-type', 'ngram-cache']);
  assert.ok(!profile.args.includes('--cache-type-k'));
});

test('hybrid profile reduces context and quantizes KV cache', () => {
  const profile = buildLlamaRuntimeProfile({
    hardware: { gpus: [{}], maxVramMiB: 8192, cpuCores: 12, totalRamMiB: 32768, platform: 'linux' },
    modelBytes: 14 * 1024 ** 3,
    requestedContextSize: 16384,
    deviceMode: 'auto', gpuLayers: 'auto', splitMode: 'layer', cpuMoe: false, noMmap: false, supportedFlags: FLAGS
  });
  assert.equal(profile.mode, 'hybrid');
  assert.equal(profile.contextSize, 8192);
  assert.ok(profile.args.includes('--cache-type-k'));
});

test('unsupported optional flags are omitted', () => {
  const profile = buildLlamaRuntimeProfile({
    hardware: { gpus: [], cpuCores: 4, totalRamMiB: 8192, platform: 'linux' },
    modelBytes: 2 * 1024 ** 3,
    requestedContextSize: 8192,
    deviceMode: 'cpu', gpuLayers: 'auto', splitMode: 'layer', cpuMoe: true, noMmap: false, supportedFlags: new Set()
  });
  assert.ok(!profile.args.includes('--flash-attn'));
  assert.deepEqual(profile.args.slice(-4), ['--gpu-layers', '0', '--split-mode', 'layer']);
});
