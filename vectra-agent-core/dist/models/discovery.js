"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCAL_RUNTIME_TARGETS = void 0;
exports.discoverGgufModels = discoverGgufModels;
exports.searchGgufModels = searchGgufModels;
exports.discoverOllamaModels = discoverOllamaModels;
exports.discoverLocalRuntimes = discoverLocalRuntimes;
exports.discoverOpenAICompatibleModels = discoverOpenAICompatibleModels;
exports.discoverInstalledModels = discoverInstalledModels;
exports.appModelDirectories = appModelDirectories;
exports.broadModelDirectories = broadModelDirectories;
exports.storageModelDirectories = storageModelDirectories;
exports.commonModelDirectories = commonModelDirectories;
exports.defaultModelRoots = defaultModelRoots;
exports.normalizeShardPath = normalizeShardPath;
exports.formatBytes = formatBytes;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_util_1 = require("node:util");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
exports.LOCAL_RUNTIME_TARGETS = [
    { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', discoveryUrl: 'http://127.0.0.1:11434/api/tags', format: 'ollama' },
    { name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
    { name: 'Jan', baseUrl: 'http://127.0.0.1:1337/v1' },
    { name: 'GPT4All', baseUrl: 'http://127.0.0.1:4891/v1' },
    { name: 'KoboldCpp', baseUrl: 'http://127.0.0.1:5001/v1' },
    { name: 'Text generation web UI', baseUrl: 'http://127.0.0.1:5000/v1' },
    { name: 'llama.cpp / LocalAI', baseUrl: 'http://127.0.0.1:8080/v1' },
    { name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1' },
    { name: 'Msty', baseUrl: 'http://127.0.0.1:10000/v1' }
];
const SKIPPED = new Set([
    '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', 'coverage',
    '$recycle.bin', 'system volume information', 'windows', 'recovery', 'program files', 'program files (x86)', 'appdata'
]);
async function discoverGgufModels(extraRoots = [], maxDirectories = 20_000, maxModels = 500, includeDefaults = true) {
    const paths = await findGgufPaths({ roots: extraRoots, limit: maxModels, maxDirectories, includeDefaults });
    const models = await Promise.all(paths.map(async (filePath) => {
        try {
            const size = (await node_fs_1.promises.stat(filePath)).size;
            return { kind: 'gguf', id: filePath, label: path.basename(filePath), detail: `${formatBytes(size)} · ${path.dirname(filePath)}`, size };
        }
        catch {
            return undefined;
        }
    }));
    return models.filter((item) => Boolean(item)).sort((a, b) => natural(a.label, b.label));
}
async function searchGgufModels(options = {}) {
    return findGgufPaths(options);
}
async function findGgufPaths({ query = '', roots = [], limit = 500, maxDirectories = 20_000, includeDefaults = true }) {
    const needle = query.trim().toLowerCase();
    const visited = new Set();
    const output = [];
    if (roots.length)
        await scan(roots, visited, output, needle, limit, maxDirectories);
    if (!includeDefaults)
        return finishGgufPaths(output, limit);
    const appBudget = Math.max(1, Math.floor(maxDirectories * 0.6));
    const personalBudget = Math.max(appBudget, Math.floor(maxDirectories * 0.8));
    await scan(appModelDirectories(), visited, output, needle, limit, appBudget);
    await scan(broadModelDirectories(), visited, output, needle, limit, personalBudget);
    await scan(storageModelDirectories(), visited, output, needle, limit, maxDirectories);
    return finishGgufPaths(output, limit);
}
async function scan(roots, visited, output, needle, limit, maxDirectories) {
    const queue = uniquePaths(roots).map((directory) => ({ directory, depth: 0 }));
    for (let cursor = 0; cursor < queue.length && visited.size < maxDirectories && output.length < limit; cursor++) {
        const current = queue[cursor];
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
            if (output.length >= limit)
                break;
            const full = path.join(current.directory, entry.name);
            let directory = entry.isDirectory();
            let file = entry.isFile();
            if (entry.isSymbolicLink()) {
                try {
                    const value = await node_fs_1.promises.stat(full);
                    directory = value.isDirectory();
                    file = value.isFile();
                }
                catch {
                    continue;
                }
            }
            if (directory && current.depth < 12 && !SKIPPED.has(entry.name.toLowerCase()))
                queue.push({ directory: full, depth: current.depth + 1 });
            else if (file && isSelectableGguf(entry.name) && (!needle || entry.name.toLowerCase().includes(needle)))
                output.push(full);
        }
    }
}
/** Finds Ollama models even when its server is stopped: API, CLI, and manifest index are merged. */
async function discoverOllamaModels(baseUrl = 'http://127.0.0.1:11434') {
    const [api, cli, manifests] = await Promise.all([ollamaApi(baseUrl), ollamaCli(), ollamaManifests()]);
    return dedupe([...api, ...cli, ...manifests], (item) => item.id.toLowerCase()).sort((a, b) => natural(a.label, b.label));
}
async function ollamaApi(baseUrl) {
    let url;
    try {
        url = new URL(baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, ''));
    }
    catch {
        return [];
    }
    if (!isLoopback(url.hostname))
        return [];
    const data = await timedJson(`${url}/api/tags`, {}, 1_800);
    return (data?.models ?? []).flatMap((item) => {
        const id = item.name || item.model;
        if (!id)
            return [];
        const detail = [item.details?.family, item.details?.parameter_size, item.details?.quantization_level, item.size ? formatBytes(item.size) : undefined].filter(Boolean).join(' · ');
        return [{ kind: 'ollama', id, label: id, detail: detail || 'Installed Ollama model', size: item.size }];
    });
}
async function ollamaCli() {
    try {
        const { stdout } = await execFileAsync(process.platform === 'win32' ? 'ollama.exe' : 'ollama', ['list'], { timeout: 3_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        return String(stdout).split(/\r?\n/).slice(1).flatMap((line) => {
            const id = line.trim().split(/\s+/)[0];
            return id ? [{ kind: 'ollama', id, label: id, detail: 'Installed Ollama model · detected by CLI' }] : [];
        });
    }
    catch {
        return [];
    }
}
async function ollamaManifests() {
    const roots = uniquePaths([
        process.env.OLLAMA_MODELS ? path.join(process.env.OLLAMA_MODELS, 'manifests') : '',
        path.join(os.homedir(), '.ollama', 'models', 'manifests')
    ]);
    const files = [];
    for (const root of roots)
        await collectFiles(root, root, files, 0, 8);
    return Promise.all(files.map(async (file) => {
        const relative = path.relative(path.dirname(path.dirname(path.dirname(file))), file).split(path.sep);
        if (relative.length < 3)
            return undefined;
        const model = relative.at(-2);
        const tag = relative.at(-1);
        let size;
        try {
            const manifest = JSON.parse(await node_fs_1.promises.readFile(file, 'utf8'));
            size = manifest.layers?.reduce((sum, layer) => sum + (layer.size ?? 0), 0);
        }
        catch { /* The path still identifies the installed model. */ }
        const id = `${model}:${tag}`;
        return { kind: 'ollama', id, label: id, detail: `Installed Ollama model · manifest${size ? ` · ${formatBytes(size)}` : ''}`, size };
    })).then((items) => items.filter((item) => Boolean(item)));
}
async function collectFiles(root, directory, output, depth, maxDepth) {
    if (depth > maxDepth)
        return;
    let entries;
    try {
        entries = await node_fs_1.promises.readdir(directory, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory())
            await collectFiles(root, full, output, depth + 1, maxDepth);
        else if (entry.isFile())
            output.push(full);
    }
}
async function discoverLocalRuntimes(extra = []) {
    const targets = dedupe([...exports.LOCAL_RUNTIME_TARGETS, ...extra].map((item) => ({ ...item, discoveryUrl: item.discoveryUrl ?? `${item.baseUrl.replace(/\/+$/, '')}/models` })), (item) => item.discoveryUrl);
    const found = await Promise.all(targets.map(async (runtime) => {
        const data = await timedJson(runtime.discoveryUrl, runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {}, 1_800);
        const models = runtime.format === 'ollama'
            ? (data?.models ?? []).map((item) => item.name || item.model).filter((item) => Boolean(item))
            : (data?.data ?? []).map((item) => item.id).filter((item) => Boolean(item));
        return models.length ? { name: runtime.name, baseUrl: runtime.baseUrl, models: [...new Set(models)].sort(natural) } : undefined;
    }));
    return found.filter((item) => Boolean(item));
}
async function discoverOpenAICompatibleModels(extra = []) {
    const runtimes = await discoverLocalRuntimes(extra);
    return runtimes.filter((runtime) => runtime.name !== 'Ollama').flatMap((runtime) => runtime.models.map((id) => ({
        kind: 'runtime', id, label: id, detail: `${runtime.name} · ${runtime.baseUrl}`, baseUrl: runtime.baseUrl
    }))).sort((a, b) => natural(a.label, b.label));
}
/** One shared detection pass for both Vectra hosts. This includes offline GGUF
 * files, Ollama's API/CLI/on-disk manifests, and running local API servers. */
async function discoverInstalledModels(options = {}) {
    const [gguf, ollama, runtimes] = await Promise.all([
        discoverGgufModels(options.extraRoots, options.maxDirectories, options.maxModels),
        discoverOllamaModels(options.ollamaBaseUrl),
        discoverLocalRuntimes(options.runtimeTargets)
    ]);
    const runtimeModels = runtimes
        .filter((runtime) => runtime.name !== 'Ollama')
        .flatMap((runtime) => runtime.models.map((id) => ({
        kind: 'runtime',
        id,
        label: id,
        detail: `${runtime.name} · ${runtime.baseUrl}`,
        baseUrl: runtime.baseUrl
    })))
        .sort((a, b) => natural(a.label, b.label));
    return { gguf, ollama, runtimes, runtimeModels };
}
function appModelDirectories() {
    const home = os.homedir();
    const envRoots = ['HF_HOME', 'HUGGINGFACE_HUB_CACHE', 'LLAMA_MODELS', 'MODELS_DIR', 'GPT4ALL_MODEL_PATH'].map((name) => process.env[name] || '');
    return uniquePaths([
        path.join(home, '.vectra', 'models'), path.join(home, 'Models'), path.join(home, 'models'),
        path.join(home, '.cache', 'huggingface', 'hub'), process.env.HF_HOME ? path.join(process.env.HF_HOME, 'hub') : '',
        path.join(home, '.cache', 'lm-studio', 'models'), path.join(home, '.lmstudio', 'models'),
        path.join(home, '.cache', 'gpt4all'), path.join(home, 'gpt4all'), path.join(home, 'text-generation-webui', 'models'),
        path.join(home, 'koboldcpp', 'models'), path.join(home, 'llama.cpp', 'models'),
        path.join(home, '.local', 'share', 'Jan', 'models'), path.join(home, '.local', 'share', 'nomic.ai', 'GPT4All'),
        path.join(home, '.msty', 'models'),
        path.join(home, 'Library', 'Application Support', 'LM Studio', 'models'),
        path.join(home, 'Library', 'Application Support', 'Jan', 'data', 'models'),
        path.join(home, 'Library', 'Application Support', 'nomic.ai', 'GPT4All'),
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'LM Studio', 'models') : '',
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'nomic.ai', 'GPT4All') : '',
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Jan', 'data', 'models') : '',
        process.env.APPDATA ? path.join(process.env.APPDATA, 'jan', 'models') : '',
        process.env.APPDATA ? path.join(process.env.APPDATA, 'Jan', 'data', 'models') : '',
        process.env.APPDATA ? path.join(process.env.APPDATA, 'GPT4All') : '',
        process.env.PROGRAMDATA ? path.join(process.env.PROGRAMDATA, 'GPT4All', 'models') : '',
        process.env.XDG_CACHE_HOME ? path.join(process.env.XDG_CACHE_HOME, 'huggingface', 'hub') : '',
        process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'jan', 'models') : '',
        ...envRoots
    ]);
}
function broadModelDirectories() { const home = os.homedir(); return [path.join(home, 'Downloads'), path.join(home, 'Documents'), path.join(home, 'Desktop')]; }
/** Last-pass roots cover arbitrary folders and secondary drives without making OS directories the priority. */
function storageModelDirectories() {
    const home = os.homedir();
    if (process.platform === 'win32')
        return uniquePaths([home, ...'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`)]);
    return uniquePaths([home, ...(process.platform === 'darwin' ? ['/Volumes'] : ['/mnt', '/media'])]);
}
function commonModelDirectories() { return [...appModelDirectories(), ...broadModelDirectories(), ...storageModelDirectories()]; }
function defaultModelRoots() { return commonModelDirectories(); }
function normalizeShardPath(filePath) { const match = filePath.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i); return match ? `${match[1]}-00001-of-${match[3]}.gguf` : filePath; }
function formatBytes(bytes) { const gib = bytes / 1024 ** 3; return gib >= 0.1 ? `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB` : `${(bytes / 1024 ** 2).toFixed(0)} MiB`; }
async function timedJson(url, headers, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { signal: controller.signal, headers });
        return response.ok ? await response.json() : undefined;
    }
    catch {
        return undefined;
    }
    finally {
        clearTimeout(timer);
    }
}
function isLoopback(host) { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host); }
function isSelectableGguf(name) { if (!/\.gguf$/i.test(name) || /^mmproj/i.test(name))
    return false; const shard = name.match(/-(\d{5})-of-\d{5}\.gguf$/i); return !shard || shard[1] === '00001'; }
function finishGgufPaths(values, limit) { return [...new Set(values.map(normalizeShardPath))].sort((a, b) => natural(path.basename(a), path.basename(b))).slice(0, limit); }
function uniquePaths(values) { return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))]; }
function dedupe(values, key) { const seen = new Set(); return values.filter((item) => { const value = key(item); return seen.has(value) ? false : Boolean(seen.add(value)); }); }
function natural(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }
//# sourceMappingURL=discovery.js.map