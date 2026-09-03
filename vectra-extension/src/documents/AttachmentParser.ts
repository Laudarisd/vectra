// Beginner guide: Handles a tt ac hm en tp ar se r responsibilities for Vectra.
import * as path from 'node:path';
import { Attachment } from '../types';
import {
  extractDocTextFromPath,
  extractDocxTextFromBuffer,
  extractPdfTextFromBuffer,
  extractPptxTextFromBuffer,
  extractRtfTextFromBuffer,
  extractXlsxTextFromBuffer
} from './DocumentExtractor';

type ParsedAttachment = Pick<Attachment, 'kind' | 'mime' | 'text' | 'base64'>;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.yaml', '.yml', '.xml', '.csv', '.tsv',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cc', '.cpp',
  '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.kts', '.sql',
  '.sh', '.bash', '.zsh', '.ps1', '.html', '.htm', '.css', '.scss', '.less', '.vue',
  '.svelte', '.toml', '.ini', '.cfg', '.conf', '.log', '.tex', '.ipynb'
]);

const IMAGE_MIME: Record<string, string> = {
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
export async function parseAttachmentBytes(
  fileName: string,
  bytes: Uint8Array,
  sourcePath?: string
): Promise<ParsedAttachment> {
  const extension = path.extname(fileName).toLowerCase();

  if (TEXT_EXTENSIONS.has(extension)) {
    return { kind: 'text', mime: textMime(extension), text: decodeText(bytes) };
  }

  if (extension === '.pdf') {
    return binaryDocument('pdf', 'application/pdf', await extractPdfTextFromBuffer(bytes), bytes);
  }
  if (extension === '.docx') {
    return binaryDocument(
      'document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      await extractDocxTextFromBuffer(bytes),
      bytes
    );
  }
  if (extension === '.pptx') {
    return binaryDocument(
      'document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      await extractPptxTextFromBuffer(bytes),
      bytes
    );
  }
  if (extension === '.xlsx') {
    return binaryDocument(
      'document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      await extractXlsxTextFromBuffer(bytes),
      bytes
    );
  }
  if (extension === '.rtf') {
    return binaryDocument('document', 'application/rtf', await extractRtfTextFromBuffer(bytes), bytes);
  }
  if (extension === '.doc') {
    const text = sourcePath ? await extractDocTextFromPath(sourcePath) : '';
    return binaryDocument('document', 'application/msword', text, bytes);
  }

  const imageMime = IMAGE_MIME[extension];
  if (imageMime) return { kind: 'image', mime: imageMime, base64: toBase64(bytes) };
  return { kind: 'binary', mime: 'application/octet-stream', base64: toBase64(bytes) };
}

function binaryDocument(
  kind: 'pdf' | 'document',
  mime: string,
  text: string,
  bytes: Uint8Array
): ParsedAttachment {
  return {
    kind,
    mime,
    text: text.trim() || undefined,
    base64: toBase64(bytes)
  };
}

/** Decode common editor text encodings and remove a leading byte-order mark. */
function decodeText(bytes: Uint8Array): string {
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

function textMime(extension: string): string {
  if (extension === '.md' || extension === '.markdown') return 'text/markdown';
  if (extension === '.json' || extension === '.ipynb') return 'application/json';
  if (extension === '.csv') return 'text/csv';
  if (extension === '.html' || extension === '.htm') return 'text/html';
  if (extension === '.css') return 'text/css';
  return 'text/plain';
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
