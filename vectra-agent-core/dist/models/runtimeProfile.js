"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLlamaRuntimeProfile = buildLlamaRuntimeProfile;
exports.parseLlamaServerFlags = parseLlamaServerFlags;
const GIB = 1024 * 1024 * 1024;
/** Shared adaptive policy used by the VS Code and Node.js llama.cpp hosts. */
function buildLlamaRuntimeProfile(input) {
    const modelGiB = input.modelBytes / GIB;
    const vramGiB = (input.hardware.maxVramMiB ?? 0) / 1024;
    const ramGiB = input.hardware.totalRamMiB / 1024;
    const hasGpu = input.deviceMode !== 'cpu' && input.hardware.gpus.length > 0;
    const resident = hasGpu && vramGiB > 0 && modelGiB <= vramGiB * 0.78;
    const mode = resident ? 'gpu-resident' : hasGpu ? 'hybrid' : 'cpu';
    const ceiling = mode === 'gpu-resident' ? 16_384 : 8_192;
    const memoryTight = modelGiB > ramGiB * 0.55;
    const contextSize = Math.max(2_048, Math.min(input.requestedContextSize, memoryTight ? 4_096 : ceiling));
    const args = ['-c', String(contextSize)];
    add(args, input.supportedFlags, '--fit', 'on');
    args.push('--gpu-layers', input.deviceMode === 'cpu' ? '0' : input.gpuLayers);
    args.push('--split-mode', input.splitMode);
    add(args, input.supportedFlags, '--flash-attn', 'auto');
    add(args, input.supportedFlags, '--parallel', '1');
    add(args, input.supportedFlags, '--cache-prompt');
    add(args, input.supportedFlags, '--cache-reuse', '256');
    add(args, input.supportedFlags, '--jinja');
    add(args, input.supportedFlags, '--spec-type', 'ngram-cache');
    add(args, input.supportedFlags, '--metrics');
    if (mode !== 'gpu-resident') {
        add(args, input.supportedFlags, '--cache-type-k', 'q8_0');
        add(args, input.supportedFlags, '--cache-type-v', 'q8_0');
    }
    if (input.cpuMoe && input.supportedFlags.has('--cpu-moe'))
        args.push('--cpu-moe');
    if (input.noMmap)
        args.push('--no-mmap');
    return {
        mode,
        contextSize,
        args,
        summary: `${mode}; model ${modelGiB.toFixed(1)} GiB, VRAM ${vramGiB.toFixed(1)} GiB, RAM ${ramGiB.toFixed(1)} GiB, context ${contextSize}`
    };
}
function parseLlamaServerFlags(help) {
    return new Set(help.match(/--[a-z][a-z0-9-]*/gi) ?? []);
}
function add(args, supported, flag, value) {
    if (!supported.has(flag))
        return;
    args.push(flag);
    if (value !== undefined)
        args.push(value);
}
//# sourceMappingURL=runtimeProfile.js.map