// Beginner guide: Checks that c or e r un ti me.t es t behavior stays correct as the project changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AgentEventStream,
  AgentSession,
  AgentToolRouter,
  ApprovalState,
  PlanState,
  TodoState,
  VectraDeepAgentRuntime,
  VectraLangChainChatModel,
  DEEP_AGENT_ACTION_TOOL_NAMES,
  DEEP_AGENT_BUILTIN_TOOL_DEFINITIONS,
  DEEP_AGENT_FILESYSTEM_TOOL_NAMES,
  DEEP_AGENT_ASYNC_TOOL_NAMES,
  VECTRA_TOOL_DEFINITIONS,
  EXTENSION_TOOL_DEFINITIONS,
  WEB_TOOL_DEFINITIONS,
  createAttachmentTools,
  createWebTools,
  createVectraHostTools,
  createVectraDiscoveryTools
} = require('../build/core');
const { tool } = require('langchain');
const { z } = require('zod');

test('session owns messages, todos, plans, approvals, and run lifecycle events', async () => {
  const events = new AgentEventStream();
  const seen = [];
  events.subscribe((event) => seen.push(event.type));
  const approvals = new ApprovalState(events);
  const session = new AgentSession({
    events,
    approvals,
    todos: new TodoState(events),
    plans: new PlanState(approvals, events)
  });

  session.addMessage({ id: 'u1', role: 'user', content: 'hello', createdAt: 1 });
  session.todos.set([{ id: 't1', content: 'Inspect workspace', status: 'in_progress' }]);
  const plan = session.plans.propose(['Inspect', 'Implement']);
  const decision = session.plans.waitForDecision(plan.id);
  session.plans.approve();

  assert.equal(await decision, 'approved');
  assert.equal(await session.run(async ({ messages }) => messages[0].content), 'hello');
  assert.deepEqual(session.todos.list().map((item) => item.id), ['t1']);
  assert.ok(seen.includes('run.started'));
  assert.ok(seen.includes('run.completed'));
  assert.ok(seen.includes('approval.requested'));
});

test('tool router dispatches host tools and emits their lifecycle', async () => {
  const events = new AgentEventStream();
  const seen = [];
  events.subscribe((event) => seen.push(event.type));
  const tools = new AgentToolRouter((action) => action.type, events)
    .register('echo', (action) => action.value);

  assert.equal(await tools.execute({ type: 'echo', value: 'Vectra' }, {}), 'Vectra');
  assert.deepEqual(seen, ['tool.started', 'tool.completed']);
});

test('cancelled approvals reject pending waiters', async () => {
  const approvals = new ApprovalState();
  const request = approvals.request('command', { command: 'test' });
  const waiting = approvals.waitForDecision(request.id);
  approvals.cancelPending();
  await assert.rejects(waiting, /cancelled/);
});

test('Vectra model adapter turns JSON fallback actions into LangChain tool calls', async () => {
  const provider = {
    async complete() {
      return JSON.stringify({ message: 'Checking', actions: [{ type: 'echo', value: 'hello' }] });
    }
  };
  const model = new VectraLangChainChatModel(provider, 'local-test').bindTools([
    tool(async ({ value }) => value, {
      name: 'echo',
      description: 'Echo text',
      schema: z.object({ value: z.string() })
    })
  ]);
  const response = await model.invoke([{ role: 'user', content: 'echo hello' }]);
  assert.equal(response.tool_calls[0].name, 'echo');
  assert.deepEqual(response.tool_calls[0].args, { value: 'hello' });
});

test('Vectra model adapter consumes Qwen XML tool calls without exposing think text', async () => {
  const provider = {
    async completeWithTools() {
      return {
        text: '<think>private plan</think><tool_call><function=echo><parameter=value>"hello"</parameter></function></tool_call>',
        toolCalls: []
      };
    }
  };
  const model = new VectraLangChainChatModel(provider, 'qwen-test').bindTools([
    tool(async ({ value }) => value, { name: 'echo', description: 'Echo text', schema: z.object({ value: z.string() }) })
  ]);
  const response = await model.invoke([{ role: 'user', content: 'echo hello' }]);
  assert.equal(response.content, '');
  assert.equal(response.tool_calls[0].name, 'echo');
  assert.deepEqual(response.tool_calls[0].args, { value: 'hello' });
});

