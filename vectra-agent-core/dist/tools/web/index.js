"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEB_TOOL_DEFINITIONS = void 0;
exports.createWebTools = createWebTools;
const zod_1 = require("zod");
const attachments_1 = require("../attachments");
const catalog_1 = require("../catalog");
exports.WEB_TOOL_DEFINITIONS = catalog_1.VECTRA_TOOL_DEFINITIONS.filter((item) => item.surface === 'web' || item.surface === 'all');
/** Portable web tools operate on uploaded files and downloadable artifacts.
 * They never gain arbitrary server filesystem or shell access. */
function createWebTools(attachments, artifacts) {
    const attachmentTools = (0, attachments_1.createAttachmentTools)(attachments);
    const filesSchema = zod_1.z.array(zod_1.z.object({ path: zod_1.z.string().min(1), content: zod_1.z.string() })).min(1).max(30);
    return [
        ...attachmentTools,
        {
            name: 'vectra_read_files',
            description: 'Parse/read multiple uploaded files by exact name in one call. Also discoverable as parse_files.',
            schema: zod_1.z.object({ paths: zod_1.z.array(zod_1.z.string().min(1)).min(1).max(20) }),
            execute: ({ paths }) => paths.map((name) => {
                const file = attachments.find((item) => item.name === name);
                return file ? `FILE ${file.name}\n${file.text || '[No parsed text available]'}` : `FILE ${name}\n[Not found]`;
            }).join('\n\n')
        },
        {
            name: 'vectra_create_file',
            description: 'Generate one complete text/code file as a downloadable web artifact.',
            schema: zod_1.z.object({ path: zod_1.z.string().min(1), content: zod_1.z.string() }),
            execute: ({ path, content }) => addArtifact(artifacts, String(path), String(content))
        },
        {
            name: 'vectra_propose_files',
            description: 'Generate multiple complete text/code files, including nested folder paths, as downloadable web artifacts. Also covers create_files and generate_folder_files.',
            schema: zod_1.z.object({ files: filesSchema }),
            execute: ({ files }) => files.map((file) => addArtifact(artifacts, file.path, file.content)).join('\n')
        }
    ];
}
function addArtifact(artifacts, requestedPath, content) {
    const name = requestedPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name || name.includes('../'))
        throw new Error('Artifact paths must be relative and cannot traverse parent folders.');
    const existing = artifacts.findIndex((item) => item.name === name);
    const artifact = { name, mime: mimeFor(name), base64: Buffer.from(content, 'utf8').toString('base64') };
    if (existing >= 0)
        artifacts[existing] = artifact;
    else
        artifacts.push(artifact);
    return `Prepared downloadable artifact ${name} (${content.length} characters).`;
}
function mimeFor(name) {
    if (/\.html?$/i.test(name))
        return 'text/html';
    if (/\.json$/i.test(name))
        return 'application/json';
    if (/\.csv$/i.test(name))
        return 'text/csv';
    if (/\.md$/i.test(name))
        return 'text/markdown';
    if (/\.(?:js|mjs|cjs)$/i.test(name))
        return 'text/javascript';
    return 'text/plain';
}
//# sourceMappingURL=index.js.map