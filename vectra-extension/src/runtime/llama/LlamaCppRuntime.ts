// Beginner guide: Handles l la ma cp pr un ti me responsibilities for Vectra.
import { ChildProcess, execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { OpenAICompatibleProvider } from '../../providers/OpenAICompatibleProvider';
import { getHardwareSnapshot } from '../../utils/hardware';
import { detectGpus, hasNvidiaGpu } from '../../utils/gpu';
import {
  getConfig,
  updateLlamaMmprojPath,
  updateLlamaServerPath,
  updateLocalModel,
  updateLocalModelDirectory,
  updateModelsDirectory,
  updateModel,
  updateOpenAICompatibleBaseUrl,
  updateProvider
} from '../../utils/config';
import { HfSearchResult, resolveDownloadableFile, searchHuggingFace } from '../../models/HuggingFaceSearch';
import {
  appModelDirectories,
  broadModelDirectories,
  DiscoveredLocalModel,
  discoverGgufModels,
  discoverOllamaModels,
  discoverOpenAICompatibleModels,
  FIRST_RUN_TIME_BUDGET_MS,
  formatBytes,
  FULL_SCAN_MAX_DIRECTORIES,
  FULL_SCAN_TIME_BUDGET_MS,
  normalizeShardPath,
  SCOPED_TIME_BUDGET_MS,
  storageModelDirectories
} from '../../models/LocalModelDiscovery';
import { findLatestAsset, findServerExecutable, installDirFor, installLatestLlamaCpp, LlamaCppAsset } from './LlamaCppInstaller';
import { CatalogEntry, CURATED_MODELS } from '../../models/ModelCatalog';
import { downloadFile } from '../../models/ModelDownloader';
import { recommendCatalogTiers } from '../../models/ModelRecommender';
import { buildLlamaRuntimeProfile, parseLlamaServerFlags } from './LlamaRuntimeProfile';

const execFileAsync = promisify(execFile);

interface DetectedModelItem extends vscode.QuickPickItem {
  model?: DiscoveredLocalModel;
  action?: 'browseFile' | 'chooseFolder' | 'scanEverywhere';
}

type CatalogQuickPickItem = vscode.QuickPickItem & { entry?: CatalogEntry; action?: 'search' };
type SearchQuickPickItem = vscode.QuickPickItem & { result?: HfSearchResult; action?: 'back' };

/** Owns local model selection and the llama.cpp child-process lifecycle. */
export class LlamaCppRuntime implements vscode.Disposable {
  private process?: ChildProcess;
  private readonly output = vscode.window.createOutputChannel('Vectra · llama.cpp');
  private currentModelPath = '';
  private currentMmprojPath = '';
  private lastArgsKey = '';
  private ready = false;
  private startupPromise?: Promise<void>;
  private readonly capabilityCache = new Map<string, ReadonlySet<string>>();
  private activePick?: { pick: vscode.QuickPick<DetectedModelItem>; promise: Promise<string | undefined> };

  get isRunning(): boolean { return Boolean(this.process && !this.process.killed); }
  get isReady(): boolean { return this.isRunning && this.ready; }
  get baseUrl(): string { return `http://127.0.0.1:${getConfig().llamaCppPort}/v1`; }
  get modelPath(): string { return this.currentModelPath || getConfig().localModelPath; }
  get mmprojPath(): string { return this.currentMmprojPath || getConfig().llamaCppMmprojPath; }
  get visionEnabled(): boolean { return Boolean(this.mmprojPath); }

  /**
   * One live picker for every local workflow. It is shown before any filesystem
   * work starts, so it appears instantly and stays useful while models stream in
   * underneath. `ignoreFocusOut` matters more than it looks: this is launched from
   * a webview button, so without it the picker silently vanishes the moment the
   * user clicks back into the sidebar and the whole flow looks dead.
   */
  async chooseLocalModel(options: { scanEverywhere?: boolean } = {}): Promise<string | undefined> {
    // A second click means "I cannot see it", so re-reveal the picker that is
    // already scanning rather than discarding its partial results.
    if (this.activePick) {
      this.activePick.pick.show();
      return this.activePick.promise;
    }

    const savedFolder = getConfig().localModelDirectory;
    const scoped = Boolean(savedFolder) && !options.scanEverywhere;
    const pick = vscode.window.createQuickPick<DetectedModelItem>();
    pick.title = 'Vectra: Local Model';
    pick.placeholder = 'Searching for local models…';
    pick.matchOnDescription = true;
    pick.matchOnDetail = true;
    pick.ignoreFocusOut = true;
    pick.busy = true;
    pick.items = actionItems(savedFolder);
    pick.show();

    const promise = new Promise<string | undefined>((resolve) => {
      let settled = false;
      let accepted = false;
      const controller = new AbortController();
      const disposables: vscode.Disposable[] = [];

      // Only ever clears our own registration: a sub-flow may already have opened
      // a replacement picker by the time this one settles.
      const release = () => { if (this.activePick?.pick === pick) this.activePick = undefined; };

      const settle = (value?: string) => {
        if (settled) return;
        settled = true;
        controller.abort();
        release();
        disposables.forEach((item) => item.dispose());
        pick.dispose();
        resolve(value);
      };

      disposables.push(pick.onDidHide(() => { if (!accepted) settle(undefined); }));
      disposables.push(pick.onDidAccept(() => {
        const item = pick.selectedItems[0];
        if (!item) return;
        accepted = true;
        controller.abort();
        pick.hide();
        // Ownership is released *before* the sub-flow runs, otherwise
        // "Change model folder…" re-enters chooseLocalModel(), hits the
        // re-entrancy guard, and deadlocks awaiting its own promise.
        release();
        void this.runSelection(item, savedFolder).then(settle, (error) => {
          void vscode.window.showErrorMessage(`Vectra local model failed: ${messageOf(error)}`);
          settle(undefined);
        });
      }));

      void this.streamLocalModels(pick, {
        savedFolder,
        scoped,
        signal: controller.signal,
        isStale: () => settled
      }).catch(() => undefined);
    });

    this.activePick = { pick, promise };
    return promise;
  }

  /**
   * Feed the picker as results arrive. Detected models are appended below the
   * actions so no already-rendered row ever shifts under the user's cursor, and
   * the network probes are not gated behind the filesystem walk.
   */
  private async streamLocalModels(
    pick: vscode.QuickPick<DetectedModelItem>,
    context: { savedFolder: string; scoped: boolean; signal: AbortSignal; isStale: () => boolean }
  ): Promise<void> {
    const config = getConfig();
    const found = new Map<string, DiscoveredLocalModel>();
    const visited = new Set<string>();
    let pending = 2;

    const publish = () => {
      if (context.isStale()) return;
      const models = [...found.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
      const next = [...actionItems(context.savedFolder), ...detectedItems(models)];
      // Assigning items resets activeItems to the first row; restore the highlight
      // so streaming never yanks the cursor back to the top.
      const keep = pick.activeItems[0];
      const index = keep ? next.findIndex((item) => sameRow(item, keep)) : -1;
      pick.items = next;
      if (index >= 0) pick.activeItems = [next[index]];
      pick.title = models.length
        ? `Vectra: Local Model — ${models.length} found${pick.busy ? '…' : ''}`
        : 'Vectra: Local Model';
    };

    const add = (models: DiscoveredLocalModel[]) => {
      for (const model of models) found.set(`${model.kind}:${model.id}`, model);
      publish();
    };

    const finish = () => {
      if (--pending > 0 || context.isStale()) return;
      pick.busy = false;
      pick.placeholder = found.size
        ? 'Select a local model, or choose a folder to scan'
        : 'No local models found — choose a folder or a GGUF file';
      publish();
    };

    // Network probes run alongside the disk walk instead of behind it.
    void Promise.all([
      discoverOllamaModels(config.ollamaBaseUrl).catch(() => []),
      discoverOpenAICompatibleModels().catch(() => [])
    ]).then(([ollama, runtimes]) => add([...ollama, ...runtimes])).finally(finish);

    void (async () => {
      const roots = [config.localModelDirectory, config.localModelPath ? path.dirname(config.localModelPath) : '']
        .filter(Boolean);
      if (context.scoped) {
        add(await discoverGgufModels({
          roots,
          includeDefaults: false,
          visited,
          timeBudgetMs: SCOPED_TIME_BUDGET_MS,
          signal: context.signal
        }));
        return;
      }
      // Walk the tiers separately so each one's results appear as it completes.
      const everywhere = !context.savedFolder ? FIRST_RUN_TIME_BUDGET_MS : FULL_SCAN_TIME_BUDGET_MS;
      const budget = Math.floor(everywhere / 4);
      const tiers: Array<{ roots: string[]; depth: number }> = [
        { roots, depth: 8 },
        { roots: appModelDirectories(), depth: 6 },
        { roots: broadModelDirectories(), depth: 4 },
        { roots: storageModelDirectories(), depth: 4 }
      ];
      for (const entry of tiers) {
        if (context.signal.aborted || context.isStale() || !entry.roots.length) continue;
        add(await discoverGgufModels({
          roots: entry.roots,
          includeDefaults: false,
          maxDepth: entry.depth,
          maxDirectories: FULL_SCAN_MAX_DIRECTORIES,
          visited,
          timeBudgetMs: budget,
          signal: context.signal
        }));
      }
    })().finally(finish);
  }

  /** Shared activation path for every row the picker can offer. */
  private async runSelection(item: DetectedModelItem, savedFolder: string): Promise<string | undefined> {
    if (item.action === 'browseFile') return this.selectAndStartModel();
    if (item.action === 'scanEverywhere') return this.chooseLocalModel({ scanEverywhere: true });
    if (item.action === 'chooseFolder') {
      const directory = await this.pickModelFolder(savedFolder);
      if (!directory) return undefined;
      await updateLocalModelDirectory(directory);
      return this.chooseLocalModel();
    }
    if (!item.model) return undefined;
    if (item.model.kind === 'ollama') {
      await this.stop();
      await updateProvider('ollama');
      await updateModel(item.model.id);
      return item.model.id;
    }
    if (item.model.kind === 'runtime') {
      await this.stop();
      await updateOpenAICompatibleBaseUrl(item.model.baseUrl);
      await updateProvider('openaiCompatible');
      await updateModel(item.model.id);
      return item.model.id;
    }
    return this.loadModelWithProgress(item.model.id);
  }

  private async pickModelFolder(savedFolder: string): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
      title: 'Vectra: Choose the folder that holds your local models',
      defaultUri: vscode.Uri.file(savedFolder || os.homedir()),
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Scan this folder'
    });
    return picked?.[0]?.fsPath;
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

    const destDir = await this.chooseDownloadDirectory();
    if (!destDir) return undefined;
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

  private async chooseDownloadDirectory(): Promise<string | undefined> {
    const preferred = this.resolveModelsDirectory();
    let defaultDirectory = preferred;
    try { await fs.access(defaultDirectory); } catch { defaultDirectory = os.homedir(); }
    const picked = await vscode.window.showOpenDialog({
      title: 'Vectra: Choose where to download the model',
      defaultUri: vscode.Uri.file(defaultDirectory),
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Download here'
    });
    if (!picked?.[0]) return undefined;
    const directory = picked[0].fsPath;
    await updateModelsDirectory(directory);
    return directory;
  }

  private async pickCatalogEntry(): Promise<CatalogEntry | undefined> {
    const hw = await getHardwareSnapshot();
    const recommendations = recommendCatalogTiers(hw, CURATED_MODELS);
    return this.showCatalogPicker(recommendations.fast, recommendations.hybrid);
  }

  private async showCatalogPicker(recommended: CatalogEntry[], hybrid: CatalogEntry[] = []): Promise<CatalogEntry | undefined> {
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
    if (hybrid.length) {
      items.push({ label: 'Larger models (hybrid GPU + RAM, slower)', kind: vscode.QuickPickItemKind.Separator });
      items.push(...hybrid.map(toCatalogPickItem));
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
    if (picked.action === 'search') return this.showSearchFlow([...recommended, ...hybrid]);
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
    const executable = await this.resolveServerExecutable(modelPath);
    const config = getConfig();
    const normalized = normalizeShardPath(modelPath);
    const mmproj = await this.resolveMmproj(normalized);
    const [hardware, modelStat, supportedFlags] = await Promise.all([
      getHardwareSnapshot(),
      fs.stat(normalized),
      this.probeCapabilities(executable)
    ]);
    const profile = buildLlamaRuntimeProfile({
      hardware,
      modelBytes: modelStat.size,
      requestedContextSize: config.llamaCppContextSize,
      deviceMode: config.deviceMode,
      gpuLayers: config.llamaCppGpuLayers,
      cpuThreads: config.llamaCppThreads,
      threadProfile: config.llamaCppThreadProfile,
      splitMode: config.llamaCppSplitMode,
      cpuMoe: config.llamaCppCpuMoe,
      noMmap: config.llamaCppNoMmap,
      supportedFlags
    });
    const args = [
      '-m', normalized,
      '--host', '127.0.0.1',
      '--port', String(config.llamaCppPort),
      ...profile.args
    ];
    if (mmproj) args.push('--mmproj', mmproj);
    if (config.llamaCppExtraArgs.length) args.push(...config.llamaCppExtraArgs);

    // A model already running with the same executable/args is left alone
    // instead of being stopped and reloaded from disk for no reason.
    const argsKey = JSON.stringify({ executable, args });
    if (this.isRunning && argsKey === this.lastArgsKey) {
      this.output.appendLine('[Vectra] Reusing the already-running local model (unchanged settings).');
      if (this.startupPromise) await this.startupPromise;
      return;
    }
    await this.stop();

    this.output.show(true);
    this.output.appendLine('[Vectra] Starting llama.cpp');
    this.output.appendLine(`[Vectra] Server: ${executable}`);
    this.output.appendLine(`[Vectra] Model: ${normalized}`);
    if (mmproj) this.output.appendLine(`[Vectra] Vision projector: ${mmproj}`);
    this.output.appendLine(`[Vectra] Endpoint: ${this.baseUrl}`);
    this.output.appendLine(`[Vectra] Adaptive profile: ${profile.summary}`);
    this.output.appendLine(`[Vectra] Args: ${args.map(shellQuote).join(' ')}`);

    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = child;
    this.currentModelPath = normalized;
    this.currentMmprojPath = mmproj || '';
    this.lastArgsKey = argsKey;
    this.ready = false;
    child.stdout?.on('data', (data: Buffer) => this.output.append(data.toString()));
    child.stderr?.on('data', (data: Buffer) => this.output.append(data.toString()));
    child.on('exit', (code, signal) => {
      this.output.appendLine(`\n[Vectra] llama-server exited (${code ?? 'no code'}${signal ? `, ${signal}` : ''}).`);
      if (this.process === child) { this.process = undefined; this.ready = false; }
    });

    const startup = this.waitUntilHealthy(child, config.llamaCppLoadTimeoutSeconds * 1000);
    this.startupPromise = startup;
    try {
      await startup;
      this.ready = true;
      this.output.appendLine(`[Vectra] Local model is ready${mmproj ? ' with multimodal vision' : ''}.`);
    } finally {
      if (this.startupPromise === startup) this.startupPromise = undefined;
    }
  }

  private async probeCapabilities(executable: string): Promise<ReadonlySet<string>> {
    const cached = this.capabilityCache.get(executable);
    if (cached) return cached;
    let output = '';
    try {
      const result = await execFileAsync(executable, ['--help'], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
      output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    } catch (error) {
      const value = error as { stdout?: string; stderr?: string };
      output = `${value.stdout ?? ''}\n${value.stderr ?? ''}`;
    }
    const flags = parseLlamaServerFlags(output);
    this.capabilityCache.set(executable, flags);
    return flags;
  }

  async stop(): Promise<void> {
    const child = this.process;
    this.process = undefined;
    this.currentModelPath = '';
    this.currentMmprojPath = '';
    this.lastArgsKey = '';
    this.ready = false;
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
      const modelName = path.basename(modelPath);
      const family = visionFamily(modelName);
      if (!family) return undefined;
      const modelScale = parameterScale(modelName);
      const names = await fs.readdir(directory);
      const candidates = names
        .filter((name) => /^mmproj.*\.gguf$/i.test(name))
        .filter((name) => visionFamily(name) === family)
        .filter((name) => !modelScale || !parameterScale(name) || parameterScale(name) === modelScale)
        .sort((left, right) => scoreMmproj(right) - scoreMmproj(left));
      return candidates[0] ? path.join(directory, candidates[0]) : undefined;
    } catch {
      return undefined;
    }
  }

  private async resolveServerExecutable(modelPath: string): Promise<string> {
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

    const modelDirectory = path.dirname(modelPath);
    const common = process.platform === 'darwin'
      ? [path.join(modelDirectory, command), '/opt/homebrew/bin/llama-server', '/usr/local/bin/llama-server']
      : process.platform === 'win32'
        ? [
            path.join(modelDirectory, command),
            path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', command),
            path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'llama.cpp', 'llama-server.exe'),
            path.join(os.homedir(), 'llama.cpp', 'build', 'bin', 'Release', 'llama-server.exe')
          ]
        : [
            path.join(modelDirectory, command),
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

    const installRoots = [
      path.join(os.homedir(), '.vectra', 'llama.cpp'),
      ...(process.platform === 'win32' && process.env.LOCALAPPDATA
        ? [path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')]
        : [])
    ];
    for (const root of installRoots) {
      const candidate = await findServerExecutable(root, 5);
      if (!candidate) continue;
      await updateLlamaServerPath(candidate);
      return candidate;
    }

    const choice = await vscode.window.showWarningMessage(
      'Vectra found your GGUF model, but llama-server could not be found.',
      'Install llama.cpp automatically',
      'Select llama-server',
      'Open llama.cpp'
    );
    if (choice === 'Install llama.cpp automatically') {
      const installed = await this.installLlamaCpp();
      if (installed) return installed;
    }
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

  /**
   * Downloads and installs the llama.cpp build matching this machine (CPU or
   * CUDA), so a missing llama-server is fixed inline the first time a local
   * model needs it instead of sending the user to install it by hand. The
   * resolved path is cached via updateLlamaServerPath(), so this only runs
   * once per machine — every later start finds it immediately.
   */
  private async installLlamaCpp(): Promise<string | undefined> {
    let asset: LlamaCppAsset | undefined;
    let hasCuda = false;
    try {
      const gpus = await detectGpus();
      hasCuda = hasNvidiaGpu(gpus);
      asset = await findLatestAsset(hasCuda);
    } catch (error) {
      void vscode.window.showErrorMessage(`Vectra could not check for a llama.cpp release: ${messageOf(error)}`);
      return undefined;
    }
    if (!asset) {
      void vscode.window.showWarningMessage('Vectra could not find a matching llama.cpp build to install automatically for this platform.');
      return undefined;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Install llama.cpp (${asset.name})?`,
      {
        modal: true,
        detail: `Size: ${asset.sizeBytes ? formatBytes(asset.sizeBytes) : 'unknown'}\nSaves to: ${installDirFor(asset.version)}`
      },
      'Install'
    );
    if (confirm !== 'Install') return undefined;

    try {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Vectra: installing llama.cpp (${asset.name})…`,
          cancellable: true
        },
        async (progress, token) => {
          const controller = new AbortController();
          token.onCancellationRequested(() => controller.abort());
          const result = await installLatestLlamaCpp({
            hasCuda,
            asset: asset!,
            onProgress: phaseProgress(progress, 'llama.cpp'),
            signal: controller.signal
          });
          await updateLlamaServerPath(result.execPath);
          if (result.fellBackToCpu) {
            void vscode.window.showInformationMessage(
              `Vectra installed the CPU llama.cpp build because the CUDA build could not run on this computer.`
            );
          }
          return result.execPath;
        }
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`Vectra could not install llama.cpp: ${messageOf(error)}`);
      return undefined;
    }
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

function visionFamily(name: string): string {
  const value = name.toLowerCase().replace(/[_. ]+/g, '-');
  if (/qwen-?3-?vl|qwen3vl/.test(value)) return 'qwen3vl';
  if (/qwen-?2[.-]?5-?vl|qwen2[.-]?5vl/.test(value)) return 'qwen2.5vl';
  if (/qwen-?2-?vl|qwen2vl/.test(value)) return 'qwen2vl';
  if (/minicpm-?v/.test(value)) return 'minicpmv';
  if (/internvl/.test(value)) return 'internvl';
  if (/smolvlm/.test(value)) return 'smolvlm';
  if (/llava/.test(value)) return 'llava';
  if (/pixtral/.test(value)) return 'pixtral';
  if (/moondream/.test(value)) return 'moondream';
  if (/gemma-?3/.test(value)) return 'gemma3';
  if (/phi-?3.*vision/.test(value)) return 'phi3vision';
  if (/lfm-?2.*vl/.test(value)) return 'lfm2vl';
  return '';
}

function parameterScale(name: string): string {
  return name.toLowerCase().match(/(?:^|[-_.])(\d+(?:\.\d+)?)b(?:[-_.]|$)/)?.[1] ?? '';
}

function scoreMmproj(name: string): number {
  return /f16/i.test(name) ? 3 : /bf16/i.test(name) ? 2 : /q8/i.test(name) ? 1 : 0;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') await execFileAsync('where', [command], { timeout: 3_000, windowsHide: true });
    else await execFileAsync('which', [command], { timeout: 3_000 });
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

/** Actions sit above the results so appended models never shift a rendered row. */
function actionItems(savedFolder: string): DetectedModelItem[] {
  return [
    {
      label: '$(search) Choose a GGUF file…',
      description: 'Browse this computer for a .gguf model',
      action: 'browseFile'
    },
    {
      label: '$(folder-opened) Change model folder…',
      description: savedFolder || 'No folder saved yet',
      detail: savedFolder ? `Vectra scans ${savedFolder}` : 'Pick a folder and Vectra will scan only that from now on',
      action: 'chooseFolder'
    },
    {
      label: '$(globe) Scan whole computer…',
      description: 'Slower — ignores the saved folder',
      action: 'scanEverywhere'
    }
  ];
}

function detectedItems(models: DiscoveredLocalModel[]): DetectedModelItem[] {
  if (!models.length) return [];
  return [
    { label: 'Detected models', kind: vscode.QuickPickItemKind.Separator },
    ...models.map((model) => ({
      label: `${model.kind === 'gguf' ? '$(file-binary)' : '$(server-process)'} ${model.label}`,
      description: model.kind === 'gguf' ? 'GGUF · llama.cpp' : model.kind === 'ollama' ? 'Ollama' : model.detail.split(' · ')[0],
      detail: model.detail,
      model
    }))
  ];
}

function sameRow(a: DetectedModelItem, b: DetectedModelItem): boolean {
  return a.model && b.model ? a.model.kind === b.model.kind && a.model.id === b.model.id : a.action === b.action && a.label === b.label;
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
