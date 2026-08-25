import { VectraToolDefinition } from './contracts';

/** Canonical metadata for real Vectra host capabilities used by every UI. */
export const VECTRA_TOOL_DEFINITIONS = [
  tool('workspace_summary', 'Workspace Summary', 'Count and summarize a workspace or subdirectory.', 'read'),
  tool('list_directory', 'List Directory', 'Recursively list files and directories with bounded depth.', 'read'),
  tool('list_files', 'Find Files', 'Find workspace files using a glob.', 'read'),
  tool('read_file', 'Read File', 'Read a line-numbered window from one text file.', 'read'),
  tool('read_files', 'Read Multiple Files', 'Read up to 20 related text files in one call.', 'read'),
  tool('read_document', 'Read Document', 'Extract text from PDF, DOCX, PPTX, XLSX, or RTF.', 'read'),
  tool('inspect_file', 'Inspect Visual File', 'Attach an image or visual document for model inspection.', 'read'),
  tool('search_text', 'Search Workspace Text', 'Search text across bounded workspace files.', 'read'),
  tool('get_diagnostics', 'Editor Diagnostics', 'Read editor errors and warnings.', 'read'),
  tool('git_status', 'Git Status', 'Read Git branch and working-tree status.', 'read'),
  tool('git_diff', 'Git Diff', 'Read a Git diff.', 'read'),
  tool('create_file', 'Create File', 'Prepare one complete new text/code file for review.', 'write'),
  tool('propose_file', 'Propose File Change', 'Prepare one complete new or replacement file for review.', 'write'),
  tool('propose_files', 'Propose Multiple Files', 'Prepare a coherent batch of complete files for review.', 'write'),
  tool('replace_lines', 'Replace Lines', 'Prepare a focused line replacement for review.', 'write'),
  tool('delete_lines', 'Delete Lines', 'Prepare a focused line deletion for review.', 'write'),
  tool('insert_lines', 'Insert Lines', 'Prepare a focused line insertion for review.', 'write'),
  tool('create_document', 'Create Document', 'Prepare a generated PDF or DOCX for review.', 'write', 'all'),
  tool('edit_document', 'Edit Document', 'Prepare a replacement PDF or DOCX for review.', 'write'),
  tool('delete_file', 'Delete File', 'Prepare a file deletion for review.', 'write'),
  tool('create_directory', 'Create Directory', 'Create an empty workspace directory after confirmation.', 'write'),
  tool('rename_path', 'Rename File or Directory', 'Rename one workspace file or directory after confirmation.', 'write'),
  tool('move_path', 'Move File or Directory', 'Move one workspace file or directory after confirmation.', 'write'),
  tool('copy_path', 'Copy File or Directory', 'Copy one workspace file or directory after confirmation.', 'write'),
  tool('delete_directory', 'Delete Directory', 'Delete an empty or explicitly recursive workspace directory after confirmation.', 'write'),
  tool('run_file', 'Run Source File', 'Request approval to run a source file.', 'execute'),
  tool('run_project', 'Run Project', 'Request approval to run an auto-detected project.', 'execute'),
  tool('run_command', 'Run Command', 'Request approval to run an explicit command.', 'execute'),
  tool('run_tests', 'Run Tests', 'Request approval to run tests.', 'execute'),
  tool('todo_write', 'Update Task Checklist', 'Create or update a live checklist.', 'coordination', 'all'),
  tool('propose_plan', 'Propose Plan', 'Propose a plan for user approval before writes or execution.', 'coordination'),
  tool('web_search', 'Search the Web', 'Search the public web through Vectra network policy.', 'network'),
  tool('web_fetch', 'Fetch Web Page', 'Fetch readable text from a public URL through Vectra network policy.', 'network'),
  tool('delegate_task', 'Delegate Task', 'Delegate an isolated exploration task.', 'coordination', 'all')
] as const;

function tool<TName extends string>(
  name: TName,
  displayName: string,
  description: string,
  risk: VectraToolDefinition['risk'],
  surface: VectraToolDefinition['surface'] = 'extension'
): VectraToolDefinition<TName> {
  return { name, displayName, description, risk, surface };
}
