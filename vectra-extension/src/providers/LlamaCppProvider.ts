import { ModelInfo, NativeToolCall, NativeToolRequest, NativeToolResult, ProviderRequest, TextProvider } from '../types';
import { fetchJson } from '../utils/http';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';

export class LlamaCppProvider implements TextProvider {
  readonly id = 'llamaCpp' as const;
  private readonly delegate: OpenAICompatibleProvider;
  private nativeToolsUnavailable = false;
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 900_000) { this.delegate = new OpenAICompatibleProvider(baseUrl, undefined, true, timeoutMs); }
  complete(request: ProviderRequest): Promise<string> { return this.delegate.complete(request); }
  async completeWithTools(request: NativeToolRequest): Promise<NativeToolResult> {
    if (this.nativeToolsUnavailable) throw new Error('NATIVE_TOOL_CALLING_UNSUPPORTED: disabled after an incompatible response.');
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
      const data = await fetchJson<NativeChatResponse>(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: request.signal
      }, this.timeoutMs);
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error('llama.cpp returned no assistant message.');
      return { text: message.content?.trim() ?? '', toolCalls: parseToolCalls(message.tool_calls ?? []) };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/HTTP (400|404|422)|tool.?call|chat template|jinja/i.test(detail)) {
        this.nativeToolsUnavailable = true;
        throw new Error(`NATIVE_TOOL_CALLING_UNSUPPORTED: ${detail}`);
      }
      throw error;
    }
  }
  listModels(signal?: AbortSignal): Promise<ModelInfo[]> { return this.delegate.listModels(signal); }
  async testConnection(signal?: AbortSignal): Promise<string> {
    const models = await this.listModels(signal);
    return `Connected to local llama.cpp. ${models.length || 1} model(s) available.`;
  }
}

interface NativeChatResponse {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown[] } }>;
}

function openAiToolCall(call: NativeToolCall): Record<string, unknown> {
  return { id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } };
}

function parseToolCalls(values: unknown[]): NativeToolCall[] {
  const calls: NativeToolCall[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const record = value as { id?: string; function?: { name?: string; arguments?: unknown } };
    const name = record.function?.name;
    if (!name) continue;
    let args: Record<string, unknown> = {};
    const raw = record.function?.arguments;
    if (typeof raw === 'string') {
      try { args = JSON.parse(raw) as Record<string, unknown>; } catch { args = {}; }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) args = raw as Record<string, unknown>;
    calls.push({ id: record.id ?? `call-${Date.now()}-${calls.length}`, name, args });
  }
  return calls;
}
