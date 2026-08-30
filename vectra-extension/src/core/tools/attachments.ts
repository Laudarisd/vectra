import { VectraDeepTool, VectraToolDefinition } from './contracts';

export interface VectraAttachmentRecord {
  name: string;
  kind?: string;
  mime?: string;
  text?: string;
}

/** Metadata for the attachment tools below -- not part of VECTRA_TOOL_DEFINITIONS
 * since they only exist on the web surface (uploaded files, not a workspace). */
export const ATTACHMENT_TOOL_DEFINITIONS: readonly VectraToolDefinition[] = [
  { name: 'list_attachments', displayName: 'List Attachments', description: 'List files uploaded to Vectra and report parsed-text availability.', risk: 'read', surface: 'web' },
  { name: 'read_attachment', displayName: 'Read Attachment', description: "Read parsed text from an uploaded file by its exact name.", risk: 'read', surface: 'web' }
];

/** Shared safe attachment tools for browser/server hosts. */
export function createAttachmentTools<TContext = unknown>(
  attachments: readonly VectraAttachmentRecord[]
): VectraDeepTool<TContext>[] {
  return [
    {
      name: 'vectra_list_attachments',
      description: 'List files uploaded to Vectra and report parsed-text availability.',
      execute: () => attachments.map(({ name, kind, mime, text }) => ({
        name,
        kind,
        mime,
        parsedCharacters: (text ?? '').length
      }))
    },
    {
      name: 'vectra_read_attachment',
      description: 'Read parsed text from an uploaded file by its exact name.',
      execute: ({ name }) => {
        const file = attachments.find((item) => item.name === name);
        if (!file) throw new Error(`Attachment not found: ${String(name)}`);
        return file.text || `No extracted text is available for ${file.name}.`;
      }
    }
  ];
}
