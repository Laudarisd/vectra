const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('resolved human-in-the-loop cards disappear automatically', () => {
  const source = fs.readFileSync('src/ui/ChatViewProvider.ts', 'utf8');

  assert.match(source, /await this\.patches\.accept\(message\.id\);\s*this\.patches\.clearCompleted\(\);/);
  assert.match(source, /this\.patches\.reject\(message\.id\);\s*this\.patches\.clearCompleted\(\);/);
  assert.match(source, /await this\.patches\.acceptAllPending\(\);\s*this\.patches\.clearCompleted\(\);/);
  assert.match(source, /this\.patches\.rejectAllPending\(\);\s*this\.patches\.clearCompleted\(\);/);
  assert.match(source, /plan: activePlan\?\.status === 'pending' \? activePlan : undefined/);
});
