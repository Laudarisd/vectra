// Copilot-style ghost-text suggestions backed by the configured Vectra model.
import * as vscode from 'vscode';
import { ProviderManager } from '../providers/ProviderManager';
import { getConfig } from '../utils/config';
import { isSensitiveAgentPath, relativeToWorkspace } from '../utils/path';
import { buildInlinePrompt, cleanInlineCompletion } from './FimPrompt';

/**
 * Enabled by default and independent of the sidebar mode. Each keystroke pause
 * asks the model for code at the cursor; the status-bar command can turn it off.
 */
export class InlineSuggestionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  private readonly configListener: vscode.Disposable;
  private readonly cache = new Map<string, string>();
  private failures = 0;

  constructor(private readonly providers: ProviderManager, private readonly output: vscode.OutputChannel) {
    this.status.command = 'vectra.toggleInlineSuggestions';
    this.refreshStatus();
    this.status.show();
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('vectra.inlineSuggestions')) this.refreshStatus();
    });
  }

  async toggle(): Promise<void> {
    const enabled = getConfig().inlineSuggestions.enabled;
    await vscode.workspace.getConfiguration('vectra').update('inlineSuggestions.enabled', !enabled, vscode.ConfigurationTarget.Global);
    this.refreshStatus();
  }

  refreshStatus(): void {
    const on = getConfig().inlineSuggestions.enabled;
    this.status.text = on ? '$(lightbulb-autofix) Vectra inline' : '$(lightbulb) Vectra inline off';
    this.status.tooltip = `Vectra inline suggestions are ${on ? 'on' : 'off'}. Click to toggle.`;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    const config = getConfig();
    const settings = config.inlineSuggestions;
    if (!settings.enabled || !vscode.workspace.isTrusted || !['file', 'untitled'].includes(document.uri.scheme)) return [];
    const relative = relativeToWorkspace(document.uri) ?? document.fileName;
    if (!config.allowSensitiveFiles && isSensitiveAgentPath(relative)) return [];

    await new Promise((resolve) => setTimeout(resolve, settings.debounceMs));
    if (token.isCancellationRequested) return [];

    const key = `${document.uri.toString()}:${document.version}:${position.line}:${position.character}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return this.items(cached, position);

    const context = {
      fileName: relative,
      languageId: document.languageId,
      prefix: document.getText(new vscode.Range(new vscode.Position(0, 0), position)),
      suffix: document.getText(new vscode.Range(position, document.lineAt(document.lineCount - 1).range.end))
    };
    const abort = new AbortController();
    const cancel = token.onCancellationRequested(() => abort.abort());
    try {
      const provider = await this.providers.getProvider();
      const { systemPrompt, userPrompt } = buildInlinePrompt(context);
      const raw = await provider.complete({
        systemPrompt,
        userPrompt,
        model: settings.model || config.model,
        structured: false,
        reasoning: 'minimal',
        maxTokens: 160,
        signal: abort.signal
      });
      const text = cleanInlineCompletion(raw, context, settings.maxLines);
      this.cache.set(key, text);
      if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value as string);
      this.failures = 0;
      return this.items(text, position);
    } catch (error) {
      // A cold local server or a network blip must not spam the log on every keystroke.
      if (!token.isCancellationRequested && this.failures++ < 3) {
        this.output.appendLine(`[Vectra inline] ${error instanceof Error ? error.message : String(error)}`);
      }
      return [];
    } finally {
      cancel.dispose();
    }
  }

  dispose(): void { this.configListener.dispose(); this.status.dispose(); }

  private items(text: string, position: vscode.Position): vscode.InlineCompletionItem[] {
    return text ? [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))] : [];
  }
}
