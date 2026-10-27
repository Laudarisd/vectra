// Beginner guide: Handles c pu t op ol og y responsibilities for Vectra.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 60_000;

let cache;

/**
 * Best-effort detection of performance/efficiency core counts, used to keep
 * llama-server threads on the fast cores and off the ones the OS needs for
 * everything else. Only Apple Silicon exposes this cheaply via sysctl; other
 * platforms fall back to treating all logical cores as equivalent.
 */
export async function detectCpuTopology() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.topology;
  const topology = process.platform === 'darwin' ? await detectViaSysctl() : {};
  cache = { at: Date.now(), topology };
  return topology;
}

async function detectViaSysctl() {
  try {
    const { stdout } = await execFileAsync(
      'sysctl',
      ['-n', 'hw.perflevel0.physicalcpu', 'hw.perflevel1.physicalcpu'],
      { timeout: PROBE_TIMEOUT_MS }
    );
    const [performance, efficiency] = stdout.trim().split('\n').map((line) => parseInt(line.trim(), 10));
    if (!Number.isFinite(performance) || performance <= 0) return {};
    return { performanceCores: performance, efficiencyCores: Number.isFinite(efficiency) ? efficiency : undefined };
  } catch {
    // Intel Macs and older machines have no perflevel split -- sysctl exits non-zero.
    return {};
  }
}
