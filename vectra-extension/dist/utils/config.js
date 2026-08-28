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
exports.getConfig = getConfig;
exports.updateProvider = updateProvider;
exports.updateDeviceMode = updateDeviceMode;
exports.updateTheme = updateTheme;
exports.updateModel = updateModel;
exports.updateLocalModel = updateLocalModel;
exports.updateLocalModelDirectory = updateLocalModelDirectory;
exports.updateModelsDirectory = updateModelsDirectory;
exports.updateOpenAICompatibleBaseUrl = updateOpenAICompatibleBaseUrl;
exports.updateLlamaServerPath = updateLlamaServerPath;
exports.updateLlamaMmprojPath = updateLlamaMmprojPath;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const SECTION = 'vectra';
function getConfig() {
    const c = vscode.workspace.getConfiguration(SECTION);
    return {
        provider: c.get('provider', 'llamaCpp'),
        model: c.get('model', '').trim(),
        agentHarness: c.get('agentHarness', 'deepagents'),
        localModelPath: c.get('localModelPath', '').trim(),
        localModelDirectory: c.get('localModelDirectory', '').trim(),
        modelsDirectory: c.get('modelsDirectory', '').trim(),
        llamaCppServerPath: c.get('llamaCppServerPath', '').trim(),
        llamaCppPort: c.get('llamaCppPort', 8080),
        llamaCppContextSize: c.get('llamaCppContextSize', 16384),
        llamaCppLoadTimeoutSeconds: c.get('llamaCppLoadTimeoutSeconds', 3600),
        llamaCppGpuLayers: c.get('llamaCppGpuLayers', 'auto').trim() || 'auto',
        llamaCppSplitMode: c.get('llamaCppSplitMode', 'layer'),
        llamaCppCpuMoe: c.get('llamaCppCpuMoe', false),
        llamaCppNoMmap: c.get('llamaCppNoMmap', false),
        llamaCppMmprojPath: c.get('llamaCppMmprojPath', '').trim(),
        llamaCppExtraArgs: c.get('llamaCppExtraArgs', []),
        deviceMode: c.get('deviceMode', 'auto'),
        theme: c.get('theme', 'auto'),
        ollamaBaseUrl: trim(c.get('ollamaBaseUrl', 'http://localhost:11434')),
        ollamaContextSize: c.get('ollamaContextSize', 8192),
        openaiCompatibleBaseUrl: trim(c.get('openaiCompatibleBaseUrl', 'http://localhost:1234/v1')),
        openaiBaseUrl: trim(c.get('openaiBaseUrl', 'https://api.openai.com/v1')),
        anthropicBaseUrl: trim(c.get('anthropicBaseUrl', 'https://api.anthropic.com/v1')),
        geminiBaseUrl: trim(c.get('geminiBaseUrl', 'https://generativelanguage.googleapis.com/v1beta')),
        maxAgentSteps: c.get('maxAgentSteps', 12),
        maxSubagentSteps: c.get('maxSubagentSteps', 6),
        maxFileBytes: c.get('maxFileBytes', 1_000_000),
        maxContextCharacters: c.get('maxContextCharacters', 180_000),
        localRequestTimeoutSeconds: c.get('localRequestTimeoutSeconds', 3600),
        excludeGlob: c.get('excludeGlob', '**/{node_modules,.git,dist,build,out,.next,.venv,venv,__pycache__,coverage}/**'),
        supportDeveloperUrl: c.get('supportDeveloperUrl', 'https://github.com/Laudarisd/vectra'),
        showDiagnosticsInContext: c.get('showDiagnosticsInContext', true),
        allowSensitiveFiles: c.get('allowSensitiveFiles', false)
    };
}
async function updateProvider(value) {
    await vscode.workspace.getConfiguration(SECTION).update('provider', value, vscode.ConfigurationTarget.Global);
}
async function updateDeviceMode(value) {
    await vscode.workspace.getConfiguration(SECTION).update('deviceMode', value, vscode.ConfigurationTarget.Global);
}
async function updateTheme(value) {
    await vscode.workspace.getConfiguration(SECTION).update('theme', value, vscode.ConfigurationTarget.Global);
}
async function updateModel(value) {
    await vscode.workspace.getConfiguration(SECTION).update('model', value, vscode.ConfigurationTarget.Global);
}
async function updateLocalModel(value) {
    const config = vscode.workspace.getConfiguration(SECTION);
    await config.update('localModelPath', value, vscode.ConfigurationTarget.Global);
    await config.update('localModelDirectory', path.dirname(value), vscode.ConfigurationTarget.Global);
}
async function updateLocalModelDirectory(value) {
    await vscode.workspace.getConfiguration(SECTION).update('localModelDirectory', value, vscode.ConfigurationTarget.Global);
}
async function updateModelsDirectory(value) {
    await vscode.workspace.getConfiguration(SECTION).update('modelsDirectory', value, vscode.ConfigurationTarget.Global);
}
async function updateOpenAICompatibleBaseUrl(value) {
    await vscode.workspace.getConfiguration(SECTION).update('openaiCompatibleBaseUrl', value, vscode.ConfigurationTarget.Global);
}
async function updateLlamaServerPath(value) {
    await vscode.workspace.getConfiguration(SECTION).update('llamaCppServerPath', value, vscode.ConfigurationTarget.Global);
}
async function updateLlamaMmprojPath(value) {
    await vscode.workspace.getConfiguration(SECTION).update('llamaCppMmprojPath', value, vscode.ConfigurationTarget.Global);
}
function trim(value) { return value.replace(/\/+$/, ''); }
//# sourceMappingURL=config.js.map