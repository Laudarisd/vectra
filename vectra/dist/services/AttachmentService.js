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
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const vscode = __importStar(require("vscode"));
const AttachmentParser_1 = require("./AttachmentParser");
const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_PICK = 12;
/** Loads user-selected and workspace files through the shared attachment parser. */
class AttachmentService {
    async pick() {
        const uris = await vscode.window.showOpenDialog({
            title: 'Vectra: Attach files',
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            openLabel: 'Attach'
        });
        if (!uris?.length)
            return [];
        const results = [];
        for (const uri of uris.slice(0, MAX_ATTACHMENTS_PER_PICK)) {
            results.push(await this.loadUri(uri, 'picker'));
        }
        return results;
    }
    async loadWorkspacePath(uri) {
        return this.loadUri(uri, 'workspace');
    }
    async loadUri(uri, source) {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const name = path.basename(uri.fsPath || uri.path);
        if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
            throw new Error(`${name} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB. ` +
                `Vectra's per-attachment limit is ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
        }
        const parsed = await (0, AttachmentParser_1.parseAttachmentBytes)(name, bytes, uri.fsPath || undefined);
        return {
            id: (0, node_crypto_1.randomUUID)(),
            name,
            size: bytes.byteLength,
            source,
            path: uri.fsPath,
            ...parsed
        };
    }
}
exports.AttachmentService = AttachmentService;
//# sourceMappingURL=AttachmentService.js.map