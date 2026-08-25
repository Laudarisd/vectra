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

export interface DiscoveredRuntimeModel {
  kind: 'runtime';
  id: string;
  label: string;
  detail: string;
  baseUrl: string;
}

export type DiscoveredLocalModel = DiscoveredGgufModel | DiscoveredOllamaModel | DiscoveredRuntimeModel;

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
 *
 * extraRoots and the app-specific caches (huggingface/lm-studio/jan/...) are
 * scanned to completion in a first pass before touching broad personal
 * folders (Downloads/Documents/Desktop) in a second pass, sharing the same
 * budget and results. A single interleaved BFS across every root would let a
 * large Downloads/Documents tree exhaust maxDirectories before the scan ever
 * reaches the app caches that actually hold models.
 */
export async function discoverGgufModels(
  extraRoots: string[] = [],
  maxDirectories = 20_000,
  maxModels = 500
): Promise<DiscoveredGgufModel[]> {
  const visited = new Set<string>();
  const models: DiscoveredGgufModel[] = [];
  const budget = () => maxDirectories - visited.size;

  await scanRoots(
    uniqueExistingCandidates([...extraRoots, ...appModelDirectories()]),
    visited, models, budget(), maxModels
  );
  await scanRoots(
    uniqueExistingCandidates(broadModelDirectories()),
    visited, models, budget(), maxModels
  );

  return deduplicate(models, (model) => model.id.toLowerCase())
    .sort((left, right) => left.label.localeCompare(right.label));
}

async function scanRoots(
  roots: string[],
  visited: Set<string>,
  models: DiscoveredGgufModel[],
  directoryBudget: number,
  maxModels: number
): Promise<void> {
  const queue = roots.map((directory) => ({ directory, depth: 0 }));
  const visitLimit = visited.size + Math.max(0, directoryBudget);

  while (queue.length && visited.size < visitLimit && models.length < maxModels) {
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
      // A symlink/junction (common when a models folder is redirected to
      // another drive) reports false from both isDirectory() and isFile() on
      // Windows — resolve it with stat() instead of silently dropping it.
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const resolved = await fs.stat(fullPath);
          isDir = resolved.isDirectory();
          isFile = resolved.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        if (current.depth < 12 && !SKIPPED_DIRECTORIES.has(entry.name)) {
          queue.push({ directory: fullPath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!isFile || !isSelectableGguf(entry.name)) continue;

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

/** Narrow, app-specific caches that are worth scanning to completion first — this is where real models actually live. */
export function appModelDirectories(): string[] {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  const programData = process.env.PROGRAMDATA || '';
  const hfHome = process.env.HF_HOME || '';
  return [
    path.join(home, '.vectra', 'models'),
    path.join(home, 'models'),
    path.join(home, 'Models'),
    path.join(home, '.cache', 'huggingface', 'hub'),
    hfHome && path.join(hfHome, 'hub'),
    path.join(home, '.cache', 'lm-studio', 'models'),
    path.join(home, '.lmstudio', 'models'),
    path.join(home, '.ollama', 'models'),
    path.join(home, '.cache', 'gpt4all'),
    path.join(home, 'gpt4all'),
    path.join(home, 'text-generation-webui', 'models'),
    path.join(home, 'koboldcpp', 'models'),
    path.join(home, 'llama.cpp', 'models'),
    path.join(home, 'Library', 'Application Support', 'LM Studio', 'models'),
    path.join(home, 'Library', 'Application Support', 'Jan', 'data', 'models'),
    path.join(home, 'Library', 'Application Support', 'nomic.ai', 'GPT4All'),
    path.join(home, '.local', 'share', 'Jan', 'models'),
    path.join(home, '.local', 'share', 'nomic.ai', 'GPT4All'),
    localAppData && path.join(localAppData, 'LM Studio', 'models'),
    localAppData && path.join(localAppData, 'nomic.ai', 'GPT4All'),
    localAppData && path.join(localAppData, 'Jan', 'data', 'models'),
    appData && path.join(appData, 'jan', 'models'),
    appData && path.join(appData, 'GPT4All'),
    programData && path.join(programData, 'GPT4All', 'models')
  ].filter(Boolean);
}

/** Broad personal folders that can contain models but are large enough to exhaust the scan budget if searched first. */
export function broadModelDirectories(): string[] {
  const home = os.homedir();
  return [
    path.join(home, 'Downloads'),
    path.join(home, 'Documents'),
    path.join(home, 'Desktop')
  ];
}

export function commonModelDirectories(): string[] {
  return [...appModelDirectories(), ...broadModelDirectories()];
}

/** Detect models exposed by common local OpenAI-compatible runtimes. */
export async function discoverOpenAICompatibleModels(): Promise<DiscoveredRuntimeModel[]> {
  const runtimes = [
    { name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
    { name: 'Jan', baseUrl: 'http://127.0.0.1:1337/v1' },
    { name: 'GPT4All', baseUrl: 'http://127.0.0.1:4891/v1' },
    { name: 'KoboldCpp', baseUrl: 'http://127.0.0.1:5001/v1' },
    { name: 'Text generation web UI', baseUrl: 'http://127.0.0.1:5000/v1' },
    { name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1' },
    { name: 'llama.cpp / LocalAI', baseUrl: 'http://127.0.0.1:8080/v1' }
  ];
  const results = await Promise.all(runtimes.map(async (runtime) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_800);
    try {
      const response = await fetch(`${runtime.baseUrl}/models`, { signal: controller.signal });
      if (!response.ok) return [];
      const data = await response.json() as { data?: Array<{ id?: string }> };
      return (data.data ?? []).flatMap((model) => model.id ? [{
        kind: 'runtime' as const,
        id: model.id,
        label: model.id,
        detail: `${runtime.name} · ${runtime.baseUrl}`,
        baseUrl: runtime.baseUrl
      }] : []);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }));
  return deduplicate(results.flat(), (model) => `${model.baseUrl}\0${model.id}`)
    .sort((left, right) => left.label.localeCompare(right.label));
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

export function formatBytes(bytes: number): string {
  const gib = bytes / 1024 / 1024 / 1024;
  if (gib >= 0.1) return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MiB`;
}
