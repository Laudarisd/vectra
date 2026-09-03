// Beginner guide: Handles d ee pa ge nt ru nt im e responsibilities for Vectra.
import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { BaseChatModel, BaseChatModelCallOptions, BindToolsInput } from '@langchain/core/language_models/chat_models';
import { ChatResult } from '@langchain/core/outputs';
import { Runnable } from '@langchain/core/runnables';
import { createDeepAgent, StateBackend } from 'deepagents';
import type { AnyBackendProtocol, AnySubAgent, FilesystemPermission, SubAgent } from 'deepagents';
import { todoListMiddleware, tool } from 'langchain';
import { z } from 'zod';
import type { AgentEventStream } from './session';
import { VectraDeepTool } from '../tools/contracts';
import { VectraSubagentSpec } from '../tools/subagents';

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
  finishReason?: string;
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
  /** Synchronous and/or asynchronous Deep Agents subagent definitions, passed through as-is. */
  subagents?: AnySubAgent[];
  /** Vectra's own role-scoped subagent team, converted to Deep Agents subagents here
   * (the one file that owns the LangChain/deepagents boundary) and merged with `subagents`. */
  subagentSpecs?: readonly VectraSubagentSpec<TContext>[];
}

export interface VectraDeepAgentRunRequest {
  task: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  threadId?: string;
  signal?: AbortSignal;
  /** Optional read-through mirrors for hosts whose models mistakenly choose Deep scratch read_file for an attachment. */
  scratchFiles?: Record<string, { content: string; mimeType: string; created_at: string; modified_at: string }>;
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
    const tools = options.tools.map((definition) => wrapVectraTool(definition, options.context, options.events));
    const subagentsFromSpecs: SubAgent[] = (options.subagentSpecs ?? []).map((spec) => ({
      name: spec.name,
      description: spec.description,
      systemPrompt: spec.systemPrompt,
      tools: spec.tools.map((definition) => wrapVectraTool(definition, options.context, options.events))
    }));
    const subagents = [...(options.subagents ?? []), ...subagentsFromSpecs];

