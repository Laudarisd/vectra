// Beginner guide: Handles d ee pa ge nt ru nt im e responsibilities for Vectra.
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
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
  /** 'minimal' asks a thinking-capable model to skip extended reasoning for this turn. */
  reasoning?: 'minimal';
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
  /** Hard ceiling on LangGraph node transitions for one run. Falsy derives it from `maxSteps`. */
  recursionLimit?: number;
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
  /** Set when a harness guard ended the run instead of the model's own final answer. */
  stopReason?: 'recursion-limit' | 'tool-loop';
}

/**
 * LangGraph counts every node transition, not every agent turn. One Vectra step
 * is really a model node, a tool node, and the planning/subagent middleware
 * around them, so the old `maxSteps * 3` under-counted by roughly half: the
 * default 12-step budget produced a limit of 36 and any "go deeper" follow-up
 * tripped `GraphRecursionError` mid-run. These give a normal deep run headroom
 * while still bounding a runaway graph.
 */
const GRAPH_STEPS_PER_AGENT_STEP = 8;
const MIN_GRAPH_RECURSION_LIMIT = 120;

export function resolveRecursionLimit(options: { maxSteps?: number; recursionLimit?: number }): number {
  const explicit = Math.floor(options.recursionLimit ?? 0);
  if (explicit > 0) return Math.max(8, explicit);
  return Math.max(MIN_GRAPH_RECURSION_LIMIT, (options.maxSteps ?? 20) * GRAPH_STEPS_PER_AGENT_STEP);
}

/** The adapter's own guard against a model re-issuing one identical tool call forever. */
export function isRepeatedToolLoopError(error: unknown): boolean {
  return /REPEATED_TOOL_LOOP/.test(messageOf(error));
}

/** LangGraph's own recursion guard, matched by name and by message for wrapped/serialized errors. */
export function isRecursionLimitError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'GraphRecursionError') return true;
  return /recursion limit of \d+ reached/i.test(messageOf(error));
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
        'Host tools enforce plans, human review, and approvals; do not attempt to bypass them.',
        'Never end a turn with only a statement of what you are about to do. Either call the tool in that same turn, or give the complete answer.'
      ].filter(Boolean).join('\n\n')
    });
  }

  /** One tool-free completion that turns a finished-but-silent run into a real answer. */
  private async closeOut(messages: unknown[], signal?: AbortSignal): Promise<string> {
    const transcript = runTranscript(messages);
    if (!transcript) return '';
    this.options.events?.emit({ type: 'deepagent.closing_answer.requested' });
    try {
      const raw = await this.options.provider.complete({
        systemPrompt: 'You are Vectra. Write the final answer for the user, grounded only in the work recorded below. ' +
          'Plain prose: no JSON, no tool syntax, no private reasoning. Name the real files you looked at or changed. ' +
          'If a step did not finish, say so plainly instead of claiming it did.',
        userPrompt: `WORK COMPLETED THIS RUN\n${transcript}\n\nWrite the final answer now.`,
        model: this.options.model,
        structured: false,
        signal
      });
      return visibleModelText(raw);
    } catch {
      // A failed wrap-up must not fail the run; the caller has its own fallback.
      return '';
    }
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
    // Kept so a run stopped by a harness guard can still hand back the model's
    // most recent prose instead of only an error string.
    let latestModelText = '';
    const callbacks = BaseCallbackHandler.fromMethods({
      handleLLMEnd: (output) => {
        const text = generationText(output);
        if (text) latestModelText = text;
      },
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
          recursionLimit: resolveRecursionLimit(this.options),
          signal: request.signal,
          callbacks: [callbacks]
        }
      );
      const stateMessages = (state as { messages?: unknown[] }).messages ?? [];
      // A local model regularly closes the loop with an empty turn: its whole
      // reply was internal reasoning, or the response was cut off mid-<think>.
      // The run itself finished correctly, so write the answer from what it did
      // rather than showing a placeholder or a stale progress line.
      const text = finalAssistantText(stateMessages) || await this.closeOut(stateMessages, request.signal);
      this.options.events?.emit({ type: 'deepagent.state.changed', threadId: request.threadId, state: summarizeState(state) });
      this.options.events?.emit({ type: 'deepagent.completed', threadId: request.threadId, text });
      return { text, state, harness: 'deepagents' };
    } catch (error) {
      // Running out of graph steps is a budget outcome, not a crash. Surfacing
      // LangGraph's raw GraphRecursionError (and its docs URL) told the user
      // nothing actionable, so end the turn with the work done so far.
      if (isRecursionLimitError(error)) {
        const text = recursionLimitSummary(latestModelText, resolveRecursionLimit(this.options));
        this.options.events?.emit({ type: 'deepagent.step_budget.reached', threadId: request.threadId });
        this.options.events?.emit({ type: 'deepagent.completed', threadId: request.threadId, text });
        return { text, state: {}, harness: 'deepagents', stopReason: 'recursion-limit' };
      }
      // Same treatment for the identical-tool-call guard: it is the harness
      // protecting the user's time, so it must end as an explanation the user
      // can act on, never as a raw REPEATED_TOOL_LOOP error string.
      if (isRepeatedToolLoopError(error)) {
        const text = toolLoopSummary(latestModelText);
        this.options.events?.emit({ type: 'deepagent.completed', threadId: request.threadId, text });
        return { text, state: {}, harness: 'deepagents', stopReason: 'tool-loop' };
      }
      this.options.events?.emit({ type: 'deepagent.failed', threadId: request.threadId, error: messageOf(error) });
      throw error;
    }
  }
}

