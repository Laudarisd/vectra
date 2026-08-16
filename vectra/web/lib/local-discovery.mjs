import { readdir } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';

const RUNTIMES = [
  { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', discoveryUrl: 'http://127.0.0.1:11434/api/tags', format: 'ollama' },
  { name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', discoveryUrl: 'http://127.0.0.1:1234/v1/models' },
  { name: 'llama.cpp / LocalAI', baseUrl: 'http://127.0.0.1:8080/v1', discoveryUrl: 'http://127.0.0.1:8080/v1/models' },
  { name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1', discoveryUrl: 'http://127.0.0.1:8000/v1/models' },
  { name: 'Local runtime', baseUrl: 'http://127.0.0.1:5000/v1', discoveryUrl: 'http://127.0.0.1:5000/v1/models' }
];

export async function discoverLocalRuntimes(extra = []) {
  const targets = deduplicateTargets([...RUNTIMES, ...extra]);
  const found = await Promise.all(targets.map(probeRuntime));
  return found.filter(Boolean);
}

async function probeRuntime(runtime) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(runtime.discoveryUrl, { signal: controller.signal, headers: runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {} });
    if (!response.ok) return undefined;
    const data = await response.json();
    const models = runtime.format === 'ollama'
      ? (data.models || []).map((model) => model.name || model.model).filter(Boolean)
      : (data.data || []).map((model) => model.id).filter(Boolean);
    if (!models.length) return undefined;
    return { name: runtime.name, baseUrl: runtime.baseUrl, models: [...new Set(models)].sort(natural) };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchGgufModels({ query = '', roots = [], limit = 200 } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  const candidates = roots.length ? roots : defaultModelRoots();
  const output = [];
  const visited = new Set();
  for (const root of candidates) {
    if (output.length >= limit) break;
    await walk(resolve(root), 0, output, visited, needle, limit);
  }
  return output.sort((a, b) => natural(basename(a), basename(b))).slice(0, limit);
}

export function defaultModelRoots() {
  const home = homedir();
  const roots = [
    join(home, 'Downloads'),
    join(home, 'Documents'),
    join(home, 'Models'),
    join(home, 'models'),
    join(home, '.cache', 'huggingface', 'hub'),
    join(home, '.lmstudio', 'models')
  ];
  if (process.env.LOCALAPPDATA) roots.push(join(process.env.LOCALAPPDATA, 'LM Studio', 'models'));
  return [...new Set(roots)];
}

async function walk(directory, depth, output, visited, needle, limit) {
  if (depth > 7 || output.length >= limit || visited.has(directory)) return;
  visited.add(directory);
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (output.length >= limit) return;
    const full = join(directory, entry.name);
    if (entry.isFile() && /\.gguf$/i.test(entry.name) && !/^mmproj/i.test(entry.name) && (!needle || entry.name.toLowerCase().includes(needle))) output.push(full);
    else if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(full, depth + 1, output, visited, needle, limit);
  }
}

function deduplicateTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => target?.discoveryUrl && !seen.has(target.discoveryUrl) && seen.add(target.discoveryUrl));
}
function natural(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }); }
