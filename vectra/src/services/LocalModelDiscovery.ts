import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface DiscoveredGgufModel {
  kind: 'gguf';
  id: string;
  label: string;
  detail: string;
  size: number;
}

export interface DiscoveredOllamaModel {
  kind: 'ollama';
  id: string;
  label: string;
  detail: string;
  size?: number;
}

export type DiscoveredLocalModel = DiscoveredGgufModel | DiscoveredOllamaModel;

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    size?: number;
    details?: { family?: string; parameter_size?: string; quantization_level?: string };
  }>;
}

const SKIPPED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.venv', 'venv',
  '__pycache__', 'coverage', 'AppData', 'Library'
]);

/**
 * Search common model locations without crawling the entire computer.
 * Directory and result caps keep detection responsive on very large homes.
 */
export async function discoverGgufModels(
  extraRoots: string[] = [],
  maxDirectories = 4_000,
  maxModels = 80
): Promise<DiscoveredGgufModel[]> {
  const roots = uniqueExistingCandidates([...extraRoots, ...commonModelDirectories()]);
  const queue = roots.map((directory) => ({ directory, depth: 0 }));
  const visited = new Set<string>();
  const models: DiscoveredGgufModel[] = [];

  while (queue.length && visited.size < maxDirectories && models.length < maxModels) {
    const current = queue.shift()!;
    const key = path.resolve(current.directory).toLowerCase();
    if (visited.has(key)) continue;
    visited.add(key);

    let entries;
    try {
      entries = await fs.readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (models.length >= maxModels) break;
      const fullPath = path.join(current.directory, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 6 && !SKIPPED_DIRECTORIES.has(entry.name)) {
          queue.push({ directory: fullPath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || !isSelectableGguf(entry.name)) continue;

      try {
        const stat = await fs.stat(fullPath);
        models.push({
          kind: 'gguf',
          id: normalizeShardPath(fullPath),
          label: path.basename(normalizeShardPath(fullPath)),
          detail: `${formatBytes(stat.size)} · ${path.dirname(fullPath)}`,
          size: stat.size
        });
      } catch {
        // A model may disappear while detection is running; skip it safely.
      }
    }
  }

  return deduplicate(models, (model) => model.id.toLowerCase())
    .sort((left, right) => left.label.localeCompare(right.label));
}

/** Detect models exposed by a locally running Ollama installation. */
export async function discoverOllamaModels(baseUrl: string): Promise<DiscoveredOllamaModel[]> {
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    return [];
  }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(endpoint.hostname)) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_800);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: controller.signal });
    if (!response.ok) return [];
    const data = await response.json() as OllamaTagsResponse;
    return (data.models ?? []).flatMap((model) => {
      if (!model.name) return [];
      const details = [
        model.details?.family,
        model.details?.parameter_size,
        model.details?.quantization_level,
        model.size ? formatBytes(model.size) : undefined
      ].filter(Boolean).join(' · ');
      return [{
        kind: 'ollama' as const,
        id: model.name,
        label: model.name,
        detail: details || 'Installed Ollama model',
        size: model.size
      }];
    }).sort((left, right) => left.label.localeCompare(right.label));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function commonModelDirectories(): string[] {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  return [
    path.join(home, 'models'),
    path.join(home, 'Models'),
    path.join(home, 'Downloads'),
    path.join(home, '.cache', 'huggingface', 'hub'),
    path.join(home, '.cache', 'lm-studio', 'models'),
    path.join(home, '.lmstudio', 'models'),
    path.join(home, '.ollama', 'models'),
    localAppData && path.join(localAppData, 'LM Studio', 'models'),
    localAppData && path.join(localAppData, 'nomic.ai', 'GPT4All'),
    appData && path.join(appData, 'jan', 'models')
  ].filter(Boolean);
}

export function normalizeShardPath(filePath: string): string {
  const match = filePath.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
  return match ? `${match[1]}-00001-of-${match[3]}.gguf` : filePath;
}

function isSelectableGguf(fileName: string): boolean {
  if (!fileName.toLowerCase().endsWith('.gguf')) return false;
  if (/^mmproj.*\.gguf$/i.test(fileName)) return false;
  const shard = fileName.match(/-(\d{5})-of-\d{5}\.gguf$/i);
  return !shard || shard[1] === '00001';
}

function uniqueExistingCandidates(values: string[]): string[] {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function deduplicate<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function formatBytes(bytes: number): string {
  const gib = bytes / 1024 / 1024 / 1024;
  if (gib >= 0.1) return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MiB`;
}