/** Prefixes a guard explanation with whatever real progress the model had already written. */
function withProgress(latestModelText: string, explanation: string): string {
  const progress = latestModelText.trim();
  return progress ? `${progress}\n\n${explanation}` : explanation;
}

/** Plain-language replacement for LangGraph's raw recursion error. */
function recursionLimitSummary(latestModelText: string, limit: number): string {
  return withProgress(
    latestModelText,
    `I stopped here because this run hit its step budget (${limit} internal steps), so I did not get to a final answer. ` +
    'Ask me to continue and I will pick up from this point, or narrow the request to one area so it fits. ' +
    'To allow longer runs, raise "vectra.maxAgentSteps" (or set "vectra.deepAgentRecursionLimit" directly) in Settings.'
  );
}

/** Plain-language replacement for the adapter's raw REPEATED_TOOL_LOOP error. */
function toolLoopSummary(latestModelText: string): string {
  return withProgress(
    latestModelText,
    'I stopped because I kept calling the same tool with the same arguments without making progress. ' +
    'Point me at the exact file or folder to work with, or narrow the request, and I will take it from there.'
  );
}

/** Best-effort text of an LLM result, used only to preserve partial progress. */
function generationText(output: unknown): string {
  const generations = (output as { generations?: unknown[][] } | undefined)?.generations;
  if (!Array.isArray(generations)) return '';
  for (let index = generations.length - 1; index >= 0; index--) {
    for (const generation of generations[index] ?? []) {
      const text = String((generation as { text?: unknown })?.text ?? '').trim();
      if (text) return visibleModelText(text);
    }
  }
  return '';
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
    const turn = await this.respond(messages, options);

    // LangGraph ends the run as soon as a turn carries no tool call, so a model
    // that narrates its next move ("Let me first read ChatViewProvider…") and
    // calls nothing stops the whole request and hands the user that sentence as
    // the final answer. Re-ask once, telling it to act or answer for real.
    if (!turn.calls.length && this.boundTools.length && announcesPendingAction(turn.text)) {
      this.events?.emit({ type: 'deepagent.stalled_narration', text: turn.text });
      const retried = await this.respond([...messages, new HumanMessage(ACT_OR_ANSWER_NUDGE)], options);
      if (retried.calls.length || retried.text.trim()) return this.result(retried);
    }
    return this.result(turn);
  }

  /** One provider round trip, normalized to text plus tool calls. */
  private async respond(messages: BaseMessage[], options: BaseChatModelCallOptions): Promise<ParsedTurn> {
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
        if (result.toolCalls.length) {
          return {
            text: stripInternalReasoning(result.text),
            calls: rerouteUnknownToolCalls(result.toolCalls.map(withCallId), boundToolNames(this.boundTools))
          };
        }
        return parseToolEnvelope(result.text, this.boundTools);
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
    return parseToolEnvelope(raw, this.boundTools);
  }

  private result(turn: ParsedTurn): ChatResult {
    this.guardRepeatedToolLoop(turn.calls);
    const message = new AIMessage({
      content: turn.text,
      tool_calls: turn.calls.map((call) => ({
        id: call.id,
        name: call.name,
        args: call.args,
        type: 'tool_call' as const
      }))
    });
    return { generations: [{ text: turn.text, message }] };
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

/** One model turn after parsing: the prose to show and the tools it asked for. */
interface ParsedTurn {
  text: string;
  calls: ParsedToolCall[];
}

function withCallId(call: { id?: string; name: string; args: Record<string, unknown> }): ParsedToolCall {
  return { id: call.id ?? deepId(), name: call.name, args: call.args };
}

function boundToolNames(tools: BindToolsInput[]): ReadonlySet<string> {
  return new Set(tools.map((value) => (value as { name?: string }).name).filter((name): name is string => Boolean(name)));
}

/** Identifier-shaped tool names only; anything else is malformed output, not a capability guess. */
const CAPABILITY_NAME_PATTERN = /^[a-z][a-z0-9_]{2,64}$/i;

/**
 * In discovery mode only vectra_search_tools and vectra_invoke_tool are bound,
 * but a model under pressure guesses direct capability names ("Let me try
 * using the vectra_read_file tool instead..."). Such a call used to reach
 * LangGraph as an unknown tool, and the resulting error loop burned the whole
 * step budget. Rewriting it into a vectra_invoke_tool invocation runs the real
 * capability the model meant, or returns one clear, suggestion-bearing error.
 */
function rerouteUnknownToolCalls(calls: ParsedToolCall[], bound: ReadonlySet<string>): ParsedToolCall[] {
  if (!bound.has('vectra_invoke_tool')) return calls;
  return calls.map((call) => {
    if (bound.has(call.name) || !CAPABILITY_NAME_PATTERN.test(call.name)) return call;
    const capability = call.name.startsWith('vectra_') ? call.name.slice('vectra_'.length) : call.name;
    return { id: call.id, name: 'vectra_invoke_tool', args: { name: capability, arguments: call.args } };
  });
}

const ACT_OR_ANSWER_NUDGE =
  'You described what you were about to do but called no tool, so nothing happened. ' +
  'Call the tool now, in this turn, to actually do it. ' +
  'If no tool is needed, give the complete answer instead. ' +
  'Never reply with only a statement of what you are about to do next.';

/**
 * First-person promises of an imminent action: "Let me read X", "I'll start by
 * checking Y", "I will now search Z". Paired with an empty tool-call list this
 * is a stalled turn, not an answer.
 *
 * The length ceiling keeps a genuine long explanation that happens to open with
 * "I'll walk you through this" out of the guard -- a real answer carries its
 * content with it, a stall is a single sentence of intent.
 */
const PENDING_ACTION_PATTERN =
  /\b(?:let(?:'s| us| me)|i(?:'ll| will| am going to| going to)|first,? i(?:'ll| will)|now i(?:'ll| will))\b[^.!?\n]{0,120}\b(?:read|check|look|inspect|examine|review|search|explore|scan|open|list|find|start|begin|create|add|write|update|modify|edit|implement|build|fix|run|analyz\w*|investigat\w*)\b/i;

const MAX_STALL_NARRATION_CHARACTERS = 900;

export function announcesPendingAction(text: string): boolean {
  const value = String(text ?? '').trim();
  if (!value || value.length > MAX_STALL_NARRATION_CHARACTERS) return false;
  return PENDING_ACTION_PATTERN.test(value);
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
    const supplied = record.args && typeof record.args === 'object' && !Array.isArray(record.args)
      ? record.args as Record<string, unknown>
      : Object.fromEntries(Object.entries(record).filter(([key]) => !['id', 'name', 'type'].includes(key)));
    if (!name) {
      // A plausible-but-unbound capability guess used to be dropped silently,
      // leaving the turn with prose and no action. Route it through the
      // discovery dispatcher instead, which either runs the real capability or
      // answers with the closest real names.
      if (allowed.has('vectra_invoke_tool') && CAPABILITY_NAME_PATTERN.test(requestedName)) {
        const capability = deepName || requestedName.replace(/^vectra_/, '');
        calls.push({ id: String(record.id ?? deepId()), name: 'vectra_invoke_tool', args: { name: capability, arguments: supplied } });
      }
      continue;
    }
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

/**
 * The final answer is only the assistant prose written after the last tool
 * result. The previous version skipped past tool and user messages entirely, so
 * whenever the closing turn came back empty it resurrected a mid-run narration
 * ("Reading ChatViewProvider to understand the button layout") and presented
 * that to the user as the answer.
 */
function finalAssistantText(messages: unknown[]): string {
  const parts: string[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as { content?: unknown; getType?: () => string };
    const type = message?.getType?.();
    if (type && type !== 'ai') break;
    const text = visibleModelText(contentText((message?.content ?? '') as BaseMessage['content']));
    if (text) parts.unshift(text);
  }
  return parts.join('\n\n').trim();
}

/** Compact record of what the run actually did, used only to close out an empty final turn. */
function runTranscript(messages: unknown[]): string {
  const lines: string[] = [];
  for (const value of messages.slice(-24)) {
    const message = value as { content?: unknown; getType?: () => string; name?: string };
    const type = message?.getType?.() ?? 'ai';
    if (type === 'system') continue;
    const text = visibleModelText(contentText((message?.content ?? '') as BaseMessage['content']));
    if (!text) continue;
    const label = type === 'tool' ? `TOOL ${message.name ?? ''}`.trim() : type === 'human' ? 'USER' : 'ASSISTANT';
    lines.push(`${label}: ${text.length > 1_500 ? `${text.slice(0, 1_500)}…` : text}`);
  }
  return lines.join('\n\n');
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
