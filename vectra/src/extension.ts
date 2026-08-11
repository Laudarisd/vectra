import * as vscode from 'vscode';
import { AgentController } from './agent/AgentController';
import { ProviderManager } from './providers/ProviderManager';
import { ContextCollector } from './services/ContextCollector';
import { DIFF_SCHEME, DiffContentProvider } from './services/DiffContentProvider';
import { PatchManager } from './services/PatchManager';
import { LocalCredentialStore } from './services/LocalCredentialStore';
import { LocalLlamaCppService } from './services/LocalLlamaCppService';
import { WorkspaceTools } from './services/WorkspaceTools';
import { CommandRunner } from './services/CommandRunner';
import { AttachmentService } from './services/AttachmentService';
import { ChatViewProvider } from './ui/ChatViewProvider';
import { ModelInfo, ProviderId } from './types';
import { getConfig, updateModel, updateProvider } from './utils/config';

let localLlama: LocalLlamaCppService | undefined;
let extensionOutput: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionOutput = vscode.window.createOutputChannel('Vectra');
  context.subscriptions.push(extensionOutput);
  extensionOutput.appendLine(`[Vectra] Activating ${context.extension.packageJSON.version ?? ''} on VS Code ${vscode.version}`);
  extensionOutput.appendLine(`[Vectra] Workspace trusted: ${vscode.workspace.isTrusted}`);

  try {
    activateVectra(context, extensionOutput);
  } catch (error) {
    const text = messageOf(error);
    extensionOutput.appendLine(`[Vectra] Activation failed: ${text}`);
    if (error instanceof Error && error.stack) extensionOutput.appendLine(error.stack);
    void vscode.window.showErrorMessage(`Vectra failed to activate: ${text}`, 'Show Logs').then((choice) => {
      if (choice === 'Show Logs') extensionOutput?.show(true);
    });
  }
}

