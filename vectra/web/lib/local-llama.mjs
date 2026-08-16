import { spawn, execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { dirname, basename, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';

const execFileAsync = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class LocalLlamaManager {
  constructor() {
    this.child = undefined;
    this.runtimeApiKey = '';
    this.lastRequestKey = '';
    this.state = {
      status: 'stopped',
      modelPath: '',
      mmprojPath: '',
      serverPath: '',
      port: 8080,
      contextSize: 16384,
      modelId: '',
      baseUrl: 'http://127.0.0.1:8080/v1',
      startedAt: 0,
      lastError: '',
      logs: []
    };
  }

  snapshot() {
    return {
      ...this.state,
      running: Boolean(this.child && !this.child.killed && this.child.exitCode === null),
      logs: this.state.logs.slice(-120)
    };
  }

  connection() {
    return {
      baseUrl: this.state.baseUrl,
      modelId: this.state.modelId,
      apiKey: this.runtimeApiKey
    };
  }

  async chooseModel() {
    const picked = await nativePickFile({
      title: 'Vectra: Select local GGUF model',
      extensions: ['gguf']
    });
    if (!picked) return { cancelled: true };
    const modelPath = normalizeShardPath(picked);
    if (!/\.gguf$/i.test(modelPath)) throw new Error('Select a .gguf model file.');
    await ensureFile(modelPath);
    const mmprojPath = await detectMmproj(modelPath);
    return { cancelled: false, modelPath, mmprojPath: mmprojPath || '' };
  }

  async chooseMmproj() {
    const picked = await nativePickFile({
      title: 'Vectra: Select multimodal projector (mmproj GGUF)',
      extensions: ['gguf']
    });
    if (!picked) return { cancelled: true };
    if (!/\.gguf$/i.test(picked)) throw new Error('Select a .gguf projector file.');
    await ensureFile(picked);
    return { cancelled: false, mmprojPath: picked };
  }

  async chooseServer() {
    const picked = await nativePickFile({
      title: 'Vectra: Select llama-server executable',
      extensions: process.platform === 'win32' ? ['exe'] : []
    });
    if (!picked) return { cancelled: true };
    await ensureFile(picked);
    return { cancelled: false, serverPath: picked };
  }

  async start(options = {}) {
    const modelPath = normalizeShardPath(String(options.modelPath || '').trim());
    if (!modelPath) throw new Error('Choose a GGUF model first.');

    const requestedPort = clampInt(options.port, 1024, 65535, 8080);
    const contextSize = clampInt(options.contextSize, 1024, 1048576, 16384);
    // 'cpu' forces every layer off the GPU regardless of the configured
    // gpuLayers value; 'auto'/'gpu' keep it, which already spreads offloaded
    // layers across every visible GPU via --split-mode layer.
    const device = ['auto', 'gpu', 'cpu'].includes(options.device) ? options.device : 'auto';
    const gpuLayers = device === 'cpu' ? '0' : normalizeGpuLayers(options.gpuLayers);
    const splitMode = ['none', 'layer', 'row', 'tensor'].includes(options.splitMode) ? options.splitMode : 'layer';
    const serverPathInput = String(options.serverPath || '').trim();
    const mmprojPathInput = String(options.mmprojPath || '').trim();
    const extraArgs = Array.isArray(options.extraArgs)
      ? options.extraArgs.map((value) => String(value)).filter(Boolean).slice(0, 80)
      : parseExtraArgs(String(options.extraArgs || ''));

    // A request identical to the one already running is a no-op instead of a
    // stop-and-reload from disk.
    const requestKey = JSON.stringify({
      modelPath, requestedPort, contextSize, gpuLayers, splitMode, serverPathInput, mmprojPathInput,
      cpuMoe: options.cpuMoe === true, noMmap: options.noMmap === true, extraArgs
    });
    if (
      requestKey === this.lastRequestKey &&
      this.child && !this.child.killed && this.child.exitCode === null &&
      this.state.status === 'ready'
    ) {
      this.log('[Vectra] Reusing the already-running local model (unchanged settings).');
      return this.snapshot();
    }

    await ensureFile(modelPath);
    const port = await findAvailablePort(requestedPort, 60);
    const timeoutSeconds = clampInt(options.timeoutSeconds, 30, 3600, 600);
    const serverPath = await resolveServerExecutable(serverPathInput);
    let mmprojPath = mmprojPathInput;
    if (mmprojPath) await ensureFile(mmprojPath);
    else mmprojPath = (await detectMmproj(modelPath)) || '';

    await this.stop();
    this.runtimeApiKey = randomBytes(24).toString('base64url');
    this.state = {
      ...this.state,
      status: 'starting',
      modelPath,
      mmprojPath,
      serverPath,
      port,
      contextSize,
      modelId: basename(modelPath),
      baseUrl: `http://127.0.0.1:${port}/v1`,
      startedAt: Date.now(),
      lastError: '',
      logs: []
    };

    const args = [
      '--model', modelPath,
      '--host', '127.0.0.1',
      '--port', String(port),
      '--ctx-size', String(contextSize),
      '--fit', 'on',
      '--gpu-layers', gpuLayers,
      '--split-mode', splitMode,
      '--api-key', this.runtimeApiKey,
      '--no-webui',
      '--alias', basename(modelPath)
    ];
    if (options.cpuMoe === true) args.push('--cpu-moe');
    if (options.noMmap === true) args.push('--no-mmap');
    if (mmprojPath) args.push('--mmproj', mmprojPath);
    if (splitMode === 'tensor' && !extraArgs.some((arg) => arg === '-fa' || arg === '--flash-attn')) {
      args.push('--flash-attn', 'on');
    }
    args.push(...extraArgs);

    this.log(`[Vectra] Starting ${serverPath}`);
    if (port !== requestedPort) this.log(`[Vectra] Port ${requestedPort} is busy; using ${port} instead.`);
    this.log(`[Vectra] Model: ${modelPath}`);
    if (mmprojPath) this.log(`[Vectra] Vision projector: ${mmprojPath}`);
    this.log(`[Vectra] Endpoint: ${this.state.baseUrl}`);
    this.log(`[Vectra] Args: ${args.map(shellQuoteForLog).join(' ')}`);

    const child = spawn(serverPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.child = child;
    child.stdout?.on('data', (chunk) => this.log(chunk.toString(), false));
    child.stderr?.on('data', (chunk) => this.log(chunk.toString(), false));
    child.on('error', (error) => {
      this.state.status = 'error';
      this.state.lastError = error.message;
      this.log(`[Vectra] llama-server error: ${error.message}`);
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = undefined;
      if (this.state.status !== 'stopping') {
        this.state.status = code === 0 ? 'stopped' : 'error';
        if (code !== 0) this.state.lastError = `llama-server exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.`;
      } else {
        this.state.status = 'stopped';
      }
      this.log(`[Vectra] llama-server exited: code=${code ?? 'none'}${signal ? ` signal=${signal}` : ''}`);
    });

    try {
      await this.waitUntilHealthy(child, timeoutSeconds * 1000);
      const ids = await this.listModels();
      await delay(200);
      if (child.exitCode !== null || child.killed || this.child !== child) throw new Error('llama-server exited during startup verification.');
      this.state.status = 'ready';
      if (ids[0]) this.state.modelId = ids[0];
      this.lastRequestKey = requestKey;
      this.log(`[Vectra] Local model ready: ${this.state.modelId}`);
      return this.snapshot();
    } catch (error) {
      this.state.status = 'error';
      this.state.lastError = error instanceof Error ? error.message : String(error);
      await this.stop({ preserveError: true });
      throw error;
    }
  }

  async stop({ preserveError = false } = {}) {
    const child = this.child;
    this.child = undefined;
    this.lastRequestKey = '';
    if (!preserveError) {
      this.state.status = 'stopping';
      this.state.lastError = '';
    }
    if (!child || child.killed || child.exitCode !== null) {
      if (!preserveError) this.state.status = 'stopped';
      if (!preserveError) this.runtimeApiKey = '';
      return this.snapshot();
    }
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(3000).then(() => {
        try { child.kill('SIGKILL'); } catch {}
      })
    ]);
    if (!preserveError) { this.state.status = 'stopped'; this.runtimeApiKey = ''; }
    return this.snapshot();
  }

  async listModels() {
    const response = await fetch(`${this.state.baseUrl}/models`, {
      headers: this.runtimeApiKey ? { Authorization: `Bearer ${this.runtimeApiKey}` } : {}
    });
    if (!response.ok) throw new Error(`llama.cpp model listing failed: HTTP ${response.status}`);
    const data = await response.json();
    return (data.data || []).map((item) => item.id).filter(Boolean);
  }

  async waitUntilHealthy(child, timeoutMs) {
    const health = `http://127.0.0.1:${this.state.port}/health`;
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.killed) {
        throw new Error(this.state.lastError || 'llama-server stopped before the model became ready.');
      }
      try {
        const response = await fetch(health);
        if (response.ok) return;
        const body = await response.text().catch(() => '');
        last = `HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await delay(750);
    }
    throw new Error(`Timed out waiting for llama-server after ${Math.round(timeoutMs / 1000)} seconds. ${last}`.trim());
  }

  log(text, addNewline = true) {
    const normalized = String(text || '').replace(/\r/g, '');
    const lines = normalized.split('\n').filter((line, index, all) => line || index < all.length - 1);
    for (const line of lines) {
      if (!line && !addNewline) continue;
      this.state.logs.push(line);
    }
    if (this.state.logs.length > 500) this.state.logs.splice(0, this.state.logs.length - 500);
  }
}

export function normalizeShardPath(pathValue) {
  const match = String(pathValue || '').match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
  if (!match) return String(pathValue || '');
  return `${match[1]}-00001-of-${match[3]}.gguf`;
}

export async function detectMmproj(modelPath) {
  try {
    const directory = dirname(modelPath);
    const names = await readdir(directory);
    const candidates = names
      .filter((name) => /^mmproj.*\.gguf$/i.test(name))
      .sort((a, b) => scoreMmproj(b) - scoreMmproj(a) || a.localeCompare(b));
    return candidates[0] ? join(directory, candidates[0]) : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveServerExecutable(configured = '') {
  if (configured) {
    if (isAbsolute(configured)) {
      await ensureFile(configured);
      return configured;
    }
    if (await commandExists(configured)) return configured;
  }

  const command = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  if (await commandExists(command)) return command;

  const common = process.platform === 'darwin'
    ? ['/opt/homebrew/bin/llama-server', '/usr/local/bin/llama-server', join(homedir(), '.local', 'bin', 'llama-server')]
    : process.platform === 'win32'
      ? [
          join(process.env.LOCALAPPDATA || '', 'Programs', 'llama.cpp', 'llama-server.exe'),
          join(homedir(), 'llama.cpp', 'build', 'bin', 'Release', 'llama-server.exe')
        ]
      : ['/usr/local/bin/llama-server', '/usr/bin/llama-server', join(homedir(), '.local', 'bin', 'llama-server')];

  for (const candidate of common) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error('llama-server was not found. Install llama.cpp or use “Choose llama-server” in Local Model settings.');
}

async function nativePickFile({ title, extensions = [] }) {
  if (process.platform === 'darwin') {
    // AppleScript's `of type` expects file type/UTI values, not arbitrary extensions such as .gguf.
    // Use the native picker without a type filter, then validate the selected path in Vectra.
    const script = `POSIX path of (choose file with prompt ${JSON.stringify(title)})`;
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 120000 });
      return stdout.trim();
    } catch (error) {
      if (isCancelError(error)) return '';
      throw new Error(`Could not open macOS file picker: ${error.message || error}`);
    }
  }

  if (process.platform === 'win32') {
    const filter = extensions.length
      ? `${extensions.map((ext) => `*.${ext}`).join(';')}|${extensions.map((ext) => `*.${ext}`).join(';')}|All files|*.*`
      : 'All files|*.*';
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$d = New-Object System.Windows.Forms.OpenFileDialog;',
      `$d.Title = ${powershellQuote(title)};`,
      `$d.Filter = ${powershellQuote(filter)};`,
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }'
    ].join(' ');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 120000 });
    return stdout.trim();
  }

  if (await commandExists('zenity')) {
    const args = ['--file-selection', '--title', title];
    if (extensions.length) args.push('--file-filter', `${extensions.map((ext) => `*.${ext}`).join(' ')}`);
    try {
      const { stdout } = await execFileAsync('zenity', args, { timeout: 120000 });
      return stdout.trim();
    } catch (error) {
      if (isCancelError(error)) return '';
      throw error;
    }
  }
  if (await commandExists('kdialog')) {
    const pattern = extensions.length ? extensions.map((ext) => `*.${ext}`).join(' ') : '*';
    try {
      const { stdout } = await execFileAsync('kdialog', ['--getopenfilename', homedir(), pattern, '--title', title], { timeout: 120000 });
      return stdout.trim();
    } catch (error) {
      if (isCancelError(error)) return '';
      throw error;
    }
  }
  throw new Error('No native Linux file picker was found. Install zenity or kdialog, or enter the model path manually.');
}


async function findAvailablePort(preferred, attempts = 60) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = preferred + offset;
    if (candidate > 65535) break;
    if (await canBind(candidate)) return candidate;
  }
  throw new Error(`No free localhost port was found near ${preferred}. Stop an existing llama-server or choose another preferred port.`);
}

function canBind(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

function parseExtraArgs(raw) {
  if (!raw.trim()) return [];
  const result = [];
  let current = '';
  let quote = '';
  let escape = false;
  for (const char of raw) {
    if (escape) { current += char; escape = false; continue; }
    if (char === '\\') { escape = true; continue; }
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (/\s/.test(char)) {
      if (current) { result.push(current); current = ''; }
    } else current += char;
  }
  if (current) result.push(current);
  return result.slice(0, 80);
}

async function commandExists(command) {
  try {
    if (process.platform === 'win32') await execFileAsync('where', [command]);
    else await execFileAsync('which', [command]);
    return true;
  } catch {
    return false;
  }
}

async function ensureFile(filePath) {
  try { await access(filePath); }
  catch { throw new Error(`File not found: ${filePath}`); }
}
function normalizeGpuLayers(value) {
  const raw = String(value ?? 'auto').trim().toLowerCase();
  if (raw === 'auto' || raw === 'all') return raw;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : 'auto';
}
function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
function scoreMmproj(name) { return /f16/i.test(name) ? 4 : /bf16/i.test(name) ? 3 : /q8/i.test(name) ? 2 : /q6/i.test(name) ? 1 : 0; }
function shellQuoteForLog(value) { return /\s/.test(value) ? JSON.stringify(value) : value; }
function powershellQuote(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function isCancelError(error) {
  const message = String(error?.stderr || error?.message || error || '');
  return error?.code === 1 || /cancel/i.test(message) || /User canceled/i.test(message);
}
