// Beginner guide: Handles s ub ag en ts responsibilities for Vectra.
import { VectraDeepTool, VectraHostToolExecutor, VectraToolDefinition, VectraToolRisk } from './contracts';
import { createVectraDiscoveryTools, createVectraHostTools } from './deepTools';

export type VectraSubagentRoleName =
  | 'planner'
  | 'researcher'
  | 'coder'
  | 'tester'
  | 'reviewer'
  | 'security'
  | 'documentation';

export interface VectraSubagentRole {
  name: VectraSubagentRoleName;
  description: string;
  systemPrompt: string;
  /** Tool risk levels this role may use. Coordination-risk tools and delegate_task
   * are always excluded regardless of this list -- see buildVectraSubagentSpecs. */
  allowedRisk: readonly VectraToolRisk[];
}

/** Vectra's specialized subagent team, per TASKS.md "advanced agent teams". */
export const VECTRA_SUBAGENT_ROLES: readonly VectraSubagentRole[] = [
  {
    name: 'planner',
    description: 'Breaks a complex task into a concrete, ordered set of steps before work begins. Read-only: reports a plan back as text.',
    systemPrompt: "You are Vectra's planning specialist. Investigate the workspace with the tools you have, then return a clear, ordered breakdown of the steps needed to complete the task. You cannot write files, run commands, or delegate further -- report your plan as text for the orchestrating agent to act on.",
    allowedRisk: ['read', 'network']
  },
  {
    name: 'researcher',
    description: 'Explores code, uploaded documents, and the web to gather grounded context. Can analyze an assigned batch of PDFs/drawings and report source-specific findings.',
    systemPrompt: "You are Vectra's research and document-analysis specialist. For uploaded PDFs/documents, use vectra_list_attachments, vectra_search_attachments, vectra_read_attachment, or vectra_read_files; never use scratch filesystem tools for uploads. Analyze only the files/batch assigned to you, retain filenames/page evidence, and return a focused grounded report for the orchestrating agent to synthesize. For workspace or web research, use the relevant Vectra tools. You cannot write files, run commands, or delegate further.",
    allowedRisk: ['read', 'network']
  },
  {
    name: 'coder',
    description: 'Implements file changes for a well-scoped task. Can read and propose reviewed file writes; cannot run commands or delegate.',
    systemPrompt: "You are Vectra's implementation specialist. Read whatever context you need, then propose the file changes that complete the task using Vectra's reviewed write tools. Every write you propose still requires the user's approval before it is applied -- you are preparing changes, not applying them directly. You cannot run commands or delegate further.",
    allowedRisk: ['read', 'write']
  },
  {
    name: 'tester',
    description: 'Runs tests and commands to verify behavior. Can read and request approval to execute; cannot write files or delegate.',
    systemPrompt: "You are Vectra's verification specialist. Read whatever context you need, then request approval to run the relevant tests or commands and report the real result. You cannot write files or delegate further.",
    allowedRisk: ['read', 'execute']
  },
  {
    name: 'reviewer',
    description: 'Reviews existing code, diffs, and diagnostics for correctness and quality. Strictly read-only.',
    systemPrompt: "You are Vectra's code review specialist. Read the relevant files, diffs, and diagnostics, then report concrete, evidence-backed findings with file and line references. You cannot write files, run commands, or delegate further.",
    allowedRisk: ['read']
  },
  {
    name: 'security',
    description: 'Reviews code and dependencies for security issues. Read-only, may consult public sources.',
    systemPrompt: "You are Vectra's security review specialist. Read the relevant files and, when useful, check public sources for known issues, then report concrete, evidence-backed security findings with file and line references. You cannot write files, run commands, or delegate further.",
    allowedRisk: ['read', 'network']
  },
  {
    name: 'documentation',
    description: 'Writes and updates documentation. Can read and propose reviewed file writes; cannot run commands or delegate.',
    systemPrompt: "You are Vectra's documentation specialist. Read whatever context you need, then propose documentation file changes using Vectra's reviewed write tools. Every write you propose still requires the user's approval before it is applied. You cannot run commands or delegate further.",
    allowedRisk: ['read', 'write']
  }
] as const;

/** A role's compiled tool set, still in Vectra's host-neutral shape. Converted to
 * LangChain subagents by VectraDeepAgentRuntime, the one file that owns that boundary. */
export interface VectraSubagentSpec<TContext = unknown> {
  name: VectraSubagentRoleName;
  description: string;
  systemPrompt: string;
  tools: VectraDeepTool<TContext>[];
}

/**
 * Builds one subagent spec per Vectra role, each with its own tool subset
 * drawn strictly from `definitions` filtered by the role's allowed risk
 * levels. Coordination-risk tools (todo_write, propose_plan) and
 * delegate_task are never included for any role -- subagents report back to
 * the orchestrator, which alone owns plan/todo/delegation state.
 *
 * Tools are built fresh per role (not shared) so role isolation holds even
 * through vectra_invoke_tool: its dispatcher only ever knows the definitions
 * it was constructed with, so e.g. a reviewer's vectra_invoke_tool cannot
 * resolve propose_file -- it was never in its closure's lookup map.
 *
 * Pass an already-gated `execute` (e.g. wrapped with a concurrency semaphore)
 * if callers want to throttle subagent-originated tool calls; this function
 * has no concurrency concerns of its own.
 */
export function buildVectraSubagentSpecs<TContext>(
  definitions: readonly VectraToolDefinition[],
  execute: VectraHostToolExecutor<TContext>,
  completeWithTools: boolean
): VectraSubagentSpec<TContext>[] {
  const eligible = definitions.filter((item) => item.risk !== 'coordination' && item.name !== 'delegate_task');
  return VECTRA_SUBAGENT_ROLES.map((role) => {
    const roleDefinitions = eligible.filter((item) => role.allowedRisk.includes(item.risk));
    const tools = completeWithTools
      ? createVectraHostTools(roleDefinitions, execute)
      : createVectraDiscoveryTools(roleDefinitions, execute);
    return { name: role.name, description: role.description, systemPrompt: role.systemPrompt, tools };
  });
}
