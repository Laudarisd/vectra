"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverGgufModels = discoverGgufModels;
exports.discoverOllamaModels = discoverOllamaModels;
exports.commonModelDirectories = commonModelDirectories;
exports.normalizeShardPath = normalizeShardPath;
const node_fs_1 = require("node:fs");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const SKIPPED_DIRECTORIES = new Set([
    '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.venv', 'venv',
    '__pycache__', 'coverage', 'AppData', 'Library'
]);
/**
 * Search common model locations without crawling the entire computer.
 * Directory and result caps keep detection responsive on very large homes.
 */
async function discoverGgufModels(extraRoots = [], maxDirectories = 4_000, maxModels = 80) {
    const roots = uniqueExistingCandidates([...extraRoots, ...commonModelDirectories()]);
    const queue = roots.map((directory) => ({ directory, depth: 0 }));
    const visited = new Set();
    const models = [];
    while (queue.length && visited.size < maxDirectories && models.length < maxModels) {
        const current = queue.shift();
        const key = path.resolve(current.directory).toLowerCase();
        if (visited.has(key))
            continue;
        visited.add(key);
        let entries;
        try {
            entries = await node_fs_1.promises.readdir(current.directory, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (models.length >= maxModels)
                break;
            const fullPath = path.join(current.directory, entry.name);
            if (entry.isDirectory()) {
                if (current.depth < 6 && !SKIPPED_DIRECTORIES.has(entry.name)) {
                    queue.push({ directory: fullPath, depth: current.depth + 1 });
                }
                continue;
            }
            if (!entry.isFile() || !isSelectableGguf(entry.name))
                continue;
            try {
                const stat = await node_fs_1.promises.stat(fullPath);
                models.push({
                    kind: 'gguf',
                    id: normalizeShardPath(fullPath),
                    label: path.basename(normalizeShardPath(fullPath)),
                    detail: `${formatBytes(stat.size)} · ${path.dirname(fullPath)}`,
                    size: stat.size
                });
            }
            catch {
                // A model may disappear while detection is running; skip it safely.
            }
        }
    }
    return deduplicate(models, (model) => model.id.toLowerCase())
        .sort((left, right) => left.label.localeCompare(right.label));
}
/** Detect models exposed by a locally running Ollama installation. */
async function discoverOllamaModels(baseUrl) {
    let endpoint;
    try {
        endpoint = new URL(baseUrl);
    }
    catch {
        return [];
    }
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(endpoint.hostname))
        return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_800);
    try {
        const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: controller.signal });
        if (!response.ok)
            return [];
        const data = await response.json();
        return (data.models ?? []).flatMap((model) => {
            if (!model.name)
                return [];
            const details = [
                model.details?.family,
                model.details?.parameter_size,
                model.details?.quantization_level,
                model.size ? formatBytes(model.size) : undefined
            ].filter(Boolean).join(' · ');
            return [{
                    kind: 'ollama',
                    id: model.name,
                    label: model.name,
                    detail: details || 'Installed Ollama model',
                    size: model.size
                }];
        }).sort((left, right) => left.label.localeCompare(right.label));
    }
    catch {
        return [];
    }
    finally {
        clearTimeout(timer);
    }
}
function commonModelDirectories() {
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || '';
    const appData = process.env.APPDATA || '';
    return [
        path.join(home, 'models'),
        path.join(home, 'Models'),
        path.join(home, 'Downloads'),
        path.join(home, '.cache', 'huggingface', 'hub'),
        path.join(home, '.cache', 'lm-studio', 'models'),
        path.join(home, '.lmstudio', 'models'),
        path.join(home, '.ollama', 'models'),
        localAppData && path.join(localAppData, 'LM Studio', 'models'),
        localAppData && path.join(localAppData, 'nomic.ai', 'GPT4All'),
        appData && path.join(appData, 'jan', 'models')
    ].filter(Boolean);
}
function normalizeShardPath(filePath) {
    const match = filePath.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
    return match ? `${match[1]}-00001-of-${match[3]}.gguf` : filePath;
}
function isSelectableGguf(fileName) {
    if (!fileName.toLowerCase().endsWith('.gguf'))
        return false;
    if (/^mmproj.*\.gguf$/i.test(fileName))
        return false;
    const shard = fileName.match(/-(\d{5})-of-\d{5}\.gguf$/i);
    return !shard || shard[1] === '00001';
}
function uniqueExistingCandidates(values) {
    return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}
function deduplicate(values, key) {
    const seen = new Set();
    return values.filter((value) => {
        const id = key(value);
        if (seen.has(id))
            return false;
        seen.add(id);
        return true;
    });
}
function formatBytes(bytes) {
    const gib = bytes / 1024 / 1024 / 1024;
    if (gib >= 0.1)
        return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
    return `${(bytes / 1024 / 1024).toFixed(0)} MiB`;
}
//# sourceMappingURL=LocalModelDiscovery.js.map