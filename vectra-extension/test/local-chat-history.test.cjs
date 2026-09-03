// Beginner guide: Checks that l oc al c ha t h is to ry.t es t behavior stays correct as the project changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LocalChatHistory } = require('../build/history/LocalChatHistory.js');

test('local chat history saves, lists, opens, and deletes conversations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vectra-history-'));
  try {
    const history = new LocalChatHistory(directory);
    const messages = [{ id: 'u1', role: 'user', content: 'Remember this chat', createdAt: 1, mode: 'ask' }];
    const saved = history.save(messages, 'openai', 'model-x');
    assert.equal(history.list()[0].title, 'Remember this chat');
    assert.equal(history.get(saved.id).messages[0].content, 'Remember this chat');
    history.delete(saved.id);
    assert.equal(history.list().length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('extension archives a reloaded chat and starts with an empty session', () => {
  const source = fs.readFileSync('src/ui/ChatViewProvider.ts', 'utf8');
  assert.match(source, /if \(Array\.isArray\(saved\) && saved\.length\) this\.history\.save/);
  assert.match(source, /messages: \[\]/);
  assert.match(source, /history: this\.history\.list\(\)/);
  assert.match(source, /if \(this\.hasResolvedView\) this\.startNewChat\(\)/);
});
