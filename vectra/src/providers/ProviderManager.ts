import { ModelInfo, ProviderId, TextProvider } from '../types';
import { getConfig } from '../utils/config';
import { LocalCredentialStore } from '../services/LocalCredentialStore';
import { AnthropicProvider } from './AnthropicProvider';
import { GeminiProvider } from './GeminiProvider';
import { OllamaProvider } from './OllamaProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { LlamaCppProvider } from './LlamaCppProvider';

export class ProviderManager {
  constructor(private readonly credentials: LocalCredentialStore) {}

  async getProvider(): Promise<TextProvider> {
    const config = getConfig();
    switch (config.provider) {
      case 'llamaCpp':
        return new LlamaCppProvider(`http://127.0.0.1:${config.llamaCppPort}/v1`);
      case 'ollama':
        return new OllamaProvider(config.ollamaBaseUrl, config.deviceMode);
      case 'openai':
        return new OpenAIProvider(await this.requireKey('openai'), config.openaiBaseUrl);
      case 'anthropic':
        return new AnthropicProvider(await this.requireKey('anthropic'), config.anthropicBaseUrl);
      case 'gemini':
        return new GeminiProvider(await this.requireKey('gemini'), config.geminiBaseUrl);
      case 'openaiCompatible':
        return new OpenAICompatibleProvider(config.openaiCompatibleBaseUrl, await this.credentials.get('openaiCompatible'));
      default:
        return assertNever(config.provider);
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> { return (await this.getProvider()).listModels(signal); }
  async testConnection(signal?: AbortSignal): Promise<string> { return (await this.getProvider()).testConnection(signal); }
  async hasRequiredApiKey(provider: ProviderId): Promise<boolean> {
    if (provider === 'llamaCpp' || provider === 'ollama' || provider === 'openaiCompatible') return true;
    return this.credentials.has(provider);
  }
  private async requireKey(provider: ProviderId): Promise<string> {
    const key = await this.credentials.get(provider);
    if (!key) throw new Error(`No ${provider} API key is configured. Click “API Key” in Vectra.`);
    return key;
  }
}
function assertNever(value: never): never { throw new Error(`Unsupported provider: ${String(value)}`); }
