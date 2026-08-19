import { ModelInfo, ProviderRequest, TextProvider } from '../types';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';

export class LlamaCppProvider implements TextProvider {
  readonly id = 'llamaCpp' as const;
  private readonly delegate: OpenAICompatibleProvider;
  constructor(baseUrl: string, timeoutMs = 900_000) { this.delegate = new OpenAICompatibleProvider(baseUrl, undefined, true, timeoutMs); }
  complete(request: ProviderRequest): Promise<string> { return this.delegate.complete(request); }
  listModels(signal?: AbortSignal): Promise<ModelInfo[]> { return this.delegate.listModels(signal); }
  async testConnection(signal?: AbortSignal): Promise<string> {
    const models = await this.listModels(signal);
    return `Connected to local llama.cpp. ${models.length || 1} model(s) available.`;
  }
}