test('Vectra model adapter prefers native tool calls without serializing the fallback envelope', async () => {
  let fallbackCalls = 0;
  const provider = {
    async complete() { fallbackCalls++; return 'unused'; },
    async completeWithTools(request) {
      assert.equal(request.tools[0].name, 'echo');
      assert.equal(request.messages.at(-1).role, 'user');
      return { text: 'Checking', toolCalls: [{ id: 'native-1', name: 'echo', args: { value: 'hello' } }] };
    }
  };
  const model = new VectraLangChainChatModel(provider, 'local-test').bindTools([
    tool(async ({ value }) => value, { name: 'echo', description: 'Echo text', schema: z.object({ value: z.string() }) })
  ]);
  const response = await model.invoke([{ role: 'user', content: 'echo hello' }]);
  assert.equal(response.tool_calls[0].id, 'native-1');
  assert.equal(fallbackCalls, 0);
});

test('model-driven tool discovery exposes and gates canonical host capabilities', async () => {
  const calls = [];
  const definitions = [
    { name: 'read_file', displayName: 'Read File', description: 'Read a workspace file.', risk: 'read', surface: 'extension' },
    { name: 'create_directory', displayName: 'Create Directory', description: 'Create an empty folder.', risk: 'write', surface: 'extension' }
  ];
  const discovery = createVectraDiscoveryTools(definitions, async (name, input) => { calls.push({ name, input }); return 'ok'; });
  const search = discovery.find((item) => item.name === 'vectra_search_tools');
  const invoke = discovery.find((item) => item.name === 'vectra_invoke_tool');
  const found = await search.execute({ query: 'create a folder' }, {});
  assert.ok(found.tools.some((item) => item.name === 'create_directory'));
  assert.equal(await invoke.execute({ name: 'create_directory', arguments: { path: 'education' } }, {}), 'ok');
  // An exact catalog name works without a prior search: the catalog subset is
  // the allowlist, and forcing a search first only produced error loops.
  assert.equal(await invoke.execute({ name: 'read_file', arguments: { path: 'a.txt' } }, {}), 'ok');
  // The vectra_ prefix a model habitually adds resolves to the same capability.
  assert.equal(await invoke.execute({ name: 'vectra_read_file', arguments: { path: 'a.txt' } }, {}), 'ok');
  assert.deepEqual(calls, [
    { name: 'create_directory', input: { path: 'education' } },
    { name: 'read_file', input: { path: 'a.txt' } },
    { name: 'read_file', input: { path: 'a.txt' } }
  ]);
  // A wrong name fails with real alternatives, not a dead end.
  assert.throws(
    () => invoke.execute({ name: 'read_files_from_disk', arguments: {} }, {}),
    /Unknown Vectra capability: read_files_from_disk\..*read_file/s
  );
});

test('tool discovery understands common capability aliases without duplicating tools', () => {
  const { searchToolCatalog } = require('../build/core');
  assert.equal(searchToolCatalog(VECTRA_TOOL_DEFINITIONS, 'generate_folder_files')[0].name, 'propose_files');
  assert.equal(searchToolCatalog(VECTRA_TOOL_DEFINITIONS, 'parse_files')[0].name, 'read_files');
  assert.equal(new Set(VECTRA_TOOL_DEFINITIONS.map((item) => item.name)).size, VECTRA_TOOL_DEFINITIONS.length);
});

test('web adapter uses shared portable definitions and creates downloadable files', async () => {
  assert.ok(EXTENSION_TOOL_DEFINITIONS.length >= WEB_TOOL_DEFINITIONS.length);
  const artifacts = [];
  const tools = createWebTools([{ name: 'notes.txt', text: 'hello' }], artifacts);
  const implementedCanonical = tools.map((item) => item.name.replace(/^vectra_/, '')).filter((name) => WEB_TOOL_DEFINITIONS.some((item) => item.name === name));
  assert.deepEqual(implementedCanonical.sort(), WEB_TOOL_DEFINITIONS.map((item) => item.name).sort());
  const read = tools.find((item) => item.name === 'vectra_read_files');
  const create = tools.find((item) => item.name === 'vectra_propose_files');
  assert.match(await read.execute({ paths: ['notes.txt'] }, {}), /hello/);
  await create.execute({ files: [{ path: 'education/README.md', content: '# Echo state network' }] }, {});
  assert.equal(artifacts[0].name, 'education/README.md');
  assert.equal(Buffer.from(artifacts[0].base64, 'base64').toString(), '# Echo state network');
});

