import * as vscode from 'vscode';
import * as path from 'node:path';
import { AgentAction, Attachment } from '../types';
import { AttachmentService } from '../documents/AttachmentService';
import { extractDocumentText, documentFormatForPath } from '../documents/DocumentCodec';
import { getConfig } from '../utils/config';
import { isSensitiveAgentPath, normalizeAgentPath, relativeToWorkspace, resolveWorkspacePath, searchRoots, validateAgentRelativePath } from '../utils/path';
import { safeJson } from '../utils/text';

const COMMON_EXCLUDED_DIRS = new Set(['.git','node_modules','dist','build','out','.next','.venv','venv','__pycache__','coverage','.idea','.vs']);

export class WorkspaceTools {
  private readonly attachments = new AttachmentService();

  async execute(action: Extract<AgentAction, { type: 'workspace_summary' | 'list_directory' | 'list_files' | 'read_file' | 'search_text' | 'get_diagnostics' }>): Promise<string> {
    assertWorkspaceTrusted();
    switch (action.type) {
      case 'workspace_summary': return this.workspaceSummary(action.path);
      case 'list_directory': return this.listDirectory(action.path, action.maxResults, action.maxDepth);
      case 'list_files': return this.listFiles(action.path, action.glob, action.maxResults);
      case 'read_file': return this.readFile(action.path, action.startLine, action.endLine);
      case 'search_text': return this.searchText(action.query, action.path, action.glob, action.maxResults, action.caseSensitive);
      case 'get_diagnostics': return this.getDiagnostics(action.path);
    }
  }

  async workspaceSummary(pathInput = ''): Promise<string> {
    assertWorkspaceTrusted();
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return 'No workspace folder is open.';
    validateAgentRelativePath(pathInput || '', true);
    const config = getConfig();
    const summaries: unknown[] = [];
    for (const { folder, baseUri } of searchRoots(pathInput || '')) {
      let stat: vscode.FileStat;
      try { stat = await vscode.workspace.fs.stat(baseUri); }
      catch { throw new Error(`Directory does not exist: ${pathInput || folder.name}`); }
      if (!(stat.type & vscode.FileType.Directory)) throw new Error(`${pathInput || folder.name} is not a directory.`);
      const files = await vscode.workspace.findFiles(new vscode.RelativePattern(baseUri, '**/*'), config.excludeGlob, 100_000);
      const filtered = files.filter(uri => {
        const rel = relativeToWorkspace(uri);
        return !rel || config.allowSensitiveFiles || !isSensitiveAgentPath(rel);
      });
      const extCounts = new Map<string, number>();
      for (const uri of filtered) {
        const ext = path.extname(uri.fsPath).toLowerCase() || '(no extension)';
        extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
      }
      const direct = await vscode.workspace.fs.readDirectory(baseUri);
      const topLevel = direct
        .filter(([name]) => !COMMON_EXCLUDED_DIRS.has(name))
        .slice(0, 120)
        .map(([name, type]) => ({ name, type: fileTypeName(type) }));
      const directoryCount = await countDirectories(baseUri, 50_000);
      summaries.push({
        workspace: folder.name,
        requestedPath: pathInput || '.',
        absolutePath: baseUri.fsPath,
        fileCount: filtered.length,
        directoryCount,
        countCapped: filtered.length >= 100_000 || directoryCount >= 50_000,
        topLevel,
        extensions: [...extCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([extension,count])=>({extension,count}))
      });
    }
    return `WORKSPACE SUMMARY\n${safeJson(summaries)}`;
  }

  async listDirectory(pathInput = '', maxResults = 200, maxDepth = 2): Promise<string> {
    assertWorkspaceTrusted();
    validateAgentRelativePath(pathInput || '', true);
    const safeMax = clamp(maxResults, 1, 1000);
    const safeDepth = clamp(maxDepth, 1, 8);
    const config = getConfig();
    const rows: Array<{ path: string; type: string; size?: number }> = [];
    for (const { folder, baseUri } of searchRoots(pathInput || '')) {
      await walkDirectory(baseUri, folder, '', 0, safeDepth, safeMax, rows, config.allowSensitiveFiles);
      if (rows.length >= safeMax) break;
    }
    const files = rows.filter(r=>r.type==='file').length;
    const directories = rows.filter(r=>r.type==='directory').length;
    return `DIRECTORY LIST ${pathInput || '.'}\nVisible entries: ${rows.length}${rows.length >= safeMax ? ` (capped at ${safeMax})` : ''}; files=${files}; directories=${directories}\n${safeJson(rows)}`;
  }

