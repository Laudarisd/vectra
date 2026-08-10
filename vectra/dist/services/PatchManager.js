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
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const vscode = __importStar(require("vscode"));
const path_1 = require("../utils/path");
const text_1 = require("../utils/text");
const DocumentService_1 = require("./DocumentService");
/**
 * Owns Vectra's review-before-write boundary.
 *
 * The agent can prepare many related files during one run, but none of those
 * files reaches disk until the user accepts the corresponding proposal. A
 * pending proposal also acts as a small virtual workspace overlay: later agent
 * steps can refine or read the proposed content without producing conflicting
 * proposals for the same path.
 */
class PatchManager {
    tools;
    proposals = new Map();
    constructor(tools) {
        this.tools = tools;
    }
    list() {
        return [...this.proposals.values()].sort((a, b) => b.createdAt - a.createdAt);
    }
    get(id) {
        return this.proposals.get(id);
    }
    getPendingForPath(filePath) {
        const normalized = (0, path_1.normalizeAgentPath)(filePath);
        return [...this.proposals.values()].find((proposal) => proposal.status === 'pending' && (0, path_1.normalizeAgentPath)(proposal.path) === normalized);
    }
    /** Return proposed text so later tool calls can reason over the pending project. */
    readPendingText(filePath) {
        const proposal = this.getPendingForPath(filePath);
        if (!proposal || proposal.kind === 'delete' || proposal.contentType !== 'text')
            return undefined;
        return proposal.proposedContent;
    }
    async proposeFile(filePath, proposedContent, reason = 'Agent-proposed change') {
        const pending = this.getPendingForPath(filePath);
        if (pending) {
            if (pending.kind === 'delete' || pending.contentType !== 'text') {
                throw new Error(`${filePath} already has an incompatible pending proposal.`);
            }
            // Refine the existing virtual file instead of creating proposals that
            // would become stale as soon as the first one is accepted.
            pending.proposedContent = proposedContent;
            pending.reason = reason;
            pending.createdAt = Date.now();
            return pending;
        }
        const current = await this.tools.readWholeFile(filePath);
        return this.store({
            id: (0, node_crypto_1.randomUUID)(),
            path: (0, path_1.normalizeAgentPath)(filePath),
            reason,
            kind: current.exists ? 'modify' : 'create',
            baseContent: current.content,
            proposedContent,
            baseHash: (0, text_1.sha256)(current.content),
            createdAt: Date.now(),
            status: 'pending',
            contentType: 'text'
        });
    }
    async proposeLineEdit(filePath, startLine, endLine, content, mode, reason = 'Agent-proposed line edit') {
        const pendingText = this.readPendingText(filePath);
        const current = pendingText === undefined
            ? await this.tools.readWholeFile(filePath)
            : { exists: true, content: pendingText };
        if (!current.exists)
            throw new Error(`File does not exist: ${filePath}`);
        const eol = current.content.includes('\r\n') ? '\r\n' : '\n';
        const hasTrailingNewline = /\r?\n$/.test(current.content);
        const lines = current.content.split(/\r?\n/);
        if (hasTrailingNewline)
            lines.pop();
        const maxLine = Math.max(1, lines.length);
        const start = clamp(startLine, 1, maxLine);
        const end = clamp(endLine, start, maxLine);
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
        if (hasTrailingNewline)
            proposed += eol;
        return this.proposeFile(filePath, proposed, reason);
    }
    async proposeDocument(filePath, content, reason = 'Agent-proposed document change', title, requireExisting = false) {
        if (this.getPendingForPath(filePath))
            throw new Error(`${filePath} already has a pending proposal.`);
        const format = (0, DocumentService_1.documentFormatForPath)(filePath);
        if (!format || !(0, DocumentService_1.isWritableDocumentFormat)(format)) {
            throw new Error('Document creation/editing supports .pdf and .docx. PPTX/XLSX/RTF are read/parse only.');
        }
        const current = await this.tools.readRawFile(filePath);
        if (requireExisting && !current.exists)
            throw new Error(`Document does not exist: ${filePath}`);
        if (!requireExisting && current.exists)
            throw new Error(`${filePath} already exists. Use edit_document.`);
        const baseText = current.exists ? await (0, DocumentService_1.extractDocumentText)(filePath, current.bytes) : '';
        const output = (0, DocumentService_1.createDocumentBytes)(filePath, content, title);
        return this.store({
            id: (0, node_crypto_1.randomUUID)(),
            path: (0, path_1.normalizeAgentPath)(filePath),
            reason,
            kind: current.exists ? 'modify' : 'create',
            baseContent: baseText || `[${format.toUpperCase()} document: no extractable text]`,
            proposedContent: content,
            baseHash: (0, text_1.sha256Bytes)(current.bytes),
            createdAt: Date.now(),
            status: 'pending',
            contentType: 'document',
            documentFormat: format,
            binaryOutputBase64: Buffer.from(output).toString('base64')
        });
    }
    async proposeDelete(filePath, reason = 'Agent-proposed deletion') {
        if (this.getPendingForPath(filePath))
            throw new Error(`${filePath} already has a pending proposal.`);
        const raw = await this.tools.readRawFile(filePath);
        if (!raw.exists)
            throw new Error(`Cannot delete missing file: ${filePath}`);
        const format = (0, DocumentService_1.documentFormatForPath)(filePath);
        let baseContent = '';
        let contentType = 'binary';
        if (format) {
            baseContent = await (0, DocumentService_1.extractDocumentText)(filePath, raw.bytes);
            contentType = 'document';
        }
        else {
            try {
                baseContent = (await this.tools.readWholeFile(filePath)).content;
                contentType = 'text';
            }
            catch {
                baseContent = `[Binary file: ${filePath}]`;
            }
        }
        return this.store({
            id: (0, node_crypto_1.randomUUID)(),
            path: (0, path_1.normalizeAgentPath)(filePath),
            reason,
            kind: 'delete',
            baseContent: baseContent || `[${format?.toUpperCase() || 'Binary'} file]`,
            proposedContent: '',
            baseHash: (0, text_1.sha256Bytes)(raw.bytes),
            createdAt: Date.now(),
            status: 'pending',
            contentType,
            documentFormat: format
        });
    }
    async accept(id) {
        const proposal = this.requireProposal(id);
        await this.assertFresh(proposal);
        await this.prepareCreateDirectories([proposal]);
        await this.applyProposal(proposal);
        proposal.status = 'accepted';
    }
    async acceptAllPending() {
        const pending = this.list().filter((proposal) => proposal.status === 'pending');
        for (const proposal of pending)
            await this.assertFresh(proposal);
        await this.prepareCreateDirectories(pending);
        for (const proposal of pending) {
            await this.applyProposal(proposal);
            proposal.status = 'accepted';
        }
    }
    reject(id) {
        const proposal = this.requireProposal(id);
        proposal.status = 'rejected';
    }
    rejectAllPending() {
        for (const proposal of this.proposals.values()) {
            if (proposal.status === 'pending')
                proposal.status = 'rejected';
        }
    }
    clearCompleted() {
        for (const [id, proposal] of this.proposals) {
            if (proposal.status !== 'pending')
                this.proposals.delete(id);
        }
    }
    store(proposal) {
        this.proposals.set(proposal.id, proposal);
        return proposal;
    }
    requireProposal(id) {
        const proposal = this.proposals.get(id);
        if (!proposal)
            throw new Error('Edit proposal no longer exists.');
        if (proposal.status !== 'pending')
            throw new Error(`Proposal is already ${proposal.status}.`);
        return proposal;
    }
    async assertFresh(proposal) {
        if (proposal.contentType === 'text' && proposal.kind !== 'delete') {
            const current = await this.tools.readWholeFile(proposal.path);
            const shouldExist = proposal.kind !== 'create';
            if (current.exists !== shouldExist || (0, text_1.sha256)(current.content) !== proposal.baseHash) {
                proposal.status = 'stale';
                throw new Error(`${proposal.path} changed after the proposal was created. Ask Vectra to regenerate it.`);
            }
            return;
        }
        const raw = await this.tools.readRawFile(proposal.path);
        const shouldExist = proposal.kind !== 'create';
        if (raw.exists !== shouldExist || (0, text_1.sha256Bytes)(raw.bytes) !== proposal.baseHash) {
            proposal.status = 'stale';
            throw new Error(`${proposal.path} changed after the proposal was created. Ask Vectra to regenerate it.`);
        }
    }
    async prepareCreateDirectories(proposals) {
        for (const proposal of proposals) {
            if (proposal.kind !== 'create')
                continue;
            const resolved = (0, path_1.resolveWorkspacePath)(proposal.path);
            await vscode.workspace.fs.createDirectory(resolved.uri.with({ path: path.posix.dirname(resolved.uri.path) }));
        }
    }
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
            const document = await vscode.workspace.openTextDocument(resolved.uri);
            const lastLine = Math.max(0, document.lineCount - 1);
            edit.replace(resolved.uri, new vscode.Range(new vscode.Position(0, 0), document.lineAt(lastLine).range.end), proposal.proposedContent);
        }
        if (!await vscode.workspace.applyEdit(edit)) {
            throw new Error(`VS Code could not apply the proposed change to ${proposal.path}.`);
        }
    }
}
exports.PatchManager = PatchManager;
function clamp(value, min, max) {
    const number = Number.isFinite(value) ? Math.floor(value) : min;
    return Math.min(max, Math.max(min, number));
}
//# sourceMappingURL=PatchManager.js.map