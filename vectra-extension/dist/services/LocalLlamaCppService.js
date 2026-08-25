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
const hardware_1 = require("../utils/hardware");
const gpu_1 = require("../utils/gpu");
const config_1 = require("../utils/config");
const HuggingFaceSearch_1 = require("./HuggingFaceSearch");
const LocalModelDiscovery_1 = require("./LocalModelDiscovery");
const LlamaCppInstaller_1 = require("./LlamaCppInstaller");
const ModelCatalog_1 = require("./ModelCatalog");
const ModelDownloader_1 = require("./ModelDownloader");
const ModelRecommender_1 = require("./ModelRecommender");
const LlamaRuntimeProfile_1 = require("./LlamaRuntimeProfile");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
/** Owns local model selection and the llama.cpp child-process lifecycle. */
class LocalLlamaCppService {
    process;
    output = vscode.window.createOutputChannel('Vectra · llama.cpp');
    currentModelPath = '';
    currentMmprojPath = '';
    lastArgsKey = '';
    capabilityCache = new Map();
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
        const [ggufModels, ollamaModels, runtimeModels] = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Vectra: detecting installed local models…'
        }, () => Promise.all([
            (0, LocalModelDiscovery_1.discoverGgufModels)(extraRoots),
            (0, LocalModelDiscovery_1.discoverOllamaModels)(config.ollamaBaseUrl),
            (0, LocalModelDiscovery_1.discoverOpenAICompatibleModels)()
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
            })),
            ...runtimeModels.map((model) => ({
                label: `$(server-process) ${model.label}`,
                description: model.detail.split(' · ')[0],
                detail: model.detail,
                model
            }))
        ];
        if (!detected.length) {
            const fallback = await vscode.window.showWarningMessage('Vectra did not find a GGUF file in common model folders or a running local Ollama model.', 'Choose folder to scan', 'Choose GGUF file');
            if (fallback === 'Choose folder to scan')
                return this.scanSelectedFolder();
            return fallback === 'Choose GGUF file' ? this.selectAndStartModel() : undefined;
        }
        detected.push({
            label: '$(folder-opened) Add another model folder…',
            description: 'Scan any folder on this computer recursively',
            action: 'scanFolder'
        });
        const picked = await vscode.window.showQuickPick(detected, {
            title: `Vectra: ${detected.length} local model${detected.length === 1 ? '' : 's'} detected`,
            placeHolder: 'Type to search detected local models',
            matchOnDescription: true,
            matchOnDetail: true
        });
        if (!picked)
            return undefined;
        if (picked.action === 'scanFolder')
            return this.scanSelectedFolder();
        if (!picked.model)
            return undefined;
        if (picked.model.kind === 'ollama') {
            await this.stop();
            await (0, config_1.updateProvider)('ollama');
            await (0, config_1.updateModel)(picked.model.id);
            return picked.model.id;
        }
        if (picked.model.kind === 'runtime') {
            await this.stop();
            await (0, config_1.updateOpenAICompatibleBaseUrl)(picked.model.baseUrl);
            await (0, config_1.updateProvider)('openaiCompatible');
            await (0, config_1.updateModel)(picked.model.id);
            return picked.model.id;
        }
        return this.loadModelWithProgress(picked.model.id);
    }
    async scanSelectedFolder() {
        const preferred = (0, config_1.getConfig)().localModelDirectory || os.homedir();
        const pickedFolder = await vscode.window.showOpenDialog({
            title: 'Vectra: Choose a folder containing local models',
            defaultUri: vscode.Uri.file(preferred),
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Scan this folder'
        });
        if (!pickedFolder?.[0])
            return undefined;
        const directory = pickedFolder[0].fsPath;
        await (0, config_1.updateLocalModelDirectory)(directory);
        const models = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Vectra: scanning ${directory}…` }, () => (0, LocalModelDiscovery_1.discoverGgufModels)([directory], 20_000, 500));
        if (!models.length) {
            void vscode.window.showInformationMessage('No selectable GGUF models were found in that folder.');
            return undefined;
        }
        const picked = await vscode.window.showQuickPick(models.map((model) => ({
            label: `$(file-binary) ${model.label}`,
            description: 'GGUF · llama.cpp',
            detail: model.detail,
            model
        })), {
            title: `Vectra: ${models.length} model${models.length === 1 ? '' : 's'} found`,
            placeHolder: 'Select a local model',
            matchOnDetail: true
        });
        return picked ? this.loadModelWithProgress(picked.model.id) : undefined;
    }
    async loadModelWithProgress(modelPath) {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Vectra: loading ${path.basename(modelPath)}…`
        }, () => this.configureAndStartModel(modelPath));
    }
    /**
     * Hardware-aware model discovery: recommend from a curated list, or search
     * Hugging Face for more, confirm size/destination, download with progress,
     * then hand off to configureAndStartModel() — the exact same activation
     * path manual selection already uses, so VLM vision auto-wiring (which
     * keys off "a mmproj*.gguf file next to the model") comes for free once
     * both files land in the same directory.
     */
    async downloadAndSelectModel() {
        const entry = await this.pickCatalogEntry();
        if (!entry)
            return undefined;
        const destDir = await this.chooseDownloadDirectory();
        if (!destDir)
            return undefined;
        await node_fs_1.promises.mkdir(destDir, { recursive: true });
        const modelPath = path.join(destDir, entry.filename);
        const sizeText = entry.sizeBytes ? (0, LocalModelDiscovery_1.formatBytes)(entry.sizeBytes) : 'unknown';
        const choice = await vscode.window.showWarningMessage(`Download ${entry.label}?`, { modal: true, detail: `Size: ${sizeText}\nSaves to: ${modelPath}` }, 'Download');
        if (choice !== 'Download')
            return undefined;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Vectra: downloading ${entry.label}…`,
            cancellable: true
        }, async (progress, token) => {
            const controller = new AbortController();
            token.onCancellationRequested(() => controller.abort());
            const isVlm = entry.kind === 'vlm' && entry.mmprojUrl && entry.mmprojFilename;
            await (0, ModelDownloader_1.downloadFile)(entry.downloadUrl, modelPath, {
                signal: controller.signal,
                onProgress: phaseProgress(progress, isVlm ? 'Model (1/2)' : 'Model')
            });
            if (isVlm) {
                const mmprojPath = path.join(destDir, entry.mmprojFilename);
                await (0, ModelDownloader_1.downloadFile)(entry.mmprojUrl, mmprojPath, {
                    signal: controller.signal,
                    onProgress: phaseProgress(progress, 'Vision projector (2/2)')
                });
            }
        });
        return this.configureAndStartModel(modelPath);
    }
    resolveModelsDirectory() {
        return (0, config_1.getConfig)().modelsDirectory || path.join(os.homedir(), '.vectra', 'models');
    }
    async chooseDownloadDirectory() {
        const preferred = this.resolveModelsDirectory();
        let defaultDirectory = preferred;
        try {
            await node_fs_1.promises.access(defaultDirectory);
        }
        catch {
            defaultDirectory = os.homedir();
        }
        const picked = await vscode.window.showOpenDialog({
            title: 'Vectra: Choose where to download the model',
            defaultUri: vscode.Uri.file(defaultDirectory),
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Download here'
        });
        if (!picked?.[0])
            return undefined;
        const directory = picked[0].fsPath;
        await (0, config_1.updateModelsDirectory)(directory);
        return directory;
    }
    async pickCatalogEntry() {
        const hw = await (0, hardware_1.getHardwareSnapshot)();
        const recommendations = (0, ModelRecommender_1.recommendCatalogTiers)(hw, ModelCatalog_1.CURATED_MODELS);
        return this.showCatalogPicker(recommendations.fast, recommendations.hybrid);
    }
    async showCatalogPicker(recommended, hybrid = []) {
        const llmEntries = recommended.filter((entry) => entry.kind === 'llm');
        const vlmEntries = recommended.filter((entry) => entry.kind === 'vlm');
        const items = [];
        if (llmEntries.length) {
            items.push({ label: 'Recommended for your hardware', kind: vscode.QuickPickItemKind.Separator });
            items.push(...llmEntries.map(toCatalogPickItem));
        }
        if (vlmEntries.length) {
            items.push({ label: 'Vision models', kind: vscode.QuickPickItemKind.Separator });
            items.push(...vlmEntries.map(toCatalogPickItem));
        }
        if (hybrid.length) {
            items.push({ label: 'Larger models (hybrid GPU + RAM, slower)', kind: vscode.QuickPickItemKind.Separator });
            items.push(...hybrid.map(toCatalogPickItem));
        }
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({ label: '$(search) Search Hugging Face for more…', action: 'search' });
        const picked = await vscode.window.showQuickPick(items, {
            title: 'Vectra: Download Model',
            placeHolder: recommended.length
                ? 'Choose a recommended model, or search for more'
                : 'No curated model fits your detected hardware — search Hugging Face instead',
            matchOnDescription: true,
            matchOnDetail: true
        });
        if (!picked)
            return undefined;
        if (picked.entry)
            return picked.entry;
        if (picked.action === 'search')
            return this.showSearchFlow([...recommended, ...hybrid]);
        return undefined;
    }
    async showSearchFlow(recommended) {
        const query = await vscode.window.showInputBox({
            title: 'Vectra: Search Hugging Face for a GGUF model',
            prompt: 'e.g. "llama 3 8b", "qwen coder", "phi mini"',
            ignoreFocusOut: true
        });
        if (!query?.trim())
            return this.showCatalogPicker(recommended);
        let results;
        try {
            results = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Vectra: searching Hugging Face for "${query}"…` }, () => (0, HuggingFaceSearch_1.searchHuggingFace)(query.trim()));
        }
        catch (error) {
            void vscode.window.showErrorMessage(`Vectra Hugging Face search failed: ${messageOf(error)}`);
            return undefined;
        }
        if (!results.length) {
            const retry = await vscode.window.showWarningMessage(`No Hugging Face GGUF results for "${query}".`, 'Search again', 'Back');
            if (retry === 'Search again')
                return this.showSearchFlow(recommended);
            if (retry === 'Back')
                return this.showCatalogPicker(recommended);
            return undefined;
        }
        const items = [
            { label: '$(arrow-left) Back to recommended models', action: 'back' },
            ...results.map((result) => ({
                label: `$(repo) ${result.label}`,
                description: `${result.downloads.toLocaleString()} downloads`,
                result
            }))
        ];
        const picked = await vscode.window.showQuickPick(items, {
            title: `Vectra: ${results.length} Hugging Face result${results.length === 1 ? '' : 's'}`,
            placeHolder: 'Type to filter results',
            matchOnDescription: true
        });
        if (!picked)
            return undefined;
        if (picked.action === 'back')
            return this.showCatalogPicker(recommended);
        if (!picked.result)
            return undefined;
        const resolved = await (0, HuggingFaceSearch_1.resolveDownloadableFile)(picked.result.id);
        if (!resolved) {
            const openInBrowser = await vscode.window.showWarningMessage(`Vectra could not determine a single downloadable GGUF file for ${picked.result.id}. Open its Hugging Face page instead?`, 'Open in Browser');
            if (openInBrowser === 'Open in Browser') {
                await vscode.env.openExternal(vscode.Uri.parse(`https://huggingface.co/${picked.result.id}`));
            }
            return undefined;
        }
        return {
            id: `hf:${picked.result.id}:${resolved.filename}`,
            label: `${picked.result.id} (${resolved.filename})`,
            family: 'other',
            paramCount: 0,
            quant: '',
            kind: 'llm',
            sizeBytes: resolved.sizeBytes ?? 0,
            minVramMiB: 0,
            minRamMiB: 0,
            downloadUrl: resolved.downloadUrl,
            filename: resolved.filename
        };
    }
    /** Public: also the activation tail end of downloadAndSelectModel() below. */
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
        const [hardware, modelStat, supportedFlags] = await Promise.all([
            (0, hardware_1.getHardwareSnapshot)(),
            node_fs_1.promises.stat(normalized),
            this.probeCapabilities(executable)
        ]);
        const profile = (0, LlamaRuntimeProfile_1.buildLlamaRuntimeProfile)({
            hardware,
            modelBytes: modelStat.size,
            requestedContextSize: config.llamaCppContextSize,
            deviceMode: config.deviceMode,
            gpuLayers: config.llamaCppGpuLayers,
            splitMode: config.llamaCppSplitMode,
            cpuMoe: config.llamaCppCpuMoe,
            noMmap: config.llamaCppNoMmap,
            supportedFlags
        });
        const args = [
            '-m', normalized,
            '--host', '127.0.0.1',
            '--port', String(config.llamaCppPort),
            ...profile.args
        ];
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
        this.output.appendLine(`[Vectra] Adaptive profile: ${profile.summary}`);
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
    async probeCapabilities(executable) {
        const cached = this.capabilityCache.get(executable);
        if (cached)
            return cached;
        let output = '';
        try {
            const result = await execFileAsync(executable, ['--help'], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
            output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
        }
        catch (error) {
            const value = error;
            output = `${value.stdout ?? ''}\n${value.stderr ?? ''}`;
        }
        const flags = (0, LlamaRuntimeProfile_1.parseLlamaServerFlags)(output);
        this.capabilityCache.set(executable, flags);
        return flags;
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
            const modelName = path.basename(modelPath);
            const family = visionFamily(modelName);
            if (!family)
                return undefined;
            const modelScale = parameterScale(modelName);
            const names = await node_fs_1.promises.readdir(directory);
            const candidates = names
                .filter((name) => /^mmproj.*\.gguf$/i.test(name))
                .filter((name) => visionFamily(name) === family)
                .filter((name) => !modelScale || !parameterScale(name) || parameterScale(name) === modelScale)
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
        const choice = await vscode.window.showWarningMessage('Vectra found your GGUF model, but llama-server could not be found.', 'Install llama.cpp automatically', 'Select llama-server', 'Open llama.cpp');
        if (choice === 'Install llama.cpp automatically') {
            const installed = await this.installLlamaCpp();
            if (installed)
                return installed;
        }
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
    /**
     * Downloads and installs the llama.cpp build matching this machine (CPU or
     * CUDA), so a missing llama-server is fixed inline the first time a local
     * model needs it instead of sending the user to install it by hand. The
     * resolved path is cached via updateLlamaServerPath(), so this only runs
     * once per machine — every later start finds it immediately.
     */
    async installLlamaCpp() {
        let asset;
        let hasCuda = false;
        try {
            const gpus = await (0, gpu_1.detectGpus)();
            hasCuda = (0, gpu_1.hasNvidiaGpu)(gpus);
            asset = await (0, LlamaCppInstaller_1.findLatestAsset)(hasCuda);
        }
        catch (error) {
            void vscode.window.showErrorMessage(`Vectra could not check for a llama.cpp release: ${messageOf(error)}`);
            return undefined;
        }
        if (!asset) {
            void vscode.window.showWarningMessage('Vectra could not find a matching llama.cpp build to install automatically for this platform.');
            return undefined;
        }
        const confirm = await vscode.window.showWarningMessage(`Install llama.cpp (${asset.name})?`, {
            modal: true,
            detail: `Size: ${asset.sizeBytes ? (0, LocalModelDiscovery_1.formatBytes)(asset.sizeBytes) : 'unknown'}\nSaves to: ${(0, LlamaCppInstaller_1.installDirFor)(asset.version)}`
        }, 'Install');
        if (confirm !== 'Install')
            return undefined;
        try {
            return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Vectra: installing llama.cpp (${asset.name})…`,
                cancellable: true
            }, async (progress, token) => {
                const controller = new AbortController();
                token.onCancellationRequested(() => controller.abort());
                const result = await (0, LlamaCppInstaller_1.installLatestLlamaCpp)({
                    hasCuda,
                    asset: asset,
                    onProgress: phaseProgress(progress, 'llama.cpp'),
                    signal: controller.signal
                });
                await (0, config_1.updateLlamaServerPath)(result.execPath);
                if (result.fellBackToCpu) {
                    void vscode.window.showInformationMessage(`Vectra installed the CPU llama.cpp build because the CUDA build could not run on this computer.`);
                }
                return result.execPath;
            });
        }
        catch (error) {
            void vscode.window.showErrorMessage(`Vectra could not install llama.cpp: ${messageOf(error)}`);
            return undefined;
        }
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
function visionFamily(name) {
    const value = name.toLowerCase().replace(/[_. ]+/g, '-');
    if (/qwen-?3-?vl|qwen3vl/.test(value))
        return 'qwen3vl';
    if (/qwen-?2[.-]?5-?vl|qwen2[.-]?5vl/.test(value))
        return 'qwen2.5vl';
    if (/qwen-?2-?vl|qwen2vl/.test(value))
        return 'qwen2vl';
    if (/minicpm-?v/.test(value))
        return 'minicpmv';
    if (/internvl/.test(value))
        return 'internvl';
    if (/smolvlm/.test(value))
        return 'smolvlm';
    if (/llava/.test(value))
        return 'llava';
    if (/pixtral/.test(value))
        return 'pixtral';
    if (/moondream/.test(value))
        return 'moondream';
    if (/gemma-?3/.test(value))
        return 'gemma3';
    if (/phi-?3.*vision/.test(value))
        return 'phi3vision';
    if (/lfm-?2.*vl/.test(value))
        return 'lfm2vl';
    return '';
}
function parameterScale(name) {
    return name.toLowerCase().match(/(?:^|[-_.])(\d+(?:\.\d+)?)b(?:[-_.]|$)/)?.[1] ?? '';
}
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
function toCatalogPickItem(entry) {
    return {
        label: `$(file-binary) ${entry.label}`,
        description: `${entry.family} · ${entry.paramCount}B · ${(0, LocalModelDiscovery_1.formatBytes)(entry.sizeBytes)}`,
        detail: entry.kind === 'vlm' ? 'Vision-language model — includes a vision projector' : undefined,
        entry
    };
}
/**
 * Each phase (model, then optionally the vision projector) reports its own
 * 0-100% independently — simpler and safer than trying to weight a single
 * combined bar across two differently-sized downloads. VS Code's progress
 * bar visually settles near "full" after phase 1; the message text still
 * accurately reflects phase 2, which is what actually matters here.
 */
function phaseProgress(progress, label) {
    let lastPercent = 0;
    return (bytesDone, totalBytes) => {
        if (!totalBytes) {
            progress.report({ message: `${label}: ${(0, LocalModelDiscovery_1.formatBytes)(bytesDone)}` });
            return;
        }
        const percent = Math.min(100, Math.floor((bytesDone / totalBytes) * 100));
        progress.report({ increment: Math.max(0, percent - lastPercent), message: `${label}: ${percent}%` });
        lastPercent = percent;
    };
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=LocalLlamaCppService.js.map