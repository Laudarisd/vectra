import { ChildProcess, execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { OpenAICompatibleProvider } from '../providers/OpenAICompatibleProvider';
import {
  getConfig,
  updateLlamaMmprojPath,
  updateLlamaServerPath,
  updateLocalModel,
  updateModel,
  updateProvider
} from '../utils/config';
import {
  DiscoveredLocalModel,
  discoverGgufModels,
  discoverOllamaModels,
  normalizeShardPath
} from './LocalModelDiscovery';

const execFileAsync = promisify(execFile);

interface DetectedModelItem extends vscode.QuickPickItem {
  model: DiscoveredLocalModel;
}

/** Owns local model selection and the llama.cpp child-process lifecycle. */
export class LocalLlamaCppService implements vscode.Disposable {
  private process?: ChildProcess;
  private readonly output = vscode.window.createOutputChannel('Vectra · llama.cpp');
  private currentModelPath = '';
  private currentMmprojPath = '';

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

  private async configureAndStartModel(selectedPath: string): Promise<string> {
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
    await this.stop();
    const executable = await this.resolveServerExecutable();
    const config = getConfig();
    const normalized = normalizeShardPath(modelPath);
    const mmproj = await this.resolveMmproj(normalized);
    const args = [
      '-m', normalized,
      '--host', '127.0.0.1',
      '--port', String(config.llamaCppPort),
      '-c', String(config.llamaCppContextSize),
      '--fit', 'on',
      '--gpu-layers', config.llamaCppGpuLayers,
      '--split-mode', config.llamaCppSplitMode
    ];
    if (config.llamaCppCpuMoe) args.push('--cpu-moe');
    if (config.llamaCppNoMmap) args.push('--no-mmap');
    if (mmproj) args.push('--mmproj', mmproj);
    if (config.llamaCppExtraArgs.length) args.push(...config.llamaCppExtraArgs);

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
