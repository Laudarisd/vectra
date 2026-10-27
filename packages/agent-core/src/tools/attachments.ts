// Beginner guide: Handles a tt ac hm en ts responsibilities for Vectra.
import { VectraDeepTool, VectraToolDefinition } from './contracts';
import { z } from 'zod';
import { VectraAttachmentRecord } from '../document';
export type { VectraAttachmentRecord } from '../document';

/** Metadata for the attachment tools below -- not part of VECTRA_TOOL_DEFINITIONS
 * since they only exist on the web surface (uploaded files, not a workspace). */
export const ATTACHMENT_TOOL_DEFINITIONS: readonly VectraToolDefinition[] = [
  { name: 'list_attachments', displayName: 'List Attachments', description: 'List files uploaded to Vectra and report parsed-text availability.', risk: 'read', surface: 'web' },
  { name: 'read_attachment', displayName: 'Read Attachment', description: "Read a bounded chunk of parsed text from an uploaded file by its exact name.", risk: 'read', surface: 'web' },
  { name: 'search_attachments', displayName: 'Search Attachments', description: 'Search across all uploaded documents and return matching excerpts with source names and offsets.', risk: 'read', surface: 'web' }
];

/** Shared safe attachment tools for browser/server hosts. */
export function createAttachmentTools<TContext = unknown>(
  attachments: readonly VectraAttachmentRecord[]
): VectraDeepTool<TContext>[] {
  return [
    {
      name: 'vectra_list_attachments',
      description: 'List uploaded attachments. For PDFs and uploaded documents use this tool, vectra_search_attachments, and vectra_read_attachment — never use scratch ls/read_file.',
      execute: () => attachments.map(({ name, kind, mime, text, width, height, pageNumber, pageClassification, ocrRequired }) => ({
        name,
        kind,
        mime,
        parsedCharacters: (text ?? '').length,
        ...(width && height ? { imageSize: `${width}x${height}` } : {}),
        ...(pageNumber ? { pageNumber } : {}),
        ...(pageClassification ? { pageClassification } : {}),
        ...(ocrRequired !== undefined ? { ocrRequired } : {})
      }))
    },
    {
      name: 'vectra_read_attachment',
      description: 'Read a bounded parsed-text chunk from an uploaded PDF/document by exact attachment name. This is the correct tool for uploaded files; scratch read_file is not.',
      schema: z.object({
        name: z.string().min(1).describe('Exact name returned by vectra_list_attachments.'),
        start: z.number().int().min(0).optional().describe('Character offset, default 0.'),
        maxChars: z.number().int().min(1000).max(50000).optional().describe('Maximum characters to return, default 16000.')
      }),
      execute: ({ name, start, maxChars }) => {
        const file = attachments.find((item) => item.name === name);
        if (!file) throw new Error(`Attachment not found: ${String(name)}`);
        const text = file.text || '';
        if (!text) return `No extracted text is available for ${file.name}. A vision-capable model must inspect its image bytes.`;
        const offset = typeof start === 'number' ? Math.min(start, text.length) : 0;
        const limit = typeof maxChars === 'number' ? maxChars : 16000;
        const content = text.slice(offset, offset + limit);
        return { name: file.name, start: offset, end: offset + content.length, totalCharacters: text.length, hasMore: offset + content.length < text.length, content };
      }
    },
    {
      name: 'vectra_search_attachments',
      description: 'Search all uploaded PDFs/documents at once and return bounded source-grounded excerpts. Use this before reading large files in chunks.',
      schema: z.object({
        query: z.string().min(2).describe('Text, item number, drawing number, heading, or phrase to find.'),
        names: z.array(z.string()).max(20).optional().describe('Optional exact attachment names to limit the search.'),
        maxResults: z.number().int().min(1).max(50).optional()
      }),
      execute: ({ query, names, maxResults }) => {
        const needle = String(query).toLowerCase();
        const allowed = new Set(Array.isArray(names) ? names.map(String) : []);
        const limit = typeof maxResults === 'number' ? maxResults : 12;
        const results: Array<{ name: string; offset: number; excerpt: string }> = [];
        for (const file of attachments) {
          if (allowed.size && !allowed.has(file.name)) continue;
          const text = file.text || '';
          let from = 0;
          while (results.length < limit) {
            const offset = text.toLowerCase().indexOf(needle, from);
            if (offset < 0) break;
            const start = Math.max(0, offset - 240);
            results.push({ name: file.name, offset, excerpt: text.slice(start, Math.min(text.length, offset + needle.length + 520)).replace(/\s+/g, ' ').trim() });
            from = offset + Math.max(needle.length, 1);
          }
          if (results.length >= limit) break;
        }
        return { query: String(query), results, searchedFiles: attachments.length };
      }
    }
  ];
}
