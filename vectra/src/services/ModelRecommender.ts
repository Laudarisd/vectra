import { HardwareSnapshot } from '../utils/hardware';
import { CatalogEntry } from './ModelCatalog';

/**
 * A GPU with known VRAM sizes the recommendation directly (llama.cpp offloads
 * to it). Without one (no GPU, or a non-NVIDIA GPU the platform fallback
 * couldn't size), fall back to a conservative slice of system RAM for CPU
 * inference — the OS, VS Code, and everything else running still need room.
 */
const CPU_RAM_FRACTION = 0.5;

export function effectiveBudgetMiB(hw: HardwareSnapshot): { mib: number; source: 'vram' | 'ram' } {
  if (hw.maxVramMiB) return { mib: hw.maxVramMiB, source: 'vram' };
  return { mib: Math.floor(hw.totalRamMiB * CPU_RAM_FRACTION), source: 'ram' };
}

/**
 * Filters the catalog to entries that plausibly fit, then sorts the biggest
 * (best-quality) model that still fits to the front — same "show the best
 * option first" convention LocalLlamaCppService's detection picker already uses.
 */
export function recommendCatalogEntries(hw: HardwareSnapshot, catalog: CatalogEntry[], limit = 6): CatalogEntry[] {
  const budget = effectiveBudgetMiB(hw);
  const fits = catalog.filter((entry) => {
    const requirement = budget.source === 'vram' ? entry.minVramMiB : entry.minRamMiB;
    return requirement <= budget.mib;
  });
  return fits
    .sort((left, right) => right.paramCount - left.paramCount)
    .slice(0, limit);
}
