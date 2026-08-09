import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { Attachment } from '../types';
import { extractDocTextFromPath, extractDocxTextFromBuffer, extractPdfTextFromBuffer, extractPptxTextFromBuffer, extractXlsxTextFromBuffer, extractRtfTextFromBuffer } from './DocumentExtractor';

const TEXT_EXTENSIONS = new Set(['.txt','.md','.json','.jsonl','.yaml','.yml','.xml','.csv','.tsv','.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.java','.c','.cc','.cpp','.h','.hpp','.cs','.go','.rs','.rb','.php','.swift','.kt','.kts','.sql','.sh','.bash','.zsh','.ps1','.html','.htm','.css','.scss','.less','.vue','.svelte','.toml','.ini','.cfg','.conf','.log','.tex','.ipynb']);
const IMAGE_MIME: Record<string,string> = { '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp' };

export class AttachmentService {
  async pick(): Promise<Attachment[]> {
    const uris = await vscode.window.showOpenDialog({ title: 'Vectra: Attach files', canSelectFiles: true, canSelectFolders: false, canSelectMany: true, openLabel: 'Attach' });
    if (!uris?.length) return [];
    const results: Attachment[] = [];
    for (const uri of uris.slice(0, 12)) results.push(await this.loadUri(uri, 'picker'));
    return results;
  }

  async loadWorkspacePath(uri: vscode.Uri): Promise<Attachment> { return this.loadUri(uri, 'workspace'); }

  private async loadUri(uri: vscode.Uri, source: Attachment['source']): Promise<Attachment> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const max = 30 * 1024 * 1024;
    if (bytes.byteLength > max) throw new Error(`${path.basename(uri.fsPath)} is ${(bytes.byteLength/1024/1024).toFixed(1)} MB. Vectra's per-attachment limit is 30 MB.`);
    const name = path.basename(uri.fsPath || uri.path); const ext = path.extname(name).toLowerCase();
    const base = { id: randomUUID(), name, size: bytes.byteLength, source, path: uri.fsPath };

    if (TEXT_EXTENSIONS.has(ext)) return { ...base, kind: 'text', mime: textMime(ext), text: new TextDecoder().decode(bytes) };
    if (ext === '.pdf') {
      const text = await extractPdfTextFromBuffer(bytes);
      return { ...base, kind: 'pdf', mime: 'application/pdf', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
    }
    if (ext === '.docx') {
      const text = await extractDocxTextFromBuffer(bytes);
      return { ...base, kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
    }
    if (ext === '.pptx') {
      const text = await extractPptxTextFromBuffer(bytes);
      return { ...base, kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
    }
    if (ext === '.xlsx') {
      const text = await extractXlsxTextFromBuffer(bytes);
      return { ...base, kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
    }
    if (ext === '.rtf') {
      const text = await extractRtfTextFromBuffer(bytes);
      return { ...base, kind: 'document', mime: 'application/rtf', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
    }
    if (ext === '.doc') {
      const text = uri.fsPath ? await extractDocTextFromPath(uri.fsPath) : '';
      return { ...base, kind: 'document', mime: 'application/msword', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
    }
    const imageMime = IMAGE_MIME[ext];
    if (imageMime) return { ...base, kind: 'image', mime: imageMime, base64: Buffer.from(bytes).toString('base64') };
    return { ...base, kind: 'binary', mime: 'application/octet-stream', base64: Buffer.from(bytes).toString('base64') };
  }
}

function textMime(ext: string): string {
  if (ext === '.json' || ext === '.ipynb') return 'application/json';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.html' || ext === '.htm') return 'text/html';
  if (ext === '.css') return 'text/css';
  if (ext === '.rtf') return 'application/rtf';
  return 'text/plain';
}
