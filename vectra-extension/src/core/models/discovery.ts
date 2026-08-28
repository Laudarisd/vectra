import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DiscoveredGgufModel { kind: 'gguf'; id: string; label: string; detail: string; size: number }
export interface DiscoveredOllamaModel { kind: 'ollama'; id: string; label: string; detail: string; size?: number }
export interface DiscoveredRuntimeModel { kind: 'runtime'; id: string; label: string; detail: string; baseUrl: string }
export type DiscoveredLocalModel = DiscoveredGgufModel | DiscoveredOllamaModel | DiscoveredRuntimeModel;

export interface LocalRuntimeTarget { name: string; baseUrl: string; discoveryUrl?: string; format?: 'ollama' | 'openai'; apiKey?: string }
export interface DiscoveredRuntime { name: string; baseUrl: string; models: string[] }
export interface InstalledModelInventory {
  gguf: DiscoveredGgufModel[];
  ollama: DiscoveredOllamaModel[];
  runtimes: DiscoveredRuntime[];
  runtimeModels: DiscoveredRuntimeModel[];
}

export const LOCAL_RUNTIME_TARGETS: readonly LocalRuntimeTarget[] = [
  { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', discoveryUrl: 'http://127.0.0.1:11434/api/tags', format: 'ollama' },
  { name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
  { name: 'Jan', baseUrl: 'http://127.0.0.1:1337/v1' },
  { name: 'GPT4All', baseUrl: 'http://127.0.0.1:4891/v1' },
  { name: 'KoboldCpp', baseUrl: 'http://127.0.0.1:5001/v1' },
  { name: 'Text generation web UI', baseUrl: 'http://127.0.0.1:5000/v1' },
  { name: 'llama.cpp / LocalAI', baseUrl: 'http://127.0.0.1:8080/v1' },
  { name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1' },
  { name: 'Msty', baseUrl: 'http://127.0.0.1:10000/v1' }
];

/** Directory names never worth descending into. Matched against child entries only:
 * roots are seeded straight into the queue, so skipping 'appdata' or 'programdata'
 * here is safe while appModelDirectories() still reaches the model folders inside
 * them. '.cache' must stay off this list — the Hugging Face hub lives there. */
const SKIPPED = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', 'coverage',
  '$recycle.bin', 'system volume information', 'windows', 'recovery', 'program files', 'program files (x86)', 'appdata',
  // Windows OS noise. The last three are legacy junctions that point back up the
  // profile; following them is what turns a deep walk into a combinatorial one.
  'programdata', 'perflogs', 'msocache', '$windows.~bt', '$windows.~ws',
  'documents and settings', 'application data', 'local settings',
  // Package and toolchain caches: reliably enormous, never hold a GGUF.
  'site-packages', 'anaconda3', 'miniconda3', '.conda', '.cargo', '.rustup',
  '.gradle', '.m2', '.nuget', '.npm', '.pnpm-store', '.yarn', '.tox', '.vs', '.idea'
]);

/** Wall-clock and breadth budgets. A GGUF walk is bounded by time first and
 * directory count second: on Windows with on-access virus scanning a single
 * readdir costs ~6ms, so an unbounded 20k-directory crawl of every drive letter
 * runs for over two minutes. */
export const DEFAULT_MAX_DIRECTORIES = 4_000;
export const SCOPED_TIME_BUDGET_MS = 5_000;
export const FIRST_RUN_TIME_BUDGET_MS = 12_000;
export const FULL_SCAN_TIME_BUDGET_MS = 60_000;
export const FULL_SCAN_MAX_DIRECTORIES = 20_000;
/** A readdir on a disconnected mapped drive can hang for a minute and cannot be
 * aborted, so each one races a timer rather than blocking its whole batch. */
export const PER_DIR_TIMEOUT_MS = 2_000;

export interface GgufScanOptions {
  query?: string;
  roots?: string[];
  limit?: number;
  maxDirectories?: number;
  includeDefaults?: boolean;
  timeBudgetMs?: number;
  /** Depth applied to `roots`. The default tiers use their own shallower caps. */
  maxDepth?: number;
  /** Share one set across calls to keep cross-tier de-duplication while streaming. */
  visited?: Set<string>;
  signal?: AbortSignal;
}

export async function discoverGgufModels(options: GgufScanOptions = {}): Promise<DiscoveredGgufModel[]> {
  const paths = await findGgufPaths(options);
  const models = await Promise.all(paths.map(async (filePath): Promise<DiscoveredGgufModel | undefined> => {
    try {
      const size = (await fs.stat(filePath)).size;
      return { kind: 'gguf', id: filePath, label: path.basename(filePath), detail: `${formatBytes(size)} · ${path.dirname(filePath)}`, size };
    } catch { return undefined; }
  }));
  return models.filter((item): item is DiscoveredGgufModel => Boolean(item)).sort((a, b) => natural(a.label, b.label));
}

export async function searchGgufModels(options: GgufScanOptions = {}): Promise<string[]> {
  return findGgufPaths(options);
}

async function findGgufPaths({
  query = '',
  roots = [],
  limit = 500,
  maxDirectories = DEFAULT_MAX_DIRECTORIES,
  includeDefaults = true,
  timeBudgetMs = FIRST_RUN_TIME_BUDGET_MS,
  maxDepth = 8,
  visited = new Set<string>(),
  signal
}: GgufScanOptions): Promise<string[]> {
  const needle = query.trim().toLowerCase();
  const output: string[] = [];
  const start = Date.now();
  // Deadlines are absolute and cumulative: a tier that finishes early donates its
  // unused time to the next, and the last one still lands on start + timeBudgetMs.
  const at = (fraction: number) => start + Math.max(1, Math.floor(timeBudgetMs * fraction));
  const tier = (tierRoots: string[], budget: number, deadline: number, depth: number) =>
    scan({ roots: tierRoots, visited, output, needle, limit, maxDirectories: budget, maxDepth: depth, deadline, signal });

  // A folder the user picked is authoritative, so it is searched first and deepest.
  if (roots.length) await tier(roots, maxDirectories, at(includeDefaults ? 0.5 : 1), maxDepth);
  if (!includeDefaults) return finishGgufPaths(output, limit);
  await tier(appModelDirectories(), Math.max(1, Math.floor(maxDirectories * 0.6)), at(0.7), 6);
  await tier(broadModelDirectories(), Math.max(1, Math.floor(maxDirectories * 0.8)), at(0.85), 4);
  await tier(storageModelDirectories(), maxDirectories, at(1), 4);
  return finishGgufPaths(output, limit);
}

async function scan({ roots, visited, output, needle, limit, maxDirectories, maxDepth, deadline, signal }: {
  roots: string[];
  visited: Set<string>;
  output: string[];
  needle: string;
  limit: number;
  maxDirectories: number;
  maxDepth: number;
  deadline: number;
  signal?: AbortSignal;
}): Promise<void> {
  const queue = uniquePaths(roots).map((directory) => ({ directory, depth: 0 }));
  const exhausted = () => output.length >= limit || signal?.aborted === true || Date.now() >= deadline;
  for (let cursor = 0; cursor < queue.length && visited.size < maxDirectories && !exhausted();) {
    const batch: Array<{ directory: string; depth: number }> = [];
    while (cursor < queue.length && batch.length < 24 && visited.size < maxDirectories) {
      const current = queue[cursor++];
      const key = await visitKey(current.directory);
      if (visited.has(key)) continue;
      visited.add(key);
      batch.push(current);
    }
    const reads = batch.map(async (current) => ({
      current,
      entries: await withTimeout(readEntries(current.directory), PER_DIR_TIMEOUT_MS, [] as Dirent[])
    }));
    // Race the whole batch against the deadline as well: the per-directory timeout
    // is the common guard, this is the backstop that keeps the bound honest.
    const results = await Promise.race([
      Promise.all(reads),
      sleepUntil(deadline).then(() => [] as Array<{ current: { directory: string; depth: number }; entries: Dirent[] }>)
    ]);
    reads.forEach((read) => void read.catch(() => undefined));
    for (const { current, entries } of results) {
      for (const entry of entries) {
        if (exhausted()) break;
        const full = path.join(current.directory, entry.name);
        let directory = entry.isDirectory();
        let file = entry.isFile();
        if (entry.isSymbolicLink()) {
          try { const value = await fs.stat(full); directory = value.isDirectory(); file = value.isFile(); } catch { continue; }
        }
        if (directory && current.depth < maxDepth && !SKIPPED.has(entry.name.toLowerCase())) queue.push({ directory: full, depth: current.depth + 1 });
        else if (file && isSelectableGguf(entry.name) && (!needle || entry.name.toLowerCase().includes(needle))) output.push(full);
      }
    }
  }
}

type Dirent = import('node:fs').Dirent;

async function readEntries(directory: string): Promise<Dirent[]> {
  try { return await fs.readdir(directory, { withFileTypes: true }); } catch { return []; }
}

/** Junctions and symlinks are followed deliberately, so identity has to come from
 * the real path — otherwise a self-referential profile junction reappears under a
 * new spelling at every depth and the walk never converges. */
async function visitKey(directory: string): Promise<string> {
  try { return (await fs.realpath(directory)).toLowerCase(); }
  catch { return path.resolve(directory).toLowerCase(); }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); }
    );
  });
}

