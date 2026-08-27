import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let core;
try { core = require('../../../vectra-agent-core'); }
catch { core = require('../../../agent-core'); }

export const discoverLocalRuntimes = core.discoverLocalRuntimes;
export const discoverInstalledModels = core.discoverInstalledModels;
export const searchGgufModels = core.searchGgufModels;
export const appModelRoots = core.appModelDirectories;
export const broadModelRoots = core.broadModelDirectories;
export const defaultModelRoots = core.defaultModelRoots;
