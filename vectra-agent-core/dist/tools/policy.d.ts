export declare const VECTRA_WRITE_OR_EXECUTE_TOOL_NAMES: Set<"workspace_summary" | "list_directory" | "list_files" | "read_file" | "read_files" | "read_document" | "inspect_file" | "search_text" | "get_diagnostics" | "git_status" | "git_diff" | "create_file" | "propose_file" | "propose_files" | "replace_lines" | "delete_lines" | "insert_lines" | "create_document" | "edit_document" | "delete_file" | "create_directory" | "rename_path" | "move_path" | "copy_path" | "delete_directory" | "run_file" | "run_project" | "run_command" | "run_tests" | "todo_write" | "propose_plan" | "web_search" | "web_fetch" | "delegate_task">;
export declare const VECTRA_SUBAGENT_DENIED_TOOL_NAMES: Set<string>;
/** Shared progress wording used by every host. The playful style is a product
 * feature, while the exact path/count keeps each live step understandable. */
export declare function describeVectraTool(name: string, input?: Record<string, unknown>): string;
//# sourceMappingURL=policy.d.ts.map