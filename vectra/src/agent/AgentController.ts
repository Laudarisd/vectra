import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { AgentMode, AgentRunRequest, AgentRunResult, Attachment, ChatMessage, Plan, TextProvider, TodoItem, WorkspaceContext } from '../types';
import { ProviderManager } from '../providers/ProviderManager';
import { AgentConfiguration, getConfig } from '../utils/config';
import { truncateMiddle, estimateContextCharBudget, safeJson } from '../utils/text';
import { ContextCollector } from '../services/ContextCollector';
import { PatchManager } from '../services/PatchManager';
import { PlanManager } from '../services/PlanManager';
import { TodoManager } from '../services/TodoManager';
import { WebTools } from '../services/WebTools';
import { WorkspaceTools } from '../services/WorkspaceTools';
import { CommandRunner } from '../services/CommandRunner';
import { GitTools } from '../services/GitTools';
import { renderPdfPagesFromBuffer } from '../services/DocumentExtractor';
import { AgentToolRegistry } from './AgentToolRegistry';
import { buildChatSystemPrompt, buildSystemPrompt, parseAgentEnvelope } from './protocol';
import { classifyTurn, formatRecentHistory, isStatusOnlyReply } from './ConversationContext';

const MAX_DELEGATIONS_PER_RUN = 3;

interface RunLoopOptions {
  task: string;
  mode: AgentMode;
  history: ChatMessage[];
  workspaceContext: WorkspaceContext;
  observations: string[];
  mediaAttachments: Attachment[];
  proposalIds: Set<string>;
  maxSteps: number;
  /** True for a delegated sub-run: read-only, no history, no plan/todo involvement, cannot delegate further. */
  subagent: boolean;
  preload: boolean;
  provider: TextProvider;
  config: AgentConfiguration;
  contextCharBudget: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  onTodosChanged?: (todos: TodoItem[]) => void;
  onPlanChanged?: (plan: Plan) => void;
}

/**
 * Runs the model/tool loop for one user request.
 *
 * Unlike the previous single-edit flow, a write no longer ends the request.
 * The model can inspect, prepare a complete multi-file project, read its own
 * pending files through the virtual overlay, refine them, and then return one
 * coherent batch for the user to review.
 */
export class AgentController {
  private readonly toolRegistry: AgentToolRegistry;

  constructor(
    private readonly providers: ProviderManager,
    private readonly contextCollector: ContextCollector,
    tools: WorkspaceTools,
    private readonly patches: PatchManager,
    commands: CommandRunner,
    private readonly todos: TodoManager,
    private readonly plans: PlanManager,
    git: GitTools = new GitTools(),
    web: WebTools = new WebTools()
  ) {
    this.toolRegistry = new AgentToolRegistry(tools, patches, commands, git, todos, plans, web);
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (!vscode.workspace.isTrusted) {
      throw new Error('This workspace is not trusted. Trust it before using Vectra.');
    }

    const config = getConfig();
    if (!config.model) throw new Error('No model selected. Choose API Key or Local Model first.');

    const provider = await this.providers.getProvider();

    // A greeting or a question about Vectra is answered as conversation, before
    // any workspace I/O. Routing small talk through the tool loop is what made
    // it trigger a repository scan and come back as invented tasks or bare
    // status lines.
    const hasAttachments = (request.attachments ?? []).length > 0;
    if (classifyTurn(request.userText, request.mode, hasAttachments) === 'chat') {
      return { text: await this.converse(provider, request, config), proposals: [] };
    }

    const contextCharBudget = effectiveCharBudget(config);

    // A plan approved for a previous task must not silently authorize writes
    // for an unrelated new one — each agent-mode run starts needing its own.
    if (request.mode === 'agent') this.plans.reset();

    const workspaceContext = await this.contextCollector.collect(request.mode);
    const mediaAttachments: Attachment[] = [...(request.attachments ?? [])];
    if (config.provider === 'llamaCpp' && config.llamaCppMmprojPath) {
      await addLocalVisionPdfPages(mediaAttachments);
    }

    // Proposals from an earlier turn stay pending (unwritten) until the user
    // accepts or rejects them in the review panel. Seeding with them here is
    // what lets this run's prompt and final summary stay honest about that
    // state instead of the model guessing from its own past chat claims.
    const proposalIds = new Set<string>(
      this.patches.list().filter((proposal) => proposal.status === 'pending').map((proposal) => proposal.id)
    );

    const message = await this.runLoop({
      task: request.userText,
      mode: request.mode,
      history: request.history,
      workspaceContext,
      observations: [],
      mediaAttachments,
      proposalIds,
      maxSteps: config.maxAgentSteps,
      subagent: false,
      preload: request.mode !== 'selection',
      provider,
      config,
      contextCharBudget,
      signal: request.signal,
      onProgress: request.onProgress,
      onTodosChanged: request.onTodosChanged,
      onPlanChanged: request.onPlanChanged
    });

    return this.finish(message, [...proposalIds]);
  }

