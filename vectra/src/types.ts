export type AgentMode = 'agent' | 'ask' | 'selection';
export type ProviderId = 'llamaCpp' | 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'openaiCompatible';
export type SupportedDocumentFormat = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'rtf';
export type WritableDocumentFormat = 'pdf' | 'docx';

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'text' | 'image' | 'pdf' | 'document' | 'binary';
  source?: 'picker' | 'workspace';
  path?: string;
  text?: string;
  base64?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  mode?: AgentMode;
  attachments?: Array<Pick<Attachment, 'id' | 'name' | 'mime' | 'size' | 'kind'>>;
}

export interface ModelInfo { id: string; label?: string; detail?: string }
/**
 * `structured` defaults to true. Set it to false for conversational turns so
 * providers that can pin a JSON schema return natural prose instead.
 */
export interface ProviderRequest { systemPrompt: string; userPrompt: string; model: string; attachments?: Attachment[]; structured?: boolean; signal?: AbortSignal; onDelta?: (delta: string) => void }
export interface TextProvider { readonly id: ProviderId; complete(request: ProviderRequest): Promise<string>; listModels(signal?: AbortSignal): Promise<ModelInfo[]>; testConnection(signal?: AbortSignal): Promise<string> }

/** A complete file included in one reviewed, multi-file proposal batch. */
export interface ProposedFileInput {
  path: string;
  content: string;
  reason?: string;
}

export type AgentAction =
  | { type: 'workspace_summary'; path?: string }
  | { type: 'list_directory'; path?: string; maxResults?: number; maxDepth?: number }
  | { type: 'list_files'; path?: string; glob?: string; maxResults?: number }
  | { type: 'read_file'; path: string; startLine?: number; endLine?: number }
  | { type: 'read_files'; paths: string[]; startLine?: number; endLine?: number }
  | { type: 'read_document'; path: string }
  | { type: 'inspect_file'; path: string }
  | { type: 'search_text'; query: string; path?: string; glob?: string; maxResults?: number; caseSensitive?: boolean }
  | { type: 'get_diagnostics'; path?: string }
  | { type: 'git_status' }
  | { type: 'git_diff'; path?: string; staged?: boolean }
  | { type: 'create_file'; path: string; content: string; reason?: string }
  | { type: 'propose_file'; path: string; content: string; reason?: string }
  | { type: 'propose_files'; files: ProposedFileInput[]; reason?: string }
  | { type: 'replace_lines'; path: string; startLine: number; endLine: number; content: string; reason?: string }
  | { type: 'delete_lines'; path: string; startLine: number; endLine: number; reason?: string }
  | { type: 'insert_lines'; path: string; line: number; content: string; position?: 'before' | 'after'; reason?: string }
  | { type: 'create_document'; path: string; content: string; title?: string; reason?: string }
  | { type: 'edit_document'; path: string; content: string; title?: string; reason?: string }
  | { type: 'delete_file'; path: string; reason?: string }
  | { type: 'run_file'; path: string; args?: string[]; timeoutMs?: number; reason?: string }
  | { type: 'run_project'; path?: string; timeoutMs?: number; reason?: string }
  | { type: 'run_command'; command: string; cwd?: string; timeoutMs?: number; reason?: string }
  | { type: 'run_tests'; command?: string; cwd?: string; timeoutMs?: number; reason?: string };

export interface AgentEnvelope { message: string; actions: AgentAction[]; done: boolean }
export type ProposalKind = 'modify' | 'create' | 'delete';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale' | 'undone';

export interface EditProposal {
  id: string;
  path: string;
  reason: string;
  kind: ProposalKind;
  baseContent: string;
  proposedContent: string;
  baseHash: string;
  createdAt: number;
  status: ProposalStatus;
  contentType?: 'text' | 'document' | 'binary';
  documentFormat?: SupportedDocumentFormat;
  binaryOutputBase64?: string;
}

export interface AgentRunRequest { mode: AgentMode; userText: string; history: ChatMessage[]; attachments?: Attachment[]; onProgress?: (message: string) => void; onDelta?: (delta: string) => void; signal?: AbortSignal }
export interface AgentRunResult { text: string; proposals: EditProposal[] }
export interface WorkspaceContext { workspaceFolders: string[]; workspaceOverview?: string; activeFile?: string; activeLanguage?: string; activeFileContent?: string; selectionText?: string; selectionStartLine?: number; selectionEndLine?: number; openFiles: string[]; diagnostics: string[]; projectInstructions?: string }
