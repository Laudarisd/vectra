"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIProvider = void 0;
const http_1 = require("../utils/http");
class OpenAIProvider {
    apiKey;
    baseUrl;
    id = 'openai';
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }
    async complete(request) {
        const content = [{ type: 'input_text', text: request.userPrompt }];
        for (const file of request.attachments ?? [])
            appendOpenAIAttachment(content, file);
        const data = await (0, http_1.fetchJson)(`${this.baseUrl}/responses`, {
            method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: request.model, instructions: request.systemPrompt, input: [{ role: 'user', content }] }), signal: request.signal
        });
        const text = extractOpenAIText(data);
        if (!text)
            throw new Error('OpenAI returned no text output.');
        return text;
    }
    async listModels(signal) {
        const data = await (0, http_1.fetchJson)(`${this.baseUrl}/models`, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal });
        return (data.data ?? []).map((m) => ({ id: m.id, detail: m.owned_by })).sort((a, b) => a.id.localeCompare(b.id));
    }
    async testConnection(signal) { const models = await this.listModels(signal); return `Connected to OpenAI. ${models.length} model(s) available.`; }
}
exports.OpenAIProvider = OpenAIProvider;
function appendOpenAIAttachment(content, file) {
    if ((file.kind === 'text' || file.kind === 'document') && file.text)
        content.push({ type: 'input_text', text: `\n[Attachment: ${file.name}]\n${file.text}` });
    else if (file.kind === 'image' && file.base64)
        content.push({ type: 'input_image', image_url: `data:${file.mime};base64,${file.base64}`, detail: 'auto' });
    else if (file.kind === 'pdf' && file.base64)
        content.push({ type: 'input_file', filename: file.name, file_data: `data:${file.mime};base64,${file.base64}` });
    if (file.kind === 'pdf' && file.text)
        content.push({ type: 'input_text', text: `\n[Extracted PDF text fallback: ${file.name}]\n${file.text}` });
}
function extractOpenAIText(data) { if (data.output_text?.trim())
    return data.output_text.trim(); const p = []; for (const i of data.output ?? [])
    for (const c of i.content ?? [])
        if ((c.type === 'output_text' || c.type === 'text') && c.text)
            p.push(c.text); return p.join('\n').trim(); }
//# sourceMappingURL=OpenAIProvider.js.map