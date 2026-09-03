// Beginner guide: Checks that c ha t r es en d.t es t behavior stays correct as the project changes.
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

test('local model picker offers a file, a folder, and a full scan without blocking on detection', () => {
  const source = fs.readFileSync('src/runtime/llama/LlamaCppRuntime.ts', 'utf8');
  assert.match(source, /Choose a GGUF file…/);
  assert.match(source, /Change model folder…/);
  assert.match(source, /Scan whole computer…/);
  // Shown before any filesystem work so the picker is never a dead button.
  assert.match(source, /createQuickPick<DetectedModelItem>/);
  assert.match(source, /pick\.ignoreFocusOut = true/);
  // Detection must not run behind a notification-only progress indicator.
  assert.doesNotMatch(source, /detecting installed local models/i);
});

test('extension waits for local model readiness instead of sending during startup', () => {
  const runtime = fs.readFileSync('src/runtime/llama/LlamaCppRuntime.ts', 'utf8');
  const chat = fs.readFileSync('src/ui/ChatViewProvider.ts', 'utf8');
  assert.match(runtime, /startupPromise/);
  assert.match(runtime, /get isReady/);
  assert.match(chat, /!this\.localLlama\.isReady/);
});
