import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { BaseChatModel, BaseChatModelCallOptions, BindToolsInput } from '@langchain/core/language_models/chat_models';
import { ChatResult } from '@langchain/core/outputs';
import { Runnable } from '@langchain/core/runnables';
import { createDeepAgent, StateBackend } from 'deepagents';
import type { AnyBackendProtocol, AnySubAgent, FilesystemPermission } from 'deepagents';
import { todoListMiddleware, tool } from 'langchain';
import { z } from 'zod';
import type { AgentEventStream } from './index';
import { VectraDeepTool } from './tools/contracts';

export interface VectraModelRequest {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  structured?: boolean;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

export interface VectraNativeToolDefinition {
  name: string;
  description?: string;
  parameters: unknown;
}

export interface VectraNativeMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

export interface VectraNativeToolResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

/** Structural subset implemented by every Vectra model provider. */
export interface VectraCompletionProvider {
  complete(request: VectraModelRequest): Promise<string>;
  completeWithTools?(request: {
    messages: VectraNativeMessage[];
    tools: VectraNativeToolDefinition[];
    model: string;
    signal?: AbortSignal;
  }): Promise<VectraNativeToolResult>;
}

export interface VectraDeepAgentOptions<TContext = unknown> {
  provider: VectraCompletionProvider;
  model: string;
  tools: readonly VectraDeepTool<TContext>[];
  context: TContext;
  systemPrompt?: string;
  events?: AgentEventStream;
  maxSteps?: number;
  /** Override scratch storage; execution appears only for a sandbox-capable backend. */
  backend?: AnyBackendProtocol;
  /** Deep Agents filesystem permission rules, applied to all built-in filesystem tools. */
  permissions?: FilesystemPermission[];
  /** Synchronous and/or asynchronous Deep Agents subagent definitions. */
  subagents?: AnySubAgent[];
}

export interface VectraDeepAgentRunRequest {
  task: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  threadId?: string;
  signal?: AbortSignal;
}

export interface VectraDeepAgentRunResult {
  text: string;
  state: unknown;
  harness: 'deepagents';
}

/**
 * Host-neutral Deep Agents harness. Its filesystem is deliberately an
 * ephemeral StateBackend: real workspace access only happens through Vectra
 * tools, so the extension/web host keeps its existing permission checks,
 * proposal review, command confirmation, and network policy.
 */
export class VectraDeepAgentRuntime<TContext = unknown> {
  private readonly agent: ReturnType<typeof createDeepAgent>;

  constructor(private readonly options: VectraDeepAgentOptions<TContext>) {
    const model = new VectraLangChainChatModel(options.provider, options.model, options.events);
    const tools = options.tools.map((definition) => tool(
      async (input: Record<string, unknown>) => {
        options.events?.emit({ type: 'deepagent.tool.requested', tool: definition.name, input });
        const result = await definition.execute(input, options.context);
        options.events?.emit({ type: 'deepagent.tool.completed', tool: definition.name, result });
        return typeof result === 'string' ? result : JSON.stringify(result);
      },
      {
        name: definition.name,
        description: definition.description,
        schema: definition.schema ?? z.object({}).catchall(z.unknown())
      }
    ));

    this.agent = createDeepAgent({
      name: 'vectra',
      model,
      tools,
      backend: options.backend ?? new StateBackend(),
      permissions: options.permissions,
      subagents: options.subagents,
      // Deep Agents 1.13 only adds planning for selected harness profiles.
      // Vectra is provider-neutral, so install it explicitly for every model.
      middleware: [todoListMiddleware()],
      systemPrompt: [
        options.systemPrompt,
        'Use Vectra host tools for real workspace files, Git, commands, documents, and network access.',
        'When vectra_search_tools is available, search by your intent and then call vectra_invoke_tool with an exact returned capability name.',
        'The built-in filesystem is scratch space only. Never claim a scratch-file write changed the user project.',
        'Host tools enforce plans, human review, and approvals; do not attempt to bypass them.'
      ].filter(Boolean).join('\n\n')
    });
  }

