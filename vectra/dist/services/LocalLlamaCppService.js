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
exports.LocalLlamaCppService = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_util_1 = require("node:util");
const vscode = __importStar(require("vscode"));
const OpenAICompatibleProvider_1 = require("../providers/OpenAICompatibleProvider");
const config_1 = require("../utils/config");
const LocalModelDiscovery_1 = require("./LocalModelDiscovery");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
/** Owns local model selection and the llama.cpp child-process lifecycle. */
class LocalLlamaCppService {
    process;
    output = vscode.window.createOutputChannel('Vectra · llama.cpp');
    currentModelPath = '';
    currentMmprojPath = '';
    lastArgsKey = '';
    get isRunning() { return Boolean(this.process && !this.process.killed); }
    get baseUrl() { return `http://127.0.0.1:${(0, config_1.getConfig)().llamaCppPort}/v1`; }
    get modelPath() { return this.currentModelPath || (0, config_1.getConfig)().localModelPath; }
    get mmprojPath() { return this.currentMmprojPath || (0, config_1.getConfig)().llamaCppMmprojPath; }
    get visionEnabled() { return Boolean(this.mmprojPath); }
    /**
     * Present the two user-facing local workflows: manually search/select a GGUF
     * file, or detect installed GGUF and Ollama models automatically.
     */
    async chooseLocalModel() {
        const choice = await vscode.window.showQuickPick([
            {
                id: 'browse',
                label: '$(search) Search or choose a GGUF model',
                description: 'Browse your computer for a llama.cpp-compatible model file'
            },
            {
                id: 'detect',
                label: '$(sparkle) Detect installed local models',
                description: 'Find common GGUF locations and models from a running Ollama installation'
            }
        ], {
            title: 'Vectra: Local Model',
            placeHolder: 'Choose how Vectra should find your local model'
        });
        if (!choice)
            return undefined;
        return choice.id === 'browse' ? this.selectAndStartModel() : this.detectAndSelectModel();
    }
    /** Use VS Code's native searchable file dialog to select a GGUF model. */
    async selectAndStartModel() {
        const config = (0, config_1.getConfig)();
        let defaultUri;
        const candidate = config.localModelDirectory || path.dirname(config.localModelPath || '') || os.homedir();
        if (candidate && candidate !== '.') {
            try {
                await node_fs_1.promises.access(candidate);
                defaultUri = vscode.Uri.file(candidate);
            }
            catch {
                // Let VS Code choose the platform default location.
            }
        }
        const picked = await vscode.window.showOpenDialog({
            title: 'Vectra: Search or select local GGUF model',
            defaultUri,
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'GGUF models': ['gguf'] },
            openLabel: 'Load this model'
        });
        if (!picked?.[0])
            return undefined;
        return this.loadModelWithProgress(picked[0].fsPath);
    }
    /** Scan bounded common folders and query a local Ollama server. */
    async detectAndSelectModel() {
        const config = (0, config_1.getConfig)();
        const extraRoots = [
            config.localModelDirectory,
            config.localModelPath ? path.dirname(config.localModelPath) : ''
        ].filter(Boolean);
        const [ggufModels, ollamaModels] = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Vectra: detecting installed local models…'
        }, () => Promise.all([
            (0, LocalModelDiscovery_1.discoverGgufModels)(extraRoots),
            (0, LocalModelDiscovery_1.discoverOllamaModels)(config.ollamaBaseUrl)
        ]));
        const detected = [
            ...ggufModels.map((model) => ({
                label: `$(file-binary) ${model.label}`,
                description: 'GGUF · llama.cpp',
                detail: model.detail,
                model
            })),
            ...ollamaModels.map((model) => ({
                label: `$(server-process) ${model.label}`,
                description: 'Ollama',
                detail: model.detail,
                model
            }))
        ];
        if (!detected.length) {
            const fallback = await vscode.window.showWarningMessage('Vectra did not find a GGUF file in common model folders or a running local Ollama model.', 'Search manually');
            return fallback === 'Search manually' ? this.selectAndStartModel() : undefined;
        }
        const picked = await vscode.window.showQuickPick(detected, {
            title: `Vectra: ${detected.length} local model${detected.length === 1 ? '' : 's'} detected`,
            placeHolder: 'Type to search detected local models',
            matchOnDescription: true,
            matchOnDetail: true
        });
        if (!picked)
            return undefined;
        if (picked.model.kind === 'ollama') {
            await this.stop();
            await (0, config_1.updateProvider)('ollama');
            await (0, config_1.updateModel)(picked.model.id);
            return picked.model.id;
        }
        return this.loadModelWithProgress(picked.model.id);
    }
    async loadModelWithProgress(modelPath) {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Vectra: loading ${path.basename(modelPath)}…`
        }, () => this.configureAndStartModel(modelPath));
    }
    async configureAndStartModel(selectedPath) {
        const config = (0, config_1.getConfig)();
        const modelPath = (0, LocalModelDiscovery_1.normalizeShardPath)(selectedPath);
        if (!modelPath.toLowerCase().endsWith('.gguf')) {
            throw new Error('Vectra local llama.cpp models must be GGUF files.');
        }
        await node_fs_1.promises.access(modelPath);
        const previousModel = config.localModelPath;
        await (0, config_1.updateLocalModel)(modelPath);
        const detectedProjector = await this.detectMmproj(modelPath);
        if (previousModel !== modelPath)
            await (0, config_1.updateLlamaMmprojPath)(detectedProjector ?? '');
        else if (detectedProjector && !(0, config_1.getConfig)().llamaCppMmprojPath) {
            await (0, config_1.updateLlamaMmprojPath)(detectedProjector);
        }
        await this.start(modelPath);
        await (0, config_1.updateProvider)('llamaCpp');
        const provider = new OpenAICompatibleProvider_1.OpenAICompatibleProvider(this.baseUrl);
        let modelId = path.basename(modelPath);
        try {
            const models = await provider.listModels();
            modelId = models[0]?.id || modelId;
        }
        catch {
            // A single-model llama.cpp server may not expose model metadata.
        }
        await (0, config_1.updateModel)(modelId);
        return modelId;
    }
    async selectMmproj() {
        const config = (0, config_1.getConfig)();
        const modelDirectory = config.localModelPath ? path.dirname(config.localModelPath) : os.homedir();
        const picked = await vscode.window.showOpenDialog({
            title: 'Vectra: Select multimodal projector (mmproj GGUF)',
            defaultUri: vscode.Uri.file(modelDirectory),
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'GGUF projector': ['gguf'] },
            openLabel: 'Use projector'
        });
        if (!picked?.[0])
            return undefined;
        await (0, config_1.updateLlamaMmprojPath)(picked[0].fsPath);
        return picked[0].fsPath;
    }
    async startConfiguredModel() {
        const modelPath = (0, config_1.getConfig)().localModelPath;
        if (!modelPath)
            return false;
        try {
            await node_fs_1.promises.access(modelPath);
        }
        catch {
            return false;
        }
        await this.start(modelPath);
        return true;
    }
    async start(modelPath) {
        const executable = await this.resolveServerExecutable();
        const config = (0, config_1.getConfig)();
        const normalized = (0, LocalModelDiscovery_1.normalizeShardPath)(modelPath);
        const mmproj = await this.resolveMmproj(normalized);
        // Forcing CPU overrides whatever GPU layer count is configured; auto/gpu
        // keep the configured value, which is what already gives multi-GPU
        // placement for free (llama.cpp's layer split mode spreads offloaded
        // layers across every visible CUDA device on its own).
        const gpuLayers = config.deviceMode === 'cpu' ? '0' : config.llamaCppGpuLayers;
        const args = [
            '-m', normalized,
            '--host', '127.0.0.1',
            '--port', String(config.llamaCppPort),
            '-c', String(config.llamaCppContextSize),
            '--fit', 'on',
            '--gpu-layers', gpuLayers,
            '--split-mode', config.llamaCppSplitMode
        ];
        if (config.llamaCppCpuMoe)
            args.push('--cpu-moe');
        if (config.llamaCppNoMmap)
            args.push('--no-mmap');
        if (mmproj)
            args.push('--mmproj', mmproj);
        if (config.llamaCppExtraArgs.length)
            args.push(...config.llamaCppExtraArgs);
        // A model already running with the same executable/args is left alone
        // instead of being stopped and reloaded from disk for no reason.
        const argsKey = JSON.stringify({ executable, args });
        if (this.isRunning && argsKey === this.lastArgsKey) {
            this.output.appendLine('[Vectra] Reusing the already-running local model (unchanged settings).');
            return;
        }
        await this.stop();
        this.output.show(true);
        this.output.appendLine('[Vectra] Starting llama.cpp');
        this.output.appendLine(`[Vectra] Server: ${executable}`);
        this.output.appendLine(`[Vectra] Model: ${normalized}`);
        if (mmproj)
            this.output.appendLine(`[Vectra] Vision projector: ${mmproj}`);
        this.output.appendLine(`[Vectra] Endpoint: ${this.baseUrl}`);
        this.output.appendLine(`[Vectra] Args: ${args.map(shellQuote).join(' ')}`);
        const child = (0, node_child_process_1.spawn)(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        this.process = child;
        this.currentModelPath = normalized;
        this.currentMmprojPath = mmproj || '';
        this.lastArgsKey = argsKey;
        child.stdout?.on('data', (data) => this.output.append(data.toString()));
        child.stderr?.on('data', (data) => this.output.append(data.toString()));
        child.on('exit', (code, signal) => {
            this.output.appendLine(`\n[Vectra] llama-server exited (${code ?? 'no code'}${signal ? `, ${signal}` : ''}).`);
            if (this.process === child)
                this.process = undefined;
        });
        await this.waitUntilHealthy(child, config.llamaCppLoadTimeoutSeconds * 1000);
        this.output.appendLine(`[Vectra] Local model is ready${mmproj ? ' with multimodal vision' : ''}.`);
    }
    async stop() {
        const child = this.process;
        this.process = undefined;
        this.currentModelPath = '';
        this.currentMmprojPath = '';
        this.lastArgsKey = '';
        if (!child || child.killed)
            return;
        child.kill();
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                try {
                    child.kill('SIGKILL');
                }
                catch { /* Process already stopped. */ }
                resolve();
            }, 3_000);
            child.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
    async chooseServerExecutable() {
        const picked = await vscode.window.showOpenDialog({
            title: 'Vectra: Select llama-server executable',
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Use llama-server'
        });
        if (!picked?.[0])
            return undefined;
        await (0, config_1.updateLlamaServerPath)(picked[0].fsPath);
        return picked[0].fsPath;
    }
    dispose() {
        void this.stop();
        this.output.dispose();
    }
    async resolveMmproj(modelPath) {
        const config = (0, config_1.getConfig)();
        if (config.llamaCppMmprojPath) {
            try {
                await node_fs_1.promises.access(config.llamaCppMmprojPath);
                return config.llamaCppMmprojPath;
            }
            catch {
                // Fall back to automatic detection beside the selected model.
            }
        }
        const detected = await this.detectMmproj(modelPath);
        if (detected)
            await (0, config_1.updateLlamaMmprojPath)(detected);
        return detected;
    }
    async detectMmproj(modelPath) {
        try {
            const directory = path.dirname(modelPath);
            const names = await node_fs_1.promises.readdir(directory);
            const candidates = names
                .filter((name) => /^mmproj.*\.gguf$/i.test(name))
                .sort((left, right) => scoreMmproj(right) - scoreMmproj(left));
            return candidates[0] ? path.join(directory, candidates[0]) : undefined;
        }
        catch {
            return undefined;
        }
    }
    async resolveServerExecutable() {
        const configured = (0, config_1.getConfig)().llamaCppServerPath;
        if (configured) {
            if (path.isAbsolute(configured)) {
                try {
                    await node_fs_1.promises.access(configured);
                    return configured;
                }
                catch {
                    // Continue with PATH and common-location detection.
                }
            }
            else if (await commandExists(configured)) {
                return configured;
            }
        }
        const command = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
        if (await commandExists(command))
            return command;
        const common = process.platform === 'darwin'
            ? ['/opt/homebrew/bin/llama-server', '/usr/local/bin/llama-server']
            : process.platform === 'win32'
                ? [
                    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'llama.cpp', 'llama-server.exe'),
                    path.join(os.homedir(), 'llama.cpp', 'build', 'bin', 'Release', 'llama-server.exe')
                ]
                : [
                    '/usr/local/bin/llama-server',
                    '/usr/bin/llama-server',
                    path.join(os.homedir(), '.local', 'bin', 'llama-server')
                ];
        for (const candidate of common) {
            if (!candidate)
                continue;
            try {
                await node_fs_1.promises.access(candidate);
                await (0, config_1.updateLlamaServerPath)(candidate);
                return candidate;
            }
            catch {
                // Try the next platform-specific location.
            }
        }
        const choice = await vscode.window.showWarningMessage('Vectra found your GGUF model, but llama-server could not be found.', 'Select llama-server', 'Open llama.cpp');
        if (choice === 'Open llama.cpp') {
            await vscode.env.openExternal(vscode.Uri.parse('https://github.com/ggml-org/llama.cpp'));
            throw new Error('Install llama.cpp, then select the local model again.');
        }
        if (choice === 'Select llama-server') {
            const selected = await this.chooseServerExecutable();
            if (selected)
                return selected;
        }
        throw new Error('llama-server executable is required to run local GGUF models.');
    }
    async waitUntilHealthy(child, timeout) {
        const healthUrl = `${this.baseUrl.replace(/\/v1$/, '')}/health`;
        const deadline = Date.now() + timeout;
        let lastError = '';
        while (Date.now() < deadline) {
            if (child.exitCode !== null || child.killed) {
                throw new Error('llama-server stopped before the model became ready. See “Vectra · llama.cpp” output.');
            }
            try {
                const response = await fetch(healthUrl);
                if (response.ok)
                    return;
                lastError = `HTTP ${response.status}`;
            }
            catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
            }
            await delay(750);
        }
        throw new Error(`Timed out waiting for llama-server. Large models may need a longer ` +
            `vectra.llamaCppLoadTimeoutSeconds. ${lastError}`.trim());
    }
}
exports.LocalLlamaCppService = LocalLlamaCppService;
function scoreMmproj(name) {
    return /f16/i.test(name) ? 3 : /bf16/i.test(name) ? 2 : /q8/i.test(name) ? 1 : 0;
}
async function commandExists(command) {
    try {
        if (process.platform === 'win32')
            await execFileAsync('where', [command]);
        else
            await execFileAsync('which', [command]);
        return true;
    }
    catch {
        return false;
    }
}
function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function shellQuote(value) {
    return /\s/.test(value) ? JSON.stringify(value) : value;
}
//# sourceMappingURL=LocalLlamaCppService.js.map