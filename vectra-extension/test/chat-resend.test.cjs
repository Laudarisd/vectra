const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('webview exposes an Edit & resend action and sends the edited message id', () => {
  const source = fs.readFileSync('media/main.js', 'utf8');
  assert.match(source, /Edit & resend/);
  assert.match(source, /editMessageId: editingMessageId/);
  assert.match(source, /els\.send\.textContent = editingMessageId \? 'Resend' : 'Send'/);
});

test('extension branches chat history and reuses session attachments on resend', () => {
  const source = fs.readFileSync('src/ui/ChatViewProvider.ts', 'utf8');
  assert.match(source, /branchFromEditedMessage/);
  assert.match(source, /messageAttachments/);
  assert.match(source, /this\.messages\.splice\(index\)/);
  assert.match(source, /this\.patches\.rejectAllPending\(\)/);
});

test('local model command offers manual search and automatic detection', () => {
  const source = fs.readFileSync('src/services/LocalLlamaCppService.ts', 'utf8');
  assert.match(source, /Search or choose a GGUF model/);
  assert.match(source, /Detect installed local models/);
  assert.match(source, /discoverGgufModels/);
  assert.match(source, /discoverOllamaModels/);
});
