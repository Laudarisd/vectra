// Beginner guide: Checks that p ro to co l.t es t behavior stays correct as the project changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAgentEnvelope, buildSystemPrompt } = require('../build/agent/protocol.js');

test('parses a valid action envelope', () => {
  const parsed = parseAgentEnvelope('{"message":"reading","actions":[{"type":"read_file","path":"src/a.ts"}],"done":false}');
  assert.equal(parsed.message, 'reading');
  assert.equal(parsed.done, false);
  assert.equal(parsed.actions[0].type, 'read_file');
});

test('parses fenced JSON from less strict models', () => {
  const parsed = parseAgentEnvelope('```json\n{"message":"done","actions":[],"done":true}\n```');
  assert.equal(parsed.message, 'done');
  assert.equal(parsed.done, true);
});

test('falls back to a normal final answer when JSON is ignored', () => {
  const parsed = parseAgentEnvelope('This is a plain explanation.');
  assert.equal(parsed.message, 'This is a plain explanation.');
  assert.deepEqual(parsed.actions, []);
  assert.equal(parsed.done, true);
});

test('parses professional create/run actions', () => {
  const parsed = parseAgentEnvelope('{"message":"building","actions":[{"type":"create_file","path":"tool.py","content":"print(1)"},{"type":"run_tests","command":"python tool.py"}],"done":false}');
  assert.equal(parsed.actions[0].type, 'create_file');
  assert.equal(parsed.actions[1].type, 'run_tests');
});

test('agent prompt explicitly permits creating a new language file in workspace', () => {
  const { buildSystemPrompt } = require('../build/agent/protocol.js');
  const prompt = buildSystemPrompt('agent');
  assert.match(prompt, /may create new files/i);
  assert.match(prompt, /repository does not need to already use that language/i);
  assert.match(prompt, /run_tests/);
  assert.match(prompt, /inspect_file/);
});

test('parses line and document editing actions', () => {
  const raw = JSON.stringify({ message:'edit', actions:[
    { type:'delete_lines', path:'src/a.ts', startLine:4, endLine:6, reason:'remove obsolete block' },
    { type:'create_document', path:'reports/result.docx', title:'Result', content:'Hello document' }
  ], done:false });
  const parsed = parseAgentEnvelope(raw);
  assert.equal(parsed.actions[0].type, 'delete_lines');
  assert.equal(parsed.actions[1].type, 'create_document');
  assert.match(buildSystemPrompt('agent'), /PDF\/DOCX\/PPTX\/XLSX\/RTF/i);
});


test('agent exposes workspace discovery and language-aware execution tools', () => {
  const prompt = buildSystemPrompt('agent');
  assert.match(prompt, /workspace_summary/);
  assert.match(prompt, /list_directory/);
  assert.match(prompt, /how many files/i);
  assert.match(prompt, /run_file/);
  assert.match(prompt, /run_project/);
  const parsed = parseAgentEnvelope(JSON.stringify({message:'inspect',actions:[{type:'workspace_summary',path:'vectra'},{type:'run_file',path:'hello.py'}],done:false}));
  assert.equal(parsed.actions[0].type, 'workspace_summary');
  assert.equal(parsed.actions[1].type, 'run_file');
});

test('rejects string actions from small local models before tool dispatch', () => {
  const parsed = parseAgentEnvelope('{"message":"listing","actions":["list directory(resize)"],"done":false}');
  assert.deepEqual(parsed.actions, []);
  assert.equal(parsed.done, false);
  assert.match(parsed.actionError, /must be an object/i);
});

test('rejects action objects with unknown tool types', () => {
  const parsed = parseAgentEnvelope('{"message":"working","actions":[{"type":"list directory"}],"done":false}');
  assert.deepEqual(parsed.actions, []);
  assert.match(parsed.actionError, /recognized string type/i);
});

test('recovers the message from truncated tool JSON without exposing stale actions', () => {
  const parsed = parseAgentEnvelope('{"message":"Old analysis complete","actions":[{"type":"create_document","path":"test.md","content":"unfinished');
  assert.equal(parsed.message, 'Old analysis complete');
  assert.deepEqual(parsed.actions, []);
  assert.equal(parsed.done, true);
});

test('prompts make the current task authoritative and keep Ask mode read-only', () => {
  assert.match(buildSystemPrompt('ask'), /CURRENT USER TASK is authoritative/);
  assert.match(buildSystemPrompt('ask'), /Never request a write or execution action in Ask mode/);
});

test('agent exposes multi-file context and complete project batch tools', () => {
  const prompt = buildSystemPrompt('agent');
  assert.match(prompt, /read_files/);
  assert.match(prompt, /propose_files/);
  assert.match(prompt, /complete file set/i);
  assert.match(prompt, /No ellipses, TODO-only bodies, placeholder comments, or one-line stubs/i);

  const parsed = parseAgentEnvelope(JSON.stringify({
    message: 'building project',
    actions: [{
      type: 'propose_files',
      files: [
        { path: 'package.json', content: '{"private":true}' },
        { path: 'src/index.ts', content: 'export const ready = true;\n' }
      ]
    }],
    done: true
  }));
  assert.equal(parsed.actions[0].type, 'propose_files');
  assert.equal(parsed.actions[0].files.length, 2);
});

test('agent exposes confirmed file and directory path operations', () => {
  const prompt = buildSystemPrompt('agent');
  for (const name of ['create_directory', 'rename_path', 'move_path', 'copy_path', 'delete_directory']) {
    assert.match(prompt, new RegExp(name));
  }
  const parsed = parseAgentEnvelope(JSON.stringify({
    message: 'organizing workspace',
    actions: [
      { type: 'create_directory', path: 'src/empty' },
      { type: 'rename_path', path: 'src/old.ts', destinationPath: 'src/new.ts' },
      { type: 'move_path', path: 'src/new.ts', destinationPath: 'archive/new.ts' },
      { type: 'copy_path', path: 'assets/logo.svg', destinationPath: 'public/logo.svg' },
      { type: 'delete_directory', path: 'tmp/generated', recursive: true }
    ],
    done: false
  }));
  assert.deepEqual(parsed.actions.map((action) => action.type), [
    'create_directory', 'rename_path', 'move_path', 'copy_path', 'delete_directory'
  ]);
});
