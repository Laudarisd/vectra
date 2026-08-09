import * as vscode from 'vscode';
import { PatchManager } from './PatchManager';

export const DIFF_SCHEME = 'dev-agent-diff';

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly patches: PatchManager) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    const params = new URLSearchParams(uri.query);
    const id = params.get('id');
    const side = params.get('side');
    if (!id) {
      return '';
    }
    const proposal = this.patches.get(id);
    if (!proposal) {
      return 'Proposal no longer exists.';
    }
    return side === 'before' ? proposal.baseContent : proposal.proposedContent;
  }

  async showDiff(id: string): Promise<void> {
    const proposal = this.patches.get(id);
    if (!proposal) {
      throw new Error('Proposal no longer exists.');
    }
    const before = this.makeUri(proposal.path, id, 'before');
    const after = this.makeUri(proposal.path, id, 'after');
    const title = `${proposal.path} — Agent Proposal`;
    await vscode.commands.executeCommand('vscode.diff', before, after, title, { preview: true });
  }

  private makeUri(path: string, id: string, side: 'before' | 'after'): vscode.Uri {
    return vscode.Uri.from({
      scheme: DIFF_SCHEME,
      path: `/${path}`,
      query: `id=${encodeURIComponent(id)}&side=${side}`
    });
  }
}