function sleepUntil(deadline: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/** Finds Ollama models even when its server is stopped: API, CLI, and manifest index are merged. */
export async function discoverOllamaModels(baseUrl = 'http://127.0.0.1:11434'): Promise<DiscoveredOllamaModel[]> {
  const [api, cli, manifests] = await Promise.all([ollamaApi(baseUrl), ollamaCli(), ollamaManifests()]);
  return dedupe([...api, ...cli, ...manifests], (item) => item.id.toLowerCase()).sort((a, b) => natural(a.label, b.label));
}

async function ollamaApi(baseUrl: string): Promise<DiscoveredOllamaModel[]> {
  let url: URL;
  try { url = new URL(baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '')); } catch { return []; }
  if (!isLoopback(url.hostname)) return [];
  const data = await timedJson<{ models?: Array<{ name?: string; model?: string; size?: number; details?: { family?: string; parameter_size?: string; quantization_level?: string } }> }>(`${url}/api/tags`, {}, 1_800);
  return (data?.models ?? []).flatMap((item) => {
    const id = item.name || item.model;
    if (!id) return [];
    const detail = [item.details?.family, item.details?.parameter_size, item.details?.quantization_level, item.size ? formatBytes(item.size) : undefined].filter(Boolean).join(' · ');
    return [{ kind: 'ollama' as const, id, label: id, detail: detail || 'Installed Ollama model', size: item.size }];
  });
}