test('image tools show uploaded images with bounding boxes and draw new SVG figures', async () => {
  const artifacts = [];
  const image = { name: 'photo.png', kind: 'image', mime: 'image/png', base64: Buffer.from('png-bytes').toString('base64') };
  const tools = createWebTools([image, { name: 'notes.txt', text: 'hello' }], artifacts);

  const show = tools.find((item) => item.name === 'show_image');
  assert.match(await show.execute({ name: 'photo.png', title: 'Detected part', boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: 'bolt' }] }, {}), /1 highlighted region/);
  assert.deepEqual(artifacts[0], { name: 'photo.png', mime: 'image/png', base64: image.base64, view: 'image', title: 'Detected part', boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: 'bolt' }] });
  await assert.rejects(async () => show.execute({ name: 'notes.txt' }, {}), /image bytes/i);

  const draw = tools.find((item) => item.name === 'draw_image');
  await draw.execute({ title: 'Sales by month', svg: '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>' }, {});
  const figure = artifacts.find((item) => item.name === 'Sales_by_month.svg');
  assert.equal(figure.view, 'image');
  assert.match(Buffer.from(figure.base64, 'base64').toString(), /<rect/);
  await assert.rejects(async () => draw.execute({ title: 'evil', svg: '<svg onload="x()"></svg>' }, {}), /scripts or event handlers/i);
});

// Regression: "show this PDF as an image" used to fail with '"x.pdf" is not an
// image attachment', and images whose bytes were released after OCR could
// never be re-displayed.
test('show_image renders PDF pages on demand and keeps post-OCR display bytes usable', async () => {
  const artifacts = [];
  const attachments = [
    { name: 'drawing.pdf', kind: 'pdf', mime: 'application/pdf', text: 'native text', base64: Buffer.from('pdf-bytes').toString('base64') },
    { name: 'scan.png', kind: 'image', mime: 'image/png', base64: '', viewBase64: Buffer.from('scan-bytes').toString('base64') }
  ];
  const rendered = [];
  const tools = createWebTools(attachments, artifacts, {
    renderPdfPage: async (record, pageNumber) => {
      rendered.push([record.name, pageNumber]);
      return { mime: 'image/png', base64: Buffer.from(`page-${pageNumber}`).toString('base64'), width: 100, height: 50 };
    }
  });
  const show = tools.find((item) => item.name === 'show_image');

  // A PDF name plus page rasterizes that page from the original document.
  assert.match(await show.execute({ name: 'drawing.pdf', page: 3 }, {}), /drawing\.pdf · page 3/);
  assert.deepEqual(rendered, [['drawing.pdf', 3]]);
  assert.equal(artifacts[0].name, 'drawing.pdf · page 3');
  assert.equal(artifacts[0].view, 'image');

  // Display-only bytes retained after OCR release still show.
  await show.execute({ name: 'scan.png' }, {});
  assert.ok(artifacts.some((item) => item.name === 'scan.png' && item.base64 === attachments[1].viewBase64));

  // Without a host page renderer the PDF error is actionable, not "not an image".
  const bare = createWebTools(attachments, []).find((item) => item.name === 'show_image');
  await assert.rejects(async () => bare.execute({ name: 'drawing.pdf', page: 2 }, {}), /No rendered image is available/);

  // fetch_image is registered and its URLs pass the SSRF guard before any request.
  const fetchImage = tools.find((item) => item.name === 'fetch_image');
  assert.ok(fetchImage);
  await assert.rejects(async () => fetchImage.execute({ url: 'http://localhost/logo.png' }, {}), /local\/private address/);
});

test('Deep Agents built-in inventory is complete and records conditional availability', () => {
  assert.deepEqual(DEEP_AGENT_FILESYSTEM_TOOL_NAMES, [
    'ls', 'read_file', 'write_file', 'edit_file', 'delete', 'glob', 'grep', 'execute'
  ]);
  assert.deepEqual(DEEP_AGENT_ASYNC_TOOL_NAMES, [
    'start_async_task', 'check_async_task', 'update_async_task', 'cancel_async_task', 'list_async_tasks'
  ]);
  assert.equal(DEEP_AGENT_BUILTIN_TOOL_DEFINITIONS.length, 15);
  assert.equal(DEEP_AGENT_BUILTIN_TOOL_DEFINITIONS.find((item) => item.name === 'execute').availability, 'sandbox-backend');
  assert.equal(DEEP_AGENT_BUILTIN_TOOL_DEFINITIONS.find((item) => item.name === 'start_async_task').availability, 'async-subagent');
  assert.ok(DEEP_AGENT_ACTION_TOOL_NAMES.includes('deep_write_todos'));
  for (const tool of DEEP_AGENT_BUILTIN_TOOL_DEFINITIONS) {
    assert.ok(tool.displayName && !tool.displayName.includes('_'), `${tool.name} needs a readable display name`);
  }
});

