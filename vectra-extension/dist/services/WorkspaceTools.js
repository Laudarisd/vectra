"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceTools = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const AttachmentService_1 = require("./AttachmentService");
const DocumentService_1 = require("./DocumentService");
const config_1 = require("../utils/config");
const path_1 = require("../utils/path");
const text_1 = require("../utils/text");
const COMMON_EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', 'coverage', '.idea', '.vs']);
class WorkspaceTools {
    attachments = new AttachmentService_1.AttachmentService();
    async execute(action) {
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
    async workspaceSummary(pathInput = '') {
        assertWorkspaceTrusted();
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length)
            return 'No workspace folder is open.';
        (0, path_1.validateAgentRelativePath)(pathInput || '', true);
        const config = (0, config_1.getConfig)();
        const summaries = [];
        for (const { folder, baseUri } of (0, path_1.searchRoots)(pathInput || '')) {
            let stat;
            try {
                stat = await vscode.workspace.fs.stat(baseUri);
            }
            catch {
                throw new Error(`Directory does not exist: ${pathInput || folder.name}`);
            }
            if (!(stat.type & vscode.FileType.Directory))
                throw new Error(`${pathInput || folder.name} is not a directory.`);
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(baseUri, '**/*'), config.excludeGlob, 100_000);
            const filtered = files.filter(uri => {
                const rel = (0, path_1.relativeToWorkspace)(uri);
                return !rel || config.allowSensitiveFiles || !(0, path_1.isSensitiveAgentPath)(rel);
            });
            const extCounts = new Map();
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
                extensions: [...extCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([extension, count]) => ({ extension, count }))
            });
        }
        return `WORKSPACE SUMMARY\n${(0, text_1.safeJson)(summaries)}`;
    }
    async listDirectory(pathInput = '', maxResults = 200, maxDepth = 2) {
        assertWorkspaceTrusted();
        (0, path_1.validateAgentRelativePath)(pathInput || '', true);
        const safeMax = clamp(maxResults, 1, 1000);
        const safeDepth = clamp(maxDepth, 1, 8);
        const config = (0, config_1.getConfig)();
        const rows = [];
        for (const { folder, baseUri } of (0, path_1.searchRoots)(pathInput || '')) {
            await walkDirectory(baseUri, folder, '', 0, safeDepth, safeMax, rows, config.allowSensitiveFiles);
            if (rows.length >= safeMax)
                break;
        }
        const files = rows.filter(r => r.type === 'file').length;
        const directories = rows.filter(r => r.type === 'directory').length;
        return `DIRECTORY LIST ${pathInput || '.'}\nVisible entries: ${rows.length}${rows.length >= safeMax ? ` (capped at ${safeMax})` : ''}; files=${files}; directories=${directories}\n${(0, text_1.safeJson)(rows)}`;
    }
    async inspectFile(pathInput) {
        assertWorkspaceTrusted();
        const config = (0, config_1.getConfig)();
        if (!config.allowSensitiveFiles && (0, path_1.isSensitiveAgentPath)(pathInput))
            throw new Error(`Sensitive file access is blocked by default: ${(0, path_1.normalizeAgentPath)(pathInput)}.`);
        const resolved = (0, path_1.resolveWorkspacePath)(pathInput);
        const attachment = await this.attachments.loadWorkspacePath(resolved.uri);
        attachment.path = (0, path_1.normalizeAgentPath)(pathInput);
        return attachment;
    }
    async readRawFile(pathInput) {
        assertWorkspaceTrusted();
        const config = (0, config_1.getConfig)();
        if (!config.allowSensitiveFiles && (0, path_1.isSensitiveAgentPath)(pathInput))
            throw new Error(`Sensitive file access is blocked by default: ${(0, path_1.normalizeAgentPath)(pathInput)}.`);
        const resolved = (0, path_1.resolveWorkspacePath)(pathInput);
        try {
            const bytes = await vscode.workspace.fs.readFile(resolved.uri);
            if (bytes.byteLength > Math.max(config.maxFileBytes, 30 * 1024 * 1024))
                throw new Error(`File is too large (${bytes.byteLength} bytes).`);
            return { exists: true, bytes };
        }
        catch (error) {
            if (isFileNotFound(error))
                return { exists: false, bytes: new Uint8Array() };
            throw error;
        }
    }
    async readDocument(pathInput) {
        assertWorkspaceTrusted();
        const format = (0, DocumentService_1.documentFormatForPath)(pathInput);
        if (!format)
            throw new Error('read_document supports .pdf, .docx, .pptx, .xlsx and .rtf files.');
        const raw = await this.readRawFile(pathInput);
        if (!raw.exists)
            throw new Error(`Document does not exist: ${pathInput}`);
        const text = await (0, DocumentService_1.extractDocumentText)(pathInput, raw.bytes);
        if (!text.trim())
            return `DOCUMENT ${(0, path_1.normalizeAgentPath)(pathInput)} (${format})\nNo reliable embedded text was found. This may be a scanned or visual PDF. Use inspect_file with a vision-capable model for visual understanding.`;
        return `DOCUMENT ${(0, path_1.normalizeAgentPath)(pathInput)} (${format})\n${text}`;
    }
    async readWholeFile(pathInput) {
        assertWorkspaceTrusted();
        const config = (0, config_1.getConfig)();
        if (!config.allowSensitiveFiles && (0, path_1.isSensitiveAgentPath)(pathInput))
            throw new Error(`Sensitive file access is blocked by default: ${(0, path_1.normalizeAgentPath)(pathInput)}. Enable vectra.allowSensitiveFiles only if you explicitly want model access.`);
        const resolved = (0, path_1.resolveWorkspacePath)(pathInput);
        try {
            const openDocument = vscode.workspace.textDocuments.find(document => document.uri.toString() === resolved.uri.toString());
            if (openDocument) {
                const content = openDocument.getText();
                const byteLength = new TextEncoder().encode(content).byteLength;
                if (byteLength > config.maxFileBytes)
                    throw new Error(`File is too large (${byteLength} bytes; limit ${config.maxFileBytes}).`);
                return { exists: true, content };
            }
            const bytes = await vscode.workspace.fs.readFile(resolved.uri);
            if (bytes.byteLength > config.maxFileBytes)
                throw new Error(`File is too large (${bytes.byteLength} bytes; limit ${config.maxFileBytes}).`);
            if (looksBinary(bytes))
                throw new Error('Binary files cannot be edited by the text agent. Use document/image tools when appropriate.');
            return { exists: true, content: new TextDecoder().decode(bytes) };
        }
        catch (error) {
            if (isFileNotFound(error))
                return { exists: false, content: '' };
            throw error;
        }
    }
    async listFiles(pathInput = '', glob = '**/*', maxResults = 80) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length)
            return 'No workspace folder is open.';
        const config = (0, config_1.getConfig)();
        const safeMax = clamp(maxResults, 1, 2000);
        const results = [];
        (0, path_1.validateAgentRelativePath)(pathInput || '', true);
        for (const { baseUri } of (0, path_1.searchRoots)(pathInput || '')) {
            const include = new vscode.RelativePattern(baseUri, glob || '**/*');
            const uris = await vscode.workspace.findFiles(include, config.excludeGlob, safeMax);
            for (const uri of uris) {
                const relative = (0, path_1.relativeToWorkspace)(uri);
                if (relative && (config.allowSensitiveFiles || !(0, path_1.isSensitiveAgentPath)(relative)))
                    results.push(relative);
                if (results.length >= safeMax)
                    break;
            }
            if (results.length >= safeMax)
                break;
        }
        return `FILES ${pathInput || '.'} count=${results.length}${results.length >= safeMax ? ` (capped at ${safeMax})` : ''}\n${(0, text_1.safeJson)(results.sort())}`;
    }
    /**
     * Read a bounded, line-numbered text window. This method is public so the
     * agent tool registry can compose efficient multi-file reads without
     * duplicating workspace security and size checks.
     */
    async readFile(pathInput, startLine = 1, endLine) {
        const { exists, content } = await this.readWholeFile(pathInput);
        if (!exists)
            throw new Error(`File does not exist: ${pathInput}`);
        const lines = content.split(/\r?\n/);
        const start = clamp(startLine, 1, Math.max(1, lines.length));
        const end = clamp(endLine ?? Math.min(lines.length, start + 399), start, lines.length);
        const numbered = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`);
        return `FILE ${(0, path_1.normalizeAgentPath)(pathInput)} lines ${start}-${end} of ${lines.length}\n${numbered.join('\n')}`;
    }
    /** Read several related files in one tool call while keeping each result bounded. */
    async readFiles(paths, startLine = 1, endLine) {
        const uniquePaths = [...new Set(paths.map(path_1.normalizeAgentPath).filter(Boolean))].slice(0, 20);
        if (!uniquePaths.length)
            throw new Error('read_files requires at least one workspace-relative path.');
        const results = [];
        for (const filePath of uniquePaths) {
            try {
                results.push(await this.readFile(filePath, startLine, endLine));
            }
            catch (error) {
                results.push(`FILE ${filePath}\nERROR: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return results.join('\n\n');
    }
    async searchText(query, pathInput = '', glob = '**/*', maxResults = 30, caseSensitive = false) {
        if (!query)
            throw new Error('search_text requires a non-empty query.');
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length)
            return 'No workspace folder is open.';
        const config = (0, config_1.getConfig)();
        const safeMax = clamp(maxResults, 1, 200);
        (0, path_1.validateAgentRelativePath)(pathInput || '', true);
        const needle = caseSensitive ? query : query.toLowerCase();
        const matches = [];
        for (const { baseUri } of (0, path_1.searchRoots)(pathInput || '')) {
            const include = new vscode.RelativePattern(baseUri, glob || '**/*');
            const files = await vscode.workspace.findFiles(include, config.excludeGlob, 1200);
            for (const uri of files) {
                if (matches.length >= safeMax)
                    break;
                const relativePath = (0, path_1.relativeToWorkspace)(uri);
                if (!config.allowSensitiveFiles && relativePath && (0, path_1.isSensitiveAgentPath)(relativePath))
                    continue;
                let bytes;
                try {
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.size > config.maxFileBytes)
                        continue;
                    bytes = await vscode.workspace.fs.readFile(uri);
                }
                catch {
                    continue;
                }
                if (looksBinary(bytes))
                    continue;
                const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
                for (let i = 0; i < lines.length && matches.length < safeMax; i++) {
                    const haystack = caseSensitive ? lines[i] : lines[i].toLowerCase();
                    if (haystack.includes(needle))
                        matches.push({ path: relativePath ?? uri.fsPath, line: i + 1, text: lines[i].trim().slice(0, 500) });
                }
            }
        }
        return (0, text_1.safeJson)(matches);
    }
    async getDiagnostics(pathInput) {
        const config = (0, config_1.getConfig)();
        if (pathInput && !config.allowSensitiveFiles && (0, path_1.isSensitiveAgentPath)(pathInput))
            throw new Error(`Sensitive file diagnostics are blocked by default: ${(0, path_1.normalizeAgentPath)(pathInput)}.`);
        let entries;
        if (pathInput) {
            const resolved = (0, path_1.resolveWorkspacePath)(pathInput);
            entries = [[resolved.uri, vscode.languages.getDiagnostics(resolved.uri)]];
        }
        else
            entries = vscode.languages.getDiagnostics();
        const rows = entries.flatMap(([uri, diagnostics]) => diagnostics
            .filter(diagnostic => diagnostic.severity <= vscode.DiagnosticSeverity.Warning)
            .slice(0, 50)
            .map(diagnostic => ({ path: (0, path_1.relativeToWorkspace)(uri) ?? uri.fsPath, severity: diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning', line: diagnostic.range.start.line + 1, character: diagnostic.range.start.character + 1, message: diagnostic.message, source: diagnostic.source })))
            .slice(0, 100);
        return (0, text_1.safeJson)(rows);
    }
}
exports.WorkspaceTools = WorkspaceTools;
async function walkDirectory(uri, folder, prefix, depth, maxDepth, maxResults, rows, allowSensitive) {
    if (rows.length >= maxResults || depth >= maxDepth)
        return;
    let entries;
    try {
        entries = await vscode.workspace.fs.readDirectory(uri);
    }
    catch {
        return;
    }
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, type] of entries) {
        if (rows.length >= maxResults)
            return;
        if (COMMON_EXCLUDED_DIRS.has(name))
            continue;
        const relativeLocal = prefix ? `${prefix}/${name}` : name;
        const displayPath = (vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? `${folder.name}/${relativeLocal}` : relativeLocal;
        if (!allowSensitive && (0, path_1.isSensitiveAgentPath)(displayPath))
            continue;
        const child = vscode.Uri.joinPath(uri, name);
        if (type & vscode.FileType.Directory) {
            rows.push({ path: displayPath, type: 'directory' });
            await walkDirectory(child, folder, relativeLocal, depth + 1, maxDepth, maxResults, rows, allowSensitive);
        }
        else if (type & vscode.FileType.File) {
            let size;
            try {
                size = (await vscode.workspace.fs.stat(child)).size;
            }
            catch { /* noop */ }
            rows.push({ path: displayPath, type: 'file', size });
        }
    }
}
async function countDirectories(root, cap) {
    let count = 0;
    const queue = [root];
    while (queue.length && count < cap) {
        const current = queue.shift();
        let entries;
        try {
            entries = await vscode.workspace.fs.readDirectory(current);
        }
        catch {
            continue;
        }
        for (const [name, type] of entries) {
            if (!(type & vscode.FileType.Directory) || COMMON_EXCLUDED_DIRS.has(name))
                continue;
            count++;
            if (count >= cap)
                break;
            queue.push(vscode.Uri.joinPath(current, name));
        }
    }
    return count;
}
function fileTypeName(type) {
    if (type & vscode.FileType.Directory)
        return 'directory';
    if (type & vscode.FileType.File)
        return 'file';
    if (type & vscode.FileType.SymbolicLink)
        return 'symlink';
    return 'other';
}
function clamp(value, min, max) { const finite = Number.isFinite(value) ? Math.floor(value) : min; return Math.min(max, Math.max(min, finite)); }
function looksBinary(bytes) { const sample = bytes.subarray(0, Math.min(bytes.length, 8000)); let suspicious = 0; for (const byte of sample) {
    if (byte === 0)
        return true;
    if (byte < 7 || (byte > 13 && byte < 32))
        suspicious++;
} return sample.length > 0 && suspicious / sample.length > 0.08; }
function isFileNotFound(error) { return error instanceof vscode.FileSystemError && error.code === 'FileNotFound'; }
function assertWorkspaceTrusted() { if (!vscode.workspace.isTrusted)
    throw new Error('This workspace is not trusted. Trust the workspace before allowing an AI agent to inspect or modify its files.'); }
//# sourceMappingURL=WorkspaceTools.js.map