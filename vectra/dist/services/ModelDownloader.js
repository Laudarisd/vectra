"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadFile = downloadFile;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_stream_1 = require("node:stream");
const promises_2 = require("node:stream/promises");
/**
 * Streams a URL straight to disk (never buffers the whole file in memory —
 * these are multi-GB GGUF files). Writes to "<destPath>.part" and only
 * renames to the final path after the write (and optional hash check)
 * succeeds, so a cancelled or failed download never leaves a corrupt file
 * where a caller might mistake it for a complete one.
 */
async function downloadFile(url, destPath, options = {}) {
    const { onProgress, signal, expectedSha256 } = options;
    const partPath = `${destPath}.part`;
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) {
        throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
    }
    const totalHeader = response.headers.get('content-length');
    const totalBytes = totalHeader ? Number(totalHeader) : undefined;
    let bytesDone = 0;
    const counter = new node_stream_1.Transform({
        transform(chunk, _encoding, callback) {
            bytesDone += chunk.length;
            onProgress?.(bytesDone, Number.isFinite(totalBytes) ? totalBytes : undefined);
            callback(null, chunk);
        }
    });
    try {
        // response.body is a Web ReadableStream (DOM lib); Readable.fromWeb wants
        // Node's stream/web ReadableStream — structurally compatible at runtime,
        // just not the same TS type declaration, hence the cast.
        await (0, promises_2.pipeline)(node_stream_1.Readable.fromWeb(response.body), counter, (0, node_fs_1.createWriteStream)(partPath));
        if (expectedSha256) {
            const actual = await sha256OfFile(partPath);
            if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
                throw new Error(`Checksum mismatch for ${destPath}: expected ${expectedSha256}, got ${actual}`);
            }
        }
        await (0, promises_1.rename)(partPath, destPath);
    }
    catch (error) {
        await (0, promises_1.rm)(partPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
function sha256OfFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = (0, node_crypto_1.createHash)('sha256');
        const stream = (0, node_fs_1.createReadStream)(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}
//# sourceMappingURL=ModelDownloader.js.map