async function ollamaCli(): Promise<DiscoveredOllamaModel[]> {
  try {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'ollama.exe' : 'ollama', ['list'], { timeout: 3_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    return String(stdout).split(/\r?\n/).slice(1).flatMap((line) => {
      const id = line.trim().split(/\s+/)[0];
      return id ? [{ kind: 'ollama' as const, id, label: id, detail: 'Installed Ollama model · detected by CLI' }] : [];
    });
  } catch { return []; }
}

async function ollamaManifests(): Promise<DiscoveredOllamaModel[]> {
  const roots = uniquePaths([
    process.env.OLLAMA_MODELS ? path.join(process.env.OLLAMA_MODELS, 'manifests') : '',
    path.join(os.homedir(), '.ollama', 'models', 'manifests')
  ]);
  const files: string[] = [];
  for (const root of roots) await collectFiles(root, root, files, 0, 8);
  return Promise.all(files.map(async (file): Promise<DiscoveredOllamaModel | undefined> => {
    const relative = path.relative(path.dirname(path.dirname(path.dirname(file))), file).split(path.sep);
    if (relative.length < 3) return undefined;
    const model = relative.at(-2)!;
    const tag = relative.at(-1)!;
    let size: number | undefined;
    try {
      const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as { layers?: Array<{ size?: number }> };
      size = manifest.layers?.reduce((sum, layer) => sum + (layer.size ?? 0), 0);
    } catch { /* The path still identifies the installed model. */ }
    const id = `${model}:${tag}`;
    return { kind: 'ollama', id, label: id, detail: `Installed Ollama model · manifest${size ? ` · ${formatBytes(size)}` : ''}`, size };
  })).then((items) => items.filter((item): item is DiscoveredOllamaModel => Boolean(item)));
}

async function collectFiles(root: string, directory: string, output: string[], depth: number, maxDepth: number): Promise<void> {
  if (depth > maxDepth) return;
  let entries: import('node:fs').Dirent[];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(root, full, output, depth + 1, maxDepth);
    else if (entry.isFile()) output.push(full);
  }
}

