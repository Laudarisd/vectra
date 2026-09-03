// Beginner guide: Handles m od el do wn lo ad er responsibilities for Vectra.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface DownloadOptions {
  onProgress?: (bytesDone: number, totalBytes?: number) => void;
  signal?: AbortSignal;
  expectedSha256?: string;
}

/**
 * Streams a URL straight to disk (never buffers the whole file in memory —
 * these are multi-GB GGUF files). Writes to "<destPath>.part" and only
 * renames to the final path after the write (and optional hash check)
 * succeeds, so a cancelled or failed download never leaves a corrupt file
 * where a caller might mistake it for a complete one.
 */
export async function downloadFile(url: string, destPath: string, options: DownloadOptions = {}): Promise<void> {
  const { onProgress, signal, expectedSha256 } = options;
  const partPath = `${destPath}.part`;

  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }
  const totalHeader = response.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) : undefined;

  let bytesDone = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesDone += chunk.length;
      onProgress?.(bytesDone, Number.isFinite(totalBytes) ? totalBytes : undefined);
      callback(null, chunk);
    }
  });

  try {
    // response.body is a Web ReadableStream (DOM lib); Readable.fromWeb wants
    // Node's stream/web ReadableStream — structurally compatible at runtime,
    // just not the same TS type declaration, hence the cast.
    await pipeline(Readable.fromWeb(response.body as never), counter, createWriteStream(partPath));

    if (expectedSha256) {
      const actual = await sha256OfFile(partPath);
      if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new Error(`Checksum mismatch for ${destPath}: expected ${expectedSha256}, got ${actual}`);
      }
    }

    await rename(partPath, destPath);
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
