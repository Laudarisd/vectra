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
exports.PatchManager = void 0;
const vscode = __importStar(require("vscode"));
const node_crypto_1 = require("node:crypto");
const path = __importStar(require("node:path"));
const path_1 = require("../utils/path");
const text_1 = require("../utils/text");
const DocumentService_1 = require("./DocumentService");
class PatchManager {
    tools;
    proposals = new Map();
    constructor(tools) {
        this.tools = tools;
    }
    list() { return [...this.proposals.values()].sort((a, b) => b.createdAt - a.createdAt); }
    get(id) { return this.proposals.get(id); }
    async proposeFile(path, proposedContent, reason = 'Agent-proposed change') {
        const current = await this.tools.readWholeFile(path);
        return this.store({ id: (0, node_crypto_1.randomUUID)(), path, reason, kind: current.exists ? 'modify' : 'create', baseContent: current.content, proposedContent, baseHash: (0, text_1.sha256)(current.content), createdAt: Date.now(), status: 'pending', contentType: 'text' });
    }
    async proposeLineEdit(path, startLine, endLine, content, mode, reason = 'Agent-proposed line edit') {
        const current = await this.tools.readWholeFile(path);
        if (!current.exists)
            throw new Error(`File does not exist: ${path}`);
        const eol = current.content.includes('\r\n') ? '\r\n' : '\n';
        const trailing = /\r?\n$/.test(current.content);
        const lines = current.content.split(/\r?\n/);
        if (trailing)
            lines.pop();
        const max = Math.max(1, lines.length);
        const start = clamp(startLine, 1, max);
        const end = clamp(endLine, start, max);
        const replacement = content ? content.replace(/\r\n/g, '\n').split('\n') : [];
        if (mode === 'replace')
            lines.splice(start - 1, end - start + 1, ...replacement);
        else if (mode === 'delete')
            lines.splice(start - 1, end - start + 1);
        else if (mode === 'insert-before')
            lines.splice(start - 1, 0, ...replacement);
        else
            lines.splice(start, 0, ...replacement);
        let proposed = lines.join(eol);
        if (trailing)
            proposed += eol;
        return this.proposeFile(path, proposed, reason);
    }
    async proposeDocument(path, content, reason = 'Agent-proposed document change', title, requireExisting = false) {
        const format = (0, DocumentService_1.documentFormatForPath)(path);
        if (!format || !(0, DocumentService_1.isWritableDocumentFormat)(format))
            throw new Error('Document creation/editing supports .pdf and .docx. PPTX/XLSX/RTF are currently read/parse only.');
        const current = await this.tools.readRawFile(path);
        if (requireExisting && !current.exists)
            throw new Error(`Document does not exist: ${path}`);
        if (!requireExisting && current.exists)
            throw new Error(`${path} already exists. Use edit_document.`);
        const baseText = current.exists ? await (0, DocumentService_1.extractDocumentText)(path, current.bytes) : '';
        const output = (0, DocumentService_1.createDocumentBytes)(path, content, title);
        return this.store({ id: (0, node_crypto_1.randomUUID)(), path, reason, kind: current.exists ? 'modify' : 'create', baseContent: baseText || `[${format.toUpperCase()} document: no extractable text]`, proposedContent: content, baseHash: (0, text_1.sha256Bytes)(current.bytes), createdAt: Date.now(), status: 'pending', contentType: 'document', documentFormat: format, binaryOutputBase64: Buffer.from(output).toString('base64') });
    }
    async proposeDelete(path, reason = 'Agent-proposed deletion') {
        const raw = await this.tools.readRawFile(path);
        if (!raw.exists)
            throw new Error(`Cannot delete missing file: ${path}`);
        const format = (0, DocumentService_1.documentFormatForPath)(path);
        let baseContent = '';
        let contentType = 'binary';
        if (format) {
            baseContent = await (0, DocumentService_1.extractDocumentText)(path, raw.bytes);
            contentType = 'document';
        }
        else {
            try {
                const text = await this.tools.readWholeFile(path);
                baseContent = text.content;
                contentType = 'text';
            }
            catch {
                baseContent = `[Binary file: ${path}]`;
            }
        }
        return this.store({ id: (0, node_crypto_1.randomUUID)(), path, reason, kind: 'delete', baseContent: baseContent || `[${format?.toUpperCase() || 'Binary'} file]`, proposedContent: '', baseHash: (0, text_1.sha256Bytes)(raw.bytes), createdAt: Date.now(), status: 'pending', contentType, documentFormat: format });
    }
    async accept(id) { const proposal = this.requireProposal(id); await this.assertFresh(proposal); await this.prepareCreateDirectories([proposal]); await this.applyProposal(proposal); proposal.status = 'accepted'; }
    async acceptAllPending() { const pending = this.list().filter(p => p.status === 'pending'); for (const p of pending)
        await this.assertFresh(p); for (const p of pending) {
        await this.prepareCreateDirectories([p]);
        await this.applyProposal(p);
        p.status = 'accepted';
    } }
    reject(id) { const p = this.requireProposal(id); if (p.status === 'pending')
        p.status = 'rejected'; }
    rejectAllPending() { for (const p of this.proposals.values())
        if (p.status === 'pending')
            p.status = 'rejected'; }
    clearCompleted() { for (const [id, p] of this.proposals)
        if (p.status !== 'pending')
            this.proposals.delete(id); }
    store(proposal) { this.proposals.set(proposal.id, proposal); return proposal; }
    requireProposal(id) { const p = this.proposals.get(id); if (!p)
        throw new Error('Edit proposal no longer exists.'); if (p.status !== 'pending')
        throw new Error(`Proposal is already ${p.status}.`); return p; }
    async assertFresh(proposal) {
        if (proposal.contentType === 'text' && proposal.kind !== 'delete') {
            const current = await this.tools.readWholeFile(proposal.path);
            const expected = proposal.kind !== 'create';
            if (current.exists !== expected || (0, text_1.sha256)(current.content) !== proposal.baseHash) {
                proposal.status = 'stale';
                throw new Error(`${proposal.path} changed after the proposal was created. Ask Vectra to regenerate it.`);
            }
            return;
        }
        const raw = await this.tools.readRawFile(proposal.path);
        const expected = proposal.kind !== 'create';
        if (raw.exists !== expected || (0, text_1.sha256Bytes)(raw.bytes) !== proposal.baseHash) {
            proposal.status = 'stale';
            throw new Error(`${proposal.path} changed after the proposal was created. Ask Vectra to regenerate it.`);
        }
    }
    async prepareCreateDirectories(proposals) { for (const p of proposals) {
        if (p.kind !== 'create')
            continue;
        const resolved = (0, path_1.resolveWorkspacePath)(p.path);
        await vscode.workspace.fs.createDirectory(resolved.uri.with({ path: path.posix.dirname(resolved.uri.path) }));
    } }
    async applyProposal(proposal) {
        const resolved = (0, path_1.resolveWorkspacePath)(proposal.path);
        if (proposal.kind === 'delete') {
            await vscode.workspace.fs.delete(resolved.uri, { recursive: false, useTrash: false });
            return;
        }
        if (proposal.contentType === 'document' && proposal.binaryOutputBase64) {
            await vscode.workspace.fs.writeFile(resolved.uri, Buffer.from(proposal.binaryOutputBase64, 'base64'));
            return;
        }
        const edit = new vscode.WorkspaceEdit();
        if (proposal.kind === 'create') {
            edit.createFile(resolved.uri, { ignoreIfExists: false, overwrite: false });
            edit.insert(resolved.uri, new vscode.Position(0, 0), proposal.proposedContent);
        }
        else {
            const doc = await vscode.workspace.openTextDocument(resolved.uri);
            const last = Math.max(0, doc.lineCount - 1);
            edit.replace(resolved.uri, new vscode.Range(new vscode.Position(0, 0), doc.lineAt(last).range.end), proposal.proposedContent);
        }
        if (!await vscode.workspace.applyEdit(edit))
            throw new Error(`VS Code could not apply the proposed change to ${proposal.path}.`);
    }
}
exports.PatchManager = PatchManager;
function clamp(value, min, max) { const n = Number.isFinite(value) ? Math.floor(value) : min; return Math.min(max, Math.max(min, n)); }
//# sourceMappingURL=PatchManager.js.map