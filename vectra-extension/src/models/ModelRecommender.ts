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
 * option first" convention LlamaCppRuntime's detection picker already uses.
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

export interface CatalogRecommendations {
  fast: CatalogEntry[];
  hybrid: CatalogEntry[];
}

/** Offer larger partial-offload models without confusing them with the
 * latency-first, fully resident recommendation. */
export function recommendCatalogTiers(hw: HardwareSnapshot, catalog: CatalogEntry[], limitPerTier = 6): CatalogRecommendations {
  const fast = recommendCatalogEntries(hw, catalog, limitPerTier);
  if (!hw.maxVramMiB) return { fast, hybrid: [] };
  const fastIds = new Set(fast.map((entry) => entry.id));
  const ramBudget = Math.floor(hw.totalRamMiB * CPU_RAM_FRACTION);
  const hybrid = catalog
    .filter((entry) => !fastIds.has(entry.id) && entry.minRamMiB <= ramBudget)
    .sort((left, right) => right.paramCount - left.paramCount)
    .slice(0, limitPerTier);
  return { fast, hybrid };
}
