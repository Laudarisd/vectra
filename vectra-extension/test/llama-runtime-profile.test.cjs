// Beginner guide: Checks that l la ma r un ti me p ro fi le.t es t behavior stays correct as the project changes.
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

test('threads are never left unset, even with no explicit input -- avoids llama-server\'s all-cores default', () => {
  const profile = buildLlamaRuntimeProfile({
    hardware: { gpus: [], cpuCores: 8, totalRamMiB: 16384, platform: 'linux' },
    modelBytes: 2 * 1024 ** 3,
    requestedContextSize: 8192,
    deviceMode: 'cpu', gpuLayers: 'auto', splitMode: 'layer', cpuMoe: false, noMmap: false, supportedFlags: new Set()
  });
  assert.ok(profile.args.includes('-t'));
  assert.ok(profile.args.includes('-tb'));
  assert.equal(profile.args[profile.args.indexOf('-t') + 1], '6');
});

test('auto profile pins threads to performance cores on hybrid CPUs, leaving efficiency cores free', () => {
  const profile = buildLlamaRuntimeProfile({
    hardware: { gpus: [{}], maxVramMiB: undefined, cpuCores: 8, performanceCores: 6, efficiencyCores: 2, totalRamMiB: 16384, platform: 'darwin' },
    modelBytes: 1.7 * 1024 ** 3,
    requestedContextSize: 16384,
    deviceMode: 'auto', gpuLayers: 'auto', splitMode: 'layer', cpuMoe: false, noMmap: false, supportedFlags: FLAGS
  });
  assert.equal(profile.args[profile.args.indexOf('-t') + 1], '6');
});

test('performance profile uses every logical core, including efficiency cores', () => {
  const profile = buildLlamaRuntimeProfile({
    hardware: { gpus: [{}], cpuCores: 8, performanceCores: 6, efficiencyCores: 2, totalRamMiB: 16384, platform: 'darwin' },
    modelBytes: 1.7 * 1024 ** 3,
    requestedContextSize: 16384,
    deviceMode: 'auto', gpuLayers: 'auto', splitMode: 'layer', cpuMoe: false, noMmap: false, supportedFlags: FLAGS,
    threadProfile: 'performance'
  });
  assert.equal(profile.args[profile.args.indexOf('-t') + 1], '8');
});

test('efficiency profile halves the performance-core count for the quietest option', () => {
  const profile = buildLlamaRuntimeProfile({
    hardware: { gpus: [{}], cpuCores: 8, performanceCores: 6, efficiencyCores: 2, totalRamMiB: 16384, platform: 'darwin' },
    modelBytes: 1.7 * 1024 ** 3,
    requestedContextSize: 16384,
    deviceMode: 'auto', gpuLayers: 'auto', splitMode: 'layer', cpuMoe: false, noMmap: false, supportedFlags: FLAGS,
    threadProfile: 'efficiency'
  });
  assert.equal(profile.args[profile.args.indexOf('-t') + 1], '3');
});

test('an explicit cpuThreads override always wins over the thread profile', () => {
  const profile = buildLlamaRuntimeProfile({
    hardware: { gpus: [{}], cpuCores: 8, performanceCores: 6, efficiencyCores: 2, totalRamMiB: 16384, platform: 'darwin' },
    modelBytes: 1.7 * 1024 ** 3,
    requestedContextSize: 16384,
    deviceMode: 'auto', gpuLayers: 'auto', splitMode: 'layer', cpuMoe: false, noMmap: false, supportedFlags: FLAGS,
    threadProfile: 'performance', cpuThreads: 2
  });
  assert.equal(profile.args[profile.args.indexOf('-t') + 1], '2');
});
