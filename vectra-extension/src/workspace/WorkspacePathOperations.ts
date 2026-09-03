// Beginner guide: Handles w or ks pa ce pa th op er at io ns responsibilities for Vectra.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { isSensitiveAgentPath, normalizeAgentPath, resolveWorkspacePath } from '../utils/path';

/** Confirmed workspace-bound operations for files and directories. */
export class WorkspacePathOperations {
  async createDirectory(pathInput: string, reason = '', signal?: AbortSignal): Promise<string> {
    this.assertAllowed(pathInput);
    const target = resolveWorkspacePath(pathInput);
    assertNotWorkspaceRoot(target);
    if (await exists(target.uri)) throw new Error(`Path already exists: ${target.relativePath}`);
    await this.confirm('Create directory', target.relativePath, reason, signal);
    await vscode.workspace.fs.createDirectory(target.uri);
    return `Created directory ${target.relativePath}.`;
  }

  async rename(sourceInput: string, destinationInput: string, reason = '', signal?: AbortSignal): Promise<string> {
    const { source, destination } = await this.resolvePair(sourceInput, destinationInput);
    if (parentPath(source.relativePath) !== parentPath(destination.relativePath)) {
      throw new Error('rename_path keeps the same parent directory. Use move_path to relocate an item.');
    }
    await this.confirm('Rename file or directory', `${source.relativePath} → ${destination.relativePath}`, reason, signal);
    await vscode.workspace.fs.rename(source.uri, destination.uri, { overwrite: false });
    return `Renamed ${source.relativePath} to ${destination.relativePath}.`;
  }

  async move(sourceInput: string, destinationInput: string, reason = '', signal?: AbortSignal): Promise<string> {
    const { source, destination } = await this.resolvePair(sourceInput, destinationInput);
    await this.confirm('Move file or directory', `${source.relativePath} → ${destination.relativePath}`, reason, signal);
    await vscode.workspace.fs.createDirectory(destination.uri.with({ path: path.posix.dirname(destination.uri.path) }));
    await vscode.workspace.fs.rename(source.uri, destination.uri, { overwrite: false });
    return `Moved ${source.relativePath} to ${destination.relativePath}.`;
  }

  async copy(sourceInput: string, destinationInput: string, reason = '', signal?: AbortSignal): Promise<string> {
    const { source, destination } = await this.resolvePair(sourceInput, destinationInput);
    await this.confirm('Copy file or directory', `${source.relativePath} → ${destination.relativePath}`, reason, signal);
    await vscode.workspace.fs.createDirectory(destination.uri.with({ path: path.posix.dirname(destination.uri.path) }));
    await vscode.workspace.fs.copy(source.uri, destination.uri, { overwrite: false });
    return `Copied ${source.relativePath} to ${destination.relativePath}.`;
  }

  async deleteDirectory(pathInput: string, recursive = false, reason = '', signal?: AbortSignal): Promise<string> {
    this.assertAllowed(pathInput);
    const target = resolveWorkspacePath(pathInput);
    assertNotWorkspaceRoot(target);
    const stat = await statOrThrow(target.uri, target.relativePath);
    if (!(stat.type & vscode.FileType.Directory)) throw new Error(`Not a directory: ${target.relativePath}`);
    const entries = await vscode.workspace.fs.readDirectory(target.uri);
    if (entries.length && !recursive) {
      throw new Error(`Directory is not empty: ${target.relativePath}. Use recursive=true only when the user explicitly requested deleting its contents.`);
    }
    const detail = recursive
      ? `${target.relativePath}\nThis permanently removes the directory and all ${entries.length} direct entries inside it.`
      : target.relativePath;
    await this.confirm(recursive ? 'Delete directory recursively' : 'Delete empty directory', detail, reason, signal, 'Delete');
    await vscode.workspace.fs.delete(target.uri, { recursive, useTrash: true });
    return `Deleted directory ${target.relativePath}${recursive ? ' and its contents' : ''}.`;
  }

  private async resolvePair(sourceInput: string, destinationInput: string) {
    this.assertAllowed(sourceInput);
    this.assertAllowed(destinationInput);
    const source = resolveWorkspacePath(sourceInput);
    const destination = resolveWorkspacePath(destinationInput);
    assertNotWorkspaceRoot(source);
    assertNotWorkspaceRoot(destination);
    if (source.uri.toString() === destination.uri.toString()) throw new Error('Source and destination must be different.');
    const sourceStat = await statOrThrow(source.uri, source.relativePath);
    if ((sourceStat.type & vscode.FileType.Directory) && isDescendant(source.uri, destination.uri)) {
      throw new Error('A directory cannot be moved or copied inside itself.');
    }
    if (await exists(destination.uri)) throw new Error(`Destination already exists: ${destination.relativePath}`);
    return { source, destination };
  }

  private assertAllowed(pathInput: string): void {
    if (!vscode.workspace.isTrusted) throw new Error('This workspace is not trusted.');
    const normalized = normalizeAgentPath(pathInput);
    if (!getConfig().allowSensitiveFiles && isSensitiveAgentPath(normalized)) {
      throw new Error(`Sensitive path operations are blocked by default: ${normalized}.`);
    }
  }

  private async confirm(
    action: string,
    detail: string,
    reason: string,
    signal?: AbortSignal,
    acceptLabel = action
  ): Promise<void> {
    if (signal?.aborted) throw cancelled();
    const choice = await vscode.window.showWarningMessage(
      `Vectra wants to ${action.toLowerCase()}:`,
      { modal: true, detail: `${detail}${reason ? `\n\nReason: ${reason}` : ''}` },
      acceptLabel,
      'Cancel'
    );
    if (signal?.aborted) throw cancelled();
    if (choice !== acceptLabel) throw new Error(`${action} cancelled by user.`);
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; }
  catch (error) { if (isNotFound(error)) return false; throw error; }
}

async function statOrThrow(uri: vscode.Uri, label: string): Promise<vscode.FileStat> {
  try { return await vscode.workspace.fs.stat(uri); }
  catch (error) { if (isNotFound(error)) throw new Error(`Path does not exist: ${label}`); throw error; }
}

function isNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

function parentPath(value: string): string {
  return path.posix.dirname(value.replace(/\\/g, '/'));
}

function assertNotWorkspaceRoot(value: { uri: vscode.Uri; folder: vscode.WorkspaceFolder }): void {
  if (value.uri.toString() === value.folder.uri.toString()) {
    throw new Error('Workspace root folders cannot be changed by path-operation tools.');
  }
}

function isDescendant(source: vscode.Uri, destination: vscode.Uri): boolean {
  if (source.scheme !== destination.scheme || source.authority !== destination.authority) return false;
  const root = source.path.replace(/\/$/, '');
  return destination.path.startsWith(`${root}/`);
}

function cancelled(): Error {
  const error = new Error('Path operation cancelled.');
  error.name = 'AbortError';
  return error;
}
