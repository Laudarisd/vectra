// Implements read-only, workspace-bounded file discovery, reading, search, and diagnostics.
import * as vscode from 'vscode';
import * as path from 'node:path';
import { AgentAction, Attachment } from '../../../core/types';
import { AttachmentService } from '../../../core/documents/AttachmentService';
import { extractDocumentText, documentFormatForPath } from '../../../core/documents/DocumentCodec';
import { getConfig } from '../../../core/utils/config';
import { isSensitiveAgentPath, normalizeAgentPath, relativeToWorkspace, resolveWorkspacePath, searchRoots, validateAgentRelativePath } from '../../../core/utils/path';
import { safeJson } from '../../../core/utils/text';

const COMMON_EXCLUDED_DIRS = new Set(['.git','node_modules','dist','build','out','.next','.venv','venv','__pycache__','coverage','.idea','.vs']);
const FAST_SUMMARY_FILE_LIMIT = 10_000;
const SUMMARY_CACHE_MS = 30_000;
const FAST_SCAN_TIMEOUT_MS = 2_000;
const EXACT_SCAN_TIMEOUT_MS = 10_000;

export class WorkspaceTools {
  private readonly attachments = new AttachmentService();
  private readonly summaryCache = new Map<string, { expiresAt: number; text: string }>();

  async execute(action: Extract<AgentAction, { type: 'workspace_summary' | 'list_directory' | 'list_files' | 'read_file' | 'search_text' | 'get_diagnostics' | 'workspace_symbols' | 'go_to_definition' | 'find_references' }>, signal?: AbortSignal): Promise<string> {
    assertWorkspaceTrusted();
    switch (action.type) {
      case 'workspace_summary': return this.workspaceSummary(action.path, action.exact, signal);
      case 'list_directory': return this.listDirectory(action.path, action.maxResults, action.maxDepth, signal);
      case 'list_files': return this.listFiles(action.path, action.glob, action.maxResults, signal);
      case 'read_file': return this.readFile(action.path, action.startLine, action.endLine);
      case 'search_text': return this.searchText(action.query, action.path, action.glob, action.maxResults, action.caseSensitive, signal);
      case 'get_diagnostics': return this.getDiagnostics(action.path);
      case 'workspace_symbols': return this.workspaceSymbols(action.query, action.maxResults);
      case 'go_to_definition': return this.goToDefinition(action.path, action.line, action.column);
      case 'find_references': return this.findReferences(action.path, action.line, action.column, action.includeDeclaration);
    }
  }

