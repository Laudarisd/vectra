"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAttachmentTools = createAttachmentTools;
/** Shared safe attachment tools for browser/server hosts. */
function createAttachmentTools(attachments) {
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
                if (!file)
                    throw new Error(`Attachment not found: ${String(name)}`);
                return file.text || `No extracted text is available for ${file.name}.`;
            }
        }
    ];
}
//# sourceMappingURL=attachments.js.map