  async run(request: VectraDeepAgentRunRequest): Promise<VectraDeepAgentRunResult> {
    if (request.signal?.aborted) throw abortError();
    const messages = [
      ...(request.history ?? []).map((message) => ({ role: message.role, content: message.content })),
      { role: 'user' as const, content: request.task }
    ];
    this.options.events?.emit({ type: 'deepagent.started', threadId: request.threadId });
    const activeTools = new Map<string, string>();
    const callbacks = BaseCallbackHandler.fromMethods({
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
      const state = await this.agent.invoke(
        { messages },
        {
          configurable: { thread_id: request.threadId ?? deepId() },
          recursionLimit: Math.max(8, (this.options.maxSteps ?? 20) * 3),
          signal: request.signal,
          callbacks: [callbacks]
        }
      );
      const text = lastAssistantText((state as { messages?: unknown[] }).messages ?? []);
      this.options.events?.emit({ type: 'deepagent.state.changed', threadId: request.threadId, state: summarizeState(state) });
      this.options.events?.emit({ type: 'deepagent.completed', threadId: request.threadId, text });
      return { text, state, harness: 'deepagents' };
    } catch (error) {
      this.options.events?.emit({ type: 'deepagent.failed', threadId: request.threadId, error: messageOf(error) });
      throw error;
    }
  }
}

/**
 * Adapts Vectra's provider-neutral text API to LangChain's chat-model API.
 * Bound tools are described in a strict JSON envelope, allowing small local
 * models without native tool calling to participate in the Deep Agents loop.
 */
export class VectraLangChainChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  private readonly boundTools: BindToolsInput[];

  constructor(
    private readonly provider: VectraCompletionProvider,
    private readonly modelId: string,
    private readonly events?: AgentEventStream,
    tools: BindToolsInput[] = []
  ) {
    super({});
    this.boundTools = tools;
  }

  _llmType(): string { return 'vectra-provider'; }

  bindTools(tools: BindToolsInput[]): Runnable {
    return new VectraLangChainChatModel(this.provider, this.modelId, this.events, tools);
  }