  /**
   * The shared step loop. The top-level run() and a delegate_task sub-run both
   * call this — a sub-run passes subagent: true, fresh empty history/
   * observations/proposalIds, an independent (smaller) step budget, and no
   * plan/todo callbacks, so it can never see or mutate the parent's plan or
   * todo state. AgentToolRegistry additionally denies it any write, execution,
   * plan, todo, or further-delegation action regardless of what it requests.
   */
  private async runLoop(opts: RunLoopOptions): Promise<string> {
    const observations = opts.observations;
    const attemptedActions = new Set<string>();
    let duplicateOnlySteps = 0;
    let verificationTurnUsed = false;
    let delegateCallCount = 0;
    let lastMessage = '';

    // Ask and Agent begin with real workspace evidence. This makes a directory
    // question answerable in one user prompt even when a small model forgets to
    // request discovery on its first turn. A sub-run reuses the parent's
    // already-collected workspaceContext instead of preloading again.
    if (opts.preload) {
      opts.onProgress?.("Snoopin' 'round the whole workspace, first peek!…");
      const preload = await this.toolRegistry.execute(
        { type: 'workspace_summary' },
        { mode: opts.mode, mediaAttachments: opts.mediaAttachments, signal: opts.signal, subagent: opts.subagent }
      );
      observations.push(preload.observation);
    }

    for (let step = 1; step <= opts.maxSteps; step++) {
      if (opts.signal?.aborted) throw new Error('Request cancelled.');
      opts.onProgress?.(step === 1 ? "Analyzin' errythin'…" : "Generatin' more stuff…");

      const userPrompt = buildUserPrompt(
        opts.task,
        opts.history,
        opts.workspaceContext,
        observations,
        opts.mediaAttachments,
        this.resolveProposals([...opts.proposalIds]),
        opts.subagent ? [] : this.todos.list(),
        opts.subagent ? undefined : this.plans.get(),
        opts.contextCharBudget
      );

      const raw = await opts.provider.complete({
        systemPrompt: buildSystemPrompt(opts.mode),
        userPrompt,
        model: opts.config.model,
        // Extracted text already lives in userPrompt. Providers only receive
        // native visual/PDF bytes here, avoiding duplicate token-heavy text.
        attachments: providerMediaAttachments(opts.mediaAttachments),
        signal: opts.signal
      });
      const envelope = parseAgentEnvelope(raw);
      lastMessage = envelope.message || lastMessage;

      if (!envelope.actions.length) {
        opts.onProgress?.("Wrappin' it all up…");
        const answer = envelope.message || lastMessage;

        // A model can skip tools entirely and just narrate success in prose.
        // There is no create_directory action at all, so any "created a
        // folder" claim reaching here is fabricated by definition. Give it
        // one real chance to back the claim with an actual action, or retract
        // it, instead of forwarding an assertion nothing supports.
        if (
          opts.mode === 'agent' &&
          !this.resolveProposals([...opts.proposalIds]).length &&
          !verificationTurnUsed &&
          claimsUnverifiedCreation(answer)
        ) {
          verificationTurnUsed = true;
          opts.onProgress?.("Checky-checky my own work…");
          observations.push(
            'GROUNDING CHECK: Your last reply claimed file or folder creation, but no propose_file(s)/create_file ' +
            'action was ever executed this run and no proposal is pending. There is no create_directory action — ' +
            'folders only ever appear as a side effect of an accepted file proposal. Either call the real action now ' +
            '(propose_files, create_file, etc.) to actually do this, or reply again with actions=[] and an honest ' +
            'message that does not claim anything was created, written, or saved.'
          );
          continue;
        }

        return isStatusOnlyReply(answer)
          ? 'I finished, but I do not have a useful summary to show for it. Could you rephrase what you need?'
          : answer;
      }

      let allActionsWereSuccessfulWrites = true;
      let executedActionCount = 0;
      for (const action of envelope.actions.slice(0, 40)) {
        if (opts.signal?.aborted) throw new Error('Request cancelled.');
        const fingerprint = actionFingerprint(action);
        if (attemptedActions.has(fingerprint)) {
          observations.push(
            `ERROR: Repeated tool action suppressed: ${action.type}. ` +
            'Do not retry it. Follow the CURRENT USER TASK and either choose a different evidence-gathering action or finish with actions=[].'
          );
          allActionsWereSuccessfulWrites = false;
          continue;
        }
        attemptedActions.add(fingerprint);
        executedActionCount++;

        // A legitimate (non-subagent) delegation runs a nested, bounded,
        // read-only step loop and folds its summary back in as one
        // observation. A subagent requesting this itself falls through to
        // the normal dispatch below, where AgentToolRegistry denies it —
        // recursion is never allowed, not even once.
        if (action.type === 'delegate_task' && !opts.subagent) {
          if (delegateCallCount >= MAX_DELEGATIONS_PER_RUN) {
            observations.push(
              `ACTION ${safeJson({ type: 'delegate_task', task: action.task })}\n` +
              `RESULT\nERROR: delegate_task call limit (${MAX_DELEGATIONS_PER_RUN}) reached this run. Proceed directly instead of delegating further.`
            );
            allActionsWereSuccessfulWrites = false;
            continue;
          }
          delegateCallCount++;
          opts.onProgress?.(`Delegatin' a sub-task: "${truncateMiddle(action.task, 80)}"…`);
          const subBudget = Math.max(1, Math.min(opts.config.maxAgentSteps, opts.config.maxSubagentSteps));
          const summary = await this.runLoop({
            task: buildSubagentTask(action.task),
            mode: 'agent',
            history: [],
            workspaceContext: opts.workspaceContext,
            observations: [],
            mediaAttachments: [],
            proposalIds: new Set<string>(),
            maxSteps: subBudget,
            subagent: true,
            preload: false,
            provider: opts.provider,
            config: opts.config,
            contextCharBudget: opts.contextCharBudget,
            signal: opts.signal,
            onProgress: (message) => opts.onProgress?.(`Sub-task: ${message}`)
          });
          observations.push(`ACTION ${safeJson({ type: 'delegate_task', task: action.task })}\nRESULT\n${summary}`);
          // A delegation is exploration, not a write — it must not make the
          // step look like a completed write batch to the done-check below.
          allActionsWereSuccessfulWrites = false;
          continue;
        }

        opts.onProgress?.(this.toolRegistry.describe(action));
        const result = await this.toolRegistry.execute(action, {
          mode: opts.mode,
          mediaAttachments: opts.mediaAttachments,
          signal: opts.signal,
          subagent: opts.subagent
        });
        observations.push(result.observation);
        for (const id of result.proposalIds) opts.proposalIds.add(id);
        if (!result.wrote || /\b(?:ERROR|Denied):/i.test(result.observation)) {
          allActionsWereSuccessfulWrites = false;
        }
        if (action.type === 'todo_write') opts.onTodosChanged?.(this.todos.list());
      }

      // A freshly proposed plan suspends this run in place until the user
      // decides in the chat panel. No synthetic turn or resend is needed:
      // execution resumes in the same run with the same step budget. A
      // subagent can never propose a plan (denied by the registry), so this
      // never applies to one — it also must never react to the parent's plan.
      if (!opts.subagent) {
        const activePlan = this.plans.get();
        if (activePlan && activePlan.status === 'pending') {
          opts.onPlanChanged?.(activePlan);
          opts.onProgress?.('Waiting for you to approve the plan…');
          const decision = await this.plans.waitForDecision(activePlan.id, opts.signal);
          if (decision === 'approved') {
            this.todos.set(activePlan.steps.map((planStep) => ({ id: planStep.id, content: planStep.text, status: 'pending' as const })));
            opts.onTodosChanged?.(this.todos.list());
            observations.push('PLAN APPROVED: proceed to execute it now, step by step, using real tools.');
          } else {
            observations.push(
              'PLAN REJECTED: ask what to change, or propose a revised plan with propose_plan before attempting any write/execution action.'
            );
          }
          continue;
        }
      }

      duplicateOnlySteps = executedActionCount === 0 ? duplicateOnlySteps + 1 : 0;
      if (duplicateOnlySteps >= 2) {
        // The loop guard is an engine detail. The user gets a plain explanation
        // and a way forward instead of the internal reason.
        const progress = isStatusOnlyReply(lastMessage) ? '' : `${lastMessage}\n\n`;
        return `${progress}I stopped because I kept repeating the same step without making progress. ` +
          'Could you tell me a bit more about what you need, or point me at the file or folder to start from?';
      }

      // A model may submit a complete batch and explicitly mark it done. Before
      // accepting that, give it exactly one turn to check its own work against
      // the real filesystem, so the final summary is evidence-based rather than
      // an assertion. Read and error results always get another turn anyway.
      if (envelope.done && allActionsWereSuccessfulWrites) {
        if (verificationTurnUsed) {
          return lastMessage || 'Project changes prepared.';
        }
        verificationTurnUsed = true;
        opts.onProgress?.("Checky-checky my own work…");
        observations.push(
          'VERIFICATION STEP: Your files are prepared but not yet reviewed by the user. ' +
          'Check your own work now: use list_directory to confirm the layout, read_file on the files you just prepared ' +
          '(the pending overlay serves their new content), and search_text to confirm imports, names, and references line up. ' +
          'Fix anything wrong with a new action. If everything is correct, reply with actions=[] and a final summary that ' +
          'states what you created or changed and what you verified. Do not repeat an unchanged proposal.'
        );
        continue;
      }
    }

    const progress = isStatusOnlyReply(lastMessage) ? '' : `${lastMessage}\n\n`;
    return `${progress}I reached my limit of ${opts.maxSteps} steps for this request, so this is as far as I got. ` +
      'Ask me to continue, or narrow the request and I will pick it up from here.';
  }

