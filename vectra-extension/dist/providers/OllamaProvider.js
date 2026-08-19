"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaProvider = void 0;
const protocol_1 = require("../agent/protocol");
const http_1 = require("../utils/http");
class OllamaProvider {
    baseUrl;
    deviceMode;
    contextSize;
    timeoutMs;
    id = 'ollama';
    constructor(baseUrl, deviceMode = 'auto', contextSize = 8192, timeoutMs = 900_000) {
        this.baseUrl = baseUrl;
        this.deviceMode = deviceMode;
        this.contextSize = contextSize;
        this.timeoutMs = timeoutMs;
    }
    async complete(request) {
        const options = {
            // Ollama silently truncates context to a small default (often 2K-4K)
            // unless told otherwise, which is a frequent cause of degraded answers
            // and mid-conversation "forgetting" on local models.
            num_ctx: this.contextSize,
            ...(this.deviceMode === 'cpu' ? { num_gpu: 0 } : {})
        };
        const body = {
            model: request.model,
            messages: [
                { role: 'system', content: request.systemPrompt },
                { role: 'user', content: request.userPrompt }
            ],
            // Keeping the model resident avoids Ollama's default 5-minute unload,
            // which otherwise reloads the whole model from disk on the next turn.
            keep_alive: '30m',
            options,
            // Conversational turns must not be forced into the tool envelope.
            ...(request.structured === false ? {} : { format: protocol_1.AGENT_ENVELOPE_SCHEMA })
        };
        if (request.structured === false && request.onDelta) {
            const text = await (0, http_1.streamNdjson)(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...body, stream: true }),
                signal: request.signal
            }, { onDelta: request.onDelta, idleTimeoutMs: this.timeoutMs, signal: request.signal });
            if (!text.trim())
                throw new Error('Ollama returned no text output.');
            return text.trim();
        }
        const data = await (0, http_1.fetchJson)(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, stream: false }),
            signal: request.signal
        }, this.timeoutMs);
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