export async function discoverLocalRuntimes(extra: LocalRuntimeTarget[] = []): Promise<DiscoveredRuntime[]> {
  const targets = dedupe([...LOCAL_RUNTIME_TARGETS, ...extra].map((item) => ({ ...item, discoveryUrl: item.discoveryUrl ?? `${item.baseUrl.replace(/\/+$/, '')}/models` })), (item) => item.discoveryUrl!);
  const found = await Promise.all(targets.map(async (runtime): Promise<DiscoveredRuntime | undefined> => {
    const data = await timedJson<{ models?: Array<{ name?: string; model?: string }>; data?: Array<{ id?: string }> }>(runtime.discoveryUrl!, runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {}, 1_800);
    const models = runtime.format === 'ollama'
      ? (data?.models ?? []).map((item) => item.name || item.model).filter((item): item is string => Boolean(item))
      : (data?.data ?? []).map((item) => item.id).filter((item): item is string => Boolean(item));
    return models.length ? { name: runtime.name, baseUrl: runtime.baseUrl, models: [...new Set(models)].sort(natural) } : undefined;
  }));
  return found.filter((item): item is DiscoveredRuntime => Boolean(item));
}

export async function discoverOpenAICompatibleModels(extra: LocalRuntimeTarget[] = []): Promise<DiscoveredRuntimeModel[]> {
  const runtimes = await discoverLocalRuntimes(extra);
  return runtimes.filter((runtime) => runtime.name !== 'Ollama').flatMap((runtime) => runtime.models.map((id) => ({
    kind: 'runtime' as const, id, label: id, detail: `${runtime.name} · ${runtime.baseUrl}`, baseUrl: runtime.baseUrl
  }))).sort((a, b) => natural(a.label, b.label));
}

/** One shared detection pass for both Vectra hosts. This includes offline GGUF
 * files, Ollama's API/CLI/on-disk manifests, and running local API servers. */
export async function discoverInstalledModels(options: {
  extraRoots?: string[];
  ollamaBaseUrl?: string;
  runtimeTargets?: LocalRuntimeTarget[];
  maxDirectories?: number;
  maxModels?: number;
  includeDefaults?: boolean;
  timeBudgetMs?: number;
  signal?: AbortSignal;
} = {}): Promise<InstalledModelInventory> {
  const [gguf, ollama, runtimes] = await Promise.all([
    discoverGgufModels({
      roots: options.extraRoots,
      maxDirectories: options.maxDirectories,
      limit: options.maxModels,
      includeDefaults: options.includeDefaults ?? true,
      timeBudgetMs: options.timeBudgetMs,
      signal: options.signal
    }),
    discoverOllamaModels(options.ollamaBaseUrl),
    discoverLocalRuntimes(options.runtimeTargets)
  ]);
  const runtimeModels = runtimes
    .filter((runtime) => runtime.name !== 'Ollama')
    .flatMap((runtime) => runtime.models.map((id) => ({
      kind: 'runtime' as const,
      id,
      label: id,
      detail: `${runtime.name} · ${runtime.baseUrl}`,
      baseUrl: runtime.baseUrl
    })))
    .sort((a, b) => natural(a.label, b.label));
  return { gguf, ollama, runtimes, runtimeModels };
}

