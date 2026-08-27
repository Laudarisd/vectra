import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Streams a URL straight to disk (never buffers the whole file in memory —
 * these are multi-GB GGUF files). Writes to "<destPath>.part" and only
 * renames to the final path once the write succeeds, so a cancelled or
 * failed download never leaves a corrupt file a caller might mistake for a
 * complete one.
 */
export async function downloadFile(url, destPath, options = {}) {
  const { onProgress, signal } = options;
  const partPath = `${destPath}.part`;

  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }
  const totalHeader = response.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) : undefined;

  let bytesDone = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      bytesDone += chunk.length;
      onProgress?.(bytesDone, Number.isFinite(totalBytes) ? totalBytes : undefined);
      callback(null, chunk);
    }
  });

  try {
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(partPath));
    await rename(partPath, destPath);
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
