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
exports.GitTools = void 0;
const node_child_process_1 = require("node:child_process");
const vscode = __importStar(require("vscode"));
const node_util_1 = require("node:util");
const path_1 = require("../utils/path");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const MAX_OUTPUT = 60_000;
/** Read-only `git` inspection. No commits, pushes, or working-tree mutation — parity with search_text/get_diagnostics, not with the confirmed CommandRunner tools. */
class GitTools {
    async status() {
        const cwd = this.workspaceRoot();
        const status = await this.run(cwd, ['status', '--porcelain=v1', '--branch']);
        if (status === null)
            return 'Not a git repository (or git is not installed).';
        const branch = (await this.run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => null)) ?? '';
        const trimmed = status.trim();
        return trimmed
            ? `Branch: ${branch.trim() || 'unknown'}\n${clip(trimmed)}`
            : `Branch: ${branch.trim() || 'unknown'}\nWorking tree clean.`;
    }
    async diff(pathInput, staged = false) {
        const cwd = this.workspaceRoot();
        const args = ['diff', '--no-color'];
        if (staged)
            args.push('--staged');
        if (pathInput)
            args.push('--', (0, path_1.validateAgentRelativePath)(pathInput));
        const output = await this.run(cwd, args);
        if (output === null)
            return 'Not a git repository (or git is not installed).';
        return output.trim() ? clip(output.trim()) : 'No differences.';
    }
    workspaceRoot() {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder)
            throw new Error('Open a workspace folder first.');
        return folder.uri.fsPath;
    }
    async run(cwd, args) {
        try {
            const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 15_000 });
            return stdout;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/not a git repository|ENOENT/i.test(message))
                return null;
            throw new Error(message);
        }
    }
}
exports.GitTools = GitTools;
function clip(text) {
    return text.length > MAX_OUTPUT
        ? `${text.slice(0, MAX_OUTPUT)}\n\n… output truncated (${text.length - MAX_OUTPUT} more characters) …`
        : text;
}
//# sourceMappingURL=GitTools.js.map