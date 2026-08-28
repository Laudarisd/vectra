import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../../core');

export const discoverLocalRuntimes = core.discoverLocalRuntimes;
export const discoverInstalledModels = core.discoverInstalledModels;
export const searchGgufModels = core.searchGgufModels;
export const appModelRoots = core.appModelDirectories;
export const broadModelRoots = core.broadModelDirectories;
export const storageModelRoots = core.storageModelDirectories;
export const defaultModelRoots = core.defaultModelRoots;
