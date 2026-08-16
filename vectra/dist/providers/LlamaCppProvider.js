"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlamaCppProvider = void 0;
const OpenAICompatibleProvider_1 = require("./OpenAICompatibleProvider");
class LlamaCppProvider {
    id = 'llamaCpp';
    delegate;
    constructor(baseUrl, timeoutMs = 900_000) { this.delegate = new OpenAICompatibleProvider_1.OpenAICompatibleProvider(baseUrl, undefined, true, timeoutMs); }
    complete(request) { return this.delegate.complete(request); }
    listModels(signal) { return this.delegate.listModels(signal); }
    async testConnection(signal) {
        const models = await this.listModels(signal);
        return `Connected to local llama.cpp. ${models.length || 1} model(s) available.`;
    }
}
exports.LlamaCppProvider = LlamaCppProvider;
//# sourceMappingURL=LlamaCppProvider.js.map