  async workspaceSummary(pathInput = '', exact = false, signal?: AbortSignal): Promise<string> {
    assertWorkspaceTrusted();
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return 'No workspace folder is open.';
    validateAgentRelativePath(pathInput || '', true);
    const cacheKey = normalizeAgentPath(pathInput || '.');
    const cached = !exact ? this.summaryCache.get(cacheKey) : undefined;
    if (cached && cached.expiresAt > Date.now()) return cached.text;

    const config = getConfig();
    const summaries: unknown[] = [];
    for (const { folder, baseUri } of searchRoots(pathInput || '')) {
      throwIfCancelled(signal);
      let stat: vscode.FileStat;
      try { stat = await vscode.workspace.fs.stat(baseUri); }
      catch { throw new Error(`Directory does not exist: ${pathInput || folder.name}`); }
      if (!(stat.type & vscode.FileType.Directory)) throw new Error(`${pathInput || folder.name} is not a directory.`);
      const fileLimit = exact ? 100_000 : FAST_SUMMARY_FILE_LIMIT;
      const scan = await findFilesBounded(
        new vscode.RelativePattern(baseUri, '**/*'),
        config.excludeGlob,
        fileLimit,
        signal,
        exact ? EXACT_SCAN_TIMEOUT_MS : FAST_SCAN_TIMEOUT_MS
      );
      const files = scan.files;
      const filtered = files.filter(uri => {
        const rel = relativeToWorkspace(uri);
        return !rel || config.allowSensitiveFiles || !isSensitiveAgentPath(rel);
      });
      const extCounts = new Map<string, number>();
      const discoveredDirectories = new Set<string>();
      for (const uri of filtered) {
        const ext = path.extname(uri.fsPath).toLowerCase() || '(no extension)';
        extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
        const localParts = path.relative(baseUri.fsPath, uri.fsPath).split(path.sep).slice(0, -1);
        for (let index = 1; index <= localParts.length; index++) discoveredDirectories.add(localParts.slice(0, index).join('/'));
      }
      const direct = await vscode.workspace.fs.readDirectory(baseUri);
      const topLevel = direct
        .filter(([name]) => !COMMON_EXCLUDED_DIRS.has(name))
        .slice(0, 120)
        .map(([name, type]) => ({ name, type: fileTypeName(type) }));
      const exactDirectoryCount = exact
        ? await countDirectories(baseUri, 50_000, Date.now() + EXACT_SCAN_TIMEOUT_MS, signal)
        : undefined;
      const directoryCount = exactDirectoryCount?.count ?? discoveredDirectories.size;
      summaries.push({
        workspace: folder.name,
        requestedPath: pathInput || '.',
        absolutePath: baseUri.fsPath,
        fileCount: filtered.length,
        directoryCount,
        countMode: exact ? 'exact-requested' : 'fast-cached-snapshot',
        countCapped: scan.timedOut || filtered.length >= fileLimit || Boolean(exactDirectoryCount?.capped),
        topLevel,
        extensions: [...extCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([extension,count])=>({extension,count}))
      });
    }
    const text = `WORKSPACE SUMMARY${exact ? ' (EXACT REQUEST)' : ' (FAST SNAPSHOT)'}\n${safeJson(summaries)}`;
    if (!exact) this.summaryCache.set(cacheKey, { expiresAt: Date.now() + SUMMARY_CACHE_MS, text });
    return text;
  }

