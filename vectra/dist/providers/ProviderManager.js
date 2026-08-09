"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderManager = void 0;
const config_1 = require("../utils/config");
const AnthropicProvider_1 = require("./AnthropicProvider");
const GeminiProvider_1 = require("./GeminiProvider");
const OllamaProvider_1 = require("./OllamaProvider");
const OpenAICompatibleProvider_1 = require("./OpenAICompatibleProvider");
const OpenAIProvider_1 = require("./OpenAIProvider");
const LlamaCppProvider_1 = require("./LlamaCppProvider");
class ProviderManager {
    credentials;
    constructor(credentials) {
        this.credentials = credentials;
    }
    async getProvider() {
        const config = (0, config_1.getConfig)();
        switch (config.provider) {
            case 'llamaCpp':
                return new LlamaCppProvider_1.LlamaCppProvider(`http://127.0.0.1:${config.llamaCppPort}/v1`);
            case 'ollama':
                return new OllamaProvider_1.OllamaProvider(config.ollamaBaseUrl);
            case 'openai':
                return new OpenAIProvider_1.OpenAIProvider(await this.requireKey('openai'), config.openaiBaseUrl);
            case 'anthropic':
                return new AnthropicProvider_1.AnthropicProvider(await this.requireKey('anthropic'), config.anthropicBaseUrl);
            case 'gemini':
                return new GeminiProvider_1.GeminiProvider(await this.requireKey('gemini'), config.geminiBaseUrl);
            case 'openaiCompatible':
                return new OpenAICompatibleProvider_1.OpenAICompatibleProvider(config.openaiCompatibleBaseUrl, await this.credentials.get('openaiCompatible'));
            default:
                return assertNever(config.provider);
        }
    }
    async listModels(signal) { return (await this.getProvider()).listModels(signal); }
    async testConnection(signal) { return (await this.getProvider()).testConnection(signal); }
    async hasRequiredApiKey(provider) {
        if (provider === 'llamaCpp' || provider === 'ollama' || provider === 'openaiCompatible')
            return true;
        return this.credentials.has(provider);
    }
    async requireKey(provider) {
        const key = await this.credentials.get(provider);
        if (!key)
            throw new Error(`No ${provider} API key is configured. Click “API Key” in Vectra.`);
        return key;
    }
}
exports.ProviderManager = ProviderManager;
function assertNever(value) { throw new Error(`Unsupported provider: ${String(value)}`); }
//# sourceMappingURL=ProviderManager.js.map