test('fallback actions distinguish Vectra workspace tools from Deep scratch tools', async () => {
  const responses = [
    { actions: [{ type: 'read_file', path: 'src/app.ts' }] },
    { actions: [{ type: 'deep_read_file', path: '/notes.txt' }] }
  ];
  const provider = { async complete() { return JSON.stringify(responses.shift()); } };
  const schema = z.object({ path: z.string() });
  const model = new VectraLangChainChatModel(provider, 'local-test').bindTools([
    tool(async () => '', { name: 'read_file', description: 'Scratch read', schema }),
    tool(async () => '', { name: 'vectra_read_file', description: 'Workspace read', schema })
  ]);
  const workspace = await model.invoke([{ role: 'user', content: 'workspace' }]);
  const scratch = await model.invoke([{ role: 'user', content: 'scratch' }]);
  assert.equal(workspace.tool_calls[0].name, 'vectra_read_file');
  assert.equal(scratch.tool_calls[0].name, 'read_file');
});

test('Deep Agents invokes Vectra host tools and returns its final answer', async () => {
  let calls = 0;
  const provider = {
    async complete() {
      calls++;
      return calls === 1
        ? JSON.stringify({ message: 'Using host tool', actions: [{ type: 'echo', value: 'Vectra' }] })
        : JSON.stringify({ message: 'Echoed Vectra', actions: [] });
    }
  };
  const runtime = new VectraDeepAgentRuntime({
    provider,
    model: 'local-test',
    context: {},
    tools: [{
      name: 'echo',
      description: 'Echo text',
      schema: z.object({ value: z.string() }),
      execute: ({ value }) => value
    }],
    maxSteps: 4
  });
  const result = await runtime.run({ task: 'Echo Vectra' });
  assert.equal(result.harness, 'deepagents');
  assert.match(result.text, /Echoed Vectra/);
});

test('Deep Agents planning and scratch tools run through Vectra fallback providers', async () => {
  let calls = 0;
  let boundNames = [];
  const events = new AgentEventStream();
  const started = [];
  events.subscribe((event) => {
    if (event.type === 'deepagent.tool.started') started.push(event.tool);
  });
  const provider = {
    async complete(request) {
      calls++;
      if (calls === 1) {
        const available = request.systemPrompt.match(/AVAILABLE TOOLS:\n([^\n]+)/)?.[1];
        boundNames = available ? JSON.parse(available).map((item) => item.name) : [];
      }
      if (calls === 1) return JSON.stringify({
        message: 'Writing scratch note',
        actions: [{ type: 'deep_write_file', file_path: '/notes.txt', content: 'Vectra scratch integration' }]
      });
      if (calls === 2) return JSON.stringify({
        message: 'Reading scratch note',
        actions: [{ type: 'deep_read_file', file_path: '/notes.txt' }]
      });
      if (calls === 3) return JSON.stringify({
        message: 'Planning',
        actions: [{ type: 'deep_write_todos', todos: [{ content: 'Use scratch storage', status: 'in_progress' }] }]
      });
      return JSON.stringify({ message: 'Scratch tools completed', actions: [] });
    }
  };
  const runtime = new VectraDeepAgentRuntime({
    provider,
    model: 'local-test',
    context: {},
    tools: [],
    events,
    maxSteps: 8
  });
  const result = await runtime.run({ task: 'Plan and use scratch storage' });
  assert.match(result.text, /Scratch tools completed/);
  assert.ok(started.includes('write_todos'));
  assert.ok(started.includes('write_file'));
  assert.ok(started.includes('read_file'));
  for (const name of ['write_todos', 'ls', 'read_file', 'write_file', 'edit_file', 'delete', 'glob', 'grep', 'task']) {
    assert.ok(boundNames.includes(name), `expected ${name} to be bound`);
  }
  assert.ok(!boundNames.includes('execute'), 'StateBackend must not expose sandbox execution');
  assert.equal(result.state.files['/notes.txt'].content, 'Vectra scratch integration');
  assert.equal(result.state.todos[0].content, 'Use scratch storage');
});

