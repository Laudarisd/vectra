"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAICompatibleProvider = void 0;
const http_1 = require("../utils/http");
const protocol_1 = require("../agent/protocol");
class OpenAICompatibleProvider {
    baseUrl;
    apiKey;
    structuredAgentJson;
    timeoutMs;
    id = 'openaiCompatible';
    constructor(baseUrl, apiKey, structuredAgentJson = false, timeoutMs = 120_000) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.structuredAgentJson = structuredAgentJson;
        this.timeoutMs = timeoutMs;
    }
    async complete(request) {
        const userContent = [{ type: 'text', text: request.userPrompt }];
        for (const f of request.attachments ?? [])
            append(userContent, f);
        const wantsEnvelope = this.structuredAgentJson && request.structured !== false;
        // llama.cpp has supported this schema-bearing json_object form across more
        // releases than the OpenAI-style json_schema wrapper. The latter changed
        // shape between server versions and can be silently accepted but ignored.
        const body = { model: request.model, messages: [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: userContent }], temperature: request.structured === false ? 0.6 : 0.2, ...(wantsEnvelope ? { response_format: { type: 'json_object', schema: protocol_1.AGENT_ENVELOPE_SCHEMA } } : {}) };
        // Free-form conversational replies stream token-by-token so a slow local
        // model shows visible progress instead of an unresponsive wait. The
        // schema-constrained tool-loop JSON stays non-streaming: partial JSON is
        // not useful to render and cannot be parsed until it is complete.
        if (request.structured === false && request.onDelta) {
            const text = await (0, http_1.streamSse)(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: this.headers(true), body: JSON.stringify({ ...body, stream: true }), signal: request.signal }, { onDelta: request.onDelta, idleTimeoutMs: this.timeoutMs, signal: request.signal });
            if (!text.trim())
                throw new Error('OpenAI-compatible endpoint returned no text output.');
            return text.trim();
        }
        const data = await (0, http_1.fetchJson)(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: this.headers(true), body: JSON.stringify(body), signal: request.signal }, this.timeoutMs);
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text)
            throw new Error('OpenAI-compatible endpoint returned no text output.');
        return text;
    }
    async listModels(signal) { const d = await (0, http_1.fetchJson)(`${this.baseUrl}/models`, { headers: this.headers(false), signal }); return (d.data ?? []).map(m => ({ id: m.id, detail: m.owned_by })); }
    async testConnection(signal) { const m = await this.listModels(signal); return `Connected to OpenAI-compatible endpoint. ${m.length} model(s) available.`; }
    headers(ct) { return { ...(ct ? { 'Content-Type': 'application/json' } : {}), ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) }; }
}
exports.OpenAICompatibleProvider = OpenAICompatibleProvider;
function append(content, f) {
    if ((f.kind === 'text' || f.kind === 'pdf' || f.kind === 'document') && f.text)
        content.push({ type: 'text', text: `\n[Attachment: ${f.name}]\n${f.text}` });
    if (f.kind === 'image' && f.base64)
        content.push({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.base64}` } });
}
//# sourceMappingURL=OpenAICompatibleProvider.js.map