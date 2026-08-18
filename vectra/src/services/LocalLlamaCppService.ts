import { ChildProcess, execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { OpenAICompatibleProvider } from '../providers/OpenAICompatibleProvider';
import { getHardwareSnapshot } from '../utils/hardware';
import {
  getConfig,
  updateLlamaMmprojPath,
  updateLlamaServerPath,
  updateLocalModel,
  updateModel,
  updateProvider
} from '../utils/config';
import { HfSearchResult, resolveDownloadableFile, searchHuggingFace } from './HuggingFaceSearch';
import {
  DiscoveredLocalModel,
  discoverGgufModels,
  discoverOllamaModels,
  formatBytes,
  normalizeShardPath
} from './LocalModelDiscovery';
import { CatalogEntry, CURATED_MODELS } from './ModelCatalog';
import { downloadFile } from './ModelDownloader';
import { recommendCatalogEntries } from './ModelRecommender';

const execFileAsync = promisify(execFile);

interface DetectedModelItem extends vscode.QuickPickItem {
  model: DiscoveredLocalModel;
}

type CatalogQuickPickItem = vscode.QuickPickItem & { entry?: CatalogEntry; action?: 'search' };
type SearchQuickPickItem = vscode.QuickPickItem & { result?: HfSearchResult; action?: 'back' };

/** Owns local model selection and the llama.cpp child-process lifecycle. */
export class LocalLlamaCppService implements vscode.Disposable {
  private process?: ChildProcess;
  private readonly output = vscode.window.createOutputChannel('Vectra · llama.cpp');
  private currentModelPath = '';
  private currentMmprojPath = '';
  private lastArgsKey = '';

  get isRunning(): boolean { return Boolean(this.process && !this.process.killed); }
  get baseUrl(): string { return `http://127.0.0.1:${getConfig().llamaCppPort}/v1`; }
  get modelPath(): string { return this.currentModelPath || getConfig().localModelPath; }
  get mmprojPath(): string { return this.currentMmprojPath || getConfig().llamaCppMmprojPath; }
  get visionEnabled(): boolean { return Boolean(this.mmprojPath); }

  /**
   * Present the two user-facing local workflows: manually search/select a GGUF
   * file, or detect installed GGUF and Ollama models automatically.
   */
  async chooseLocalModel(): Promise<string | undefined> {
    const choice = await vscode.window.showQuickPick([
      {
        id: 'browse' as const,
        label: '$(search) Search or choose a GGUF model',
        description: 'Browse your computer for a llama.cpp-compatible model file'
      },
      {
        id: 'detect' as const,
        label: '$(sparkle) Detect installed local models',
        description: 'Find common GGUF locations and models from a running Ollama installation'
      }
    ], {
      title: 'Vectra: Local Model',
      placeHolder: 'Choose how Vectra should find your local model'
    });
    if (!choice) return undefined;
    return choice.id === 'browse' ? this.selectAndStartModel() : this.detectAndSelectModel();
  }

  /** Use VS Code's native searchable file dialog to select a GGUF model. */
  async selectAndStartModel(): Promise<string | undefined> {
    const config = getConfig();
    let defaultUri: vscode.Uri | undefined;
    const candidate = config.localModelDirectory || path.dirname(config.localModelPath || '') || os.homedir();
    if (candidate && candidate !== '.') {
      try {
        await fs.access(candidate);
        defaultUri = vscode.Uri.file(candidate);
      } catch {
        // Let VS Code choose the platform default location.
      }
    }

    const picked = await vscode.window.showOpenDialog({
      title: 'Vectra: Search or select local GGUF model',
      defaultUri,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'GGUF models': ['gguf'] },
      openLabel: 'Load this model'
    });
    if (!picked?.[0]) return undefined;
    return this.loadModelWithProgress(picked[0].fsPath);
  }

  /** Scan bounded common folders and query a local Ollama server. */
  private async detectAndSelectModel(): Promise<string | undefined> {
    const config = getConfig();
    const extraRoots = [
      config.localModelDirectory,
      config.localModelPath ? path.dirname(config.localModelPath) : ''
    ].filter(Boolean);

    const [ggufModels, ollamaModels] = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Vectra: detecting installed local models…'
      },
      () => Promise.all([
        discoverGgufModels(extraRoots),
        discoverOllamaModels(config.ollamaBaseUrl)
      ])
    );

    const detected: DetectedModelItem[] = [
      ...ggufModels.map((model) => ({
        label: `$(file-binary) ${model.label}`,
        description: 'GGUF · llama.cpp',
        detail: model.detail,
        model
      })),
      ...ollamaModels.map((model) => ({
        label: `$(server-process) ${model.label}`,
        description: 'Ollama',
        detail: model.detail,
        model
      }))
    ];

    if (!detected.length) {
      const fallback = await vscode.window.showWarningMessage(
        'Vectra did not find a GGUF file in common model folders or a running local Ollama model.',
        'Search manually'
      );
      return fallback === 'Search manually' ? this.selectAndStartModel() : undefined;
    }

    const picked = await vscode.window.showQuickPick(detected, {
      title: `Vectra: ${detected.length} local model${detected.length === 1 ? '' : 's'} detected`,
      placeHolder: 'Type to search detected local models',
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!picked) return undefined;

    if (picked.model.kind === 'ollama') {
      await this.stop();
      await updateProvider('ollama');
      await updateModel(picked.model.id);
      return picked.model.id;
    }
    return this.loadModelWithProgress(picked.model.id);
  }

  private async loadModelWithProgress(modelPath: string): Promise<string> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Vectra: loading ${path.basename(modelPath)}…`
      },
      () => this.configureAndStartModel(modelPath)
    );
  }

  /**
   * Hardware-aware model discovery: recommend from a curated list, or search
   * Hugging Face for more, confirm size/destination, download with progress,
   * then hand off to configureAndStartModel() — the exact same activation
   * path manual selection already uses, so VLM vision auto-wiring (which
   * keys off "a mmproj*.gguf file next to the model") comes for free once
   * both files land in the same directory.
   */
  async downloadAndSelectModel(): Promise<string | undefined> {
    const entry = await this.pickCatalogEntry();
    if (!entry) return undefined;

    const destDir = this.resolveModelsDirectory();
    await fs.mkdir(destDir, { recursive: true });
    const modelPath = path.join(destDir, entry.filename);
    const sizeText = entry.sizeBytes ? formatBytes(entry.sizeBytes) : 'unknown';

    const choice = await vscode.window.showWarningMessage(
      `Download ${entry.label}?`,
      { modal: true, detail: `Size: ${sizeText}\nSaves to: ${modelPath}` },
      'Download'
    );
    if (choice !== 'Download') return undefined;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Vectra: downloading ${entry.label}…`,
        cancellable: true
      },
      async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        const isVlm = entry.kind === 'vlm' && entry.mmprojUrl && entry.mmprojFilename;

        await downloadFile(entry.downloadUrl, modelPath, {
          signal: controller.signal,
          onProgress: phaseProgress(progress, isVlm ? 'Model (1/2)' : 'Model')
        });

        if (isVlm) {
          const mmprojPath = path.join(destDir, entry.mmprojFilename!);
          await downloadFile(entry.mmprojUrl!, mmprojPath, {
            signal: controller.signal,
            onProgress: phaseProgress(progress, 'Vision projector (2/2)')
          });
        }
      }
    );

    return this.configureAndStartModel(modelPath);
  }

  private resolveModelsDirectory(): string {
    return getConfig().modelsDirectory || path.join(os.homedir(), '.vectra', 'models');
  }

  private async pickCatalogEntry(): Promise<CatalogEntry | undefined> {
    const hw = await getHardwareSnapshot();
    const recommended = recommendCatalogEntries(hw, CURATED_MODELS);
    return this.showCatalogPicker(recommended);
  }

  private async showCatalogPicker(recommended: CatalogEntry[]): Promise<CatalogEntry | undefined> {
    const llmEntries = recommended.filter((entry) => entry.kind === 'llm');
    const vlmEntries = recommended.filter((entry) => entry.kind === 'vlm');

    const items: CatalogQuickPickItem[] = [];
    if (llmEntries.length) {
      items.push({ label: 'Recommended for your hardware', kind: vscode.QuickPickItemKind.Separator });
      items.push(...llmEntries.map(toCatalogPickItem));
    }
    if (vlmEntries.length) {
      items.push({ label: 'Vision models', kind: vscode.QuickPickItemKind.Separator });
      items.push(...vlmEntries.map(toCatalogPickItem));
    }
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '$(search) Search Hugging Face for more…', action: 'search' });

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Vectra: Download Model',
      placeHolder: recommended.length
        ? 'Choose a recommended model, or search for more'
        : 'No curated model fits your detected hardware — search Hugging Face instead',
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!picked) return undefined;
    if (picked.entry) return picked.entry;
    if (picked.action === 'search') return this.showSearchFlow(recommended);
    return undefined;
  }

  private async showSearchFlow(recommended: CatalogEntry[]): Promise<CatalogEntry | undefined> {
    const query = await vscode.window.showInputBox({
      title: 'Vectra: Search Hugging Face for a GGUF model',
      prompt: 'e.g. "llama 3 8b", "qwen coder", "phi mini"',
      ignoreFocusOut: true
    });
    if (!query?.trim()) return this.showCatalogPicker(recommended);

    let results: HfSearchResult[];
    try {
      results = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Vectra: searching Hugging Face for "${query}"…` },
        () => searchHuggingFace(query.trim())
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`Vectra Hugging Face search failed: ${messageOf(error)}`);
      return undefined;
    }

    if (!results.length) {
      const retry = await vscode.window.showWarningMessage(`No Hugging Face GGUF results for "${query}".`, 'Search again', 'Back');
      if (retry === 'Search again') return this.showSearchFlow(recommended);
      if (retry === 'Back') return this.showCatalogPicker(recommended);
      return undefined;
    }

    const items: SearchQuickPickItem[] = [
      { label: '$(arrow-left) Back to recommended models', action: 'back' },
      ...results.map((result) => ({
        label: `$(repo) ${result.label}`,
        description: `${result.downloads.toLocaleString()} downloads`,
        result
      }))
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: `Vectra: ${results.length} Hugging Face result${results.length === 1 ? '' : 's'}`,
      placeHolder: 'Type to filter results',
      matchOnDescription: true
    });
    if (!picked) return undefined;
    if (picked.action === 'back') return this.showCatalogPicker(recommended);
    if (!picked.result) return undefined;

    const resolved = await resolveDownloadableFile(picked.result.id);
    if (!resolved) {
      const openInBrowser = await vscode.window.showWarningMessage(
        `Vectra could not determine a single downloadable GGUF file for ${picked.result.id}. Open its Hugging Face page instead?`,
        'Open in Browser'
      );
      if (openInBrowser === 'Open in Browser') {
        await vscode.env.openExternal(vscode.Uri.parse(`https://huggingface.co/${picked.result.id}`));
      }
      return undefined;
    }

    return {
      id: `hf:${picked.result.id}:${resolved.filename}`,
      label: `${picked.result.id} (${resolved.filename})`,
      family: 'other',
      paramCount: 0,
      quant: '',
      kind: 'llm',
      sizeBytes: resolved.sizeBytes ?? 0,
      minVramMiB: 0,
      minRamMiB: 0,
      downloadUrl: resolved.downloadUrl,
      filename: resolved.filename
    };
  }

  /** Public: also the activation tail end of downloadAndSelectModel() below. */
  async configureAndStartModel(selectedPath: string): Promise<string> {
    const config = getConfig();
    const modelPath = normalizeShardPath(selectedPath);
    if (!modelPath.toLowerCase().endsWith('.gguf')) {
      throw new Error('Vectra local llama.cpp models must be GGUF files.');
    }
    await fs.access(modelPath);

    const previousModel = config.localModelPath;
    await updateLocalModel(modelPath);
    const detectedProjector = await this.detectMmproj(modelPath);
    if (previousModel !== modelPath) await updateLlamaMmprojPath(detectedProjector ?? '');
    else if (detectedProjector && !getConfig().llamaCppMmprojPath) {
      await updateLlamaMmprojPath(detectedProjector);
    }

    await this.start(modelPath);
    await updateProvider('llamaCpp');
    const provider = new OpenAICompatibleProvider(this.baseUrl);
    let modelId = path.basename(modelPath);
    try {
      const models = await provider.listModels();
      modelId = models[0]?.id || modelId;
    } catch {
      // A single-model llama.cpp server may not expose model metadata.
    }
    await updateModel(modelId);
    return modelId;
  }

  async selectMmproj(): Promise<string | undefined> {
    const config = getConfig();
    const modelDirectory = config.localModelPath ? path.dirname(config.localModelPath) : os.homedir();
    const picked = await vscode.window.showOpenDialog({
      title: 'Vectra: Select multimodal projector (mmproj GGUF)',
      defaultUri: vscode.Uri.file(modelDirectory),
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'GGUF projector': ['gguf'] },
      openLabel: 'Use projector'
    });
    if (!picked?.[0]) return undefined;
    await updateLlamaMmprojPath(picked[0].fsPath);
    return picked[0].fsPath;
  }

  async startConfiguredModel(): Promise<boolean> {
    const modelPath = getConfig().localModelPath;
    if (!modelPath) return false;
    try {
      await fs.access(modelPath);
    } catch {
      return false;
    }
    await this.start(modelPath);
    return true;
  }

  async start(modelPath: string): Promise<void> {
    const executable = await this.resolveServerExecutable();
    const config = getConfig();
    const normalized = normalizeShardPath(modelPath);
    const mmproj = await this.resolveMmproj(normalized);
    // Forcing CPU overrides whatever GPU layer count is configured; auto/gpu
    // keep the configured value, which is what already gives multi-GPU
    // placement for free (llama.cpp's layer split mode spreads offloaded
    // layers across every visible CUDA device on its own).
    const gpuLayers = config.deviceMode === 'cpu' ? '0' : config.llamaCppGpuLayers;
    const args = [
      '-m', normalized,
      '--host', '127.0.0.1',
      '--port', String(config.llamaCppPort),
      '-c', String(config.llamaCppContextSize),
      '--fit', 'on',
      '--gpu-layers', gpuLayers,
      '--split-mode', config.llamaCppSplitMode
    ];
    if (config.llamaCppCpuMoe) args.push('--cpu-moe');
    if (config.llamaCppNoMmap) args.push('--no-mmap');
    if (mmproj) args.push('--mmproj', mmproj);
    if (config.llamaCppExtraArgs.length) args.push(...config.llamaCppExtraArgs);

    // A model already running with the same executable/args is left alone
    // instead of being stopped and reloaded from disk for no reason.
    const argsKey = JSON.stringify({ executable, args });
    if (this.isRunning && argsKey === this.lastArgsKey) {
      this.output.appendLine('[Vectra] Reusing the already-running local model (unchanged settings).');
      return;
    }
    await this.stop();

    this.output.show(true);
    this.output.appendLine('[Vectra] Starting llama.cpp');
    this.output.appendLine(`[Vectra] Server: ${executable}`);
    this.output.appendLine(`[Vectra] Model: ${normalized}`);
    if (mmproj) this.output.appendLine(`[Vectra] Vision projector: ${mmproj}`);
    this.output.appendLine(`[Vectra] Endpoint: ${this.baseUrl}`);
    this.output.appendLine(`[Vectra] Args: ${args.map(shellQuote).join(' ')}`);

    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = child;
    this.currentModelPath = normalized;
    this.currentMmprojPath = mmproj || '';
    this.lastArgsKey = argsKey;
    child.stdout?.on('data', (data: Buffer) => this.output.append(data.toString()));
    child.stderr?.on('data', (data: Buffer) => this.output.append(data.toString()));
    child.on('exit', (code, signal) => {
      this.output.appendLine(`\n[Vectra] llama-server exited (${code ?? 'no code'}${signal ? `, ${signal}` : ''}).`);
      if (this.process === child) this.process = undefined;
    });

    await this.waitUntilHealthy(child, config.llamaCppLoadTimeoutSeconds * 1000);
    this.output.appendLine(`[Vectra] Local model is ready${mmproj ? ' with multimodal vision' : ''}.`);
  }

  async stop(): Promise<void> {
    const child = this.process;
    this.process = undefined;
    this.currentModelPath = '';
    this.currentMmprojPath = '';
    this.lastArgsKey = '';
    if (!child || child.killed) return;
    child.kill();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* Process already stopped. */ }
        resolve();
      }, 3_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async chooseServerExecutable(): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
      title: 'Vectra: Select llama-server executable',
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Use llama-server'
    });
    if (!picked?.[0]) return undefined;
    await updateLlamaServerPath(picked[0].fsPath);
    return picked[0].fsPath;
  }

  dispose(): void {
    void this.stop();
    this.output.dispose();
  }

  private async resolveMmproj(modelPath: string): Promise<string | undefined> {
    const config = getConfig();
    if (config.llamaCppMmprojPath) {
      try {
        await fs.access(config.llamaCppMmprojPath);
        return config.llamaCppMmprojPath;
      } catch {
        // Fall back to automatic detection beside the selected model.
      }
    }
    const detected = await this.detectMmproj(modelPath);
    if (detected) await updateLlamaMmprojPath(detected);
    return detected;
  }

  private async detectMmproj(modelPath: string): Promise<string | undefined> {
    try {
      const directory = path.dirname(modelPath);
      const names = await fs.readdir(directory);
      const candidates = names
        .filter((name) => /^mmproj.*\.gguf$/i.test(name))
        .sort((left, right) => scoreMmproj(right) - scoreMmproj(left));
      return candidates[0] ? path.join(directory, candidates[0]) : undefined;
    } catch {
      return undefined;
    }
  }

  private async resolveServerExecutable(): Promise<string> {
    const configured = getConfig().llamaCppServerPath;
    if (configured) {
      if (path.isAbsolute(configured)) {
        try {
          await fs.access(configured);
          return configured;
        } catch {
          // Continue with PATH and common-location detection.
        }
      } else if (await commandExists(configured)) {
        return configured;
      }
    }

    const command = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    if (await commandExists(command)) return command;

    const common = process.platform === 'darwin'
      ? ['/opt/homebrew/bin/llama-server', '/usr/local/bin/llama-server']
      : process.platform === 'win32'
        ? [
            path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'llama.cpp', 'llama-server.exe'),
            path.join(os.homedir(), 'llama.cpp', 'build', 'bin', 'Release', 'llama-server.exe')
          ]
        : [
            '/usr/local/bin/llama-server',
            '/usr/bin/llama-server',
            path.join(os.homedir(), '.local', 'bin', 'llama-server')
          ];
    for (const candidate of common) {
      if (!candidate) continue;
      try {
        await fs.access(candidate);
        await updateLlamaServerPath(candidate);
        return candidate;
      } catch {
        // Try the next platform-specific location.
      }
    }

    const choice = await vscode.window.showWarningMessage(
      'Vectra found your GGUF model, but llama-server could not be found.',
      'Select llama-server',
      'Open llama.cpp'
    );
    if (choice === 'Open llama.cpp') {
      await vscode.env.openExternal(vscode.Uri.parse('https://github.com/ggml-org/llama.cpp'));
      throw new Error('Install llama.cpp, then select the local model again.');
    }
    if (choice === 'Select llama-server') {
      const selected = await this.chooseServerExecutable();
      if (selected) return selected;
    }
    throw new Error('llama-server executable is required to run local GGUF models.');
  }

  private async waitUntilHealthy(child: ChildProcess, timeout: number): Promise<void> {
    const healthUrl = `${this.baseUrl.replace(/\/v1$/, '')}/health`;
    const deadline = Date.now() + timeout;
    let lastError = '';
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.killed) {
        throw new Error('llama-server stopped before the model became ready. See “Vectra · llama.cpp” output.');
      }
      try {
        const response = await fetch(healthUrl);
        if (response.ok) return;
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await delay(750);
    }
    throw new Error(
      `Timed out waiting for llama-server. Large models may need a longer ` +
      `vectra.llamaCppLoadTimeoutSeconds. ${lastError}`.trim()
    );
  }
}