  /**
   * Single plain-prose completion for a conversational turn. No tools, no
   * workspace context, and no forced JSON schema.
   */
  private async converse(
    provider: TextProvider,
    request: AgentRunRequest,
    config: AgentConfiguration
  ): Promise<string> {
    request.onProgress?.("Thinkin' thinkin'…");
    const history = formatRecentHistory(request.history);
    const charBudget = Math.min(effectiveCharBudget(config), 24_000);
    // A retry (see below) must not re-stream: the first attempt's partial
    // text is already shown, and a second stream would visibly duplicate it.
    let streamingClaimed = false;
    const ask = (nudge = '') => {
      const onDelta = streamingClaimed ? undefined : request.onDelta;
      streamingClaimed = true;
      return provider.complete({
        systemPrompt: buildChatSystemPrompt(),
        userPrompt: truncateMiddle(
          `${history ? `RECENT CHAT (finished history, for reference only)\n${history}\n\n` : ''}` +
          `THE USER JUST SAID\n${request.userText}\n\n` +
          `Reply to them directly and naturally.${nudge}`,
          charBudget
        ),
        model: config.model,
        structured: false,
        signal: request.signal,
        onDelta
      });
    };

    // Tool-tuned local models sometimes answer a greeting with an envelope or a
    // status line anyway. Unwrap it, then retry once with an explicit nudge.
    let reply = parseAgentEnvelope(await ask()).message.trim();
    if (isStatusOnlyReply(reply)) {
      if (request.signal?.aborted) throw new Error('Request cancelled.');
      reply = parseAgentEnvelope(
        await ask(' Do not reply with a status line such as "task completed" — the user asked you a question, so answer it in a friendly sentence.')
      ).message.trim();
    }
    return isStatusOnlyReply(reply)
      ? 'Hi! I am Vectra, your coding assistant in VS Code. What would you like to work on?'
      : reply;
  }

