import { ModelInfo, ProviderRequest, TextProvider } from '../types';
import { AGENT_ENVELOPE_SCHEMA } from '../agent/protocol';
import { fetchJson } from '../utils/http';

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
    private readonly deviceMode: 'auto' | 'gpu' | 'cpu' = 'auto'
  ) {}

  async complete(request: ProviderRequest): Promise<string> {
    const data = await fetchJson<OllamaChatResponse>(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt }
        ],
        // Keeping the model resident avoids Ollama's default 5-minute unload,
        // which otherwise reloads the whole model from disk on the next turn.
        keep_alive: '30m',
        // 'cpu' forces every layer off the GPU; 'auto'/'gpu' leave Ollama's
        // own (multi-)GPU auto-placement in charge, so no override is sent.
        ...(this.deviceMode === 'cpu' ? { options: { num_gpu: 0 } } : {}),
        // Conversational turns must not be forced into the tool envelope.
        ...(request.structured === false ? {} : { format: AGENT_ENVELOPE_SCHEMA })
      }),
      signal: request.signal
    });
    const text = data.message?.content?.trim();
    if (!text) {
      throw new Error('Ollama returned no text output.');
    }
    return text;
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const data = await fetchJson<OllamaTagsResponse>(`${this.baseUrl}/api/tags`, { signal });
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