function scoreMmproj(name: string): number {
  return /f16/i.test(name) ? 3 : /bf16/i.test(name) ? 2 : /q8/i.test(name) ? 1 : 0;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') await execFileAsync('where', [command]);
    else await execFileAsync('which', [command]);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shellQuote(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function toCatalogPickItem(entry: CatalogEntry): CatalogQuickPickItem {
  return {
    label: `$(file-binary) ${entry.label}`,
    description: `${entry.family} · ${entry.paramCount}B · ${formatBytes(entry.sizeBytes)}`,
    detail: entry.kind === 'vlm' ? 'Vision-language model — includes a vision projector' : undefined,
    entry
  };
}

/**
 * Each phase (model, then optionally the vision projector) reports its own
 * 0-100% independently — simpler and safer than trying to weight a single
 * combined bar across two differently-sized downloads. VS Code's progress
 * bar visually settles near "full" after phase 1; the message text still
 * accurately reflects phase 2, which is what actually matters here.
 */
function phaseProgress(
  progress: vscode.Progress<{ increment?: number; message?: string }>,
  label: string
): (bytesDone: number, totalBytes?: number) => void {
  let lastPercent = 0;
  return (bytesDone, totalBytes) => {
    if (!totalBytes) {
      progress.report({ message: `${label}: ${formatBytes(bytesDone)}` });
      return;
    }
    const percent = Math.min(100, Math.floor((bytesDone / totalBytes) * 100));
    progress.report({ increment: Math.max(0, percent - lastPercent), message: `${label}: ${percent}%` });
    lastPercent = percent;
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
