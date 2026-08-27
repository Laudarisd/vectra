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
exports.DiffContentProvider = exports.DIFF_SCHEME = void 0;
const vscode = __importStar(require("vscode"));
exports.DIFF_SCHEME = 'dev-agent-diff';
class DiffContentProvider {
    patches;
    emitter = new vscode.EventEmitter();
    onDidChange = this.emitter.event;
    constructor(patches) {
        this.patches = patches;
    }
    provideTextDocumentContent(uri) {
        const params = new URLSearchParams(uri.query);
        const id = params.get('id');
        const side = params.get('side');
        if (!id) {
            return '';
        }
        const proposal = this.patches.get(id);
        if (!proposal) {
            return 'Proposal no longer exists.';
        }
        return side === 'before' ? proposal.baseContent : proposal.proposedContent;
    }
    async showDiff(id) {
        const proposal = this.patches.get(id);
        if (!proposal) {
            throw new Error('Proposal no longer exists.');
        }
        const before = this.makeUri(proposal.path, id, 'before');
        const after = this.makeUri(proposal.path, id, 'after');
        const title = `${proposal.path} — Agent Proposal`;
        await vscode.commands.executeCommand('vscode.diff', before, after, title, { preview: true });
    }
    makeUri(path, id, side) {
        return vscode.Uri.from({
            scheme: exports.DIFF_SCHEME,
            path: `/${path}`,
            query: `id=${encodeURIComponent(id)}&side=${side}`
        });
    }
}
exports.DiffContentProvider = DiffContentProvider;
//# sourceMappingURL=DiffContentProvider.js.map