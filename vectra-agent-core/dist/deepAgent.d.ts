import { BaseMessage } from '@langchain/core/messages';
import { BaseChatModel, BaseChatModelCallOptions, BindToolsInput } from '@langchain/core/language_models/chat_models';
import { ChatResult } from '@langchain/core/outputs';
import { Runnable } from '@langchain/core/runnables';
import type { AnyBackendProtocol, AnySubAgent, FilesystemPermission } from 'deepagents';
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
    toolCalls?: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
    }>;
}
export interface VectraNativeToolResult {
    text: string;
    toolCalls: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
    }>;
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
    history?: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
    }>;
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
export declare class VectraDeepAgentRuntime<TContext = unknown> {
    private readonly options;
    private readonly agent;
    constructor(options: VectraDeepAgentOptions<TContext>);
    run(request: VectraDeepAgentRunRequest): Promise<VectraDeepAgentRunResult>;
}
/**
 * Adapts Vectra's provider-neutral text API to LangChain's chat-model API.
 * Bound tools are described in a strict JSON envelope, allowing small local
 * models without native tool calling to participate in the Deep Agents loop.
 */
export declare class VectraLangChainChatModel extends BaseChatModel<BaseChatModelCallOptions> {
    private readonly provider;
    private readonly modelId;
    private readonly events?;
    private readonly boundTools;
    constructor(provider: VectraCompletionProvider, modelId: string, events?: AgentEventStream | undefined, tools?: BindToolsInput[]);
    _llmType(): string;
    bindTools(tools: BindToolsInput[]): Runnable;
    _generate(messages: BaseMessage[], options: BaseChatModelCallOptions): Promise<ChatResult>;
}
//# sourceMappingURL=deepAgent.d.ts.map