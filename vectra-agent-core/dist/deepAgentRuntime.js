"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VectraLangChainChatModel = exports.VectraDeepAgentRuntime = void 0;
const messages_1 = require("@langchain/core/messages");
const base_1 = require("@langchain/core/callbacks/base");
const chat_models_1 = require("@langchain/core/language_models/chat_models");
const deepagents_1 = require("deepagents");
const langchain_1 = require("langchain");
const zod_1 = require("zod");
/**
 * Host-neutral Deep Agents harness. Its filesystem is deliberately an
 * ephemeral StateBackend: real workspace access only happens through Vectra
 * tools, so the extension/web host keeps its existing permission checks,
 * proposal review, command confirmation, and network policy.
 */
class VectraDeepAgentRuntime {
    options;
    agent;
    constructor(options) {
        this.options = options;
        const model = new VectraLangChainChatModel(options.provider, options.model, options.events);
        const tools = options.tools.map((definition) => (0, langchain_1.tool)(async (input) => {
            options.events?.emit({ type: 'deepagent.tool.requested', tool: definition.name, input });
            const result = await definition.execute(input, options.context);
            options.events?.emit({ type: 'deepagent.tool.completed', tool: definition.name, result });
            return typeof result === 'string' ? result : JSON.stringify(result);
        }, {
            name: definition.name,
            description: definition.description,
            schema: definition.schema ?? zod_1.z.object({}).catchall(zod_1.z.unknown())
        }));
        this.agent = (0, deepagents_1.createDeepAgent)({
            name: 'vectra',
            model,
            tools,
            backend: options.backend ?? new deepagents_1.StateBackend(),
            permissions: options.permissions,
            subagents: options.subagents,
            // Deep Agents 1.13 only adds planning for selected harness profiles.
            // Vectra is provider-neutral, so install it explicitly for every model.
            middleware: [(0, langchain_1.todoListMiddleware)()],
            systemPrompt: [
                options.systemPrompt,
                'Use Vectra host tools for real workspace files, Git, commands, documents, and network access.',
                'When vectra_search_tools is available, search by your intent and then call vectra_invoke_tool with an exact returned capability name.',
                'The built-in filesystem is scratch space only. Never claim a scratch-file write changed the user project.',
                'Host tools enforce plans, human review, and approvals; do not attempt to bypass them.'
            ].filter(Boolean).join('\n\n')
        });
    }
    async run(request) {
        if (request.signal?.aborted)
            throw abortError();
        const messages = [
            ...(request.history ?? []).map((message) => ({ role: message.role, content: message.content })),
            { role: 'user', content: request.task }
        ];
        this.options.events?.emit({ type: 'deepagent.started', threadId: request.threadId });
        const activeTools = new Map();
        const callbacks = base_1.BaseCallbackHandler.fromMethods({
            handleToolStart: (tool, input, runId, _parentRunId, _tags, _metadata, runName) => {
                const name = runName || tool.name || tool.id?.[tool.id.length - 1] || 'tool';
                activeTools.set(runId, name);
                this.options.events?.emit({
                    type: 'deepagent.tool.started',
                    runId,
                    tool: name,
                    input: parseCallbackInput(input)
                });
            },
            handleToolEnd: (output, runId) => {
                const name = activeTools.get(runId) ?? 'tool';
                activeTools.delete(runId);
                this.options.events?.emit({ type: 'deepagent.tool.finished', runId, tool: name, output: callbackOutput(output) });
            },
            handleToolError: (error, runId) => {
                const name = activeTools.get(runId) ?? 'tool';
                activeTools.delete(runId);
                this.options.events?.emit({ type: 'deepagent.tool.failed', runId, tool: name, error: messageOf(error) });
            }
        });
        try {
            const state = await this.agent.invoke({ messages }, {
                configurable: { thread_id: request.threadId ?? deepId() },
                recursionLimit: Math.max(8, (this.options.maxSteps ?? 20) * 3),
                signal: request.signal,
                callbacks: [callbacks]
            });
            const text = lastAssistantText(state.messages ?? []);
            this.options.events?.emit({ type: 'deepagent.state.changed', threadId: request.threadId, state: summarizeState(state) });
            this.options.events?.emit({ type: 'deepagent.completed', threadId: request.threadId, text });
            return { text, state, harness: 'deepagents' };
        }
        catch (error) {
            this.options.events?.emit({ type: 'deepagent.failed', threadId: request.threadId, error: messageOf(error) });
            throw error;
        }
    }
}
exports.VectraDeepAgentRuntime = VectraDeepAgentRuntime;
/**
 * Adapts Vectra's provider-neutral text API to LangChain's chat-model API.
 * Bound tools are described in a strict JSON envelope, allowing small local
 * models without native tool calling to participate in the Deep Agents loop.
 */
