// Stores API keys in VS Code's encrypted SecretStorage and migrates older plaintext keys once.
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SecretStorage } from 'vscode';
import { ProviderId } from '../types';

type CloudProvider = Extract<ProviderId, 'openai' | 'anthropic' | 'gemini' | 'openaiCompatible'>;
type SecretStorageLike = Pick<SecretStorage, 'get' | 'store' | 'delete'>;

interface LegacyCredentialFile {
  version?: number;
  keys?: Partial<Record<CloudProvider, string>>;
}

const CLOUD_PROVIDERS: readonly CloudProvider[] = ['openai', 'anthropic', 'gemini', 'openaiCompatible'];
const SECRET_PREFIX = 'vectra.apiKey.';

/**
 * Keeps provider keys out of settings and ordinary files.
 *
 * VS Code SecretStorage uses the operating system's protected credential
 * service. Existing Marketplace users may still have the old credentials.json
 * file, so the first access copies those values into SecretStorage and removes
 * the plaintext file only after every copy succeeds.
 */
export class LocalCredentialStore {
  readonly legacyFilePath: string;
  private migration?: Promise<void>;

  constructor(
    private readonly secrets: SecretStorageLike,
    legacyFilePath = path.join(os.homedir(), '.agent', 'vectra', 'credentials.json')
  ) {
    this.legacyFilePath = legacyFilePath;
  }

  async get(provider: ProviderId): Promise<string | undefined> {
    if (!isCloudProvider(provider)) return undefined;
    await this.ensureMigrated();
    return (await this.secrets.get(secretName(provider)))?.trim() || undefined;
  }

  async set(provider: ProviderId, value: string): Promise<void> {
    if (!isCloudProvider(provider)) throw new Error(`${provider} does not use an API key here.`);
    await this.ensureMigrated();
    const key = value.trim();
    if (key) await this.secrets.store(secretName(provider), key);
    else await this.secrets.delete(secretName(provider));
  }

  async delete(provider: ProviderId): Promise<void> {
    if (!isCloudProvider(provider)) return;
    await this.ensureMigrated();
    await this.secrets.delete(secretName(provider));
  }

  async has(provider: ProviderId): Promise<boolean> {
    return Boolean(await this.get(provider));
  }

  /** Share one migration promise when several UI requests arrive together. */
  private ensureMigrated(): Promise<void> {
    this.migration ??= this.migrateLegacyFile();
    return this.migration;
  }

  private async migrateLegacyFile(): Promise<void> {
    let legacy: LegacyCredentialFile;
    try {
      legacy = JSON.parse(await fs.readFile(this.legacyFilePath, 'utf8')) as LegacyCredentialFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      if (error instanceof SyntaxError) {
        throw new Error(`The old Vectra credential file is invalid JSON: ${this.legacyFilePath}`);
      }
      throw error;
    }

    for (const provider of CLOUD_PROVIDERS) {
      const oldKey = legacy.keys?.[provider]?.trim();
      if (!oldKey || await this.secrets.get(secretName(provider))) continue;
      await this.secrets.store(secretName(provider), oldKey);
    }

    // Deletion happens last. A failed SecretStorage write therefore never
    // destroys the user's only copy of a credential.
    await fs.rm(this.legacyFilePath, { force: true });
  }
}

function secretName(provider: CloudProvider): string {
  return `${SECRET_PREFIX}${provider}`;
}

function isCloudProvider(provider: ProviderId): provider is CloudProvider {
  return CLOUD_PROVIDERS.includes(provider as CloudProvider);
}
