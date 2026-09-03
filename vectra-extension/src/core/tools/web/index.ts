import { z } from 'zod';
import { VectraDeepTool, VectraHostToolExecutor } from '../contracts';
import { ATTACHMENT_TOOL_DEFINITIONS, createAttachmentTools, VectraAttachmentRecord } from '../attachments';
import { VECTRA_TOOL_DEFINITIONS } from '../catalog';
import { toHostToolExecutor } from '../deepTools';
import { DOCUMENT_EXTRACTION_TOOL_DEFINITION, createDocumentExtractionTool } from './documentExtractionTool';

export * from './documentExtractionTool';

export interface VectraWebArtifact { name: string; mime: string; base64: string }

export const WEB_TOOL_DEFINITIONS = [
  ...ATTACHMENT_TOOL_DEFINITIONS,
  DOCUMENT_EXTRACTION_TOOL_DEFINITION,
  ...VECTRA_TOOL_DEFINITIONS.filter((item) => item.surface === 'web' || item.surface === 'all')
];

/** Portable web tools operate on uploaded files and downloadable artifacts.
 * They never gain arbitrary server filesystem or shell access. */
export function createWebTools<TContext = unknown>(
  attachments: readonly VectraAttachmentRecord[],
  artifacts: VectraWebArtifact[]
): VectraDeepTool<TContext>[] {
  const attachmentTools = createAttachmentTools<TContext>(attachments);
  const filesSchema = z.array(z.object({ path: z.string().min(1), content: z.string() })).min(1).max(30);
  return [
    ...attachmentTools,
    createDocumentExtractionTool<TContext>(),
    {
      name: 'vectra_read_files',
      description: 'Read bounded previews from multiple uploaded files by exact attachment name. Use for PDFs/documents; never use scratch read_file. Also discoverable as parse_files.',
      schema: z.object({
        paths: z.array(z.string().min(1)).min(1).max(20),
        maxCharsPerFile: z.number().int().min(1000).max(30000).optional()
      }),
      execute: ({ paths, maxCharsPerFile }) => (paths as string[]).map((name) => {
        const file = attachments.find((item) => item.name === name);
        const limit = typeof maxCharsPerFile === 'number' ? maxCharsPerFile : 12000;
        if (!file) return `FILE ${name}\n[Not found]`;
        const text = file.text || '';
        return `FILE ${file.name} (showing ${Math.min(text.length, limit)} of ${text.length} characters)\n${text.slice(0, limit) || '[No parsed text available; use vision inspection]'}`;
      }).join('\n\n')
    },
    {
      name: 'vectra_create_file',
      description: 'Generate one complete text/code file as a downloadable web artifact.',
      schema: z.object({ path: z.string().min(1), content: z.string() }),
      execute: ({ path, content }) => addArtifact(artifacts, String(path), String(content))
    },
    {
      name: 'vectra_propose_files',
      description: 'Generate multiple complete text/code files, including nested folder paths, as downloadable web artifacts. Also covers create_files and generate_folder_files.',
      schema: z.object({ files: filesSchema }),
      execute: ({ files }) => (files as Array<{ path: string; content: string }>).map((file) => addArtifact(artifacts, file.path, file.content)).join('\n')
    }
  ];
}

/** Generic name-dispatch view of createWebTools, so role-scoped subagent tool
 * subsets can be rebuilt from WEB_TOOL_DEFINITIONS the same way the extension
 * host does it, instead of every subagent sharing one unrestricted tool set. */
export function createWebToolExecutor<TContext = unknown>(
  attachments: readonly VectraAttachmentRecord[],
  artifacts: VectraWebArtifact[]
): VectraHostToolExecutor<TContext> {
  return toHostToolExecutor(createWebTools<TContext>(attachments, artifacts));
}

function addArtifact(artifacts: VectraWebArtifact[], requestedPath: string, content: string): string {
  const name = requestedPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!name || name.includes('../')) throw new Error('Artifact paths must be relative and cannot traverse parent folders.');
  const existing = artifacts.findIndex((item) => item.name === name);
  const artifact = { name, mime: mimeFor(name), base64: Buffer.from(content, 'utf8').toString('base64') };
  if (existing >= 0) artifacts[existing] = artifact;
  else artifacts.push(artifact);
  return `Prepared downloadable artifact ${name} (${content.length} characters).`;
}

function mimeFor(name: string): string {
  if (/\.html?$/i.test(name)) return 'text/html';
  if (/\.json$/i.test(name)) return 'application/json';
  if (/\.csv$/i.test(name)) return 'text/csv';
  if (/\.md$/i.test(name)) return 'text/markdown';
  if (/\.(?:js|mjs|cjs)$/i.test(name)) return 'text/javascript';
  return 'text/plain';
}
