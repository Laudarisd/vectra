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
exports.findLatestAsset = findLatestAsset;
exports.installDirFor = installDirFor;
exports.installAsset = installAsset;
exports.installLatestLlamaCpp = installLatestLlamaCpp;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_util_1 = require("node:util");
const http_1 = require("../utils/http");
const ModelDownloader_1 = require("./ModelDownloader");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const RELEASES_URL = 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest';
const USER_AGENT = 'Mozilla/5.0 (compatible; Vectra/1.0; +https://github.com/Laudarisd/vectra)';
const API_TIMEOUT_MS = 15_000;
const VERIFY_TIMEOUT_MS = 10_000;
/**
 * Priority-ordered filename patterns for this OS/arch/GPU. llama.cpp release
 * asset names have drifted across versions, so each platform lists a few
 * plausible patterns and the first release asset matching any of them wins.
 * Only CPU and NVIDIA/CUDA builds are matched — the rest of Vectra's hardware
 * detection (utils/gpu.ts) only resolves CUDA VRAM authoritatively today, so
 * AMD/Intel GPU users still get a working CPU install rather than a guess.
 */
function candidatePatterns(hasCuda) {
    const arch = os.arch();
    if (process.platform === 'win32') {
        const cuda = [/^llama-.*-bin-win-cuda[\w.-]*-x64\.zip$/i];
        const cpu = [
            /^llama-.*-bin-win-cpu-x64\.zip$/i,
            /^llama-.*-bin-win-avx2-x64\.zip$/i,
            /^llama-.*-bin-win-x64\.zip$/i
        ];
        return hasCuda ? [...cuda, ...cpu] : cpu;
    }
    if (process.platform === 'darwin') {
        return arch === 'arm64'
            ? [/^llama-.*-bin-macos-arm64\.zip$/i]
            : [/^llama-.*-bin-macos-x64\.zip$/i];
    }
    // Linux prebuilts only cover glibc x64 (Ubuntu runner); other distros/arches
    // find nothing here and the caller falls back to a manual-install prompt.
    if (arch === 'x64') {
        const cuda = [/^llama-.*-bin-ubuntu-cuda[\w.-]*-x64\.zip$/i];
        const cpu = [/^llama-.*-bin-ubuntu-x64\.zip$/i];
        return hasCuda ? [...cuda, ...cpu] : cpu;
    }
    return [];
}
/** Fetches the latest llama.cpp release and picks the asset matching this OS/arch/GPU, or undefined if nothing matches. */
async function findLatestAsset(hasCuda, signal) {
    const release = await (0, http_1.fetchJson)(RELEASES_URL, { signal, headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } }, API_TIMEOUT_MS);
    const assets = release.assets ?? [];
    for (const pattern of candidatePatterns(hasCuda)) {
        const match = assets.find((asset) => asset.name && pattern.test(asset.name));
        if (match?.browser_download_url) {
            return { name: match.name, downloadUrl: match.browser_download_url, sizeBytes: match.size, version: release.tag_name ?? 'latest' };
        }
    }
    return undefined;
}
function installDirFor(version) {
    return path.join(os.homedir(), '.vectra', 'llama.cpp', version);
}
/**
 * Downloads the asset zip, extracts it with the platform's built-in tar
 * (bsdtar ships in System32 on Windows 10 1803+ and reads .zip; macOS/Linux
 * tar do too), locates llama-server inside, and makes it executable — no
 * third-party zip/unzip dependency needed.
 */
async function installAsset(asset, onProgress, signal) {
    const destDir = installDirFor(asset.version);
    await node_fs_1.promises.mkdir(destDir, { recursive: true });
    const zipPath = path.join(destDir, asset.name);
    await (0, ModelDownloader_1.downloadFile)(asset.downloadUrl, zipPath, { onProgress, signal });
    try {
        await execFileAsync('tar', ['-xf', zipPath, '-C', destDir], { maxBuffer: 32 * 1024 * 1024 });
    }
    finally {
        await node_fs_1.promises.rm(zipPath, { force: true }).catch(() => undefined);
    }
    const execPath = await findServerExecutable(destDir);
    if (!execPath)
        throw new Error(`Extracted ${asset.name} but could not find llama-server inside it.`);
    if (process.platform !== 'win32')
        await node_fs_1.promises.chmod(execPath, 0o755);
    return execPath;
}
async function findServerExecutable(rootDir) {
    const target = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    let queue = [rootDir];
    for (let depth = 0; depth < 6 && queue.length; depth++) {
        const next = [];
        for (const dir of queue) {
            let entries;
            try {
                entries = await node_fs_1.promises.readdir(dir, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isFile() && entry.name.toLowerCase() === target)
                    return full;
                if (entry.isDirectory())
                    next.push(full);
            }
        }
        queue = next;
    }
    return undefined;
}
/** Verify the extracted binary can actually launch on this computer. */
async function verifyExecutable(execPath) {
    try {
        await execFileAsync(execPath, ['--version'], { timeout: VERIFY_TIMEOUT_MS });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Install and verify the best llama.cpp build for this machine. If an NVIDIA
 * GPU was detected but its CUDA build cannot launch (for example because the
 * matching CUDA runtime is unavailable), install and verify the CPU build
 * instead. Nothing is installed globally; both builds stay under ~/.vectra.
 */
async function installLatestLlamaCpp(options) {
    const { hasCuda, onProgress, signal } = options;
    const asset = options.asset ?? await findLatestAsset(hasCuda, signal);
    if (!asset)
        throw new Error('No matching llama.cpp build was found for this platform.');
    const execPath = await installAsset(asset, onProgress, signal);
    if (await verifyExecutable(execPath)) {
        return { execPath, name: asset.name, version: asset.version, fellBackToCpu: false };
    }
    if (!hasCuda) {
        throw new Error(`Installed ${asset.name}, but llama-server could not run. It may require a system library that is unavailable on this computer.`);
    }
    const cpuAsset = await findLatestAsset(false, signal);
    if (!cpuAsset || cpuAsset.name === asset.name) {
        throw new Error(`The CUDA build (${asset.name}) could not run, and no separate CPU build was available.`);
    }
    const cpuExecPath = await installAsset(cpuAsset, onProgress, signal);
    if (!(await verifyExecutable(cpuExecPath))) {
        throw new Error(`Neither the CUDA build (${asset.name}) nor CPU build (${cpuAsset.name}) could run on this computer.`);
    }
    return { execPath: cpuExecPath, name: cpuAsset.name, version: cpuAsset.version, fellBackToCpu: true };
}
//# sourceMappingURL=LlamaCppInstaller.js.map