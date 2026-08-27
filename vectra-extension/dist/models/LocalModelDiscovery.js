"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeShardPath = exports.formatBytes = exports.discoverOpenAICompatibleModels = exports.discoverOllamaModels = exports.discoverInstalledModels = exports.discoverGgufModels = exports.commonModelDirectories = exports.broadModelDirectories = exports.appModelDirectories = void 0;
/** Shared local-model discovery; kept as a compatibility import for extension services and tests. */
var agent_core_1 = require("../../generated/agent-core");
Object.defineProperty(exports, "appModelDirectories", { enumerable: true, get: function () { return agent_core_1.appModelDirectories; } });
Object.defineProperty(exports, "broadModelDirectories", { enumerable: true, get: function () { return agent_core_1.broadModelDirectories; } });
Object.defineProperty(exports, "commonModelDirectories", { enumerable: true, get: function () { return agent_core_1.commonModelDirectories; } });
Object.defineProperty(exports, "discoverGgufModels", { enumerable: true, get: function () { return agent_core_1.discoverGgufModels; } });
Object.defineProperty(exports, "discoverInstalledModels", { enumerable: true, get: function () { return agent_core_1.discoverInstalledModels; } });
Object.defineProperty(exports, "discoverOllamaModels", { enumerable: true, get: function () { return agent_core_1.discoverOllamaModels; } });
Object.defineProperty(exports, "discoverOpenAICompatibleModels", { enumerable: true, get: function () { return agent_core_1.discoverOpenAICompatibleModels; } });
Object.defineProperty(exports, "formatBytes", { enumerable: true, get: function () { return agent_core_1.formatBytes; } });
Object.defineProperty(exports, "normalizeShardPath", { enumerable: true, get: function () { return agent_core_1.normalizeShardPath; } });
//# sourceMappingURL=LocalModelDiscovery.js.map