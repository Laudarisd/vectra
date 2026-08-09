import * as path from 'node:path';
import * as vscode from 'vscode';

export interface ResolvedWorkspacePath {
  uri: vscode.Uri;
  relativePath: string;
  folder: vscode.WorkspaceFolder;
}

export function normalizeAgentPath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim();
}


export function isSensitiveAgentPath(input: string): boolean {
  const normalized = normalizeAgentPath(input).toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  const base = segments.at(-1) ?? '';

  if (/^\.env(?:\.|$)/.test(base)) {
    return true;
  }
  if (['.npmrc', '.pypirc', '.netrc', '.git-credentials'].includes(base)) {
    return true;
  }
  if (['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'].includes(base)) {
    return true;
  }
  if (/\.(?:pem|key|p12|pfx|jks)$/.test(base)) {
    return true;
  }

  const joined = `/${segments.join('/')}`;
  return joined.endsWith('/.aws/credentials')
    || joined.endsWith('/.docker/config.json')
    || joined.endsWith('/.kube/config')
    || joined.endsWith('/.config/gcloud/application_default_credentials.json');
}

export function validateAgentRelativePath(input: string, allowEmpty = false): string {
  const normalized = normalizeAgentPath(input);
  if (!normalized) {
    if (allowEmpty) {
      return '';
    }
    throw new Error('A workspace-relative file path is required.');
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Absolute paths are not allowed: ${input}`);
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`Parent-directory traversal is not allowed: ${input}`);
  }
  if (normalized.includes('\0')) {
    throw new Error('Invalid file path.');
  }
  return normalized;
}

export function resolveWorkspacePath(input: string): ResolvedWorkspacePath {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    throw new Error('Open a workspace folder before using file tools.');
  }

  const normalized = validateAgentRelativePath(input);
  const target = splitWorkspacePrefix(normalized, folders);
  if (target) {
    return createResolved(target.folder, target.relativePath, folders.length > 1);
  }

  if (folders.length > 1) {
    throw new Error(`Multi-root workspace path must start with a workspace folder name, for example “${folders[0].name}/…”.`);
  }
  return createResolved(folders[0], normalized, false);
}

export function relativeToWorkspace(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return undefined;
  }
  const relative = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? `${folder.name}/${relative}` : relative;
}

export function searchRoots(pathInput: string): Array<{ folder: vscode.WorkspaceFolder; baseUri: vscode.Uri }> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return [];
  }
  const normalized = validateAgentRelativePath(pathInput, true);
  if (!normalized) {
    return folders.map((folder: vscode.WorkspaceFolder) => ({ folder, baseUri: folder.uri }));
  }
  const target = splitWorkspacePrefix(normalized, folders);
  if (target) {
    return [{ folder: target.folder, baseUri: vscode.Uri.joinPath(target.folder.uri, ...target.relativePath.split('/').filter(Boolean)) }];
  }
  if (folders.length > 1) {
    throw new Error(`In a multi-root workspace, search paths must start with a workspace folder name.`);
  }
  return [{ folder: folders[0], baseUri: vscode.Uri.joinPath(folders[0].uri, ...normalized.split('/')) }];
}

function splitWorkspacePrefix(normalized: string, folders: readonly vscode.WorkspaceFolder[]): { folder: vscode.WorkspaceFolder; relativePath: string } | undefined {
  // Treat an explicit workspace folder name as the workspace root even in a
  // single-root workspace. This lets users naturally say things like
  // "directory vectra" when the opened root folder itself is named vectra.
  for (const folder of folders) {
    if (normalized === folder.name) {
      return { folder, relativePath: '' };
    }
    if (normalized.startsWith(`${folder.name}/`)) {
      return { folder, relativePath: normalized.slice(folder.name.length + 1) };
    }
  }
  return undefined;
}

function createResolved(folder: vscode.WorkspaceFolder, relativePath: string, includeFolderPrefix: boolean): ResolvedWorkspacePath {
  const segments = relativePath.split('/').filter(Boolean);
  const uri = vscode.Uri.joinPath(folder.uri, ...segments);
  const relative = segments.join('/');
  return {
    uri,
    relativePath: includeFolderPrefix ? `${folder.name}/${relative}` : relative,
    folder
  };
}