export function appModelDirectories(): string[] {
  const home = os.homedir();
  const envRoots = ['HF_HOME', 'HUGGINGFACE_HUB_CACHE', 'LLAMA_MODELS', 'MODELS_DIR', 'GPT4ALL_MODEL_PATH'].map((name) => process.env[name] || '');
  return uniquePaths([
    path.join(home, '.vectra', 'models'), path.join(home, 'Models'), path.join(home, 'models'),
    path.join(home, '.cache', 'huggingface', 'hub'), process.env.HF_HOME ? path.join(process.env.HF_HOME, 'hub') : '',
    path.join(home, '.cache', 'lm-studio', 'models'), path.join(home, '.lmstudio', 'models'),
    path.join(home, '.cache', 'gpt4all'), path.join(home, 'gpt4all'), path.join(home, 'text-generation-webui', 'models'),
    path.join(home, 'koboldcpp', 'models'), path.join(home, 'llama.cpp', 'models'),
    path.join(home, '.local', 'share', 'Jan', 'models'), path.join(home, '.local', 'share', 'nomic.ai', 'GPT4All'),
    path.join(home, '.msty', 'models'),
    path.join(home, 'Library', 'Application Support', 'LM Studio', 'models'),
    path.join(home, 'Library', 'Application Support', 'Jan', 'data', 'models'),
    path.join(home, 'Library', 'Application Support', 'nomic.ai', 'GPT4All'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'LM Studio', 'models') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'nomic.ai', 'GPT4All') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Jan', 'data', 'models') : '',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'jan', 'models') : '',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Jan', 'data', 'models') : '',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'GPT4All') : '',
    process.env.PROGRAMDATA ? path.join(process.env.PROGRAMDATA, 'GPT4All', 'models') : '',
    process.env.XDG_CACHE_HOME ? path.join(process.env.XDG_CACHE_HOME, 'huggingface', 'hub') : '',
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'jan', 'models') : '',
    ...envRoots
  ]);
}

export function broadModelDirectories(): string[] { const home = os.homedir(); return [path.join(home, 'Downloads'), path.join(home, 'Documents'), path.join(home, 'Desktop')]; }
/** Last-pass roots cover arbitrary folders and secondary drives without making OS directories the priority. */
export function storageModelDirectories(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') return uniquePaths([home, ...'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`)]);
  return uniquePaths([home, ...(process.platform === 'darwin' ? ['/Volumes'] : ['/mnt', '/media'])]);
}
export function commonModelDirectories(): string[] { return [...appModelDirectories(), ...broadModelDirectories(), ...storageModelDirectories()]; }
export function defaultModelRoots(): string[] { return commonModelDirectories(); }
export function normalizeShardPath(filePath: string): string { const match = filePath.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i); return match ? `${match[1]}-00001-of-${match[3]}.gguf` : filePath; }
export function formatBytes(bytes: number): string { const gib = bytes / 1024 ** 3; return gib >= 0.1 ? `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB` : `${(bytes / 1024 ** 2).toFixed(0)} MiB`; }

async function timedJson<T>(url: string, headers: Record<string, string>, timeout: number): Promise<T | undefined> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try { const response = await fetch(url, { signal: controller.signal, headers }); return response.ok ? await response.json() as T : undefined; } catch { return undefined; } finally { clearTimeout(timer); }
}
function isLoopback(host: string): boolean { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host); }
function isSelectableGguf(name: string): boolean { if (!/\.gguf$/i.test(name) || /^mmproj/i.test(name)) return false; const shard = name.match(/-(\d{5})-of-\d{5}\.gguf$/i); return !shard || shard[1] === '00001'; }
function finishGgufPaths(values: string[], limit: number): string[] { return [...new Set(values.map(normalizeShardPath))].sort((a, b) => natural(path.basename(a), path.basename(b))).slice(0, limit); }
function uniquePaths(values: string[]): string[] { return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))]; }
function dedupe<T>(values: T[], key: (value: T) => string): T[] { const seen = new Set<string>(); return values.filter((item) => { const value = key(item); return seen.has(value) ? false : Boolean(seen.add(value)); }); }
function natural(a: string, b: string): number { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }
