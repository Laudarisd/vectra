import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { promisify } from 'node:util';
import { validateAgentRelativePath } from '../utils/path';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 60_000;

/** Read-only `git` inspection. No commits, pushes, or working-tree mutation — parity with search_text/get_diagnostics, not with the confirmed CommandRunner tools. */
export class GitTools {
  async status(): Promise<string> {
    const cwd = this.workspaceRoot();
    const status = await this.run(cwd, ['status', '--porcelain=v1', '--branch']);
    if (status === null) return 'Not a git repository (or git is not installed).';
    const branch = (await this.run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => null)) ?? '';
    const trimmed = status.trim();
    return trimmed
      ? `Branch: ${branch.trim() || 'unknown'}\n${clip(trimmed)}`
      : `Branch: ${branch.trim() || 'unknown'}\nWorking tree clean.`;
  }

  async diff(pathInput?: string, staged = false): Promise<string> {
    const cwd = this.workspaceRoot();
    const args = ['diff', '--no-color'];
    if (staged) args.push('--staged');
    if (pathInput) args.push('--', validateAgentRelativePath(pathInput));
    const output = await this.run(cwd, args);
    if (output === null) return 'Not a git repository (or git is not installed).';
    return output.trim() ? clip(output.trim()) : 'No differences.';
  }

  private workspaceRoot(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('Open a workspace folder first.');
    return folder.uri.fsPath;
  }

  private async run(cwd: string, args: string[]): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 15_000 });
      return stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not a git repository|ENOENT/i.test(message)) return null;
      throw new Error(message);
    }
  }
}

function clip(text: string): string {
  return text.length > MAX_OUTPUT
    ? `${text.slice(0, MAX_OUTPUT)}\n\n… output truncated (${text.length - MAX_OUTPUT} more characters) …`
    : text;
}