  async inspectFile(pathInput: string): Promise<Attachment> {
    assertWorkspaceTrusted();
    const config = getConfig();
    if (!config.allowSensitiveFiles && isSensitiveAgentPath(pathInput)) throw new Error(`Sensitive file access is blocked by default: ${normalizeAgentPath(pathInput)}.`);
    const resolved = resolveWorkspacePath(pathInput);
    const attachment = await this.attachments.loadWorkspacePath(resolved.uri);
    attachment.path = normalizeAgentPath(pathInput);
    return attachment;
  }

  async readRawFile(pathInput: string): Promise<{ exists: boolean; bytes: Uint8Array }> {
    assertWorkspaceTrusted();
    const config = getConfig();
    if (!config.allowSensitiveFiles && isSensitiveAgentPath(pathInput)) throw new Error(`Sensitive file access is blocked by default: ${normalizeAgentPath(pathInput)}.`);
    const resolved = resolveWorkspacePath(pathInput);
    try {
      const bytes = await vscode.workspace.fs.readFile(resolved.uri);
      if (bytes.byteLength > Math.max(config.maxFileBytes, 30 * 1024 * 1024)) throw new Error(`File is too large (${bytes.byteLength} bytes).`);
      return { exists: true, bytes };
    } catch (error) {
      if (isFileNotFound(error)) return { exists: false, bytes: new Uint8Array() };
      throw error;
    }
  }

  async readDocument(pathInput: string): Promise<string> {
    assertWorkspaceTrusted();
    const format = documentFormatForPath(pathInput);
    if (!format) throw new Error('read_document supports .pdf, .docx, .pptx, .xlsx and .rtf files.');
    const raw = await this.readRawFile(pathInput);
    if (!raw.exists) throw new Error(`Document does not exist: ${pathInput}`);
    const text = await extractDocumentText(pathInput, raw.bytes);
    if (!text.trim()) return `DOCUMENT ${normalizeAgentPath(pathInput)} (${format})\nNo reliable embedded text was found. This may be a scanned or visual PDF. Use inspect_file with a vision-capable model for visual understanding.`;
    return `DOCUMENT ${normalizeAgentPath(pathInput)} (${format})\n${text}`;
  }

  async readWholeFile(pathInput: string): Promise<{ exists: boolean; content: string }> {
    assertWorkspaceTrusted();
    const config = getConfig();
    if (!config.allowSensitiveFiles && isSensitiveAgentPath(pathInput)) throw new Error(`Sensitive file access is blocked by default: ${normalizeAgentPath(pathInput)}. Enable vectra.allowSensitiveFiles only if you explicitly want model access.`);
    const resolved = resolveWorkspacePath(pathInput);
    try {
      const openDocument = vscode.workspace.textDocuments.find(document => document.uri.toString() === resolved.uri.toString());
      if (openDocument) {
        const content = openDocument.getText();
        const byteLength = new TextEncoder().encode(content).byteLength;
        if (byteLength > config.maxFileBytes) throw new Error(`File is too large (${byteLength} bytes; limit ${config.maxFileBytes}).`);
        return { exists: true, content };
      }
      const bytes = await vscode.workspace.fs.readFile(resolved.uri);
      if (bytes.byteLength > config.maxFileBytes) throw new Error(`File is too large (${bytes.byteLength} bytes; limit ${config.maxFileBytes}).`);
      if (looksBinary(bytes)) throw new Error('Binary files cannot be edited by the text agent. Use document/image tools when appropriate.');
      return { exists: true, content: new TextDecoder().decode(bytes) };
    } catch (error) {
      if (isFileNotFound(error)) return { exists: false, content: '' };
      throw error;
    }
  }

