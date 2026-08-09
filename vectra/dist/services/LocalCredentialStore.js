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
exports.LocalCredentialStore = void 0;
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
class LocalCredentialStore {
    directory = path.join(os.homedir(), '.agent', 'vectra');
    filePath = path.join(this.directory, 'credentials.json');
    async get(provider) {
        if (!isCloudProvider(provider))
            return undefined;
        const data = await this.read();
        return data.keys[provider]?.trim() || undefined;
    }
    async set(provider, value) {
        if (!isCloudProvider(provider))
            throw new Error(`${provider} does not use an API key here.`);
        const data = await this.read();
        data.keys[provider] = value.trim();
        await node_fs_1.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
        try {
            await node_fs_1.promises.chmod(this.directory, 0o700);
        }
        catch { /* Windows may not map POSIX modes. */ }
        await node_fs_1.promises.writeFile(this.filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
        try {
            await node_fs_1.promises.chmod(this.filePath, 0o600);
        }
        catch { /* Windows may not map POSIX modes. */ }
    }
    async delete(provider) {
        if (!isCloudProvider(provider))
            return;
        const data = await this.read();
        delete data.keys[provider];
        await node_fs_1.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
        try {
            await node_fs_1.promises.chmod(this.directory, 0o700);
        }
        catch { /* Windows may not map POSIX modes. */ }
        await node_fs_1.promises.writeFile(this.filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    }
    async has(provider) { return Boolean(await this.get(provider)); }
    async read() {
        try {
            const raw = await node_fs_1.promises.readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            return { version: 1, keys: parsed.keys ?? {} };
        }
        catch (error) {
            const code = error.code;
            if (code === 'ENOENT')
                return { version: 1, keys: {} };
            if (error instanceof SyntaxError)
                throw new Error(`Vectra credential file is invalid JSON: ${this.filePath}`);
            throw error;
        }
    }
}
exports.LocalCredentialStore = LocalCredentialStore;
function isCloudProvider(provider) {
    return provider === 'openai' || provider === 'anthropic' || provider === 'gemini' || provider === 'openaiCompatible';
}
//# sourceMappingURL=LocalCredentialStore.js.map