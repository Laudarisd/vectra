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
exports.parseAttachmentBytes = parseAttachmentBytes;
const path = __importStar(require("node:path"));
const DocumentExtractor_1 = require("./DocumentExtractor");
const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.markdown', '.json', '.jsonl', '.yaml', '.yml', '.xml', '.csv', '.tsv',
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cc', '.cpp',
    '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.kts', '.sql',
    '.sh', '.bash', '.zsh', '.ps1', '.html', '.htm', '.css', '.scss', '.less', '.vue',
    '.svelte', '.toml', '.ini', '.cfg', '.conf', '.log', '.tex', '.ipynb'
]);
const IMAGE_MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp'
};
/**
 * Convert an uploaded file into model-ready text and/or multimodal bytes.
 *
 * Keeping this logic independent from VS Code makes every attachment source
 * (file picker, workspace inspection, and tests) follow the same rules.
 */
async function parseAttachmentBytes(fileName, bytes, sourcePath) {
    const extension = path.extname(fileName).toLowerCase();
    if (TEXT_EXTENSIONS.has(extension)) {
        return { kind: 'text', mime: textMime(extension), text: decodeText(bytes) };
    }
    if (extension === '.pdf') {
        return binaryDocument('pdf', 'application/pdf', await (0, DocumentExtractor_1.extractPdfTextFromBuffer)(bytes), bytes);
    }
    if (extension === '.docx') {
        return binaryDocument('document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', await (0, DocumentExtractor_1.extractDocxTextFromBuffer)(bytes), bytes);
    }
    if (extension === '.pptx') {
        return binaryDocument('document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', await (0, DocumentExtractor_1.extractPptxTextFromBuffer)(bytes), bytes);
    }
    if (extension === '.xlsx') {
        return binaryDocument('document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await (0, DocumentExtractor_1.extractXlsxTextFromBuffer)(bytes), bytes);
    }
    if (extension === '.rtf') {
        return binaryDocument('document', 'application/rtf', await (0, DocumentExtractor_1.extractRtfTextFromBuffer)(bytes), bytes);
    }
    if (extension === '.doc') {
        const text = sourcePath ? await (0, DocumentExtractor_1.extractDocTextFromPath)(sourcePath) : '';
        return binaryDocument('document', 'application/msword', text, bytes);
    }
    const imageMime = IMAGE_MIME[extension];
    if (imageMime)
        return { kind: 'image', mime: imageMime, base64: toBase64(bytes) };
    return { kind: 'binary', mime: 'application/octet-stream', base64: toBase64(bytes) };
}
function binaryDocument(kind, mime, text, bytes) {
    return {
        kind,
        mime,
        text: text.trim() || undefined,
        base64: toBase64(bytes)
    };
}
/** Decode common editor text encodings and remove a leading byte-order mark. */
function decodeText(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        const swapped = Uint8Array.from(bytes.subarray(2));
        for (let index = 0; index + 1 < swapped.length; index += 2) {
            [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
        }
        return new TextDecoder('utf-16le').decode(swapped);
    }
    const offset = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return new TextDecoder('utf-8').decode(bytes.subarray(offset));
}
function textMime(extension) {
    if (extension === '.md' || extension === '.markdown')
        return 'text/markdown';
    if (extension === '.json' || extension === '.ipynb')
        return 'application/json';
    if (extension === '.csv')
        return 'text/csv';
    if (extension === '.html' || extension === '.htm')
        return 'text/html';
    if (extension === '.css')
        return 'text/css';
    return 'text/plain';
}
function toBase64(bytes) {
    return Buffer.from(bytes).toString('base64');
}
//# sourceMappingURL=AttachmentParser.js.map