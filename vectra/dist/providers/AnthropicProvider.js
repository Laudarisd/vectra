"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicProvider = void 0;
const http_1 = require("../utils/http");
class AnthropicProvider {
    apiKey;
    baseUrl;
    id = 'anthropic';
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }
    async complete(request) {
        const content = [{ type: 'text', text: request.userPrompt }];
        for (const f of request.attachments ?? [])
            append(content, f);
        const data = await (0, http_1.fetchJson)(`${this.baseUrl}/messages`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ model: request.model, max_tokens: 8192, system: request.systemPrompt, messages: [{ role: 'user', content }] }), signal: request.signal });
        const text = (data.content ?? []).filter(p => p.type === 'text' && p.text).map(p => p.text).join('\n').trim();
        if (!text)
            throw new Error('Anthropic returned no text output.');
        return text;
    }
    async listModels(signal) { const d = await (0, http_1.fetchJson)(`${this.baseUrl}/models`, { headers: this.headers(false), signal }); return (d.data ?? []).map(m => ({ id: m.id, label: m.display_name, detail: m.created_at })); }
    async testConnection(signal) { const m = await this.listModels(signal); return `Connected to Anthropic. ${m.length} model(s) available.`; }
    headers(ct = true) { return { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', ...(ct ? { 'Content-Type': 'application/json' } : {}) }; }
}
exports.AnthropicProvider = AnthropicProvider;
function append(content, f) {
    if ((f.kind === 'text' || f.kind === 'document') && f.text)
        content.push({ type: 'text', text: `\n[Attachment: ${f.name}]\n${f.text}` });
    else if (f.kind === 'image' && f.base64)
        content.push({ type: 'image', source: { type: 'base64', media_type: f.mime, data: f.base64 } });
    else if (f.kind === 'pdf' && f.base64)
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } });
    else if (f.text)
        content.push({ type: 'text', text: `\n[Attachment: ${f.name}]\n${f.text}` });
}
//# sourceMappingURL=AnthropicProvider.js.map