class VectraLangChainChatModel extends chat_models_1.BaseChatModel {
    provider;
    modelId;
    events;
    boundTools;
    constructor(provider, modelId, events, tools = []) {
        super({});
        this.provider = provider;
        this.modelId = modelId;
        this.events = events;
        this.boundTools = tools;
    }
    _llmType() { return 'vectra-provider'; }
    bindTools(tools) {
        return new VectraLangChainChatModel(this.provider, this.modelId, this.events, tools);
    }
    async _generate(messages, options) {
        if (this.provider.completeWithTools) {
            try {
                const result = await this.provider.completeWithTools({
                    messages: nativeMessages(messages),
                    tools: nativeTools(this.boundTools),
                    model: this.modelId,
                    signal: options.signal
                });
                const message = new messages_1.AIMessage({
                    content: result.text,
                    tool_calls: result.toolCalls.map((call) => ({ ...call, type: 'tool_call' }))
                });
                return { generations: [{ text: result.text, message }] };
            }
            catch (error) {
                if (!/NATIVE_TOOL_CALLING_UNSUPPORTED/.test(messageOf(error)))
                    throw error;
                this.events?.emit({ type: 'deepagent.native_tools.fallback', error: messageOf(error) });
            }
        }
        const { systemPrompt, userPrompt } = serializeMessages(messages, this.boundTools);
        const raw = await this.provider.complete({
            systemPrompt,
            userPrompt,
            model: this.modelId,
            structured: true,
            signal: options.signal,
            onDelta: (delta) => this.events?.emit({ type: 'deepagent.delta', delta })
        });
        const parsed = parseToolEnvelope(raw, this.boundTools);
        const message = new messages_1.AIMessage({
            content: parsed.text,
            tool_calls: parsed.calls.map((call) => ({
                id: call.id,
                name: call.name,
                args: call.args,
                type: 'tool_call'
            }))
        });
        return { generations: [{ text: parsed.text, message }] };
    }
}
exports.VectraLangChainChatModel = VectraLangChainChatModel;
function nativeTools(tools) {
    return tools.map((value) => {
        const item = value;
        return { name: item.name ?? '', description: item.description, parameters: schemaJson(item.schema) };
    }).filter((item) => item.name);
}
function nativeMessages(messages) {
    return messages.map((message) => {
        const type = message.getType();
        const value = message;
        const role = type === 'human' ? 'user' : type === 'ai' ? 'assistant' : type === 'tool' ? 'tool' : 'system';
        return {
            role,
            content: contentText(message.content),
            ...(value.tool_call_id ? { toolCallId: value.tool_call_id } : {}),
            ...(value.tool_calls?.length ? {
                toolCalls: value.tool_calls.map((call) => ({ id: call.id ?? deepId(), name: call.name, args: call.args }))
            } : {})
        };
    });
}
function serializeMessages(messages, tools) {
    const system = [];
    const transcript = [];
    for (const message of messages) {
        const role = message.getType();
        const content = contentText(message.content);
        if (role === 'system')
            system.push(content);
        else
            transcript.push(`${role.toUpperCase()}: ${content}`);
    }
    const descriptions = tools.map((value) => {
        const item = value;
        return { name: item.name, description: item.description, schema: schemaJson(item.schema) };
    }).filter((item) => item.name);
    system.push('You can call tools. Respond with JSON only: ' +
        '{"message":"brief explanation","tool_calls":[{"name":"tool_name","args":{}}]}. ' +
        'Use an empty tool_calls array only when you are giving the final answer. ' +
        'For compatibility, Vectra also accepts {"actions":[{"type":"tool_name",...}]}.', `AVAILABLE TOOLS:\n${JSON.stringify(descriptions)}`);
    return { systemPrompt: system.join('\n\n'), userPrompt: transcript.join('\n\n') };
}
function parseToolEnvelope(raw, tools) {
    const allowed = new Set(tools.map((value) => value.name).filter(Boolean));
    const candidate = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
    let value;
    try {
        value = JSON.parse(candidate.trim());
    }
    catch { /* natural final answer */ }
    if (!value)
        return { text: raw.trim(), calls: [] };
    const text = String(value.message ?? value.text ?? '');
    const inputCalls = Array.isArray(value.tool_calls) ? value.tool_calls : [];
    const actionCalls = Array.isArray(value.actions) ? value.actions : [];
    const calls = [];
    const addCalls = (items, actionFormat) => {
        for (const item of items) {
            if (!item || typeof item !== 'object' || Array.isArray(item))
                continue;
            const record = item;
            const requestedName = String(record.name ?? record.type ?? '');
            const deepName = requestedName.startsWith('deep_') ? requestedName.slice('deep_'.length) : '';
            const vectraName = `vectra_${requestedName}`;
            const name = actionFormat
                ? (deepName && allowed.has(deepName) ? deepName : allowed.has(vectraName) ? vectraName : allowed.has(requestedName) ? requestedName : '')
                : (allowed.has(requestedName) ? requestedName : allowed.has(vectraName) ? vectraName : '');
            if (!name)
                continue;
            const supplied = record.args && typeof record.args === 'object' && !Array.isArray(record.args)
                ? record.args
                : Object.fromEntries(Object.entries(record).filter(([key]) => !['id', 'name', 'type'].includes(key)));
            calls.push({ id: String(record.id ?? deepId()), name, args: supplied });
        }
    };
    addCalls(inputCalls, false);
    addCalls(actionCalls, true);
    return { text, calls };
}
function contentText(content) {
    if (typeof content === 'string')
        return content;
    return content.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join('\n');
}
function schemaJson(schema) {
    if (!schema)
        return {};
    try {
        return zod_1.z.toJSONSchema(schema);
    }
    catch {
        return {};
    }
}
function lastAssistantText(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message?.getType && message.getType() !== 'ai')
            continue;
        const text = contentText((message?.content ?? '')).trim();
        if (text)
            return text;
    }
    return '';
}
function abortError() {
    const error = new Error('Deep Agent run cancelled.');
    error.name = 'AbortError';
    return error;
}
function deepId() {
    if (typeof globalThis.crypto?.randomUUID === 'function')
        return globalThis.crypto.randomUUID();
    return `deep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
function parseCallbackInput(input) {
    try {
        return JSON.parse(input);
    }
    catch {
        return input;
    }
}
function callbackOutput(output) {
    if (typeof output === 'string')
        return output.length > 2_000 ? `${output.slice(0, 2_000)}...` : output;
    return output;
}
function summarizeState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state))
        return {};
    const value = state;
    const files = value.files && typeof value.files === 'object' && !Array.isArray(value.files)
        ? Object.keys(value.files)
        : [];
    return {
        todos: Array.isArray(value.todos) ? value.todos : [],
        files,
        asyncTasks: Array.isArray(value.asyncTasks) ? value.asyncTasks : []
    };
}
//# sourceMappingURL=deepAgentRuntime.js.map