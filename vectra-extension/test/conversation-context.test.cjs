const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyTurn,
  formatRecentHistory,
  isStatusOnlyReply,
  sanitizeHistoricalContent
} = require('../build/agent/ConversationContext.js');

const message = (role, content) => ({ id: Math.random().toString(), role, content, createdAt: Date.now() });

test('historical tool envelopes retain their summary but never their actions', () => {
  const stale = JSON.stringify({
    message: 'I planned the old document.',
    actions: [{ type: 'create_document', path: 'test.md', content: 'old task' }],
    done: false
  });
  const cleaned = sanitizeHistoricalContent(stale);
  assert.equal(cleaned, 'I planned the old document.');
  assert.doesNotMatch(cleaned, /create_document|test\.md|old task/);
});

test('malformed historical action JSON cannot leak into a later prompt', () => {
  const malformed = '{"message":"Old analysis complete","actions":[{"type":"create_document","path":"test.md","content":"unfinished';
  const cleaned = sanitizeHistoricalContent(malformed);
  assert.equal(cleaned, 'Old analysis complete');
  assert.doesNotMatch(cleaned, /create_document|test\.md/);
});

test('history is retained so follow-up questions stay answerable', () => {
  const history = [message('user', 'Create test.md'), message('assistant', 'Working on test.md')];
  const formatted = formatRecentHistory(history);
  assert.match(formatted, /Create test\.md/);
  assert.match(formatted, /Working on test\.md/);
});

test('greetings and questions about Vectra route to the conversational path', () => {
  const chat = [
    'Hello there',
    'hi',
    'How are you?',
    'What do you mean? I am just asking Hello, how are you?',
    'who are you',
    'thanks!',
    'good morning'
  ];
  for (const text of chat) {
    assert.equal(classifyTurn(text, 'agent'), 'chat', `expected chat for: ${text}`);
  }
});

test('real requests never route to the conversational path', () => {
  const work = [
    'Create a React app in src/',
    'how many files are in this repo?',
    'hello, can you fix the login bug',
    'read package.json',
    'continue',
    'explain this function',
    'ok now add tests'
  ];
  for (const text of work) {
    assert.equal(classifyTurn(text, 'agent'), 'work', `expected work for: ${text}`);
  }
});

test('generic capability questions route to chat even though they name a work verb', () => {
  const chat = ['Do you also edit codes?', 'Can you write code?', 'does it edit code'];
  for (const text of chat) {
    assert.equal(classifyTurn(text, 'agent'), 'chat', `expected chat for: ${text}`);
  }
});

test('capability-shaped phrasing with a concrete target still means work', () => {
  assert.equal(classifyTurn('can you edit src/app.ts', 'agent'), 'work');
  assert.equal(classifyTurn('do you also edit config.json', 'agent'), 'work');
});

test('selection mode and attachments always mean work', () => {
  assert.equal(classifyTurn('hello', 'selection'), 'work');
  assert.equal(classifyTurn('hello', 'ask', true), 'work');
  assert.equal(classifyTurn('', 'agent'), 'work');
});

test('bare status lines are recognized so they never reach the user', () => {
  for (const text of [
    'action completed',
    'The requested task has been completed.',
    'Task completed',
    'done.',
    'no action needed',
    ''
  ]) {
    assert.equal(isStatusOnlyReply(text), true, `expected status-only for: ${text}`);
  }
  for (const text of [
    'I am doing well, thanks for asking! What are you working on?',
    'I read src/app.ts and the route handler is missing an await.',
    'Done — I updated the three config files and left the tests untouched.'
  ]) {
    assert.equal(isStatusOnlyReply(text), false, `expected real reply for: ${text}`);
  }
});