  /**
   * The model's `message` is free text it writes about its own turn, and a
   * weak or local model will sometimes narrate file/folder creation it never
   * actually attempted through a tool call. When there ARE pending proposals,
   * PatchManager — the one source of truth for what is written vs. pending —
   * still gets the final word, appended as a plain, useful next step. When
   * there is nothing pending, the model's own natural reply is left alone: a
   * conversational answer (e.g. "I can't generate images, but I could write
   * a script for that") does not need a disk-write disclaimer bolted onto it.
   */
  private finish(message: string, ids: string[]): AgentRunResult {
    const proposals = this.resolveProposals(ids);
    if (proposals.length) {
      const noun = proposals.length === 1 ? 'change is' : 'changes are';
      const suffix = `${proposals.length} ${noun} ready for review. Accept them to write the project to disk.`;
      return { text: [message, suffix].filter(Boolean).join('\n\n'), proposals };
    }

    return { text: message, proposals };
  }

  private resolveProposals(ids: string[]): AgentRunResult['proposals'] {
    // Only 'pending' survives here: once a proposal is accepted, rejected, or
    // goes stale mid-run (e.g. the user actioned it from the panel while this
    // run was still going), it must stop being announced as awaiting review.
    return ids
      .map((id) => this.patches.get(id))
      .filter((proposal): proposal is NonNullable<typeof proposal> => proposal?.status === 'pending');
  }
}

