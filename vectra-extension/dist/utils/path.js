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
exports.normalizeAgentPath = normalizeAgentPath;
exports.isSensitiveAgentPath = isSensitiveAgentPath;
exports.validateAgentRelativePath = validateAgentRelativePath;
exports.resolveWorkspacePath = resolveWorkspacePath;
exports.relativeToWorkspace = relativeToWorkspace;
exports.searchRoots = searchRoots;
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
function normalizeAgentPath(input) {
    return input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim();
}
function isSensitiveAgentPath(input) {
    const normalized = normalizeAgentPath(input).toLowerCase();
    const segments = normalized.split('/').filter(Boolean);
    const base = segments.at(-1) ?? '';
    if (/^\.env(?:\.|$)/.test(base)) {
        return true;
    }
    if (['.npmrc', '.pypirc', '.netrc', '.git-credentials'].includes(base)) {
        return true;
    }
    if (['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'].includes(base)) {
        return true;
    }
    if (/\.(?:pem|key|p12|pfx|jks)$/.test(base)) {
        return true;
    }
    const joined = `/${segments.join('/')}`;
    return joined.endsWith('/.aws/credentials')
        || joined.endsWith('/.docker/config.json')
        || joined.endsWith('/.kube/config')
        || joined.endsWith('/.config/gcloud/application_default_credentials.json');
}
function validateAgentRelativePath(input, allowEmpty = false) {
    const normalized = normalizeAgentPath(input);
    if (!normalized) {
        if (allowEmpty) {
            return '';
        }
        throw new Error('A workspace-relative file path is required.');
    }
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
        throw new Error(`Absolute paths are not allowed: ${input}`);
    }
    const segments = normalized.split('/');
    if (segments.some((segment) => segment === '..')) {
        throw new Error(`Parent-directory traversal is not allowed: ${input}`);
    }
    if (normalized.includes('\0')) {
        throw new Error('Invalid file path.');
    }
    return normalized;
}
function resolveWorkspacePath(input) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        throw new Error('Open a workspace folder before using file tools.');
    }
    const normalized = validateAgentRelativePath(input);
    const target = splitWorkspacePrefix(normalized, folders);
    if (target) {
        return createResolved(target.folder, target.relativePath, folders.length > 1);
    }
    if (folders.length > 1) {
        throw new Error(`Multi-root workspace path must start with a workspace folder name, for example “${folders[0].name}/…”.`);
    }
    return createResolved(folders[0], normalized, false);
}
function relativeToWorkspace(uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
        return undefined;
    }
    const relative = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
    return (vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? `${folder.name}/${relative}` : relative;
}
function searchRoots(pathInput) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        return [];
    }
    const normalized = validateAgentRelativePath(pathInput, true);
    if (!normalized) {
        return folders.map((folder) => ({ folder, baseUri: folder.uri }));
    }
    const target = splitWorkspacePrefix(normalized, folders);
    if (target) {
        return [{ folder: target.folder, baseUri: vscode.Uri.joinPath(target.folder.uri, ...target.relativePath.split('/').filter(Boolean)) }];
    }
    if (folders.length > 1) {
        throw new Error(`In a multi-root workspace, search paths must start with a workspace folder name.`);
    }
    return [{ folder: folders[0], baseUri: vscode.Uri.joinPath(folders[0].uri, ...normalized.split('/')) }];
}
function splitWorkspacePrefix(normalized, folders) {
    // Treat an explicit workspace folder name as the workspace root even in a
    // single-root workspace. This lets users naturally say things like
    // "directory vectra" when the opened root folder itself is named vectra.
    for (const folder of folders) {
        if (normalized === folder.name) {
            return { folder, relativePath: '' };
        }
        if (normalized.startsWith(`${folder.name}/`)) {
            return { folder, relativePath: normalized.slice(folder.name.length + 1) };
        }
    }
    return undefined;
}
function createResolved(folder, relativePath, includeFolderPrefix) {
    const segments = relativePath.split('/').filter(Boolean);
    const uri = vscode.Uri.joinPath(folder.uri, ...segments);
    const relative = segments.join('/');
    return {
        uri,
        relativePath: includeFolderPrefix ? `${folder.name}/${relative}` : relative,
        folder
    };
}
//# sourceMappingURL=path.js.map