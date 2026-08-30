import * as os from 'node:os';
import { detectGpus, DetectedGpu } from './gpu';
import { detectCpuTopology } from './cpuTopology';

export interface HardwareSnapshot {
  gpus: DetectedGpu[];
  /** max vramMiB across all detected GPUs; undefined if none reported a number (non-NVIDIA fallback). */
  maxVramMiB?: number;
  cpuCores: number;
  /** Performance-core count on hybrid CPUs (Apple Silicon); undefined when the split is unknown. */
  performanceCores?: number;
  efficiencyCores?: number;
  totalRamMiB: number;
  platform: NodeJS.Platform;
}

/** Combines existing GPU probing with new, cheap, synchronous CPU/RAM reads for hardware-aware model recommendations. */
export async function getHardwareSnapshot(): Promise<HardwareSnapshot> {
  const [gpus, topology] = await Promise.all([detectGpus(), detectCpuTopology()]);
  const vramValues = gpus.map((gpu) => gpu.vramMiB).filter((value): value is number => typeof value === 'number');
  return {
    gpus,
    maxVramMiB: vramValues.length ? Math.max(...vramValues) : undefined,
    cpuCores: os.cpus().length,
    performanceCores: topology.performanceCores,
    efficiencyCores: topology.efficiencyCores,
    totalRamMiB: Math.round(os.totalmem() / 1024 / 1024),
    platform: process.platform
  };
}
