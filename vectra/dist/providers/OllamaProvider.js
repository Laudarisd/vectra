"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaProvider = void 0;
const protocol_1 = require("../agent/protocol");
const http_1 = require("../utils/http");
class OllamaProvider {
    baseUrl;
    id = 'ollama';
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    async complete(request) {
        const data = await (0, http_1.fetchJson)(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: request.model,
                stream: false,
                messages: [
                    { role: 'system', content: request.systemPrompt },
                    { role: 'user', content: request.userPrompt }
                ],
                // Conversational turns must not be forced into the tool envelope.
                ...(request.structured === false ? {} : { format: protocol_1.AGENT_ENVELOPE_SCHEMA })
            }),
            signal: request.signal
        });
        const text = data.message?.content?.trim();
        if (!text) {
            throw new Error('Ollama returned no text output.');
        }
        return text;
    }
    async listModels(signal) {
        const data = await (0, http_1.fetchJson)(`${this.baseUrl}/api/tags`, { signal });
        return (data.models ?? []).map((model) => {
            const detailParts = [
                model.details?.family,
                model.details?.parameter_size,
                model.details?.quantization_level,
                model.size ? formatBytes(model.size) : undefined
            ].filter(Boolean);
            return { id: model.name, detail: detailParts.join(' · ') };
        });
    }
    async testConnection(signal) {
        const models = await this.listModels(signal);
        return `Connected to Ollama. ${models.length} local model(s) available.`;
    }
}
exports.OllamaProvider = OllamaProvider;
function formatBytes(bytes) {
    const gib = bytes / 1024 / 1024 / 1024;
    return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
}
//# sourceMappingURL=OllamaProvider.js.map