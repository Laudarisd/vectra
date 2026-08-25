const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveBudgetMiB, recommendCatalogEntries, recommendCatalogTiers } = require('../dist/services/ModelRecommender.js');

const CATALOG = [
  { id: 'small', label: 'Small', family: 'llama', paramCount: 1, quant: 'Q4_K_M', kind: 'llm', sizeBytes: 1, minVramMiB: 1024, minRamMiB: 1536 },
  { id: 'mid', label: 'Mid', family: 'qwen', paramCount: 7, quant: 'Q4_K_M', kind: 'llm', sizeBytes: 1, minVramMiB: 5632, minRamMiB: 7168 },
  { id: 'large', label: 'Large', family: 'qwen', paramCount: 32, quant: 'Q4_K_M', kind: 'llm', sizeBytes: 1, minVramMiB: 21504, minRamMiB: 24576 },
  { id: 'vision', label: 'Vision', family: 'qwen', paramCount: 3, quant: 'Q4_K_M', kind: 'vlm', sizeBytes: 1, minVramMiB: 4096, minRamMiB: 5632 }
];

test('effectiveBudgetMiB prefers VRAM when a GPU reported it', () => {
  const budget = effectiveBudgetMiB({ gpus: [], maxVramMiB: 8192, cpuCores: 8, totalRamMiB: 32768, platform: 'linux' });
  assert.deepEqual(budget, { mib: 8192, source: 'vram' });
});

test('effectiveBudgetMiB falls back to a conservative fraction of RAM without a sized GPU', () => {
  const budget = effectiveBudgetMiB({ gpus: [], maxVramMiB: undefined, cpuCores: 8, totalRamMiB: 32768, platform: 'linux' });
  assert.deepEqual(budget, { mib: 16384, source: 'ram' });
});

test('recommendCatalogEntries filters by budget and sorts biggest-fits-first', () => {
  const hw = { gpus: [], maxVramMiB: 8000, cpuCores: 8, totalRamMiB: 16384, platform: 'linux' };
  const result = recommendCatalogEntries(hw, CATALOG);
  // "large" (21504 MiB) does not fit an 8000 MiB budget; "mid" (5632) and
  // "small" (1024) and "vision" (4096) do, biggest first.
  assert.deepEqual(result.map((e) => e.id), ['mid', 'vision', 'small']);
});

test('recommendCatalogEntries returns an empty list when nothing fits', () => {
  const hw = { gpus: [], maxVramMiB: 512, cpuCores: 2, totalRamMiB: 2048, platform: 'linux' };
  const result = recommendCatalogEntries(hw, CATALOG);
  assert.deepEqual(result, []);
});

test('recommendCatalogEntries respects the limit parameter', () => {
  const hw = { gpus: [], maxVramMiB: 40000, cpuCores: 16, totalRamMiB: 65536, platform: 'linux' };
  const result = recommendCatalogEntries(hw, CATALOG, 2);
  assert.equal(result.length, 2);
});

test('recommendCatalogTiers offers a larger RAM-backed model separately', () => {
  const hw = { gpus: [{}], maxVramMiB: 8000, cpuCores: 16, totalRamMiB: 65536, platform: 'linux' };
  const tiers = recommendCatalogTiers(hw, CATALOG);
  assert.ok(tiers.fast.some((entry) => entry.id === 'mid'));
  assert.ok(tiers.hybrid.some((entry) => entry.id === 'large'));
});