  private async listFiles(pathInput = '', glob = '**/*', maxResults = 80): Promise<string> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return 'No workspace folder is open.';
    const config = getConfig();
    const safeMax = clamp(maxResults, 1, 2000);
    const results: string[] = [];
    validateAgentRelativePath(pathInput || '', true);
    for (const { baseUri } of searchRoots(pathInput || '')) {
      const include = new vscode.RelativePattern(baseUri, glob || '**/*');
      const uris = await vscode.workspace.findFiles(include, config.excludeGlob, safeMax);
      for (const uri of uris) {
        const relative = relativeToWorkspace(uri);
        if (relative && (config.allowSensitiveFiles || !isSensitiveAgentPath(relative))) results.push(relative);
        if (results.length >= safeMax) break;
      }
      if (results.length >= safeMax) break;
    }
    return `FILES ${pathInput || '.'} count=${results.length}${results.length >= safeMax ? ` (capped at ${safeMax})` : ''}\n${safeJson(results.sort())}`;
  }

  /**
   * Read a bounded, line-numbered text window. This method is public so the
   * agent tool registry can compose efficient multi-file reads without
   * duplicating workspace security and size checks.
   */
  async readFile(pathInput: string, startLine = 1, endLine?: number): Promise<string> {
    const { exists, content } = await this.readWholeFile(pathInput);
    if (!exists) throw new Error(`File does not exist: ${pathInput}`);
    const lines = content.split(/\r?\n/);
    const start = clamp(startLine, 1, Math.max(1, lines.length));
    const end = clamp(endLine ?? Math.min(lines.length, start + 399), start, lines.length);
    const numbered = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`);
    return `FILE ${normalizeAgentPath(pathInput)} lines ${start}-${end} of ${lines.length}\n${numbered.join('\n')}`;
  }

  /** Read several related files in one tool call while keeping each result bounded. */
  async readFiles(paths: string[], startLine = 1, endLine?: number): Promise<string> {
    const uniquePaths = [...new Set(paths.map(normalizeAgentPath).filter(Boolean))].slice(0, 20);
    if (!uniquePaths.length) throw new Error('read_files requires at least one workspace-relative path.');

    const results: string[] = [];
    for (const filePath of uniquePaths) {
      try {
        results.push(await this.readFile(filePath, startLine, endLine));
      } catch (error) {
        results.push(`FILE ${filePath}\nERROR: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return results.join('\n\n');
  }

  private async searchText(query: string, pathInput = '', glob = '**/*', maxResults = 30, caseSensitive = false): Promise<string> {
    if (!query) throw new Error('search_text requires a non-empty query.');
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return 'No workspace folder is open.';
    const config = getConfig();
    const safeMax = clamp(maxResults, 1, 200);
    validateAgentRelativePath(pathInput || '', true);
    const needle = caseSensitive ? query : query.toLowerCase();
    const matches: Array<{ path: string; line: number; text: string }> = [];
    for (const { baseUri } of searchRoots(pathInput || '')) {
      const include = new vscode.RelativePattern(baseUri, glob || '**/*');
      const files = await vscode.workspace.findFiles(include, config.excludeGlob, 1200);
      for (const uri of files) {
        if (matches.length >= safeMax) break;
        const relativePath = relativeToWorkspace(uri);
        if (!config.allowSensitiveFiles && relativePath && isSensitiveAgentPath(relativePath)) continue;
        let bytes: Uint8Array;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > config.maxFileBytes) continue;
          bytes = await vscode.workspace.fs.readFile(uri);
        } catch { continue; }
        if (looksBinary(bytes)) continue;
        const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < safeMax; i++) {
          const haystack = caseSensitive ? lines[i] : lines[i].toLowerCase();
          if (haystack.includes(needle)) matches.push({ path: relativePath ?? uri.fsPath, line: i + 1, text: lines[i].trim().slice(0, 500) });
        }
      }
    }
    return safeJson(matches);
  }

  private async getDiagnostics(pathInput?: string): Promise<string> {
    const config = getConfig();
    if (pathInput && !config.allowSensitiveFiles && isSensitiveAgentPath(pathInput)) throw new Error(`Sensitive file diagnostics are blocked by default: ${normalizeAgentPath(pathInput)}.`);
    let entries: Array<[vscode.Uri, readonly vscode.Diagnostic[]]>;
    if (pathInput) { const resolved = resolveWorkspacePath(pathInput); entries = [[resolved.uri, vscode.languages.getDiagnostics(resolved.uri)]]; }
    else entries = vscode.languages.getDiagnostics();
    const rows = entries.flatMap(([uri, diagnostics]) => diagnostics
      .filter(diagnostic => diagnostic.severity <= vscode.DiagnosticSeverity.Warning)
      .slice(0, 50)
      .map(diagnostic => ({ path: relativeToWorkspace(uri) ?? uri.fsPath, severity: diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning', line: diagnostic.range.start.line + 1, character: diagnostic.range.start.character + 1, message: diagnostic.message, source: diagnostic.source })))
      .slice(0, 100);
    return safeJson(rows);
  }
}

async function walkDirectory(uri: vscode.Uri, folder: vscode.WorkspaceFolder, prefix: string, depth: number, maxDepth: number, maxResults: number, rows: Array<{path:string;type:string;size?:number}>, allowSensitive: boolean): Promise<void> {
  if (rows.length >= maxResults || depth >= maxDepth) return;
  let entries: [string, vscode.FileType][];
  try { entries = await vscode.workspace.fs.readDirectory(uri); } catch { return; }
  entries.sort((a,b)=>a[0].localeCompare(b[0]));
  for (const [name,type] of entries) {
    if (rows.length >= maxResults) return;
    if (COMMON_EXCLUDED_DIRS.has(name)) continue;
    const relativeLocal = prefix ? `${prefix}/${name}` : name;
    const displayPath = (vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? `${folder.name}/${relativeLocal}` : relativeLocal;
    if (!allowSensitive && isSensitiveAgentPath(displayPath)) continue;
    const child = vscode.Uri.joinPath(uri, name);
    if (type & vscode.FileType.Directory) {
      rows.push({ path: displayPath, type: 'directory' });
      await walkDirectory(child, folder, relativeLocal, depth + 1, maxDepth, maxResults, rows, allowSensitive);
    } else if (type & vscode.FileType.File) {
      let size: number | undefined;
      try { size = (await vscode.workspace.fs.stat(child)).size; } catch { /* noop */ }
      rows.push({ path: displayPath, type: 'file', size });
    }
  }
}

async function countDirectories(root: vscode.Uri, cap: number): Promise<number> {
  let count = 0;
  const queue: vscode.Uri[] = [root];
  while (queue.length && count < cap) {
    const current = queue.shift()!;
    let entries: [string, vscode.FileType][];
    try { entries = await vscode.workspace.fs.readDirectory(current); } catch { continue; }
    for (const [name,type] of entries) {
      if (!(type & vscode.FileType.Directory) || COMMON_EXCLUDED_DIRS.has(name)) continue;
      count++;
      if (count >= cap) break;
      queue.push(vscode.Uri.joinPath(current, name));
    }
  }
  return count;
}

function fileTypeName(type: vscode.FileType): string {
  if (type & vscode.FileType.Directory) return 'directory';
  if (type & vscode.FileType.File) return 'file';
  if (type & vscode.FileType.SymbolicLink) return 'symlink';
  return 'other';
}
function clamp(value: number, min: number, max: number): number { const finite = Number.isFinite(value) ? Math.floor(value) : min; return Math.min(max, Math.max(min, finite)); }
function looksBinary(bytes: Uint8Array): boolean { const sample = bytes.subarray(0, Math.min(bytes.length, 8000)); let suspicious = 0; for (const byte of sample) { if (byte === 0) return true; if (byte < 7 || (byte > 13 && byte < 32)) suspicious++; } return sample.length > 0 && suspicious / sample.length > 0.08; }
function isFileNotFound(error: unknown): boolean { return error instanceof vscode.FileSystemError && (error as vscode.FileSystemError & { code?: string }).code === 'FileNotFound'; }
function assertWorkspaceTrusted(): void { if (!vscode.workspace.isTrusted) throw new Error('This workspace is not trusted. Trust the workspace before allowing an AI agent to inspect or modify its files.'); }