    this.agent = createDeepAgent({
      name: 'vectra',
      model,
      tools,
      backend: options.backend ?? new StateBackend(),
      permissions: options.permissions,
      subagents: subagents.length ? subagents : undefined,
      // Deep Agents 1.13 only adds planning for selected harness profiles.
      // Vectra is provider-neutral, so install it explicitly for every model.
      middleware: [todoListMiddleware()],
      systemPrompt: [
        options.systemPrompt,
        'Use Vectra host tools for real workspace files, Git, commands, documents, and network access.',
        'When vectra_search_tools is available, search by your intent and then call vectra_invoke_tool with an exact returned capability name.',
        'When vectra_list_attachments is available, uploaded PDFs/documents are attachments, not workspace or scratch files. Use vectra_list_attachments, vectra_search_attachments, vectra_read_attachment, or vectra_read_files.',
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
    // The builtin `task` tool is how Deep Agents invokes one of Vectra's role
    // subagents (subagent_type). Tracking its runId separately lets the UI
    // group everything that tool call does under one collapsible entry,
    // without needing to walk LangChain's parent-run chain for every event.
    const activeSubagents = new Map<string, { role: string; description: string }>();
    const callbacks = BaseCallbackHandler.fromMethods({
      handleToolStart: (tool, input, runId, _parentRunId, _tags, _metadata, runName) => {
        const name = runName || tool.name || tool.id?.[tool.id.length - 1] || 'tool';
        activeTools.set(runId, name);
        const parsedInput = parseCallbackInput(input);
        this.options.events?.emit({
          type: 'deepagent.tool.started',
          runId,
          tool: name,
          input: parsedInput
        });
        if (name === 'task') {
          const record = parsedInput && typeof parsedInput === 'object' ? parsedInput as Record<string, unknown> : {};
          const role = typeof record.subagent_type === 'string' ? record.subagent_type : 'general-purpose';
          const description = typeof record.description === 'string' ? record.description : '';
          activeSubagents.set(runId, { role, description });
          this.options.events?.emit({ type: 'deepagent.subagent.started', runId, role, description });
        }
      },
      handleToolEnd: (output, runId) => {
        const name = activeTools.get(runId) ?? 'tool';
        activeTools.delete(runId);
        this.options.events?.emit({ type: 'deepagent.tool.finished', runId, tool: name, output: callbackOutput(output) });
        const subagent = activeSubagents.get(runId);
        if (subagent) {
          activeSubagents.delete(runId);
          this.options.events?.emit({ type: 'deepagent.subagent.finished', runId, role: subagent.role, output: callbackOutput(output) });
        }
      },
      handleToolError: (error, runId) => {
        const name = activeTools.get(runId) ?? 'tool';
        activeTools.delete(runId);
        this.options.events?.emit({ type: 'deepagent.tool.failed', runId, tool: name, error: messageOf(error) });
        const subagent = activeSubagents.get(runId);
        if (subagent) {
          activeSubagents.delete(runId);
          this.options.events?.emit({ type: 'deepagent.subagent.failed', runId, role: subagent.role, error: messageOf(error) });
        }
      }
    });
    try {
      const state = await this.agent.invoke(
        { messages, ...(request.scratchFiles ? { files: request.scratchFiles } : {}) },
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
  private lastToolSignature = '';
  private repeatedToolCalls = 0;

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
        // Some OpenAI-compatible Qwen servers serialize calls inside message
        // content instead of returning message.tool_calls. Normalize both forms.
        const compatibility = result.toolCalls.length
          ? { text: stripInternalReasoning(result.text), calls: result.toolCalls }
          : parseToolEnvelope(result.text, this.boundTools);
        this.guardRepeatedToolLoop(compatibility.calls);
        const message = new AIMessage({
          content: compatibility.text,
          tool_calls: compatibility.calls.map((call) => ({ ...call, type: 'tool_call' as const }))
        });
        return { generations: [{ text: compatibility.text, message }] };
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
    this.guardRepeatedToolLoop(parsed.calls);
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

  private guardRepeatedToolLoop(calls: Array<{ name: string; args: Record<string, unknown> }>): void {
    if (!calls.length) { this.lastToolSignature = ''; this.repeatedToolCalls = 0; return; }
    const signature = JSON.stringify(calls.map((call) => ({ name: call.name, args: call.args })));
    this.repeatedToolCalls = signature === this.lastToolSignature ? this.repeatedToolCalls + 1 : 1;
    this.lastToolSignature = signature;
    if (this.repeatedToolCalls >= 3) throw new Error(`REPEATED_TOOL_LOOP: The model called the same tool with identical arguments ${this.repeatedToolCalls} times.`);
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
  const qwen = parseQwenToolCalls(raw, allowed);
  if (qwen.length) return { text: visibleModelText(raw), calls: qwen };

  const cleaned = stripInternalReasoning(raw);
  const candidate = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? cleaned;
  let value: Record<string, unknown> | undefined;
  try { value = JSON.parse(candidate.trim()) as Record<string, unknown>; } catch { /* natural final answer */ }
  if (!value) return { text: visibleModelText(cleaned), calls: [] };

  const text = stripInternalReasoning(String(value.message ?? value.text ?? '')).trim();
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

/** Parse Qwen/ChatML tool syntax emitted inside assistant content. */
function parseQwenToolCalls(raw: string, allowed: Set<string | undefined>): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  for (const match of raw.matchAll(/<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi)) {
    const body = match[1].trim();

    // Common Qwen form: <tool_call>{"name":"tool","arguments":{...}}</tool_call>
    try {
      const value = JSON.parse(body) as Record<string, unknown>;
      const requested = String(value.name ?? value.function ?? '');
      const name = resolveAllowedToolName(requested, allowed);
      if (name) {
        const supplied = value.arguments ?? value.args ?? {};
        const args = typeof supplied === 'string' ? parseJsonValue(supplied) : supplied;
        calls.push({ id: deepId(), name, args: isRecord(args) ? args : {} });
        continue;
      }
    } catch { /* try the XML parameter form below */ }

    // Alternate Qwen form: <function=name><parameter=key>value</parameter>...</function>
    const functionMatch = body.match(/<function\s*=\s*["']?([^>"'\s]+)["']?\s*>([\s\S]*?)<\/function>/i);
    if (!functionMatch) continue;
    const name = resolveAllowedToolName(functionMatch[1], allowed);
    if (!name) continue;
    const args: Record<string, unknown> = {};
    for (const parameter of functionMatch[2].matchAll(/<parameter\s*=\s*["']?([^>"'\s]+)["']?\s*>([\s\S]*?)<\/parameter>/gi)) {
      args[parameter[1]] = parseJsonValue(parameter[2].trim());
    }
    calls.push({ id: deepId(), name, args });
  }
  return calls;
}

function resolveAllowedToolName(requested: string, allowed: Set<string | undefined>): string {
  const plain = requested.trim();
  if (allowed.has(plain)) return plain;
  const vectra = `vectra_${plain}`;
  return allowed.has(vectra) ? vectra : '';
}

function parseJsonValue(input: string): unknown {
  try { return JSON.parse(input); } catch { return input; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Never expose private reasoning or serialized tool markup as assistant prose. */
function stripInternalReasoning(raw: string): string {
  let text = String(raw ?? '');
  text = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  if (/<\/think>/i.test(text)) text = text.replace(/^[\s\S]*?<\/think>/i, '');
  text = text.replace(/<think\b[^>]*>[\s\S]*$/gi, '');
  return text;
}

function visibleModelText(raw: string): string {
  return stripInternalReasoning(raw)
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_call\b[^>]*>[\s\S]*$/gi, '')
    .trim();
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

/** Wraps one Vectra host tool as a LangChain tool, shared by the top-level agent and every subagent. */
function wrapVectraTool<TContext>(definition: VectraDeepTool<TContext>, context: TContext, events?: AgentEventStream) {
  return tool(
    async (input: Record<string, unknown>) => {
      events?.emit({ type: 'deepagent.tool.requested', tool: definition.name, input });
      const result = await definition.execute(input, context);
      events?.emit({ type: 'deepagent.tool.completed', tool: definition.name, result });
      return typeof result === 'string' ? result : JSON.stringify(result);
    },
    {
      name: definition.name,
      description: definition.description,
      schema: definition.schema ?? z.object({}).catchall(z.unknown())
    }
  );
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