function activateVectra(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  const credentials = new LocalCredentialStore();
  localLlama = new LocalLlamaCppService();
  const providers = new ProviderManager(credentials);
  const tools = new WorkspaceTools();
  const commands = new CommandRunner();
  const attachments = new AttachmentService();
  const patches = new PatchManager(tools);
  const diffs = new DiffContentProvider(patches);
  const controller = new AgentController(providers, new ContextCollector(), tools, patches, commands);
  const chat = new ChatViewProvider(
    context.extensionUri,
    controller,
    patches,
    diffs,
    credentials,
    localLlama,
    attachments,
    String(context.extension.packageJSON.version ?? '')
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(sparkle) Vectra';
  status.tooltip = 'Open Vectra AI coding agent';
  status.command = 'vectra.open';
  status.show();

  context.subscriptions.push(
    localLlama,
    commands,
    status,
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffs),
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chat, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('vectra.open', async () => {
      output.appendLine('[Vectra] Open requested.');
      await chat.reveal();
    }),
    vscode.commands.registerCommand('vectra.showLogs', () => output.show(true)),
    vscode.commands.registerCommand('vectra.checkSelection', () => chat.checkSelection()),
    vscode.commands.registerCommand('vectra.attachFiles', async () => {
      await chat.attachFiles();
    }),
    vscode.commands.registerCommand('vectra.selectMmproj', async () => {
      if (!requireTrustedWorkspace('select a local vision projector')) return;
      try {
        const projector = await localLlama!.selectMmproj();
        if (projector && getConfig().localModelPath) {
          await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Vectra: restarting local model with vision…' }, () => localLlama!.startConfiguredModel());
          await chat.refresh();
          void vscode.window.showInformationMessage(`Vectra vision projector ready: ${projector}`);
        }
      } catch (error) { void vscode.window.showErrorMessage(`Vectra mmproj failed: ${messageOf(error)}`); }
    }),
    vscode.commands.registerCommand('vectra.selectLocalModel', async () => {
      if (!requireTrustedWorkspace('launch a local model')) return;
      try {
        const modelId = await localLlama!.chooseLocalModel();
        if (modelId) {
          await chat.refresh();
          void vscode.window.showInformationMessage(`Vectra local model ready: ${modelId}`);
        }
      } catch (error) {
        output.appendLine(`[Vectra] Local model error: ${messageOf(error)}`);
        void vscode.window.showErrorMessage(`Vectra local model failed: ${messageOf(error)}`);
      }
    }),
    vscode.commands.registerCommand('vectra.setApiKey', async () => {
      await configureCloudProvider(credentials, providers, chat);
    }),
    vscode.commands.registerCommand('vectra.selectProvider', async () => {
      const picked = await vscode.window.showQuickPick(providerItems(), {
        title: 'Vectra: Advanced provider selection',
        placeHolder: `Current: ${getConfig().provider}`
      });
      if (!picked) return;
      await updateProvider(picked.id);
      await updateModel('');
      await chat.refresh();
    }),
    vscode.commands.registerCommand('vectra.selectModel', async () => {
      await selectProviderModel(providers, chat);
    }),
    vscode.commands.registerCommand('vectra.testConnection', async () => {
      try {
        if (getConfig().provider === 'llamaCpp' && !localLlama!.isRunning) {
          if (!requireTrustedWorkspace('launch a local model')) return;
          const started = await localLlama!.startConfiguredModel();
          if (!started) throw new Error('No local GGUF model is selected. Click Local Model first.');
        }
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Testing Vectra model connection…' },
          () => providers.testConnection()
        );
        void vscode.window.showInformationMessage(result);
      } catch (error) {
        void vscode.window.showErrorMessage(`Vectra connection failed: ${messageOf(error)}`);
      }
    }),
    vscode.commands.registerCommand('vectra.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:laudarisd.vectra');
    }),
    vscode.commands.registerCommand('vectra.supportDeveloper', async () => {
      const url = getConfig().supportDeveloperUrl.trim();
      if (!url) {
        void vscode.window.showInformationMessage('No developer support URL is configured. Set vectra.supportDeveloperUrl first.');
        return;
      }
      let uri: vscode.Uri;
      try { uri = vscode.Uri.parse(url, true); } catch { void vscode.window.showErrorMessage('The configured developer support URL is invalid.'); return; }
      if (uri.scheme !== 'https') { void vscode.window.showErrorMessage('Developer support URL must use HTTPS.'); return; }
      await vscode.env.openExternal(uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('vectra')) void chat.refresh();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      output.appendLine('[Vectra] Workspace trust granted.');
      void chat.refresh();
      if (getConfig().provider === 'llamaCpp' && getConfig().localModelPath && !localLlama!.isRunning) {
        void localLlama!.startConfiguredModel().then(() => chat.refresh()).catch((error) => {
          output.appendLine(`[Vectra] Local model did not auto-start after trust: ${messageOf(error)}`);
        });
      }
    })
  );

  output.appendLine('[Vectra] View provider and commands registered.');

  // Only auto-run a local executable in a trusted workspace.
  if (vscode.workspace.isTrusted && getConfig().provider === 'llamaCpp' && getConfig().localModelPath) {
    void localLlama.startConfiguredModel().then(() => chat.refresh()).catch((error) => {
      output.appendLine(`[Vectra] Local model did not auto-start: ${messageOf(error)}`);
    });
  }

  // A VSIX can be installed successfully while its Activity Bar container is hidden by a restored
  // layout. On the first activation of this fixed release, explicitly reveal Vectra and keep a
  // status-bar entry as a permanent fallback.
  const firstVisibleKey = 'vectra.ui.v1_0_0.sidebar.revealed';
  if (!context.globalState.get<boolean>(firstVisibleKey)) {
    void context.globalState.update(firstVisibleKey, true);
    setTimeout(() => {
      void chat.reveal().then(() => {
        output.appendLine('[Vectra] First-run view revealed.');
      }).catch((error) => {
        output.appendLine(`[Vectra] Could not auto-reveal view: ${messageOf(error)}`);
        void vscode.window.showInformationMessage('Vectra is installed. Open it from the status bar or Command Palette.', 'Open Vectra').then((choice) => {
          if (choice === 'Open Vectra') void vscode.commands.executeCommand('vectra.open');
        });
      });
    }, 800);
  }
}

export function deactivate(): void {
  extensionOutput?.appendLine('[Vectra] Deactivating.');
  void localLlama?.stop();
}

