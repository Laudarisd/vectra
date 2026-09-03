import { z } from 'zod';
import { formatDocumentTable } from '../../document';
import { VectraDeepTool, VectraToolDefinition } from '../contracts';

const valueSchema = z.union([z.string(), z.number(), z.boolean()]).nullable();
const columnSchema = z.object({
  key: z.string().min(1).max(80).describe('Stable machine key used in each row object.'),
  header: z.string().min(1).max(160).describe('Human-readable table heading.')
});

export const DOCUMENT_EXTRACTION_TOOL_DEFINITION: VectraToolDefinition<'document_extraction'> = {
  name: 'document_extraction',
  displayName: 'Document Extraction',
  description: 'Normalize and format structured information extracted from uploaded documents, drawings, images, or data files.',
  risk: 'read',
  surface: 'web'
};

export function createDocumentExtractionTool<TContext = unknown>(): VectraDeepTool<TContext> {
  return {
    name: 'document_extraction',
    description: 'Use for structured or repeating information extracted from uploaded files. Infer columns from the request and actual headings, preserve user-provided header wording/order, reconcile native tables with OCR, and retain source/page/asset provenance, dimensions, conflicts, and uncertainty. Never substitute a generic industry schema. Return the responsive table verbatim.',
    schema: z.object({
      title: z.string().max(240).optional(),
      columns: z.array(columnSchema).min(1).max(50),
      rows: z.array(z.record(z.string(), valueSchema.optional())).min(1).max(5000),
      matchKeys: z.array(z.string()).max(8).optional(),
      sources: z.array(z.string()).max(100).optional()
    }),
    execute: ({ title, columns, rows, matchKeys, sources }) => formatDocumentTable({
      title: typeof title === 'string' ? title : undefined,
      columns: columns as Array<{ key: string; header: string }>,
      rows: rows as Array<Record<string, unknown>>,
      matchKeys: Array.isArray(matchKeys) ? matchKeys.map(String) : [],
      sources: Array.isArray(sources) ? sources.map(String) : []
    })
  };
}
