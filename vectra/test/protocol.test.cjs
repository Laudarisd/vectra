const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAgentEnvelope, buildSystemPrompt } = require('../dist/agent/protocol.js');

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
  const { buildSystemPrompt } = require('../dist/agent/protocol.js');
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
