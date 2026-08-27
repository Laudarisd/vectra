/** Shared local-model discovery; kept as a compatibility import for extension services and tests. */
export {
  appModelDirectories,
  broadModelDirectories,
  commonModelDirectories,
  discoverGgufModels,
  discoverInstalledModels,
  discoverOllamaModels,
  discoverOpenAICompatibleModels,
  formatBytes,
  normalizeShardPath
} from '../../generated/agent-core';
export type {
  DiscoveredGgufModel,
  DiscoveredLocalModel,
  DiscoveredOllamaModel,
  DiscoveredRuntimeModel,
  InstalledModelInventory
} from '../../generated/agent-core';
