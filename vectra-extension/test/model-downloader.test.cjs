const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { downloadFile } = require('../build/models/ModelDownloader.js');

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'vectra-download-test-'));
}

test('downloadFile streams a URL to disk and leaves no .part file behind', async () => {
  const payload = Buffer.from('a'.repeat(50_000));
  await withServer(
    (req, res) => {
      res.setHeader('content-length', String(payload.length));
      res.end(payload);
    },
    async (base) => {
      const dir = await tempDir();
      const dest = path.join(dir, 'model.gguf');
      const progressCalls = [];
      await downloadFile(`${base}/model.gguf`, dest, {
        onProgress: (done, total) => progressCalls.push([done, total])
      });

      const written = await fs.readFile(dest);
      assert.ok(written.equals(payload));
      await assert.rejects(fs.access(`${dest}.part`));
      assert.ok(progressCalls.length > 0);
      assert.equal(progressCalls.at(-1)[0], payload.length);
      assert.equal(progressCalls.at(-1)[1], payload.length);
    }
  );
});

test('downloadFile verifies an expected sha256 and rejects on mismatch, cleaning up the .part file', async () => {
  const payload = Buffer.from('hello world');
  await withServer(
    (req, res) => res.end(payload),
    async (base) => {
      const dir = await tempDir();
      const dest = path.join(dir, 'model.gguf');
      await assert.rejects(
        downloadFile(`${base}/model.gguf`, dest, { expectedSha256: '0'.repeat(64) }),
        /checksum mismatch/i
      );
      await assert.rejects(fs.access(dest));
      await assert.rejects(fs.access(`${dest}.part`));
    }
  );
});

test('downloadFile succeeds when the expected sha256 matches', async () => {
  const payload = Buffer.from('hello world');
  const expected = crypto.createHash('sha256').update(payload).digest('hex');
  await withServer(
    (req, res) => res.end(payload),
    async (base) => {
      const dir = await tempDir();
      const dest = path.join(dir, 'model.gguf');
      await downloadFile(`${base}/model.gguf`, dest, { expectedSha256: expected });
      assert.ok((await fs.readFile(dest)).equals(payload));
    }
  );
});

test('downloadFile cleans up the .part file and never creates the final path when aborted mid-download', async () => {
  await withServer(
    (req, res) => {
      res.setHeader('content-length', '10000000');
      res.write(Buffer.alloc(100_000));
      // Never end the response — the abort should fire before the client gives up waiting.
    },
    async (base) => {
      const dir = await tempDir();
      const dest = path.join(dir, 'model.gguf');
      const controller = new AbortController();
      const downloadPromise = downloadFile(`${base}/model.gguf`, dest, { signal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      await assert.rejects(downloadPromise);
      await assert.rejects(fs.access(dest));
      await assert.rejects(fs.access(`${dest}.part`));
    }
  );
});

test('downloadFile rejects with a clear error on a non-2xx response', async () => {
  await withServer(
    (req, res) => {
      res.statusCode = 404;
      res.end('not found');
    },
    async (base) => {
      const dir = await tempDir();
      const dest = path.join(dir, 'model.gguf');
      await assert.rejects(downloadFile(`${base}/missing.gguf`, dest), /404/);
      await assert.rejects(fs.access(dest));
    }
  );
});
