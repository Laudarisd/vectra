import * as os from 'node:os';
import { detectGpus, DetectedGpu } from './gpu';

export interface HardwareSnapshot {
  gpus: DetectedGpu[];
  /** max vramMiB across all detected GPUs; undefined if none reported a number (non-NVIDIA fallback). */
  maxVramMiB?: number;
  cpuCores: number;
  totalRamMiB: number;
  platform: NodeJS.Platform;
}

/** Combines existing GPU probing with new, cheap, synchronous CPU/RAM reads for hardware-aware model recommendations. */
export async function getHardwareSnapshot(): Promise<HardwareSnapshot> {
  const gpus = await detectGpus();
  const vramValues = gpus.map((gpu) => gpu.vramMiB).filter((value): value is number => typeof value === 'number');
  return {
    gpus,
    maxVramMiB: vramValues.length ? Math.max(...vramValues) : undefined,
    cpuCores: os.cpus().length,
    totalRamMiB: Math.round(os.totalmem() / 1024 / 1024),
    platform: process.platform
  };
}
