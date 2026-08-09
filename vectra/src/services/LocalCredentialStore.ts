import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProviderId } from '../types';

type CloudProvider = Extract<ProviderId, 'openai' | 'anthropic' | 'gemini' | 'openaiCompatible'>;
interface CredentialFile { version: 1; keys: Partial<Record<CloudProvider, string>> }

export class LocalCredentialStore {
  readonly directory = path.join(os.homedir(), '.agent', 'vectra');
  readonly filePath = path.join(this.directory, 'credentials.json');

  async get(provider: ProviderId): Promise<string | undefined> {
    if (!isCloudProvider(provider)) return undefined;
    const data = await this.read();
    return data.keys[provider]?.trim() || undefined;
  }

  async set(provider: ProviderId, value: string): Promise<void> {
    if (!isCloudProvider(provider)) throw new Error(`${provider} does not use an API key here.`);
    const data = await this.read();
    data.keys[provider] = value.trim();
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { await fs.chmod(this.directory, 0o700); } catch { /* Windows may not map POSIX modes. */ }
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { await fs.chmod(this.filePath, 0o600); } catch { /* Windows may not map POSIX modes. */ }
  }

  async delete(provider: ProviderId): Promise<void> {
    if (!isCloudProvider(provider)) return;
    const data = await this.read();
    delete data.keys[provider];
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { await fs.chmod(this.directory, 0o700); } catch { /* Windows may not map POSIX modes. */ }
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  async has(provider: ProviderId): Promise<boolean> { return Boolean(await this.get(provider)); }

  private async read(): Promise<CredentialFile> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<CredentialFile>;
      return { version: 1, keys: parsed.keys ?? {} };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { version: 1, keys: {} };
      if (error instanceof SyntaxError) throw new Error(`Vectra credential file is invalid JSON: ${this.filePath}`);
      throw error;
    }
  }
}

function isCloudProvider(provider: ProviderId): provider is CloudProvider {
  return provider === 'openai' || provider === 'anthropic' || provider === 'gemini' || provider === 'openaiCompatible';
}