function buildUserPrompt(
  task: string,
  history: ChatMessage[],
  context: WorkspaceContext,
  observations: string[],
  attachments: Attachment[],
  proposals: AgentRunResult['proposals'],
  todos: TodoItem[],
  plan: Plan | undefined,
  maxCharacters: number
): string {
  const recentHistory = formatRecentHistory(history);
  const observationsText = observations.length
    ? observations.slice(-32).map((observation, index) => `OBSERVATION ${index + 1}\n${observation}`).join('\n\n')
    : 'No tool observations yet.';
  const pendingText = proposals.length
    ? `These exist only as reviewed proposals, NOT yet written to disk. Do not tell the user they were created, ` +
      `saved, or now present until the user accepts them.\n` +
      proposals.map((proposal) => `- ${proposal.kind}: ${proposal.path}`).join('\n')
    : 'No proposals are pending. Nothing has been written or is queued for review right now.';
  const todoText = todos.length
    ? todos.map((item) => `- [${item.status === 'completed' ? 'x' : item.status === 'in_progress' ? '~' : ' '}] ${item.content} (${item.status})`).join('\n')
    : 'No todo list yet.';
  const planText = plan
    ? `Plan (${plan.status}):\n${plan.steps.map((step) => `- ${step.text}`).join('\n')}`
    : 'No plan proposed yet. Propose one with propose_plan before any write or execution action.';

  // The task stays at the beginning and recent evidence stays at the end. If a
  // very large session must be truncated, these are the two highest-value areas.
  return truncateMiddle(
    `CURRENT USER TASK\n${task}\n\n` +
    `WORKSPACE CONTEXT\n${formatWorkspaceContext(context)}\n\n` +
    `PARSED ATTACHMENTS\n${formatAttachmentContext(attachments)}\n\n` +
    `RECENT CHAT\n${recentHistory || 'No previous chat.'}\n\n` +
    `PENDING REVIEW BATCH\n${pendingText}\n\n` +
    `PLAN\n${planText}\n\n` +
    `TODO LIST\n${todoText}\n\n` +
    `TOOL OBSERVATIONS\n${observationsText}\n\n` +
    `ACTIVE TASK REMINDER\n${task}\n` +
    'This task replaces any conflicting or unfinished request in RECENT CHAT. Never repeat an old tool action unless this task explicitly requests it.\n\n' +
    'Return the next JSON action envelope. Finish the complete task in this run.',
    maxCharacters
  );
}

/**
 * Cloud providers advertise large (100K+ token) context windows, so
 * `maxContextCharacters` applies unmodified. Local providers run whatever
 * context size the user actually configured for the server process, which is
 * very often much smaller — sending more than that gets the request rejected
 * outright (HTTP 400) instead of gracefully truncated.
 */
function effectiveCharBudget(config: AgentConfiguration): number {
  if (config.provider === 'llamaCpp') {
    return estimateContextCharBudget(config.llamaCppContextSize, config.maxContextCharacters);
  }
  if (config.provider === 'ollama') {
    return estimateContextCharBudget(config.ollamaContextSize, config.maxContextCharacters);
  }
  return config.maxContextCharacters;
}