test('shared tool catalog and factories serve extension and web adapters', async () => {
  assert.ok(VECTRA_TOOL_DEFINITIONS.some((item) => item.name === 'read_file'));
  assert.ok(VECTRA_TOOL_DEFINITIONS.some((item) => item.name === 'propose_files' && item.surface === 'all'));
  for (const tool of VECTRA_TOOL_DEFINITIONS) {
    assert.ok(tool.displayName && !tool.displayName.includes('_'), `${tool.name} needs a readable display name`);
  }

  const hostTools = createVectraHostTools(
    VECTRA_TOOL_DEFINITIONS.slice(0, 1),
    (name, input) => ({ name, input })
  );
  assert.equal(hostTools[0].name, 'vectra_workspace_summary');
  assert.deepEqual(await hostTools[0].execute({ path: 'src' }, {}), {
    name: 'workspace_summary',
    input: { path: 'src' }
  });

  const attachments = createAttachmentTools([{ name: 'notes.txt', kind: 'text', text: 'shared text' }]);
  assert.deepEqual(await attachments[1].execute({ name: 'notes.txt' }, {}), {
    name: 'notes.txt', start: 0, end: 11, totalCharacters: 11, hasMore: false, content: 'shared text'
  });
});

// Deep runs are unbounded unless the user opts into an explicit cap; every
// derived budget (12-step default included) ended real work mid-run.
test('the Deep Agents recursion limit is unbounded unless explicitly capped', () => {
  const { resolveRecursionLimit, isRecursionLimitError } = require('../build/core');

  assert.equal(resolveRecursionLimit({ maxSteps: 12 }), Number.MAX_SAFE_INTEGER, 'no explicit cap means unlimited');
  assert.equal(resolveRecursionLimit({ maxSteps: 1 }), Number.MAX_SAFE_INTEGER, 'maxSteps no longer derives a graph budget');

  // An explicit setting is the only thing that caps a run; 0 clears the cap.
  assert.equal(resolveRecursionLimit({ maxSteps: 12, recursionLimit: 400 }), 400);
  assert.equal(resolveRecursionLimit({ maxSteps: 12, recursionLimit: 50 }), 50);
  assert.equal(resolveRecursionLimit({ maxSteps: 12, recursionLimit: 0 }), Number.MAX_SAFE_INTEGER, '0 means unlimited');

  const raw = new Error('Recursion limit of 36 reached without hitting a stop condition.');
  assert.ok(isRecursionLimitError(raw), 'LangGraph\'s message must be recognized even when the error class is lost');
  const typed = new Error('boom');
  typed.name = 'GraphRecursionError';
  assert.ok(isRecursionLimitError(typed));
  assert.equal(isRecursionLimitError(new Error('connection refused')), false);
});

test('a run that exhausts its step budget ends as an answer, not a raw graph error', async () => {
  const { VectraDeepAgentRuntime } = require('../build/core');
  const events = new AgentEventStream();
  const seen = [];
  events.subscribe((event) => seen.push(event.type));

  const runtime = new VectraDeepAgentRuntime({
    provider: { complete: async () => 'unused' },
    model: 'local',
    tools: [],
    context: {},
    events,
    // Two graph steps is far below what any real turn needs, so the harness
    // guard is guaranteed to fire.
    recursionLimit: 8
  });
  // Replace the compiled graph with one that only ever raises LangGraph's guard.
  const failure = new Error('Recursion limit of 8 reached without hitting a stop condition.');
  failure.name = 'GraphRecursionError';
  runtime.agent = { invoke: async () => { throw failure; } };

  const result = await runtime.run({ task: 'go deeper' });
  assert.equal(result.stopReason, 'recursion-limit');
  assert.doesNotMatch(result.text, /reached without hitting a stop condition|Troubleshooting URL|langchain\.com/i);
  assert.match(result.text, /step budget/i);
  assert.ok(seen.includes('deepagent.completed'), 'the turn must complete rather than fail');
  assert.ok(!seen.includes('deepagent.failed'));
});

