"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiProvider = void 0;
const http_1 = require("../utils/http");
class GeminiProvider {
    apiKey;
    baseUrl;
    id = 'gemini';
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }
    async complete(request) {
        const parts = [{ text: request.userPrompt }];
        for (const f of request.attachments ?? [])
            append(parts, f);
        const root = this.baseUrl.replace(/\/$/, '');
        const data = await (0, http_1.fetchJson)(`${root}/models/${encodeURIComponent(request.model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ system_instruction: { parts: [{ text: request.systemPrompt }] }, contents: [{ role: 'user', parts }] }), signal: request.signal });
        const text = data.output_text?.trim() || (data.candidates ?? []).flatMap(c => c.content?.parts ?? []).map(p => p.text ?? '').join('\n').trim();
        if (!text)
            throw new Error('Gemini returned no text output.');
        return text;
    }
    async listModels(signal) { try {
        return await this.listAt(`${this.baseUrl}/models`, signal);
    }
    catch (e) {
        if (!this.baseUrl.endsWith('/v1'))
            throw e;
        return this.listAt(`${this.baseUrl.replace(/\/v1$/, '/v1beta')}/models`, signal);
    } }
    async testConnection(signal) { const m = await this.listModels(signal); return `Connected to Gemini. ${m.length} model(s) available.`; }
    async listAt(url, signal) { const d = await (0, http_1.fetchJson)(url, { headers: { 'x-goog-api-key': this.apiKey }, signal }); return (d.models ?? []).filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.some(x => x.toLowerCase().includes('generate'))).map(m => ({ id: m.name.replace(/^models\//, ''), label: m.displayName, detail: m.description })); }
}
exports.GeminiProvider = GeminiProvider;
function append(parts, f) { if ((f.kind === 'text' || f.kind === 'document') && f.text)
    parts.push({ text: `\n[Attachment: ${f.name}]\n${f.text}` });
else if ((f.kind === 'image' || f.kind === 'pdf') && f.base64)
    parts.push({ inline_data: { mime_type: f.mime, data: f.base64 } });
else if (f.text)
    parts.push({ text: `\n[Attachment: ${f.name}]\n${f.text}` }); }
//# sourceMappingURL=GeminiProvider.js.map