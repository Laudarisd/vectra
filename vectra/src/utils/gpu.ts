import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 60_000;

export interface DetectedGpu {
  name: string;
  vramMiB?: number;
}

let cache: { at: number; gpus: DetectedGpu[] } | undefined;

/**
 * Best-effort, dependency-free GPU inventory for the device-mode picker.
 * nvidia-smi gives authoritative name+VRAM for the common CUDA case; the
 * platform-native fallback only surfaces names (AMD/Apple/integrated) so the
 * UI can still say something useful even though llama.cpp/Ollama only offload
 * to CUDA devices today.
 */
export async function detectGpus(): Promise<DetectedGpu[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.gpus;
  const gpus = await detectViaNvidiaSmi() ?? await detectViaPlatform();
  cache = { at: Date.now(), gpus };
  return gpus;
}

async function detectViaNvidiaSmi(): Promise<DetectedGpu[] | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader'],
      { timeout: PROBE_TIMEOUT_MS }
    );
    const gpus = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, mem] = line.split(',').map((part) => part.trim());
        const vram = parseInt(mem, 10);
        return { name, vramMiB: Number.isFinite(vram) ? vram : undefined };
      });
    return gpus.length ? gpus : undefined;
  } catch {
    return undefined;
  }
}

async function detectViaPlatform(): Promise<DetectedGpu[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
        { timeout: PROBE_TIMEOUT_MS }
      );
      return namesToGpus(stdout.split(/\r?\n/));
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync(
        'system_profiler',
        ['SPDisplaysDataType'],
        { timeout: PROBE_TIMEOUT_MS }
      );
      const names = stdout
        .split(/\r?\n/)
        .map((line) => /^\s*Chipset Model:\s*(.+)$/.exec(line)?.[1])
        .filter((value): value is string => Boolean(value));
      return namesToGpus(names);
    }
    const { stdout } = await execFileAsync('lspci', [], { timeout: PROBE_TIMEOUT_MS });
    const names = stdout
      .split(/\r?\n/)
      .filter((line) => /VGA compatible controller|3D controller/i.test(line))
      .map((line) => line.replace(/^.*controller:\s*/i, '').trim());
    return namesToGpus(names);
  } catch {
    return [];
  }
}

function namesToGpus(lines: string[]): DetectedGpu[] {
  return lines.map((line) => line.trim()).filter(Boolean).map((name) => ({ name }));
}
