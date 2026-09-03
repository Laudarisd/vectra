// Beginner guide: Checks that h is to ry.t es t behavior stays correct as the project changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChatHistoryStore } from '../server/services/history.mjs';

test('SQLite history creates, updates, lists, and deletes conversations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vectra-history-'));
  const store = new ChatHistoryStore(join(directory, 'history.sqlite'));
  try {
    const created = store.save({
      provider: 'openaiCompatible',
      model: 'local-model',
      messages: [{ role: 'user', content: 'Build a useful project' }]
    });
    assert.match(created.id, /^[a-f0-9-]+$/);
    assert.equal(created.title, 'Build a useful project');
    assert.equal(store.list()[0].messageCount, 1);
    await access(join(directory, 'history', `${created.id}.json`));

    const extensionId = 'extension-chat-1234';
    await writeFile(join(directory, 'history', `${extensionId}.json`), JSON.stringify({
      id: extensionId, title: 'From VS Code', provider: 'openai', model: 'model-x',
      createdAt: 1, updatedAt: 2, messages: [{ role: 'user', content: 'Shared chat', createdAt: 1 }]
    }));
    assert.equal(store.get(extensionId).title, 'From VS Code');
    assert.ok(store.list().some((chat) => chat.id === extensionId));

    const updated = store.save({
      id: created.id,
      title: created.title,
      provider: created.provider,
      model: created.model,
      messages: [...created.messages, { role: 'assistant', content: 'Done', artifacts: [{ name: 'result.md', mime: 'text/markdown', base64: 'RG9uZQ==' }] }]
    });
    assert.equal(updated.messages.length, 2);
    assert.equal(updated.messages[1].artifacts[0].name, 'result.md');
    await writeFile(join(directory, 'history', `${created.id}.json`), JSON.stringify({
      ...updated, updatedAt: updated.updatedAt + 1,
      messages: [...updated.messages, { role: 'user', content: 'Updated in VS Code', createdAt: Date.now() }]
    }));
    assert.equal(store.get(created.id).messages.at(-1).content, 'Updated in VS Code');
    assert.equal(store.delete(created.id), true);
    assert.equal(store.get(created.id), undefined);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
