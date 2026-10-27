// Beginner guide: Handles r un ti me pr of il e responsibilities for Vectra.
export type LlamaRuntimeMode = 'gpu-resident' | 'hybrid' | 'cpu';
export type LlamaThreadProfile = 'auto' | 'performance' | 'efficiency';

export interface RuntimeHardwareSnapshot {
  gpus: Array<{ name?: string; vramMiB?: number }>;
  maxVramMiB?: number;
  cpuCores: number;
  /** Performance-core count on hybrid CPUs (Apple Silicon); undefined when the split is unknown. */
  performanceCores?: number;
  efficiencyCores?: number;
  totalRamMiB: number;
  platform: string;
}

export interface LlamaRuntimeProfileInput {
  hardware: RuntimeHardwareSnapshot;
  modelBytes: number;
  requestedContextSize: number;
  deviceMode: 'auto' | 'gpu' | 'cpu';
  gpuLayers: string;
  splitMode: string;
  cpuMoe: boolean;
  noMmap: boolean;
  supportedFlags: ReadonlySet<string>;
  /** User override for CPU thread count; 0/undefined defers to threadProfile. Always wins when positive. */
  cpuThreads?: number;
  /** How aggressively to claim CPU threads when cpuThreads is not set. Defaults to 'auto'. */
  threadProfile?: LlamaThreadProfile;
}

export interface LlamaRuntimeProfile {
  mode: LlamaRuntimeMode;
  contextSize: number;
  args: string[];
  summary: string;
}

const GIB = 1024 * 1024 * 1024;

/** Shared adaptive policy used by the VS Code and Node.js llama.cpp hosts. */
export function buildLlamaRuntimeProfile(input: LlamaRuntimeProfileInput): LlamaRuntimeProfile {
  const modelGiB = input.modelBytes / GIB;
  const vramGiB = (input.hardware.maxVramMiB ?? 0) / 1024;
  const ramGiB = input.hardware.totalRamMiB / 1024;
  const hasGpu = input.deviceMode !== 'cpu' && input.hardware.gpus.length > 0;
  const resident = hasGpu && vramGiB > 0 && modelGiB <= vramGiB * 0.78;
  const mode: LlamaRuntimeMode = resident ? 'gpu-resident' : hasGpu ? 'hybrid' : 'cpu';
  const ceiling = mode === 'gpu-resident' ? 16_384 : 8_192;
  const memoryTight = modelGiB > ramGiB * 0.55;
  const contextSize = Math.max(2_048, Math.min(input.requestedContextSize, memoryTight ? 4_096 : ceiling));
  const threads = resolveThreadCount(input);
  const args = ['-c', String(contextSize), '-t', String(threads), '-tb', String(threads)];

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
  if (input.cpuMoe && input.supportedFlags.has('--cpu-moe')) args.push('--cpu-moe');
  if (input.noMmap) args.push('--no-mmap');

  return {
    mode,
    contextSize,
    args,
    summary: `${mode}; model ${modelGiB.toFixed(1)} GiB, VRAM ${vramGiB.toFixed(1)} GiB, RAM ${ramGiB.toFixed(1)} GiB, context ${contextSize}, threads ${threads}`
  };
}

/**
 * llama-server's own default (-1) claims every logical core for both prompt
 * processing and generation, which is what pegs CPU and heats up the machine
 * on any local run regardless of model size -- Vectra never leaves this unset.
 *
 * 'auto' pins threads to the performance-core count on hybrid CPUs (Apple
 * Silicon): that's simultaneously the fastest option (E-cores are slow for
 * matmul-heavy inference and barely help) and the coolest one that still
 * gets full P-core throughput, since the E-cores stay free for the OS/editor.
 * On non-hybrid CPUs, where that split is unknown, it falls back to leaving
 * two logical cores free. 'performance'/'efficiency' are explicit, opt-in
 * trade-offs for machines this heuristic doesn't fit well.
 */
function resolveThreadCount(input: LlamaRuntimeProfileInput): number {
  if (input.cpuThreads && input.cpuThreads > 0) return input.cpuThreads;
  const { cpuCores, performanceCores } = input.hardware;
  switch (input.threadProfile) {
    case 'performance':
      return Math.max(1, cpuCores);
    case 'efficiency':
      return Math.max(1, Math.ceil((performanceCores ?? cpuCores) / 2));
    case 'auto':
    default:
      return Math.max(1, performanceCores ?? cpuCores - 2);
  }
}

export function parseLlamaServerFlags(help: string): Set<string> {
  return new Set(help.match(/--[a-z][a-z0-9-]*/gi) ?? []);
}

function add(args: string[], supported: ReadonlySet<string>, flag: string, value?: string): void {
  if (!supported.has(flag)) return;
  args.push(flag);
  if (value !== undefined) args.push(value);
}
