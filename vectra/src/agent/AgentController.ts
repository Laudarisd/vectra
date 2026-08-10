import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { AgentRunRequest, AgentRunResult, Attachment, ChatMessage, WorkspaceContext } from '../types';
import { ProviderManager } from '../providers/ProviderManager';
import { getConfig } from '../utils/config';
import { truncateMiddle } from '../utils/text';
import { ContextCollector } from '../services/ContextCollector';
import { PatchManager } from '../services/PatchManager';
import { WorkspaceTools } from '../services/WorkspaceTools';
import { CommandRunner } from '../services/CommandRunner';
import { renderPdfPagesFromBuffer } from '../services/DocumentExtractor';
import { AgentToolRegistry } from './AgentToolRegistry';
import { buildSystemPrompt, parseAgentEnvelope } from './protocol';

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
    commands: CommandRunner
  ) {
    this.toolRegistry = new AgentToolRegistry(tools, patches, commands);
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (!vscode.workspace.isTrusted) {
      throw new Error('This workspace is not trusted. Trust it before using Vectra.');
    }

    const config = getConfig();
    if (!config.model) throw new Error('No model selected. Choose API Key or Local Model first.');

    const provider = await this.providers.getProvider();
    const workspaceContext = await this.contextCollector.collect(request.mode);
    const mediaAttachments: Attachment[] = [...(request.attachments ?? [])];
    if (config.provider === 'llamaCpp' && config.llamaCppMmprojPath) {
      await addLocalVisionPdfPages(mediaAttachments);
    }

    const observations: string[] = [];
    const proposalIds = new Set<string>();
    let lastMessage = '';

    // Ask and Agent begin with real workspace evidence. This makes a directory
    // question answerable in one user prompt even when a small model forgets to
    // request discovery on its first turn.
    if (request.mode !== 'selection') {
      request.onProgress?.('Scanning workspace…');
      const preload = await this.toolRegistry.execute(
        { type: 'workspace_summary' },
        { mode: request.mode, mediaAttachments }
      );
      observations.push(preload.observation);
    }

    for (let step = 1; step <= config.maxAgentSteps; step++) {
      if (request.signal?.aborted) throw new Error('Request cancelled.');
      request.onProgress?.(step === 1 ? 'Analyzing…' : 'Generating…');

      const userPrompt = buildUserPrompt(
        request.userText,
        request.history,
        workspaceContext,
        observations,
        mediaAttachments,
        this.resolveProposals([...proposalIds]),
        config.maxContextCharacters
      );

      const raw = await provider.complete({
        systemPrompt: buildSystemPrompt(request.mode),
        userPrompt,
        model: config.model,
        // Extracted text already lives in userPrompt. Providers only receive
        // native visual/PDF bytes here, avoiding duplicate token-heavy text.
        attachments: providerMediaAttachments(mediaAttachments),
        signal: request.signal
      });
      const envelope = parseAgentEnvelope(raw);
      lastMessage = envelope.message || lastMessage;

      if (!envelope.actions.length) {
        request.onProgress?.('Producing…');
        return this.finish(envelope.message || lastMessage || 'Done.', [...proposalIds]);
      }

      let allActionsWereSuccessfulWrites = true;
      for (const action of envelope.actions.slice(0, 40)) {
        if (request.signal?.aborted) throw new Error('Request cancelled.');
        request.onProgress?.(this.toolRegistry.describe(action));
        const result = await this.toolRegistry.execute(action, {
          mode: request.mode,
          mediaAttachments
        });
        observations.push(result.observation);
        for (const id of result.proposalIds) proposalIds.add(id);
        if (!result.wrote || /\b(?:ERROR|Denied):/i.test(result.observation)) {
          allActionsWereSuccessfulWrites = false;
        }
      }

      // A model may submit a complete batch and explicitly mark it done. Safe
      // successful writes need no extra synthesis call; read and error results
      // always get another turn so the final answer is evidence-based.
      if (envelope.done && allActionsWereSuccessfulWrites) {
        return this.finish(lastMessage || 'Project changes prepared.', [...proposalIds]);
      }
    }

    const stopped = `${lastMessage ? `${lastMessage}\n\n` : ''}Stopped after ${config.maxAgentSteps} agent steps.`;
    return this.finish(stopped, [...proposalIds]);
  }

  private finish(message: string, ids: string[]): AgentRunResult {
    const proposals = this.resolveProposals(ids);
    if (!proposals.length) return { text: message, proposals };

    const noun = proposals.length === 1 ? 'change is' : 'changes are';
    const suffix = `${proposals.length} ${noun} ready for review. Accept them to write the project to disk.`;
    return { text: [message, suffix].filter(Boolean).join('\n\n'), proposals };
  }

  private resolveProposals(ids: string[]): AgentRunResult['proposals'] {
    return ids.map((id) => this.patches.get(id)).filter(Boolean) as AgentRunResult['proposals'];
  }
}

function buildUserPrompt(
  task: string,
  history: ChatMessage[],
  context: WorkspaceContext,
  observations: string[],
  attachments: Attachment[],
  proposals: AgentRunResult['proposals'],
  maxCharacters: number
): string {
  const recentHistory = history
    .filter((message) => message.role !== 'system')
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n');
  const observationsText = observations.length
    ? observations.slice(-32).map((observation, index) => `OBSERVATION ${index + 1}\n${observation}`).join('\n\n')
    : 'No tool observations yet.';
  const pendingText = proposals.length
    ? proposals.map((proposal) => `- ${proposal.kind}: ${proposal.path}`).join('\n')
    : 'No proposals prepared in this run.';

  // The task stays at the beginning and recent evidence stays at the end. If a
  // very large session must be truncated, these are the two highest-value areas.
  return truncateMiddle(
    `CURRENT USER TASK\n${task}\n\n` +
    `WORKSPACE CONTEXT\n${formatWorkspaceContext(context)}\n\n` +
    `PARSED ATTACHMENTS\n${formatAttachmentContext(attachments)}\n\n` +
    `RECENT CHAT\n${recentHistory || 'No previous chat.'}\n\n` +
    `PENDING REVIEW BATCH\n${pendingText}\n\n` +
    `TOOL OBSERVATIONS\n${observationsText}\n\n` +
    'Return the next JSON action envelope. Finish the complete task in this run.',
    maxCharacters
  );
}

function formatWorkspaceContext(context: WorkspaceContext): string {
  const sections: string[] = [
    `Workspace folders: ${context.workspaceFolders.join(', ') || 'none'}`,
    `Open files: ${context.openFiles.join(', ') || 'none'}`
  ];
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
