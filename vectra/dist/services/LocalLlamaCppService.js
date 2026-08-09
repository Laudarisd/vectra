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
const vscode = __importStar(require("vscode"));
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const node_util_1 = require("node:util");
const config_1 = require("../utils/config");
const OpenAICompatibleProvider_1 = require("../providers/OpenAICompatibleProvider");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
class LocalLlamaCppService {
    process;
    output = vscode.window.createOutputChannel('Vectra · llama.cpp');
    currentModelPath = '';
    currentMmprojPath = '';
    get isRunning() { return Boolean(this.process && !this.process.killed); }
    get baseUrl() { return `http://127.0.0.1:${(0, config_1.getConfig)().llamaCppPort}/v1`; }
    get modelPath() { return this.currentModelPath || (0, config_1.getConfig)().localModelPath; }
    get mmprojPath() { return this.currentMmprojPath || (0, config_1.getConfig)().llamaCppMmprojPath; }
    get visionEnabled() { return Boolean(this.mmprojPath); }
    async selectAndStartModel() {
        const config = (0, config_1.getConfig)();
        let defaultUri;
        const candidate = config.localModelDirectory || path.dirname(config.localModelPath || '') || os.homedir();
        if (candidate && candidate !== '.') {
            try {
                await node_fs_1.promises.access(candidate);
                defaultUri = vscode.Uri.file(candidate);
            }
            catch { /* default */ }
        }
        const picked = await vscode.window.showOpenDialog({ title: 'Vectra: Select local GGUF model', defaultUri, canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'GGUF models': ['gguf'] }, openLabel: 'Use this model' });
        if (!picked?.[0])
            return undefined;
        let modelPath = normalizeShardPath(picked[0].fsPath);
        if (!modelPath.toLowerCase().endsWith('.gguf'))
            throw new Error('Vectra local models must be GGUF files for llama.cpp.');
        await node_fs_1.promises.access(modelPath);
        const previousModel = config.localModelPath;
        await (0, config_1.updateLocalModel)(modelPath);
        const detected = await this.detectMmproj(modelPath);
        if (previousModel !== modelPath)
            await (0, config_1.updateLlamaMmprojPath)(detected ?? '');
        else if (detected && !(0, config_1.getConfig)().llamaCppMmprojPath)
            await (0, config_1.updateLlamaMmprojPath)(detected);
        await this.start(modelPath);
        await (0, config_1.updateProvider)('llamaCpp');
        const provider = new OpenAICompatibleProvider_1.OpenAICompatibleProvider(this.baseUrl);
        let modelId = path.basename(modelPath);
        try {
            const models = await provider.listModels();
            modelId = models[0]?.id || modelId;
        }
        catch { /* single model */ }
        await (0, config_1.updateModel)(modelId);
        return modelId;
    }
    async selectMmproj() {
        const cfg = (0, config_1.getConfig)();
        const modelDir = cfg.localModelPath ? path.dirname(cfg.localModelPath) : os.homedir();
        const picked = await vscode.window.showOpenDialog({ title: 'Vectra: Select multimodal projector (mmproj GGUF)', defaultUri: vscode.Uri.file(modelDir), canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'GGUF projector': ['gguf'] }, openLabel: 'Use projector' });
        if (!picked?.[0])
            return undefined;
        await (0, config_1.updateLlamaMmprojPath)(picked[0].fsPath);
        return picked[0].fsPath;
    }
    async startConfiguredModel() { const modelPath = (0, config_1.getConfig)().localModelPath; if (!modelPath)
        return false; try {
        await node_fs_1.promises.access(modelPath);
    }
    catch {
        return false;
    } await this.start(modelPath); return true; }
    async start(modelPath) {
        await this.stop();
        const executable = await this.resolveServerExecutable();
        const config = (0, config_1.getConfig)();
        const normalized = normalizeShardPath(modelPath);
        const mmproj = await this.resolveMmproj(normalized);
        const args = ['-m', normalized, '--host', '127.0.0.1', '--port', String(config.llamaCppPort), '-c', String(config.llamaCppContextSize), '--fit', 'on', '--gpu-layers', config.llamaCppGpuLayers, '--split-mode', config.llamaCppSplitMode];
        if (config.llamaCppCpuMoe)
            args.push('--cpu-moe');
        if (config.llamaCppNoMmap)
            args.push('--no-mmap');
        if (mmproj)
            args.push('--mmproj', mmproj);
        if (config.llamaCppExtraArgs.length)
            args.push(...config.llamaCppExtraArgs);
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
        child.stdout?.on('data', (d) => this.output.append(d.toString()));
        child.stderr?.on('data', (d) => this.output.append(d.toString()));
        child.on('exit', (code, signal) => { this.output.appendLine(`\n[Vectra] llama-server exited (${code ?? 'no code'}${signal ? `, ${signal}` : ''}).`); if (this.process === child)
            this.process = undefined; });
        await this.waitUntilHealthy(child, config.llamaCppLoadTimeoutSeconds * 1000);
        this.output.appendLine(`[Vectra] Local model is ready${mmproj ? ' with multimodal vision' : ''}.`);
    }
    async stop() { const child = this.process; this.process = undefined; this.currentModelPath = ''; this.currentMmprojPath = ''; if (!child || child.killed)
        return; child.kill(); await new Promise((resolve) => { const timer = setTimeout(() => { try {
        child.kill('SIGKILL');
    }
    catch { } resolve(); }, 3000); child.once('exit', () => { clearTimeout(timer); resolve(); }); }); }
    async chooseServerExecutable() { const picked = await vscode.window.showOpenDialog({ title: 'Vectra: Select llama-server executable', canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel: 'Use llama-server' }); if (!picked?.[0])
        return undefined; await (0, config_1.updateLlamaServerPath)(picked[0].fsPath); return picked[0].fsPath; }
    dispose() { void this.stop(); this.output.dispose(); }
    async resolveMmproj(modelPath) { const cfg = (0, config_1.getConfig)(); if (cfg.llamaCppMmprojPath) {
        try {
            await node_fs_1.promises.access(cfg.llamaCppMmprojPath);
            return cfg.llamaCppMmprojPath;
        }
        catch { /* detect */ }
    } const detected = await this.detectMmproj(modelPath); if (detected)
        await (0, config_1.updateLlamaMmprojPath)(detected); return detected; }
    async detectMmproj(modelPath) { try {
        const dir = path.dirname(modelPath);
        const names = await node_fs_1.promises.readdir(dir);
        const candidates = names.filter(n => /^mmproj.*\.gguf$/i.test(n)).sort((a, b) => scoreMmproj(b) - scoreMmproj(a));
        return candidates[0] ? path.join(dir, candidates[0]) : undefined;
    }
    catch {
        return undefined;
    } }
    async resolveServerExecutable() { const configured = (0, config_1.getConfig)().llamaCppServerPath; if (configured) {
        if (path.isAbsolute(configured)) {
            try {
                await node_fs_1.promises.access(configured);
                return configured;
            }
            catch { }
        }
        else if (await commandExists(configured))
            return configured;
    } const command = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'; if (await commandExists(command))
        return command; const common = process.platform === 'darwin' ? ['/opt/homebrew/bin/llama-server', '/usr/local/bin/llama-server'] : process.platform === 'win32' ? [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'llama.cpp', 'llama-server.exe'), path.join(os.homedir(), 'llama.cpp', 'build', 'bin', 'Release', 'llama-server.exe')] : ['/usr/local/bin/llama-server', '/usr/bin/llama-server', path.join(os.homedir(), '.local', 'bin', 'llama-server')]; for (const c of common) {
        if (!c)
            continue;
        try {
            await node_fs_1.promises.access(c);
            await (0, config_1.updateLlamaServerPath)(c);
            return c;
        }
        catch { }
    } const choice = await vscode.window.showWarningMessage('Vectra found your GGUF model, but llama-server could not be found.', 'Select llama-server', 'Open llama.cpp'); if (choice === 'Open llama.cpp') {
        await vscode.env.openExternal(vscode.Uri.parse('https://github.com/ggml-org/llama.cpp'));
        throw new Error('Install llama.cpp, then select the local model again.');
    } if (choice === 'Select llama-server') {
        const s = await this.chooseServerExecutable();
        if (s)
            return s;
    } throw new Error('llama-server executable is required to run local GGUF models.'); }
    async waitUntilHealthy(child, timeout) { const health = `${this.baseUrl.replace(/\/v1$/, '')}/health`; const deadline = Date.now() + timeout; let last = ''; while (Date.now() < deadline) {
        if (child.exitCode !== null || child.killed)
            throw new Error('llama-server stopped before the model became ready. See “Vectra · llama.cpp” output.');
        try {
            const r = await fetch(health);
            if (r.ok)
                return;
            last = `HTTP ${r.status}`;
        }
        catch (e) {
            last = e instanceof Error ? e.message : String(e);
        }
        await delay(750);
    } throw new Error(`Timed out waiting for llama-server. Large models may need a longer vectra.llamaCppLoadTimeoutSeconds. ${last}`.trim()); }
}
exports.LocalLlamaCppService = LocalLlamaCppService;
function normalizeShardPath(p) { const m = p.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i); if (!m)
    return p; return `${m[1]}-00001-of-${m[3]}.gguf`; }
function scoreMmproj(n) { return /f16/i.test(n) ? 3 : /bf16/i.test(n) ? 2 : /q8/i.test(n) ? 1 : 0; }
async function commandExists(command) { try {
    if (process.platform === 'win32')
        await execFileAsync('where', [command]);
    else
        await execFileAsync('which', [command]);
    return true;
}
catch {
    return false;
} }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function shellQuote(v) { return /\s/.test(v) ? JSON.stringify(v) : v; }
//# sourceMappingURL=LocalLlamaCppService.js.map