// Regression: a model that narrates its next move and calls nothing used to end
// the whole request, handing the user "Let me first read ChatViewProvider…" as
// the final answer. Two prompts in a row produced the same stalled sentence.
test('a narrated-but-uncalled tool is retried instead of ending the request', async () => {
  const { announcesPendingAction } = require('../build/core');
  const sent = [];
  const provider = {
    async completeWithTools(request) {
      sent.push(request.messages.at(-1));
      return sent.length === 1
        ? { text: "I'll help you add the feature. Let me first read ChatViewProvider to understand the layout.", toolCalls: [] }
        : { text: 'Reading it now.', toolCalls: [{ id: 'native-1', name: 'echo', args: { value: 'ChatViewProvider.ts' } }] };
    }
  };
  const model = new VectraLangChainChatModel(provider, 'local-test').bindTools([
    tool(async ({ value }) => value, { name: 'echo', description: 'Echo text', schema: z.object({ value: z.string() }) })
  ]);

  const response = await model.invoke([{ role: 'user', content: 'add a line suggestion feature' }]);
  assert.equal(sent.length, 2, 'the stalled turn must be re-asked, not accepted as the answer');
  assert.match(sent[1].content, /called no tool/i);
  assert.equal(response.tool_calls[0].name, 'echo');

  assert.ok(announcesPendingAction("Let me first read ChatViewProvider to understand the current UI."));
  assert.ok(announcesPendingAction("I'll start by checking the button layout."));
  // Real stalls seen in the field: "I need to", a bare "Reading..." opener, and "let me try...".
  assert.ok(announcesPendingAction('I need to read the remaining lines of vlm.py to complete the analysis.'));
  assert.ok(announcesPendingAction('Reading the remaining lines of vlm.py to complete the analysis'));
  assert.ok(announcesPendingAction('Let me try a different approach to access it.'));
  assert.equal(announcesPendingAction('The suggestion provider lives in ChatViewProvider.ts and registers on activation.'), false);
  assert.equal(announcesPendingAction(''), false);
});

test('a genuine final answer is never re-asked into an unnecessary tool call', async () => {
  let calls = 0;
  const provider = {
    async completeWithTools() {
      calls++;
      return { text: 'ChatViewProvider.ts registers the webview and owns the button row.', toolCalls: [] };
    }
  };
  const model = new VectraLangChainChatModel(provider, 'local-test').bindTools([
    tool(async ({ value }) => value, { name: 'echo', description: 'Echo text', schema: z.object({ value: z.string() }) })
  ]);
  const response = await model.invoke([{ role: 'user', content: 'where is the button row?' }]);
  assert.equal(calls, 1);
  assert.match(response.content, /ChatViewProvider\.ts/);
});

// Regression: when the closing turn came back empty (a local model whose whole
// reply was internal reasoning, or one cut off mid-<think>), the final answer
// used to be scavenged from a mid-run narration written before the tool ran.
test('an empty closing turn is answered from the run, not from a stale narration', async () => {
  const { VectraDeepAgentRuntime } = require('../build/core');
  const events = new AgentEventStream();
  const seen = [];
  events.subscribe((event) => seen.push(event.type));

  let closingPrompt = '';
  const runtime = new VectraDeepAgentRuntime({
    provider: {
      async complete(request) {
        closingPrompt = request.userPrompt;
        return 'ChatViewProvider.ts holds the button row; the suggestion provider would register beside it.';
      }
    },
    model: 'local',
    tools: [],
    context: {},
    events
  });
  const message = (type, content, name) => ({ content, name, getType: () => type });
  runtime.agent = {
    invoke: async () => ({
      messages: [
        message('human', 'add a line suggestion feature'),
        message('ai', 'Reading ChatViewProvider to understand current button layout'),
        message('tool', 'export class ChatViewProvider { /* button row */ }', 'vectra_read_file'),
        message('ai', '')
      ]
    })
  };

  const result = await runtime.run({ task: 'add a line suggestion feature' });
  assert.doesNotMatch(result.text, /^Reading ChatViewProvider/, 'a mid-run narration is not an answer');
  assert.match(result.text, /button row/);
  assert.match(closingPrompt, /vectra_read_file/, 'the closing answer must be grounded in the real tool output');
  assert.ok(seen.includes('deepagent.closing_answer.requested'));
});