  async listDirectory(pathInput = '', maxResults = 200, maxDepth = 2, signal?: AbortSignal): Promise<string> {
    assertWorkspaceTrusted();
    validateAgentRelativePath(pathInput || '', true);
    const safeMax = clamp(maxResults, 1, 1000);
    const safeDepth = clamp(maxDepth, 1, 8);
    const config = getConfig();
    const rows: Array<{ path: string; type: string; size?: number }> = [];
    const deadline = Date.now() + 2_000;
    for (const { folder, baseUri } of searchRoots(pathInput || '')) {
      await walkDirectory(baseUri, folder, '', 0, safeDepth, safeMax, rows, config.allowSensitiveFiles, deadline, signal);
      if (rows.length >= safeMax) break;
    }
    const files = rows.filter(r=>r.type==='file').length;
    const directories = rows.filter(r=>r.type==='directory').length;
    const capped = rows.length >= safeMax || Date.now() >= deadline;
    return `DIRECTORY LIST ${pathInput || '.'}\nVisible entries: ${rows.length}${capped ? ' (bounded result)' : ''}; files=${files}; directories=${directories}\n${safeJson(rows)}`;
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

  private async listFiles(pathInput = '', glob = '**/*', maxResults = 80, signal?: AbortSignal): Promise<string> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return 'No workspace folder is open.';
    const config = getConfig();
    const safeMax = clamp(maxResults, 1, 2000);
    const results: string[] = [];
    let scanTimedOut = false;
    validateAgentRelativePath(pathInput || '', true);
    for (const { baseUri } of searchRoots(pathInput || '')) {
      const include = new vscode.RelativePattern(baseUri, glob || '**/*');
      const { files: uris, timedOut } = await findFilesBounded(include, config.excludeGlob, safeMax, signal, FAST_SCAN_TIMEOUT_MS);
      scanTimedOut ||= timedOut;
      for (const uri of uris) {
        const relative = relativeToWorkspace(uri);
        if (relative && (config.allowSensitiveFiles || !isSensitiveAgentPath(relative))) results.push(relative);
        if (results.length >= safeMax) break;
      }
      if (results.length >= safeMax) break;
    }
    const bounded = results.length >= safeMax || scanTimedOut;
    return `FILES ${pathInput || '.'} count=${results.length}${bounded ? ` (bounded at ${safeMax} entries / ${FAST_SCAN_TIMEOUT_MS} ms)` : ''}\n${safeJson(results.sort())}`;
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

  private async searchText(query: string, pathInput = '', glob = '**/*', maxResults = 30, caseSensitive = false, signal?: AbortSignal): Promise<string> {
    if (!query) throw new Error('search_text requires a non-empty query.');
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return 'No workspace folder is open.';
    const config = getConfig();
    const safeMax = clamp(maxResults, 1, 200);
    validateAgentRelativePath(pathInput || '', true);
    const needle = caseSensitive ? query : query.toLowerCase();
    const matches: Array<{ path: string; line: number; text: string }> = [];
    const deadline = Date.now() + 5_000;
    let scanTimedOut = false;
    for (const { baseUri } of searchRoots(pathInput || '')) {
      const include = new vscode.RelativePattern(baseUri, glob || '**/*');
      const scan = await findFilesBounded(include, config.excludeGlob, 1200, signal, FAST_SCAN_TIMEOUT_MS);
      const files = scan.files;
      scanTimedOut ||= scan.timedOut;
      for (const uri of files) {
        throwIfCancelled(signal);
        if (matches.length >= safeMax || Date.now() >= deadline) break;
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
    return `${scanTimedOut || Date.now() >= deadline ? 'SEARCH TIME BUDGET REACHED; PARTIAL RESULTS\n' : ''}${safeJson(matches)}`;
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

  /** Ask installed language extensions for semantic symbols instead of relying on text matching. */
  private async workspaceSymbols(query: string, maxResults = 50): Promise<string> {
    if (!query.trim()) throw new Error('workspace_symbols requires a non-empty query.');
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider',
      query.trim()
    ) ?? [];
    const rows = symbols.slice(0, clamp(maxResults, 1, 200)).map((symbol) => ({
      name: symbol.name,
      kind: vscode.SymbolKind[symbol.kind],
      container: symbol.containerName || undefined,
      path: relativeToWorkspace(symbol.location.uri) ?? symbol.location.uri.fsPath,
      line: symbol.location.range.start.line + 1,
      column: symbol.location.range.start.character + 1
    }));
    return safeJson(rows);
  }

  /** Resolve a symbol definition using the same language service as VS Code's F12 command. */
  private async goToDefinition(pathInput: string, line: number, column = 1): Promise<string> {
    const { uri, position } = this.languagePosition(pathInput, line, column);
    const locations = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
      'vscode.executeDefinitionProvider',
      uri,
      position
    ) ?? [];
    return safeJson(locations.map(formatLanguageLocation));
  }

  /** Resolve references semantically so similarly named text is not mistaken for a real usage. */
  private async findReferences(pathInput: string, line: number, column = 1, includeDeclaration = true): Promise<string> {
    const { uri, position } = this.languagePosition(pathInput, line, column);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      uri,
      position,
      { includeDeclaration }
    ) ?? [];
    return safeJson(locations.slice(0, 300).map(formatLanguageLocation));
  }

  private languagePosition(pathInput: string, line: number, column: number): { uri: vscode.Uri; position: vscode.Position } {
    const config = getConfig();
    if (!config.allowSensitiveFiles && isSensitiveAgentPath(pathInput)) {
      throw new Error(`Sensitive file access is blocked by default: ${normalizeAgentPath(pathInput)}.`);
    }
    const resolved = resolveWorkspacePath(pathInput);
    return {
      uri: resolved.uri,
      position: new vscode.Position(Math.max(0, Math.floor(line) - 1), Math.max(0, Math.floor(column) - 1))
    };
  }
}

function formatLanguageLocation(location: vscode.Location | vscode.LocationLink): { path: string; line: number; column: number } {
  const isLink = 'targetUri' in location;
  const uri = isLink ? location.targetUri : location.uri;
  const range = isLink ? (location.targetSelectionRange ?? location.targetRange) : location.range;
  return {
    path: relativeToWorkspace(uri) ?? uri.fsPath,
    line: range.start.line + 1,
    column: range.start.character + 1
  };
}

async function walkDirectory(uri: vscode.Uri, folder: vscode.WorkspaceFolder, prefix: string, depth: number, maxDepth: number, maxResults: number, rows: Array<{path:string;type:string;size?:number}>, allowSensitive: boolean, deadline: number, signal?: AbortSignal): Promise<void> {
  throwIfCancelled(signal);
  if (rows.length >= maxResults || depth >= maxDepth || Date.now() >= deadline) return;
  let entries: [string, vscode.FileType][];
  try { entries = await vscode.workspace.fs.readDirectory(uri); } catch { return; }
  entries.sort((a,b)=>a[0].localeCompare(b[0]));
  for (const [name,type] of entries) {
    throwIfCancelled(signal);
    if (rows.length >= maxResults || Date.now() >= deadline) return;
    if (COMMON_EXCLUDED_DIRS.has(name)) continue;
    const relativeLocal = prefix ? `${prefix}/${name}` : name;
    const displayPath = (vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? `${folder.name}/${relativeLocal}` : relativeLocal;
    if (!allowSensitive && isSensitiveAgentPath(displayPath)) continue;
    const child = vscode.Uri.joinPath(uri, name);
    if (type & vscode.FileType.Directory) {
      rows.push({ path: displayPath, type: 'directory' });
      await walkDirectory(child, folder, relativeLocal, depth + 1, maxDepth, maxResults, rows, allowSensitive, deadline, signal);
    } else if (type & vscode.FileType.File) {
      let size: number | undefined;
      try { size = (await vscode.workspace.fs.stat(child)).size; } catch { /* noop */ }
      rows.push({ path: displayPath, type: 'file', size });
    }
  }
}

async function countDirectories(root: vscode.Uri, cap: number, deadline: number, signal?: AbortSignal): Promise<{ count: number; capped: boolean }> {
  let count = 0;
  const queue: vscode.Uri[] = [root];
  let cursor = 0;
  while (cursor < queue.length && count < cap && Date.now() < deadline) {
    throwIfCancelled(signal);
    const current = queue[cursor++];
    let entries: [string, vscode.FileType][];
    try { entries = await vscode.workspace.fs.readDirectory(current); } catch { continue; }
    for (const [name,type] of entries) {
      if (!(type & vscode.FileType.Directory) || COMMON_EXCLUDED_DIRS.has(name)) continue;
      count++;
      if (count >= cap) break;
      queue.push(vscode.Uri.joinPath(current, name));
    }
  }
  return { count, capped: count >= cap || cursor < queue.length || Date.now() >= deadline };
}

/**
 * Ask VS Code's indexed file service for results, but never let a large or
 * remote workspace hold the agent indefinitely. Cancellation is shared with
 * the Stop button, while the timeout returns a clearly labelled partial scan.
 */
async function findFilesBounded(include: vscode.GlobPattern, exclude: vscode.GlobPattern | undefined, maxResults: number, signal: AbortSignal | undefined, timeoutMs: number): Promise<{ files: vscode.Uri[]; timedOut: boolean }> {
  throwIfCancelled(signal);
  const cancellation = new vscode.CancellationTokenSource();
  let timedOut = false;
  const cancelFromRequest = (): void => cancellation.cancel();
  signal?.addEventListener('abort', cancelFromRequest, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    cancellation.cancel();
  }, timeoutMs);

  try {
    const files = await vscode.workspace.findFiles(include, exclude, maxResults, cancellation.token);
    throwIfCancelled(signal);
    return { files, timedOut };
  } catch (error) {
    throwIfCancelled(signal);
    if (timedOut || error instanceof vscode.CancellationError) return { files: [], timedOut: true };
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancelFromRequest);
    cancellation.dispose();
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Request cancelled.');
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
