/** Shared local-model discovery; kept as a compatibility import for extension services and tests. */
export {
  appModelDirectories,
  broadModelDirectories,
  commonModelDirectories,
  DEFAULT_MAX_DIRECTORIES,
  discoverGgufModels,
  discoverInstalledModels,
  discoverOllamaModels,
  discoverOpenAICompatibleModels,
  FIRST_RUN_TIME_BUDGET_MS,
  formatBytes,
  FULL_SCAN_MAX_DIRECTORIES,
  FULL_SCAN_TIME_BUDGET_MS,
  normalizeShardPath,
  PER_DIR_TIMEOUT_MS,
  SCOPED_TIME_BUDGET_MS,
  searchGgufModels,
  storageModelDirectories
} from '../core';
export type {
  DiscoveredGgufModel,
  DiscoveredLocalModel,
  DiscoveredOllamaModel,
  DiscoveredRuntimeModel,
  GgufScanOptions,
  InstalledModelInventory
} from '../core';
