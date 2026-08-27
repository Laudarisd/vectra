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
exports.WorkspacePathOperations = void 0;
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const config_1 = require("../utils/config");
const path_1 = require("../utils/path");
/** Confirmed workspace-bound operations for files and directories. */
class WorkspacePathOperations {
    async createDirectory(pathInput, reason = '', signal) {
        this.assertAllowed(pathInput);
        const target = (0, path_1.resolveWorkspacePath)(pathInput);
        assertNotWorkspaceRoot(target);
        if (await exists(target.uri))
            throw new Error(`Path already exists: ${target.relativePath}`);
        await this.confirm('Create directory', target.relativePath, reason, signal);
        await vscode.workspace.fs.createDirectory(target.uri);
        return `Created directory ${target.relativePath}.`;
    }
    async rename(sourceInput, destinationInput, reason = '', signal) {
        const { source, destination } = await this.resolvePair(sourceInput, destinationInput);
        if (parentPath(source.relativePath) !== parentPath(destination.relativePath)) {
            throw new Error('rename_path keeps the same parent directory. Use move_path to relocate an item.');
        }
        await this.confirm('Rename file or directory', `${source.relativePath} → ${destination.relativePath}`, reason, signal);
        await vscode.workspace.fs.rename(source.uri, destination.uri, { overwrite: false });
        return `Renamed ${source.relativePath} to ${destination.relativePath}.`;
    }
    async move(sourceInput, destinationInput, reason = '', signal) {
        const { source, destination } = await this.resolvePair(sourceInput, destinationInput);
        await this.confirm('Move file or directory', `${source.relativePath} → ${destination.relativePath}`, reason, signal);
        await vscode.workspace.fs.createDirectory(destination.uri.with({ path: path.posix.dirname(destination.uri.path) }));
        await vscode.workspace.fs.rename(source.uri, destination.uri, { overwrite: false });
        return `Moved ${source.relativePath} to ${destination.relativePath}.`;
    }
    async copy(sourceInput, destinationInput, reason = '', signal) {
        const { source, destination } = await this.resolvePair(sourceInput, destinationInput);
        await this.confirm('Copy file or directory', `${source.relativePath} → ${destination.relativePath}`, reason, signal);
        await vscode.workspace.fs.createDirectory(destination.uri.with({ path: path.posix.dirname(destination.uri.path) }));
        await vscode.workspace.fs.copy(source.uri, destination.uri, { overwrite: false });
        return `Copied ${source.relativePath} to ${destination.relativePath}.`;
    }
    async deleteDirectory(pathInput, recursive = false, reason = '', signal) {
        this.assertAllowed(pathInput);
        const target = (0, path_1.resolveWorkspacePath)(pathInput);
        assertNotWorkspaceRoot(target);
        const stat = await statOrThrow(target.uri, target.relativePath);
        if (!(stat.type & vscode.FileType.Directory))
            throw new Error(`Not a directory: ${target.relativePath}`);
        const entries = await vscode.workspace.fs.readDirectory(target.uri);
        if (entries.length && !recursive) {
            throw new Error(`Directory is not empty: ${target.relativePath}. Use recursive=true only when the user explicitly requested deleting its contents.`);
        }
        const detail = recursive
            ? `${target.relativePath}\nThis permanently removes the directory and all ${entries.length} direct entries inside it.`
            : target.relativePath;
        await this.confirm(recursive ? 'Delete directory recursively' : 'Delete empty directory', detail, reason, signal, 'Delete');
        await vscode.workspace.fs.delete(target.uri, { recursive, useTrash: true });
        return `Deleted directory ${target.relativePath}${recursive ? ' and its contents' : ''}.`;
    }
    async resolvePair(sourceInput, destinationInput) {
        this.assertAllowed(sourceInput);
        this.assertAllowed(destinationInput);
        const source = (0, path_1.resolveWorkspacePath)(sourceInput);
        const destination = (0, path_1.resolveWorkspacePath)(destinationInput);
        assertNotWorkspaceRoot(source);
        assertNotWorkspaceRoot(destination);
        if (source.uri.toString() === destination.uri.toString())
            throw new Error('Source and destination must be different.');
        const sourceStat = await statOrThrow(source.uri, source.relativePath);
        if ((sourceStat.type & vscode.FileType.Directory) && isDescendant(source.uri, destination.uri)) {
            throw new Error('A directory cannot be moved or copied inside itself.');
        }
        if (await exists(destination.uri))
            throw new Error(`Destination already exists: ${destination.relativePath}`);
        return { source, destination };
    }
    assertAllowed(pathInput) {
        if (!vscode.workspace.isTrusted)
            throw new Error('This workspace is not trusted.');
        const normalized = (0, path_1.normalizeAgentPath)(pathInput);
        if (!(0, config_1.getConfig)().allowSensitiveFiles && (0, path_1.isSensitiveAgentPath)(normalized)) {
            throw new Error(`Sensitive path operations are blocked by default: ${normalized}.`);
        }
    }
    async confirm(action, detail, reason, signal, acceptLabel = action) {
        if (signal?.aborted)
            throw cancelled();
        const choice = await vscode.window.showWarningMessage(`Vectra wants to ${action.toLowerCase()}:`, { modal: true, detail: `${detail}${reason ? `\n\nReason: ${reason}` : ''}` }, acceptLabel, 'Cancel');
        if (signal?.aborted)
            throw cancelled();
        if (choice !== acceptLabel)
            throw new Error(`${action} cancelled by user.`);
    }
}
exports.WorkspacePathOperations = WorkspacePathOperations;
async function exists(uri) {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    }
    catch (error) {
        if (isNotFound(error))
            return false;
        throw error;
    }
}
async function statOrThrow(uri, label) {
    try {
        return await vscode.workspace.fs.stat(uri);
    }
    catch (error) {
        if (isNotFound(error))
            throw new Error(`Path does not exist: ${label}`);
        throw error;
    }
}
function isNotFound(error) {
    return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}
function parentPath(value) {
    return path.posix.dirname(value.replace(/\\/g, '/'));
}
function assertNotWorkspaceRoot(value) {
    if (value.uri.toString() === value.folder.uri.toString()) {
        throw new Error('Workspace root folders cannot be changed by path-operation tools.');
    }
}
function isDescendant(source, destination) {
    if (source.scheme !== destination.scheme || source.authority !== destination.authority)
        return false;
    const root = source.path.replace(/\/$/, '');
    return destination.path.startsWith(`${root}/`);
}
function cancelled() {
    const error = new Error('Path operation cancelled.');
    error.name = 'AbortError';
    return error;
}
//# sourceMappingURL=WorkspacePathOperations.js.map