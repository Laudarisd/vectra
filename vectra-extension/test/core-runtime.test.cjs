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
  assert.throws(() => invoke.execute({ name: 'create_directory', arguments: { path: 'education' } }, {}), /Search/);
  const found = await search.execute({ query: 'create a folder' }, {});
  assert.ok(found.tools.some((item) => item.name === 'create_directory'));
  assert.equal(await invoke.execute({ name: 'create_directory', arguments: { path: 'education' } }, {}), 'ok');
  assert.deepEqual(calls, [{ name: 'create_directory', input: { path: 'education' } }]);
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
