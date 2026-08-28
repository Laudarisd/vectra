const test = require('node:test');
const assert = require('node:assert/strict');
const { TodoManager } = require('../build/state/TodoManager.js');

test('TodoManager starts empty and stores a full-replace list', () => {
  const todos = new TodoManager();
  assert.deepEqual(todos.list(), []);

  const items = [
    { id: '1', content: 'Read the router files', status: 'in_progress' },
    { id: '2', content: 'Add the new endpoint', status: 'pending' }
  ];
  todos.set(items);
  assert.deepEqual(todos.list(), items);
});

test('TodoManager.set fully replaces the previous list, not merges', () => {
  const todos = new TodoManager();
  todos.set([{ id: '1', content: 'A', status: 'pending' }]);
  todos.set([{ id: '2', content: 'B', status: 'completed' }]);
  assert.deepEqual(todos.list(), [{ id: '2', content: 'B', status: 'completed' }]);
});

test('TodoManager.clear empties the list', () => {
  const todos = new TodoManager();
  todos.set([{ id: '1', content: 'A', status: 'pending' }]);
  todos.clear();
  assert.deepEqual(todos.list(), []);
});
