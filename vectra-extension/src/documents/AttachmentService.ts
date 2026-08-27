import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { Attachment } from '../types';
import { parseAttachmentBytes } from './AttachmentParser';

const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_PICK = 12;

/** Loads user-selected and workspace files through the shared attachment parser. */
export class AttachmentService {
  async pick(): Promise<Attachment[]> {
    const uris = await vscode.window.showOpenDialog({
      title: 'Vectra: Attach files',
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: 'Attach'
    });
    if (!uris?.length) return [];

    const results: Attachment[] = [];
    for (const uri of uris.slice(0, MAX_ATTACHMENTS_PER_PICK)) {
      results.push(await this.loadUri(uri, 'picker'));
    }
    return results;
  }

  async loadWorkspacePath(uri: vscode.Uri): Promise<Attachment> {
    return this.loadUri(uri, 'workspace');
  }

  private async loadUri(uri: vscode.Uri, source: Attachment['source']): Promise<Attachment> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const name = path.basename(uri.fsPath || uri.path);
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `${name} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB. ` +
        `Vectra's per-attachment limit is ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`
      );
    }

    const parsed = await parseAttachmentBytes(name, bytes, uri.fsPath || undefined);
    return {
      id: randomUUID(),
      name,
      size: bytes.byteLength,
      source,
      path: uri.fsPath,
      ...parsed
    };
  }
}
