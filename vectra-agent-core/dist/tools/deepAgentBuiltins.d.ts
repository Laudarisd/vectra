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
export declare const DEEP_AGENT_FILESYSTEM_TOOL_NAMES: readonly ["ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "execute"];
export declare const DEEP_AGENT_ASYNC_TOOL_NAMES: readonly ["start_async_task", "check_async_task", "update_async_task", "cancel_async_task", "list_async_tasks"];
export declare const DEEP_AGENT_BUILTIN_TOOL_DEFINITIONS: readonly [{
    readonly name: "write_todos";
    readonly displayName: "Update Deep Agent Checklist";
    readonly family: "planning";
    readonly availability: "default";
    readonly description: "Replace the agent planning todo list.";
}, {
    readonly name: "ls";
    readonly displayName: "List Scratch Files";
    readonly family: "scratch-filesystem";
    readonly availability: "default";
    readonly description: "List files in Deep Agents scratch storage.";
}, {
    readonly name: "read_file";
    readonly displayName: "Read Scratch File";
    readonly family: "scratch-filesystem";
    readonly availability: "default";
    readonly description: "Read a file from Deep Agents scratch storage.";
}, {
    readonly name: "write_file";
    readonly displayName: "Write Scratch File";
    readonly family: "scratch-filesystem";
    readonly availability: "default";
    readonly description: "Write a file to Deep Agents scratch storage.";
}, {
    readonly name: "edit_file";
    readonly displayName: "Edit Scratch File";
    readonly family: "scratch-filesystem";
    readonly availability: "default";
    readonly description: "Edit a file in Deep Agents scratch storage.";
}, {
    readonly name: "delete";
    readonly displayName: "Delete Scratch File";
    readonly family: "scratch-filesystem";
    readonly availability: "default";
    readonly description: "Delete a file from Deep Agents scratch storage.";
}, {
    readonly name: "glob";
    readonly displayName: "Find Scratch Files";
    readonly family: "scratch-filesystem";
    readonly availability: "default";
    readonly description: "Find scratch files by glob pattern.";
}, {
    readonly name: "grep";
    readonly displayName: "Search Scratch Files";
    readonly family: "scratch-filesystem";
    readonly availability: "default";
    readonly description: "Search content in Deep Agents scratch files.";
}, {
    readonly name: "execute";
    readonly displayName: "Run Sandbox Command";
    readonly family: "scratch-filesystem";
    readonly availability: "sandbox-backend";
    readonly description: "Execute a command through an execution-capable sandbox backend.";
}, {
    readonly name: "task";
    readonly displayName: "Delegate Synchronous Task";
    readonly family: "delegation";
    readonly availability: "default";
    readonly description: "Delegate a synchronous task to a configured subagent.";
}, {
    readonly name: "start_async_task";
    readonly displayName: "Start Background Task";
    readonly family: "async-delegation";
    readonly availability: "async-subagent";
    readonly description: "Start a remote asynchronous subagent task.";
}, {
    readonly name: "check_async_task";
    readonly displayName: "Check Background Task";
    readonly family: "async-delegation";
    readonly availability: "async-subagent";
    readonly description: "Check an asynchronous task status and result.";
}, {
    readonly name: "update_async_task";
    readonly displayName: "Update Background Task";
    readonly family: "async-delegation";
    readonly availability: "async-subagent";
    readonly description: "Send updated instructions to an asynchronous task.";
}, {
    readonly name: "cancel_async_task";
    readonly displayName: "Cancel Background Task";
    readonly family: "async-delegation";
    readonly availability: "async-subagent";
    readonly description: "Cancel an asynchronous task.";
}, {
    readonly name: "list_async_tasks";
    readonly displayName: "List Background Tasks";
    readonly family: "async-delegation";
    readonly availability: "async-subagent";
    readonly description: "List tracked asynchronous tasks and statuses.";
}];
export declare const DEEP_AGENT_BUILTIN_TOOL_NAMES: ("execute" | "read_file" | "ls" | "write_file" | "edit_file" | "delete" | "glob" | "grep" | "start_async_task" | "check_async_task" | "update_async_task" | "cancel_async_task" | "list_async_tasks" | "write_todos" | "task")[];
/** Compatibility action name used by Vectra text/JSON providers. */
export declare function deepAgentActionName(name: string): string;
export declare const DEEP_AGENT_ACTION_TOOL_NAMES: string[];
export declare function describeDeepAgentTool(name: string): string;
//# sourceMappingURL=deepAgentBuiltins.d.ts.map