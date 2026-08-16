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
exports.ContextCollector = void 0;
const vscode = __importStar(require("vscode"));
const config_1 = require("../utils/config");
const path_1 = require("../utils/path");
const text_1 = require("../utils/text");
const INSTRUCTION_FILE_CANDIDATES = ['VECTRA.md', '.vectra/instructions.md', '.vectra/VECTRA.md'];
class ContextCollector {
    async collect(mode) {
        const config = (0, config_1.getConfig)();
        const editor = vscode.window.activeTextEditor;
        const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.name);
        const openFiles = vscode.workspace.textDocuments
            .filter((document) => document.uri.scheme === 'file' && !document.isClosed)
            .map((document) => (0, path_1.relativeToWorkspace)(document.uri))
            .filter((value) => Boolean(value))
            .filter((value) => config.allowSensitiveFiles || !(0, path_1.isSensitiveAgentPath)(value))
            .slice(0, 40);
        const projectInstructions = vscode.workspace.isTrusted ? await this.loadProjectInstructions() : undefined;
        if (!editor || !vscode.workspace.isTrusted) {
            return { workspaceFolders, openFiles, diagnostics: [], projectInstructions };
        }
        const document = editor.document;
        const activeFile = (0, path_1.relativeToWorkspace)(document.uri) ?? document.fileName;
        const sensitive = !config.allowSensitiveFiles && (0, path_1.isSensitiveAgentPath)(activeFile);
        if (sensitive) {
            return { workspaceFolders, openFiles, activeFile, activeLanguage: document.languageId, diagnostics: [], projectInstructions };
        }
        const selection = editor.selection;
        const selectionText = selection.isEmpty ? undefined : document.getText(selection);
        const shouldIncludeWholeActiveFile = mode !== 'agent' || document.getText().length <= 40_000;
        const activeFileContent = shouldIncludeWholeActiveFile
            ? (0, text_1.truncateMiddle)(document.getText(), 50_000)
            : undefined;
        const diagnostics = config.showDiagnosticsInContext
            ? vscode.languages.getDiagnostics(document.uri)
                .filter((diagnostic) => diagnostic.severity <= vscode.DiagnosticSeverity.Warning)
                .slice(0, 30)
                .map((diagnostic) => {
                const severity = diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning';
                return `${severity} L${diagnostic.range.start.line + 1}: ${diagnostic.message}`;
            })
            : [];
        return {
            workspaceFolders,
            activeFile,
            activeLanguage: document.languageId,
            activeFileContent,
            selectionText: selectionText ? (0, text_1.truncateMiddle)(selectionText, 50_000) : undefined,
            selectionStartLine: selection.isEmpty ? undefined : selection.start.line + 1,
            selectionEndLine: selection.isEmpty ? undefined : selection.end.line + 1,
            openFiles,
            diagnostics,
            projectInstructions
        };
    }
    /**
     * Mirrors CLAUDE.md/.cursorrules-style project instructions: a workspace-root
     * file the user maintains once, applied automatically to every turn instead
     * of having to be repeated in each prompt. First match wins; kept small since
     * it is included in-full on every request regardless of provider context size.
     */
    async loadProjectInstructions() {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder)
            return undefined;
        for (const candidate of INSTRUCTION_FILE_CANDIDATES) {
            try {
                const uri = vscode.Uri.joinPath(folder.uri, candidate);
                const bytes = await vscode.workspace.fs.readFile(uri);
                const text = new TextDecoder().decode(bytes).trim();
                if (text)
                    return (0, text_1.truncateMiddle)(text, 8_000);
            }
            catch {
                // Try the next candidate; none existing is the common case.
            }
        }
        return undefined;
    }
}
exports.ContextCollector = ContextCollector;
//# sourceMappingURL=ContextCollector.js.map