test('a real closing answer is used as-is, with no extra model call', async () => {
  const { VectraDeepAgentRuntime } = require('../build/core');
  let completions = 0;
  const runtime = new VectraDeepAgentRuntime({
    provider: { async complete() { completions++; return 'unused'; } },
    model: 'local',
    tools: [],
    context: {}
  });
  const message = (type, content) => ({ content, getType: () => type });
  runtime.agent = {
    invoke: async () => ({
      messages: [
        message('human', 'add a line suggestion feature'),
        message('ai', 'Reading ChatViewProvider'),
        message('tool', 'file contents'),
        message('ai', 'I registered an InlineCompletionItemProvider in extension.ts.')
      ]
    })
  };
  const result = await runtime.run({ task: 'add a line suggestion feature' });
  assert.equal(result.text, 'I registered an InlineCompletionItemProvider in extension.ts.');
  assert.equal(completions, 0);
});

// Regression suite for the "announce and stop" failure: the model narrated its
// next action ("Let me first read the ChatViewProvider…"), called no tool,
// LangGraph ended the run, and the user received the narration as the answer.
test('a narrated-but-uncalled action is re-asked once and turns into a real tool call', async () => {
  const prompts = [];
  const provider = {
    async complete(request) {
      prompts.push(request.userPrompt);
      // First turn stalls; the nudged retry actually calls the tool.
      if (prompts.length === 1) {
        return JSON.stringify({ message: "I'll help you add that. Let me first read the ChatViewProvider to understand the current UI structure.", actions: [] });
      }
      return JSON.stringify({ message: 'Reading it now.', actions: [{ type: 'echo', value: 'ChatViewProvider.ts' }] });
    }
  };
  const model = new VectraLangChainChatModel(provider, 'local-test').bindTools([
    tool(async ({ value }) => value, { name: 'echo', description: 'Echo text', schema: z.object({ value: z.string() }) })
  ]);
  const response = await model.invoke([{ role: 'user', content: 'add a line suggestion feature' }]);
  assert.equal(prompts.length, 2, 'the stalled turn must be retried exactly once');
  assert.match(prompts[1], /called no tool, so nothing happened/i, 'the retry must carry the act-or-answer instruction');
  assert.equal(response.tool_calls[0].name, 'echo');
});

test('a complete answer with no pending-action narration is never re-asked', async () => {
  let calls = 0;
  const provider = {
    async complete() {
      calls++;
      return JSON.stringify({ message: 'The button lives in media/main.js; add a new .mode control beside Ask and Agent.', actions: [] });
    }
  };
  const model = new VectraLangChainChatModel(provider, 'local-test').bindTools([
    tool(async ({ value }) => value, { name: 'echo', description: 'Echo text', schema: z.object({ value: z.string() }) })
  ]);
  const response = await model.invoke([{ role: 'user', content: 'where is the button defined?' }]);
  assert.equal(calls, 1, 'a real answer must not trigger the stall retry');
  assert.equal(response.tool_calls.length, 0);
});

test('an empty closing turn is answered from the run transcript, never from a stale narration', async () => {
  const { HumanMessage, AIMessage, ToolMessage } = require('@langchain/core/messages');
  const completions = [];
  const runtime = new VectraDeepAgentRuntime({
    provider: {
      async complete(request) {
        completions.push(request);
        return 'I inspected ChatViewProvider.ts; the mode buttons are declared in media/main.js.';
      }
    },
    model: 'local-test',
    tools: [],
    context: {}
  });
  // The graph finished, but its closing AI turn is empty (the model's whole
  // reply was internal reasoning). The mid-run narration must not be reused.
  runtime.agent = {
    invoke: async () => ({
      messages: [
        new HumanMessage('how do the buttons work?'),
        new AIMessage({ content: 'Reading ChatViewProvider to understand current button layout and UI structure', tool_calls: [{ id: 't1', name: 'vectra_read_file', args: {}, type: 'tool_call' }] }),
        new ToolMessage({ content: 'file contents…', tool_call_id: 't1', name: 'vectra_read_file' }),
        new AIMessage('')
      ]
    })
  };
  const result = await runtime.run({ task: 'how do the buttons work?' });
  assert.equal(completions.length, 1, 'the runtime must request one closing answer');
  assert.match(completions[0].userPrompt, /WORK COMPLETED THIS RUN/);
  assert.equal(result.text, 'I inspected ChatViewProvider.ts; the mode buttons are declared in media/main.js.');
  assert.notEqual(result.text, 'Reading ChatViewProvider to understand current button layout and UI structure');
});

