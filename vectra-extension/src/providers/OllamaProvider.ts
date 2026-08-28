import { ModelInfo, ProviderRequest, TextProvider } from '../types';
import { AGENT_ENVELOPE_SCHEMA } from '../agent/protocol';
import { fetchJson, streamNdjson } from '../utils/http';

interface OllamaChatResponse {
  message?: { content?: string };
}

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    model?: string;
    size?: number;
    details?: { parameter_size?: string; quantization_level?: string; family?: string };
  }>;
}

export class OllamaProvider implements TextProvider {
  readonly id = 'ollama' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly deviceMode: 'auto' | 'gpu' | 'cpu' = 'auto',
    private readonly contextSize = 8192,
    private readonly timeoutMs = 3_600_000
  ) {}

  async complete(request: ProviderRequest): Promise<string> {
    const options: Record<string, unknown> = {
      // Ollama silently truncates context to a small default (often 2K-4K)
      // unless told otherwise, which is a frequent cause of degraded answers
      // and mid-conversation "forgetting" on local models.
      num_ctx: this.contextSize,
      ...(this.deviceMode === 'cpu' ? { num_gpu: 0 } : {})
    };
    const body = {
      model: request.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt }
      ],
      // Keeping the model resident avoids Ollama's default 5-minute unload,
      // which otherwise reloads the whole model from disk on the next turn.
      keep_alive: '30m',
      options,
      // Conversational turns must not be forced into the tool envelope.
      ...(request.structured === false ? {} : { format: AGENT_ENVELOPE_SCHEMA })
    };

    if (request.structured === false && request.onDelta) {
      const text = await streamNdjson(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, stream: true }),
        signal: request.signal
      }, { onDelta: request.onDelta, idleTimeoutMs: this.timeoutMs, signal: request.signal });
      if (!text.trim()) throw new Error('Ollama returned no text output.');
      return text.trim();
    }

    const data = await fetchJson<OllamaChatResponse>(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: false }),
      signal: request.signal
    }, this.timeoutMs);
    const text = data.message?.content?.trim();
    if (!text) {
      throw new Error('Ollama returned no text output.');
    }
    return text;
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const data = await fetchJson<OllamaTagsResponse>(`${this.baseUrl}/api/tags`, { signal }, this.timeoutMs);
    return (data.models ?? []).map((model) => {
      const detailParts = [
        model.details?.family,
        model.details?.parameter_size,
        model.details?.quantization_level,
        model.size ? formatBytes(model.size) : undefined
      ].filter(Boolean);
      return { id: model.name, detail: detailParts.join(' · ') };
    });
  }

  async testConnection(signal?: AbortSignal): Promise<string> {
    const models = await this.listModels(signal);
    return `Connected to Ollama. ${models.length} local model(s) available.`;
  }
}

function formatBytes(bytes: number): string {
  const gib = bytes / 1024 / 1024 / 1024;
  return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
}
