"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAICompatibleProvider = void 0;
const http_1 = require("../utils/http");
const protocol_1 = require("../agent/protocol");
class OpenAICompatibleProvider {
    baseUrl;
    apiKey;
    structuredAgentJson;
    id = 'openaiCompatible';
    constructor(baseUrl, apiKey, structuredAgentJson = false) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.structuredAgentJson = structuredAgentJson;
    }
    async complete(request) {
        const userContent = [{ type: 'text', text: request.userPrompt }];
        for (const f of request.attachments ?? [])
            append(userContent, f);
        const data = await (0, http_1.fetchJson)(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: this.headers(true), body: JSON.stringify({ model: request.model, messages: [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: userContent }], temperature: 0.2, ...(this.structuredAgentJson ? { response_format: { type: 'json_schema', schema: protocol_1.AGENT_ENVELOPE_SCHEMA } } : {}) }), signal: request.signal });
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