  async _generate(messages: BaseMessage[], options: BaseChatModelCallOptions): Promise<ChatResult> {
    if (this.provider.completeWithTools) {
      try {
        const result = await this.provider.completeWithTools({
          messages: nativeMessages(messages),
          tools: nativeTools(this.boundTools),
          model: this.modelId,
          signal: options.signal
        });
        const message = new AIMessage({
          content: result.text,
          tool_calls: result.toolCalls.map((call) => ({ ...call, type: 'tool_call' as const }))
        });
        return { generations: [{ text: result.text, message }] };
      } catch (error) {
        if (!/NATIVE_TOOL_CALLING_UNSUPPORTED/.test(messageOf(error))) throw error;
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
    const message = new AIMessage({
      content: parsed.text,
      tool_calls: parsed.calls.map((call) => ({
        id: call.id,
        name: call.name,
        args: call.args,
        type: 'tool_call' as const
      }))
    });
    return { generations: [{ text: parsed.text, message }] };
  }
}

function nativeTools(tools: BindToolsInput[]): VectraNativeToolDefinition[] {
  return tools.map((value) => {
    const item = value as { name?: string; description?: string; schema?: unknown };
    return { name: item.name ?? '', description: item.description, parameters: schemaJson(item.schema) };
  }).filter((item) => item.name);
}

function nativeMessages(messages: BaseMessage[]): VectraNativeMessage[] {
  return messages.map((message) => {
    const type = message.getType();
    const value = message as BaseMessage & {
      tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
      tool_call_id?: string;
    };
    const role: VectraNativeMessage['role'] = type === 'human' ? 'user' : type === 'ai' ? 'assistant' : type === 'tool' ? 'tool' : 'system';
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

interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

function serializeMessages(messages: BaseMessage[], tools: BindToolsInput[]): { systemPrompt: string; userPrompt: string } {
  const system: string[] = [];
  const transcript: string[] = [];
  for (const message of messages) {
    const role = message.getType();
    const content = contentText(message.content);
    if (role === 'system') system.push(content);
    else transcript.push(`${role.toUpperCase()}: ${content}`);
  }
  const descriptions = tools.map((value) => {
    const item = value as { name?: string; description?: string; schema?: unknown };
    return { name: item.name, description: item.description, schema: schemaJson(item.schema) };
  }).filter((item) => item.name);
  system.push(
    'You can call tools. Respond with JSON only: ' +
    '{"message":"brief explanation","tool_calls":[{"name":"tool_name","args":{}}]}. ' +
    'Use an empty tool_calls array only when you are giving the final answer. ' +
    'For compatibility, Vectra also accepts {"actions":[{"type":"tool_name",...}]}.',
    `AVAILABLE TOOLS:\n${JSON.stringify(descriptions)}`
  );
  return { systemPrompt: system.join('\n\n'), userPrompt: transcript.join('\n\n') };
}

function parseToolEnvelope(raw: string, tools: BindToolsInput[]): { text: string; calls: ParsedToolCall[] } {
  const allowed = new Set(tools.map((value) => (value as { name?: string }).name).filter(Boolean));
  const candidate = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  let value: Record<string, unknown> | undefined;
  try { value = JSON.parse(candidate.trim()) as Record<string, unknown>; } catch { /* natural final answer */ }
  if (!value) return { text: raw.trim(), calls: [] };

  const text = String(value.message ?? value.text ?? '');
  const inputCalls = Array.isArray(value.tool_calls) ? value.tool_calls : [];
  const actionCalls = Array.isArray(value.actions) ? value.actions : [];
  const calls: ParsedToolCall[] = [];
  const addCalls = (items: unknown[], actionFormat: boolean) => { for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const requestedName = String(record.name ?? record.type ?? '');
    const deepName = requestedName.startsWith('deep_') ? requestedName.slice('deep_'.length) : '';
    const vectraName = `vectra_${requestedName}`;
    const name = actionFormat
      ? (deepName && allowed.has(deepName) ? deepName : allowed.has(vectraName) ? vectraName : allowed.has(requestedName) ? requestedName : '')
      : (allowed.has(requestedName) ? requestedName : allowed.has(vectraName) ? vectraName : '');
    if (!name) continue;
    const supplied = record.args && typeof record.args === 'object' && !Array.isArray(record.args)
      ? record.args as Record<string, unknown>
      : Object.fromEntries(Object.entries(record).filter(([key]) => !['id', 'name', 'type'].includes(key)));
    calls.push({ id: String(record.id ?? deepId()), name, args: supplied });
  }};
  addCalls(inputCalls, false);
  addCalls(actionCalls, true);
  return { text, calls };
}

function contentText(content: BaseMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join('\n');
}

function schemaJson(schema: unknown): unknown {
  if (!schema) return {};
  try { return z.toJSONSchema(schema as z.ZodType); } catch { return {}; }
}

function lastAssistantText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as { content?: unknown; getType?: () => string };
    if (message?.getType && message.getType() !== 'ai') continue;
    const text = contentText((message?.content ?? '') as BaseMessage['content']).trim();
    if (text) return text;
  }
  return '';
}

function abortError(): Error {
  const error = new Error('Deep Agent run cancelled.');
  error.name = 'AbortError';
  return error;
}

function deepId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `deep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseCallbackInput(input: string): unknown {
  try { return JSON.parse(input); } catch { return input; }
}

function callbackOutput(output: unknown): unknown {
  if (typeof output === 'string') return output.length > 2_000 ? `${output.slice(0, 2_000)}...` : output;
  return output;
}

function summarizeState(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {};
  const value = state as Record<string, unknown>;
  const files = value.files && typeof value.files === 'object' && !Array.isArray(value.files)
    ? Object.keys(value.files as Record<string, unknown>)
    : [];
  return {
    todos: Array.isArray(value.todos) ? value.todos : [],
    files,
    asyncTasks: Array.isArray(value.asyncTasks) ? value.asyncTasks : []
  };
}