test('assistant prose written after the last tool result is the answer, with no extra model call', async () => {
  const { HumanMessage, AIMessage, ToolMessage } = require('@langchain/core/messages');
  let extraCalls = 0;
  const runtime = new VectraDeepAgentRuntime({
    provider: { async complete() { extraCalls++; return 'unused'; } },
    model: 'local-test',
    tools: [],
    context: {}
  });
  runtime.agent = {
    invoke: async () => ({
      messages: [
        new HumanMessage('how do the buttons work?'),
        new AIMessage({ content: 'Reading the file', tool_calls: [{ id: 't1', name: 'vectra_read_file', args: {}, type: 'tool_call' }] }),
        new ToolMessage({ content: 'file contents…', tool_call_id: 't1', name: 'vectra_read_file' }),
        new AIMessage('The mode buttons are plain .mode controls wired in media/main.js.')
      ]
    })
  };
  const result = await runtime.run({ task: 'how do the buttons work?' });
  assert.equal(result.text, 'The mode buttons are plain .mode controls wired in media/main.js.');
  assert.equal(extraCalls, 0, 'a normal run must not pay for a closing-answer completion');
});

// Regression suite for "I'm encountering tool errors when trying to read
// files": in discovery mode a model that guessed a direct capability name
// (vectra_read_file) hit LangGraph's unknown-tool error and spiralled until a
// guard killed the run with a raw error string.
test('a guessed direct capability name is rerouted through vectra_invoke_tool (native tool calling)', async () => {
  const provider = {
    async complete() { throw new Error('fallback path must not be used'); },
    async completeWithTools() {
      return { text: 'Reading the file.', toolCalls: [{ id: 'n1', name: 'vectra_read_file', args: { path: 'package.json' } }] };
    }
  };
  const model = new VectraLangChainChatModel(provider, 'local-test').bindTools([
    tool(async () => 'ok', { name: 'vectra_search_tools', description: 'search', schema: z.object({ query: z.string() }) }),
    tool(async () => 'ok', { name: 'vectra_invoke_tool', description: 'invoke', schema: z.object({ name: z.string() }) })
  ]);
  const response = await model.invoke([{ role: 'user', content: 'analyze package.json' }]);
  assert.equal(response.tool_calls[0].name, 'vectra_invoke_tool');
  assert.deepEqual(response.tool_calls[0].args, { name: 'read_file', arguments: { path: 'package.json' } });
});

test('a guessed capability in a JSON action envelope is rerouted instead of silently dropped', async () => {
  const provider = {
    async complete() {
      return JSON.stringify({ message: 'Reading it.', actions: [{ type: 'read_file', path: 'package.json' }] });
    }
  };
  const model = new VectraLangChainChatModel(provider, 'local-test').bindTools([
    tool(async () => 'ok', { name: 'vectra_search_tools', description: 'search', schema: z.object({ query: z.string() }) }),
    tool(async () => 'ok', { name: 'vectra_invoke_tool', description: 'invoke', schema: z.object({ name: z.string() }) })
  ]);
  const response = await model.invoke([{ role: 'user', content: 'analyze package.json' }]);
  assert.equal(response.tool_calls.length, 1, 'the guessed action must not be dropped');
  assert.equal(response.tool_calls[0].name, 'vectra_invoke_tool');
  assert.deepEqual(response.tool_calls[0].args, { name: 'read_file', arguments: { path: 'package.json' } });
});

test('the identical-tool-call guard ends the run as an explanation, not a raw error', async () => {
  const events = new AgentEventStream();
  const seen = [];
  events.subscribe((event) => seen.push(event.type));
  const runtime = new VectraDeepAgentRuntime({
    provider: { async complete() { return 'unused'; } },
    model: 'local-test',
    tools: [],
    context: {},
    events
  });
  runtime.agent = {
    invoke: async () => {
      throw new Error('REPEATED_TOOL_LOOP: The model called the same tool with identical arguments 3 times.');
    }
  };
  const result = await runtime.run({ task: 'analyze the project' });
  assert.equal(result.stopReason, 'tool-loop');
  assert.doesNotMatch(result.text, /REPEATED_TOOL_LOOP/);
  assert.match(result.text, /same tool with the same arguments/i);
  assert.ok(seen.includes('deepagent.completed'));
  assert.ok(!seen.includes('deepagent.failed'));
});
