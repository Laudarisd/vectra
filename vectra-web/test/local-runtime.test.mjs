import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalLlamaManager, normalizeShardPath, detectMmproj } from '../lib/local-llama.mjs';
import http from 'node:http';

test('normalizeShardPath selects the first GGUF shard', () => {
  assert.equal(normalizeShardPath('/models/Qwen-00003-of-00008.gguf'), '/models/Qwen-00001-of-00008.gguf');
  assert.equal(normalizeShardPath('/models/model.gguf'), '/models/model.gguf');
});

test('detectMmproj finds a nearby projector', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vectra-mmproj-'));
  try {
    const model = join(dir, 'model.gguf');
    await writeFile(model, '');
    await writeFile(join(dir, 'mmproj-Q8_0.gguf'), '');
    await writeFile(join(dir, 'mmproj-F16.gguf'), '');
    assert.equal(await detectMmproj(model), join(dir, 'mmproj-F16.gguf'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('LocalLlamaManager launches a llama-server compatible process', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vectra-local-'));
  const manager = new LocalLlamaManager();
  try {
    const model = join(dir, 'test.gguf');
    const fakeJs = join(dir, 'fake.mjs');
    const executable = join(dir, 'llama-server');
    await writeFile(model, '');
    await writeFile(fakeJs, `#!/usr/bin/env node\nimport http from 'node:http';\nconst a=process.argv.slice(2); const get=(n)=>{const i=a.indexOf(n);return i>=0?a[i+1]:''}; const port=Number(get('--port')); const id=get('--alias')||'fake'; const s=http.createServer((q,r)=>{r.setHeader('content-type','application/json'); if(q.url==='/health')return r.end(JSON.stringify({status:'ok'})); if(q.url==='/v1/models')return r.end(JSON.stringify({data:[{id}]})); r.statusCode=404;r.end('{}')}); s.listen(port,'127.0.0.1'); process.on('SIGTERM',()=>s.close(()=>process.exit(0)));\n`);
    await writeFile(executable, `#!/bin/sh\nexec node ${JSON.stringify(fakeJs)} "$@"\n`);
    await chmod(executable, 0o755);
    const port = 19000 + Math.floor(Math.random() * 1000);
    const status = await manager.start({ modelPath: model, serverPath: executable, port, contextSize: 2048, timeoutSeconds: 10 });
    assert.equal(status.status, 'ready');
    assert.equal(status.running, true);
    assert.deepEqual(await manager.listModels(), ['test.gguf']);
  } finally {
    await manager.stop().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});


test('LocalLlamaManager moves to the next free port when preferred port is occupied', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vectra-port-'));
  const blocker = http.createServer((_req, res) => res.end('occupied'));
  const manager = new LocalLlamaManager();
  try {
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', resolve);
    });
    const blockedPort = blocker.address().port;
    const model = join(dir, 'test.gguf');
    const fakeJs = join(dir, 'fake.mjs');
    const executable = join(dir, 'llama-server');
    await writeFile(model, '');
    await writeFile(fakeJs, `#!/usr/bin/env node\nimport http from 'node:http';\nconst a=process.argv.slice(2); const get=(n)=>{const i=a.indexOf(n);return i>=0?a[i+1]:''}; const port=Number(get('--port')); const id=get('--alias')||'fake'; const key=get('--api-key'); const s=http.createServer((q,r)=>{r.setHeader('content-type','application/json'); if(q.url==='/health')return r.end(JSON.stringify({status:'ok'})); if(q.url==='/v1/models')return r.end(JSON.stringify({data:[{id}]})); if(q.url==='/v1/chat/completions'){if(key && q.headers.authorization!==\`Bearer \${key}\`){r.statusCode=401;return r.end('{}')}return r.end(JSON.stringify({choices:[{message:{content:'ok'}}]}))} r.statusCode=404;r.end('{}')}); s.listen(port,'127.0.0.1'); process.on('SIGTERM',()=>s.close(()=>process.exit(0)));\n`);
    await writeFile(executable, `#!/bin/sh\nexec node ${JSON.stringify(fakeJs)} "$@"\n`);
    await chmod(executable, 0o755);
    const status = await manager.start({ modelPath: model, serverPath: executable, port: blockedPort, contextSize: 2048, timeoutSeconds: 10 });
    assert.equal(status.status, 'ready');
    assert.notEqual(status.port, blockedPort);
    assert.equal(status.port, blockedPort + 1);
    assert.equal(status.apiKey, undefined);
    assert.match(status.logs.join('\n'), new RegExp(`Port ${blockedPort} is busy; using ${blockedPort + 1}`));
    assert.match(status.logs.join('\n'), /--api-key/);
    assert.match(status.logs.join('\n'), /--no-webui/);
    const connection = manager.connection();
    assert.ok(connection.apiKey);
    const chat = await fetch(`${connection.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.apiKey}` },
      body: JSON.stringify({ model: connection.modelId, messages: [{ role: 'user', content: 'hello' }] })
    });
    assert.equal(chat.status, 200);
  } finally {
    await manager.stop().catch(() => {});
    await new Promise((resolve) => blocker.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
