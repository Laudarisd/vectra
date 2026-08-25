"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlamaCppProvider = void 0;
const http_1 = require("../utils/http");
const OpenAICompatibleProvider_1 = require("./OpenAICompatibleProvider");
class LlamaCppProvider {
    baseUrl;
    timeoutMs;
    id = 'llamaCpp';
    delegate;
    nativeToolsUnavailable = false;
    constructor(baseUrl, timeoutMs = 900_000) {
        this.baseUrl = baseUrl;
        this.timeoutMs = timeoutMs;
        this.delegate = new OpenAICompatibleProvider_1.OpenAICompatibleProvider(baseUrl, undefined, true, timeoutMs);
    }
    complete(request) { return this.delegate.complete(request); }
    async completeWithTools(request) {
        if (this.nativeToolsUnavailable)
            throw new Error('NATIVE_TOOL_CALLING_UNSUPPORTED: disabled after an incompatible response.');
        const messages = request.messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
            ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(openAiToolCall) } : {})
        }));
        const body = {
            model: request.model,
            messages,
            tools: request.tools.map((item) => ({
                type: 'function',
                function: { name: item.name, description: item.description ?? '', parameters: item.parameters }
            })),
            tool_choice: 'auto',
            temperature: 0.2,
            cache_prompt: true,
            stream: false
        };
        try {
            const data = await (0, http_1.fetchJson)(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: request.signal
            }, this.timeoutMs);
            const message = data.choices?.[0]?.message;
            if (!message)
                throw new Error('llama.cpp returned no assistant message.');
            return { text: message.content?.trim() ?? '', toolCalls: parseToolCalls(message.tool_calls ?? []) };
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            if (/HTTP (400|404|422)|tool.?call|chat template|jinja/i.test(detail)) {
                this.nativeToolsUnavailable = true;
                throw new Error(`NATIVE_TOOL_CALLING_UNSUPPORTED: ${detail}`);
            }
            throw error;
        }
    }
    listModels(signal) { return this.delegate.listModels(signal); }
    async testConnection(signal) {
        const models = await this.listModels(signal);
        return `Connected to local llama.cpp. ${models.length || 1} model(s) available.`;
    }
}
exports.LlamaCppProvider = LlamaCppProvider;
function openAiToolCall(call) {
    return { id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } };
}
function parseToolCalls(values) {
    const calls = [];
    for (const value of values) {
        if (!value || typeof value !== 'object')
            continue;
        const record = value;
        const name = record.function?.name;
        if (!name)
            continue;
        let args = {};
        const raw = record.function?.arguments;
        if (typeof raw === 'string') {
            try {
                args = JSON.parse(raw);
            }
            catch {
                args = {};
            }
        }
        else if (raw && typeof raw === 'object' && !Array.isArray(raw))
            args = raw;
        calls.push({ id: record.id ?? `call-${Date.now()}-${calls.length}`, name, args });
    }
    return calls;
}
//# sourceMappingURL=LlamaCppProvider.js.map