function requireTrustedWorkspace(action: string): boolean {
  if (vscode.workspace.isTrusted) return true;
  void vscode.window.showWarningMessage(`Trust this workspace before Vectra can ${action}.`, 'Manage Workspace Trust').then((choice) => {
    if (choice === 'Manage Workspace Trust') void vscode.commands.executeCommand('workbench.trust.manage');
  });
  return false;
}

async function configureCloudProvider(
  credentials: LocalCredentialStore,
  providers: ProviderManager,
  chat: ChatViewProvider
): Promise<void> {
  const cloudItems: Array<vscode.QuickPickItem & { id: ProviderId }> = [
    { id: 'openai', label: 'OpenAI', description: 'Use your OpenAI API key' },
    { id: 'anthropic', label: 'Anthropic / Claude', description: 'Use your Anthropic API key' },
    { id: 'gemini', label: 'Google Gemini', description: 'Use your Gemini API key' },
    { id: 'openaiCompatible', label: 'OpenAI-compatible API', description: 'Custom hosted endpoint; API key may be optional' }
  ];
  const current = getConfig().provider;
  const picked = await vscode.window.showQuickPick(cloudItems, {
    title: 'Vectra: API Key',
    placeHolder: cloudItems.some((x) => x.id === current) ? `Current provider: ${current}` : 'Choose your API provider'
  });
  if (!picked) return;

  const existing = await credentials.get(picked.id);
  const key = await vscode.window.showInputBox({
    title: `Vectra: ${picked.label} API key`,
    prompt: `Stored only on this computer in ${credentials.filePath}. Vectra does not upload or sync the key.`,
    value: existing ?? '',
    password: true,
    ignoreFocusOut: true,
    placeHolder: picked.id === 'openaiCompatible' ? 'Optional for local/custom endpoints' : 'Paste API key'
  });
  if (key === undefined) return;
  if (!key.trim() && picked.id !== 'openaiCompatible') {
    void vscode.window.showWarningMessage('An API key is required for this provider.');
    return;
  }
  if (key.trim()) await credentials.set(picked.id, key);
  else await credentials.delete(picked.id);
  await updateProvider(picked.id);
  await updateModel('');
  await chat.refresh();

  try {
    await selectProviderModel(providers, chat);
  } catch (error) {
    void vscode.window.showWarningMessage(`API key saved locally, but model discovery failed: ${messageOf(error)}`);
  }
}

async function selectProviderModel(providers: ProviderManager, chat: ChatViewProvider): Promise<void> {
  const config = getConfig();
  if (config.provider === 'llamaCpp') {
    await vscode.commands.executeCommand('vectra.selectLocalModel');
    return;
  }
  const models: ModelInfo[] = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Vectra: loading ${config.provider} models…` },
    () => providers.listModels()
  );
  const manual = '$(edit) Enter model ID manually…';
  const picked = await vscode.window.showQuickPick([
    ...models.map((model) => ({ label: model.label || model.id, description: model.label ? model.id : model.detail, detail: model.label ? model.detail : undefined })),
    { label: manual, description: 'Use an exact model ID' }
  ], { title: 'Vectra: Select AI model', placeHolder: config.model ? `Current: ${config.model}` : 'Choose a model' });
  if (!picked) return;
  let id = picked.label;
  if (picked.label === manual) {
    const value = await vscode.window.showInputBox({ title: 'Vectra: Model ID', value: config.model });
    if (!value?.trim()) return;
    id = value.trim();
  } else {
    const match = models.find((m) => m.label === picked.label || m.id === picked.label || m.id === picked.description);
    id = match?.id ?? picked.description ?? picked.label;
  }
  await updateModel(id);
  await chat.refresh();
}

function providerItems(): Array<vscode.QuickPickItem & { id: ProviderId }> {
  return [
    { id: 'llamaCpp', label: 'Local llama.cpp', description: 'GGUF model selected from your computer' },
    { id: 'ollama', label: 'Ollama', description: 'Advanced: existing Ollama server' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'anthropic', label: 'Anthropic / Claude' },
    { id: 'gemini', label: 'Google Gemini' },
    { id: 'openaiCompatible', label: 'OpenAI-compatible', description: 'LM Studio, vLLM, private gateway, etc.' }
  ];
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
