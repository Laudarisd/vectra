/** Deep Agents 1.13.x middleware tools made explicit for Vectra hosts. */
export type DeepAgentToolFamily = 'planning' | 'scratch-filesystem' | 'delegation' | 'async-delegation';
export type DeepAgentToolAvailability = 'default' | 'sandbox-backend' | 'async-subagent';

export interface DeepAgentBuiltinToolDefinition {
  name: string;
  displayName: string;
  family: DeepAgentToolFamily;
  availability: DeepAgentToolAvailability;
  description: string;
}

export const DEEP_AGENT_FILESYSTEM_TOOL_NAMES = [
  'ls', 'read_file', 'write_file', 'edit_file', 'delete', 'glob', 'grep', 'execute'
] as const;

export const DEEP_AGENT_ASYNC_TOOL_NAMES = [
  'start_async_task', 'check_async_task', 'update_async_task', 'cancel_async_task', 'list_async_tasks'
] as const;

export const DEEP_AGENT_BUILTIN_TOOL_DEFINITIONS = [
  { name: 'write_todos', displayName: 'Update Deep Agent Checklist', family: 'planning', availability: 'default', description: 'Replace the agent planning todo list.' },
  { name: 'ls', displayName: 'List Scratch Files', family: 'scratch-filesystem', availability: 'default', description: 'List files in Deep Agents scratch storage.' },
  { name: 'read_file', displayName: 'Read Scratch File', family: 'scratch-filesystem', availability: 'default', description: 'Read a file from Deep Agents scratch storage.' },
  { name: 'write_file', displayName: 'Write Scratch File', family: 'scratch-filesystem', availability: 'default', description: 'Write a file to Deep Agents scratch storage.' },
  { name: 'edit_file', displayName: 'Edit Scratch File', family: 'scratch-filesystem', availability: 'default', description: 'Edit a file in Deep Agents scratch storage.' },
  { name: 'delete', displayName: 'Delete Scratch File', family: 'scratch-filesystem', availability: 'default', description: 'Delete a file from Deep Agents scratch storage.' },
  { name: 'glob', displayName: 'Find Scratch Files', family: 'scratch-filesystem', availability: 'default', description: 'Find scratch files by glob pattern.' },
  { name: 'grep', displayName: 'Search Scratch Files', family: 'scratch-filesystem', availability: 'default', description: 'Search content in Deep Agents scratch files.' },
  { name: 'execute', displayName: 'Run Sandbox Command', family: 'scratch-filesystem', availability: 'sandbox-backend', description: 'Execute a command through an execution-capable sandbox backend.' },
  { name: 'task', displayName: 'Delegate Synchronous Task', family: 'delegation', availability: 'default', description: 'Delegate a synchronous task to a configured subagent.' },
  { name: 'start_async_task', displayName: 'Start Background Task', family: 'async-delegation', availability: 'async-subagent', description: 'Start a remote asynchronous subagent task.' },
  { name: 'check_async_task', displayName: 'Check Background Task', family: 'async-delegation', availability: 'async-subagent', description: 'Check an asynchronous task status and result.' },
  { name: 'update_async_task', displayName: 'Update Background Task', family: 'async-delegation', availability: 'async-subagent', description: 'Send updated instructions to an asynchronous task.' },
  { name: 'cancel_async_task', displayName: 'Cancel Background Task', family: 'async-delegation', availability: 'async-subagent', description: 'Cancel an asynchronous task.' },
  { name: 'list_async_tasks', displayName: 'List Background Tasks', family: 'async-delegation', availability: 'async-subagent', description: 'List tracked asynchronous tasks and statuses.' }
] as const satisfies readonly DeepAgentBuiltinToolDefinition[];

export const DEEP_AGENT_BUILTIN_TOOL_NAMES = DEEP_AGENT_BUILTIN_TOOL_DEFINITIONS.map((tool) => tool.name);

/** Compatibility action name used by Vectra text/JSON providers. */
export function deepAgentActionName(name: string): string {
  return `deep_${name}`;
}

export const DEEP_AGENT_ACTION_TOOL_NAMES = DEEP_AGENT_BUILTIN_TOOL_NAMES.map(deepAgentActionName);

export function describeDeepAgentTool(name: string): string {
  const definition = DEEP_AGENT_BUILTIN_TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) return `Using ${name}...`;
  switch (definition.family) {
    case 'planning': return 'Updating the working plan...';
    case 'scratch-filesystem': return name === 'execute' ? 'Running a sandbox command...' : `${definition.displayName}...`;
    case 'delegation': return 'Delegating a focused subtask...';
    case 'async-delegation': return `Managing an asynchronous task: ${name}...`;
  }
}
