// Checks that inline (ghost-text) prompt assembly and completion cleanup stay correct.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInlinePrompt, cleanInlineCompletion, CURSOR_MARKER } = require('../build/core/inline/FimPrompt.js');

const ctx = (prefix, suffix, languageId = 'python') => ({ fileName: 'a.py', languageId, prefix, suffix });

test('inline prompt places the cursor marker between prefix and suffix', () => {
  const { systemPrompt, userPrompt } = buildInlinePrompt(ctx('def add(a, b):\n    ', '\n\nprint(add(1, 2))'));
  assert.ok(userPrompt.includes(`    ${CURSOR_MARKER}\n\nprint`));
  assert.match(systemPrompt, /only the inserted code/);
});

test('fences, private reasoning, an echoed current line, and the resumed suffix are stripped', () => {
  const c = ctx('def add(a, b):\n    ret', '\n\nprint(add(1, 2))');
  assert.equal(cleanInlineCompletion('```python\n    return a + b\n\nprint(add(1, 2))\n```', c, 6), 'urn a + b');
  assert.equal(cleanInlineCompletion('<think>hmm</think>return a + b', c, 6), 'urn a + b');
});

test('mid-line cursor yields one line; line-end suggestions respect maxLines; blank output is dropped', () => {
  assert.equal(cleanInlineCompletion('x = 1\ny = 2', ctx('foo(', ')')), 'x = 1');
  assert.equal(cleanInlineCompletion('a\nb\nc\nd', ctx('# list\n', ''), 2), 'a\nb');
  assert.equal(cleanInlineCompletion('\n\n   \n', ctx('', ''), 6), '');
});
