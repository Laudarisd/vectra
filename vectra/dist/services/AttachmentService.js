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
exports.AttachmentService = void 0;
const vscode = __importStar(require("vscode"));
const node_crypto_1 = require("node:crypto");
const path = __importStar(require("node:path"));
const DocumentExtractor_1 = require("./DocumentExtractor");
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.jsonl', '.yaml', '.yml', '.xml', '.csv', '.tsv', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.kts', '.sql', '.sh', '.bash', '.zsh', '.ps1', '.html', '.htm', '.css', '.scss', '.less', '.vue', '.svelte', '.toml', '.ini', '.cfg', '.conf', '.log', '.tex', '.ipynb']);
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
class AttachmentService {
    async pick() {
        const uris = await vscode.window.showOpenDialog({ title: 'Vectra: Attach files', canSelectFiles: true, canSelectFolders: false, canSelectMany: true, openLabel: 'Attach' });
        if (!uris?.length)
            return [];
        const results = [];
        for (const uri of uris.slice(0, 12))
            results.push(await this.loadUri(uri, 'picker'));
        return results;
    }
    async loadWorkspacePath(uri) { return this.loadUri(uri, 'workspace'); }
    async loadUri(uri, source) {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const max = 30 * 1024 * 1024;
        if (bytes.byteLength > max)
            throw new Error(`${path.basename(uri.fsPath)} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB. Vectra's per-attachment limit is 30 MB.`);
        const name = path.basename(uri.fsPath || uri.path);
        const ext = path.extname(name).toLowerCase();
        const base = { id: (0, node_crypto_1.randomUUID)(), name, size: bytes.byteLength, source, path: uri.fsPath };
        if (TEXT_EXTENSIONS.has(ext))
            return { ...base, kind: 'text', mime: textMime(ext), text: new TextDecoder().decode(bytes) };
        if (ext === '.pdf') {
            const text = await (0, DocumentExtractor_1.extractPdfTextFromBuffer)(bytes);
            return { ...base, kind: 'pdf', mime: 'application/pdf', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
        }
        if (ext === '.docx') {
            const text = await (0, DocumentExtractor_1.extractDocxTextFromBuffer)(bytes);
            return { ...base, kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
        }
        if (ext === '.pptx') {
            const text = await (0, DocumentExtractor_1.extractPptxTextFromBuffer)(bytes);
            return { ...base, kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
        }
        if (ext === '.xlsx') {
            const text = await (0, DocumentExtractor_1.extractXlsxTextFromBuffer)(bytes);
            return { ...base, kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
        }
        if (ext === '.rtf') {
            const text = await (0, DocumentExtractor_1.extractRtfTextFromBuffer)(bytes);
            return { ...base, kind: 'document', mime: 'application/rtf', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
        }
        if (ext === '.doc') {
            const text = uri.fsPath ? await (0, DocumentExtractor_1.extractDocTextFromPath)(uri.fsPath) : '';
            return { ...base, kind: 'document', mime: 'application/msword', text: text || undefined, base64: Buffer.from(bytes).toString('base64') };
        }
        const imageMime = IMAGE_MIME[ext];
        if (imageMime)
            return { ...base, kind: 'image', mime: imageMime, base64: Buffer.from(bytes).toString('base64') };
        return { ...base, kind: 'binary', mime: 'application/octet-stream', base64: Buffer.from(bytes).toString('base64') };
    }
}
exports.AttachmentService = AttachmentService;
function textMime(ext) {
    if (ext === '.json' || ext === '.ipynb')
        return 'application/json';
    if (ext === '.csv')
        return 'text/csv';
    if (ext === '.html' || ext === '.htm')
        return 'text/html';
    if (ext === '.css')
        return 'text/css';
    if (ext === '.rtf')
        return 'application/rtf';
    return 'text/plain';
}
//# sourceMappingURL=AttachmentService.js.map