function actionFingerprint(action: unknown): string {
  return JSON.stringify(action);
}

/**
 * Loose net for "I just did file/folder work" narration, used only to decide
 * whether a zero-action reply deserves one grounding challenge before it
 * reaches the user. False positives cost one extra turn; false negatives let
 * a fabricated claim straight through, so this stays deliberately broad.
 */
const CREATION_CLAIM_PATTERN =
  /\b(?:created|creating|generated|generating|built|building|wrote|written|writing|saved|saving|added|adding|implemented|implementing|set up|setting up|prepared|preparing|made|making)\b[\s\S]{0,80}\b(?:file|files|folder|folders|directory|directories|pipeline|pipelines|project|script|scripts|module|modules|component|components)\b/i;

function claimsUnverifiedCreation(message: string): boolean {
  return CREATION_CLAIM_PATTERN.test(message);
}

/** Framing prepended to a delegated task: the sub-agent has no memory of the parent conversation and a hard-restricted tool set. */
function buildSubagentTask(task: string): string {
  return 'You are a bounded, read-only sub-agent helping with one focused exploration task delegated by the main agent. ' +
    'You have no memory of the main conversation — the task below is everything you know. ' +
    'You cannot write files, run commands, propose a plan, edit the todo list, or delegate further; investigate and report back precisely.\n\n' +
    `TASK\n${task}`;
}

function formatWorkspaceContext(context: WorkspaceContext): string {
  const sections: string[] = [
    `Workspace folders: ${context.workspaceFolders.join(', ') || 'none'}`,
    `Open files: ${context.openFiles.join(', ') || 'none'}`
  ];
  if (context.projectInstructions) {
    sections.push(`PROJECT INSTRUCTIONS (from VECTRA.md, follow these for this workspace):\n${context.projectInstructions}`);
  }
  if (context.workspaceOverview) sections.push(`Workspace overview:\n${context.workspaceOverview}`);
  if (context.activeFile) {
    sections.push(`Active file: ${context.activeFile}${context.activeLanguage ? ` (${context.activeLanguage})` : ''}`);
  }
  if (context.selectionText) {
    sections.push(
      `EXACT CURRENT SELECTION lines ${context.selectionStartLine}-${context.selectionEndLine}:\n${context.selectionText}`
    );
  }
  if (context.activeFileContent) sections.push(`Active file content snapshot:\n${context.activeFileContent}`);
  if (context.diagnostics.length) sections.push(`Active diagnostics:\n${context.diagnostics.join('\n')}`);
  return sections.join('\n\n');
}

function formatAttachmentContext(attachments: Attachment[]): string {
  if (!attachments.length) return 'No user or tool attachments.';
  const selected = attachments.slice(-12);
  const perAttachmentBudget = Math.max(4_000, Math.floor(80_000 / selected.length));
  return selected.map((attachment) => {
    const extracted = attachment.text?.trim();
    const content = extracted
      ? `\nParsed content:\n${truncateMiddle(extracted, Math.min(40_000, perAttachmentBudget))}`
      : '\nParsed content: unavailable; use visual inspection when supported.';
    return `- ${attachment.name} (${attachment.kind}, ${attachment.mime}, ${attachment.size} bytes)${content}`;
  }).join('\n\n');
}

function providerMediaAttachments(attachments: Attachment[]): Attachment[] {
  return attachments
    .filter((attachment) => attachment.kind === 'image' || attachment.kind === 'pdf')
    .map((attachment) => ({ ...attachment, text: undefined }));
}

async function addLocalVisionPdfPages(attachments: Attachment[]): Promise<void> {
  const pdfs = attachments.filter((attachment) => attachment.kind === 'pdf' && attachment.base64).slice(0, 3);
  for (const pdf of pdfs) {
    try {
      const pages = await renderPdfPagesFromBuffer(Buffer.from(pdf.base64!, 'base64'), pdf.name, 6);
      for (const page of pages) {
        attachments.push({
          id: randomUUID(),
          name: page.name,
          mime: page.mime,
          size: page.size,
          kind: 'image',
          source: pdf.source,
          base64: page.base64
        });
      }
    } catch {
      // Embedded PDF text remains available when optional rendering tools are absent.
    }
  }
}
