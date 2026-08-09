import * as vscode from 'vscode';
import { AgentAction, AgentRunRequest, AgentRunResult, Attachment, ChatMessage, WorkspaceContext } from '../types';
import { ProviderManager } from '../providers/ProviderManager';
import { getConfig } from '../utils/config';
import { safeJson, truncateMiddle } from '../utils/text';
import { buildSystemPrompt, parseAgentEnvelope } from './protocol';
import { ContextCollector } from '../services/ContextCollector';
import { PatchManager } from '../services/PatchManager';
import { WorkspaceTools } from '../services/WorkspaceTools';
import { CommandRunner } from '../services/CommandRunner';
import { renderPdfPagesFromBuffer } from '../services/DocumentExtractor';
import { randomUUID } from 'node:crypto';

export class AgentController {
  constructor(
    private readonly providers: ProviderManager,
    private readonly contextCollector: ContextCollector,
    private readonly tools: WorkspaceTools,
    private readonly patches: PatchManager,
    private readonly commands: CommandRunner
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (!vscode.workspace.isTrusted) throw new Error('This workspace is not trusted. Trust it before using Vectra.');
    const config = getConfig();
    if (!config.model) throw new Error('No model selected. Choose API Key or Local Model first.');

    const provider = await this.providers.getProvider();
    const workspaceContext = await this.contextCollector.collect(request.mode);
    const observations: string[] = [];
    if (request.mode !== 'selection') {
      request.onProgress?.('Scanning workspace…');
      try { observations.push(await this.tools.workspaceSummary()); }
      catch (error) { observations.push(`WORKSPACE SUMMARY ERROR: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const mediaAttachments: Attachment[] = [...(request.attachments ?? [])];
    if (config.provider === 'llamaCpp' && config.llamaCppMmprojPath) {
      await addLocalVisionPdfPages(mediaAttachments);
    }
    const newProposalIds: string[] = [];
    let lastMessage = '';

    for (let step = 1; step <= config.maxAgentSteps; step++) {
      if (request.signal?.aborted) throw new Error('Request cancelled.');
      request.onProgress?.(step === 1 ? 'Analyzing…' : 'Generating…');

      const userPrompt = this.buildUserPrompt(request.userText, request.history, workspaceContext, observations, mediaAttachments, config.maxContextCharacters);
      request.onProgress?.('Generating…');
      const raw = await provider.complete({
        systemPrompt: buildSystemPrompt(request.mode),
        userPrompt,
        model: config.model,
        attachments: mediaAttachments,
        signal: request.signal
      });
      const envelope = parseAgentEnvelope(raw);
      lastMessage = envelope.message || lastMessage;
      if (!envelope.actions.length) request.onProgress?.('Producing…');

      if (!envelope.actions.length) {
        return { text: envelope.message || 'Done.', proposals: this.resolveProposals(newProposalIds) };
      }

      let createdProposalThisStep = false;
      for (const action of envelope.actions) {
        if (request.signal?.aborted) throw new Error('Request cancelled.');
        const observation = await this.executeAction(action, request.mode, request.onProgress, newProposalIds, mediaAttachments);
        observations.push(observation);
        if (['create_file','propose_file','replace_lines','delete_lines','insert_lines','create_document','edit_document','delete_file'].includes(action.type)) createdProposalThisStep = true;
      }

      if (createdProposalThisStep) {
        const count = newProposalIds.length;
        const suffix = count === 1 ? '1 change is ready for review.' : `${count} changes are ready for review.`;
        return { text: [lastMessage, suffix].filter(Boolean).join('\n\n'), proposals: this.resolveProposals(newProposalIds) };
      }
      // Actions produce evidence. Always give the model another turn to consume the
      // observations before presenting a final answer. This prevents a tool call's
      // provisional message from being returned as if it already contained results.
    }

    return { text: `${lastMessage ? `${lastMessage}\n\n` : ''}Stopped after ${config.maxAgentSteps} agent steps.`, proposals: this.resolveProposals(newProposalIds) };
  }

  private async executeAction(
    action: AgentAction,
    mode: AgentRunRequest['mode'],
    onProgress: AgentRunRequest['onProgress'],
    newProposalIds: string[],
    mediaAttachments: Attachment[]
  ): Promise<string> {
    onProgress?.(describeAction(action));
    try {
      if (action.type === 'read_document') {
        return toolObservation(action, await this.tools.readDocument(action.path));
      }
      if (action.type === 'replace_lines' || action.type === 'delete_lines' || action.type === 'insert_lines') {
        if (mode !== 'agent') return toolObservation(action, 'Denied: this mode is read-only.');
        const proposal = action.type === 'replace_lines'
          ? await this.patches.proposeLineEdit(action.path, action.startLine, action.endLine, action.content, 'replace', action.reason)
          : action.type === 'delete_lines'
            ? await this.patches.proposeLineEdit(action.path, action.startLine, action.endLine, '', 'delete', action.reason)
            : await this.patches.proposeLineEdit(action.path, action.line, action.line, action.content, action.position === 'before' ? 'insert-before' : 'insert-after', action.reason);
        newProposalIds.push(proposal.id);
        return toolObservation(action, `Reviewed line edit prepared for ${proposal.path}. Waiting for user approval.`);
      }
      if (action.type === 'create_document' || action.type === 'edit_document') {
        if (mode !== 'agent') return toolObservation(action, 'Denied: this mode is read-only.');
        const proposal = await this.patches.proposeDocument(action.path, action.content, action.reason, action.title, action.type === 'edit_document');
        newProposalIds.push(proposal.id);
        return toolObservation(action, `${action.type === 'create_document' ? 'Document creation' : 'Document edit'} prepared for ${proposal.path}. Waiting for user approval.`);
      }
      if (action.type === 'create_file' || action.type === 'propose_file') {
        if (mode !== 'agent') return toolObservation(action, 'Denied: this mode is read-only.');
        if (typeof action.content !== 'string') return toolObservation(action, 'Denied: file action requires complete string content.');
        if (action.type === 'create_file') {
          const current = await this.tools.readWholeFile(action.path);
          if (current.exists) return toolObservation(action, `Denied: ${action.path} already exists. Read it, then use propose_file.`);
        }
        const proposal = await this.patches.proposeFile(action.path, action.content, action.reason);
        newProposalIds.push(proposal.id);
        return toolObservation(action, `Proposal created for ${proposal.path} (${proposal.kind}). Waiting for user approval.`);
      }
      if (action.type === 'delete_file') {
        if (mode !== 'agent') return toolObservation(action, 'Denied: this mode is read-only.');
        const proposal = await this.patches.proposeDelete(action.path, action.reason);
        newProposalIds.push(proposal.id);
        return toolObservation(action, `Deletion proposal created for ${proposal.path}. Waiting for user approval.`);
      }
      if (action.type === 'run_file' || action.type === 'run_project' || action.type === 'run_command' || action.type === 'run_tests') {
        if (mode !== 'agent') return toolObservation(action, 'Denied: execution tools are available only in Agent mode.');
        if (this.patches.list().some((proposal) => proposal.status === 'pending')) {
          return toolObservation(action, 'Blocked: there are pending file proposals. The user must Accept or Reject them before Vectra can run against the workspace state.');
        }
        if (action.type === 'run_file') return toolObservation(action, await this.commands.runFile(action.path, action.args ?? [], action.timeoutMs, action.reason));
        if (action.type === 'run_project') return toolObservation(action, await this.commands.runProject(action.path ?? '', action.timeoutMs, action.reason));
        if (action.type === 'run_tests') {
          const output = action.command
            ? await this.commands.run(action.command, action.cwd, action.timeoutMs, action.reason, 'tests')
            : await this.commands.runTestsAuto(action.cwd ?? '', action.timeoutMs, action.reason);
          return toolObservation(action, output);
        }
        return toolObservation(action, await this.commands.run(action.command, action.cwd, action.timeoutMs, action.reason, 'command'));
      }
      if (action.type === 'inspect_file') {
        const attachment = await this.tools.inspectFile(action.path);
        if (!mediaAttachments.some((item) => item.path === attachment.path && item.name === attachment.name)) mediaAttachments.push(attachment);
        const extracted = attachment.text?.trim();
        const info = extracted
          ? `Attached ${attachment.name} (${attachment.mime}, ${attachment.size} bytes). Extracted text preview:\n${truncateMiddle(extracted, 20_000)}`
          : `Attached ${attachment.name} (${attachment.mime}, ${attachment.size} bytes) for multimodal inspection. No reliable text extraction was available.`;
        return toolObservation(action, info);
      }
      const output = await this.tools.execute(action);
      return toolObservation(action, output);
    } catch (error) {
      return toolObservation(action, `ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildUserPrompt(task: string, history: ChatMessage[], context: WorkspaceContext, observations: string[], attachments: Attachment[], maxCharacters: number): string {
    const recentHistory = history.filter((m) => m.role !== 'system').slice(-12).map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const contextText = formatWorkspaceContext(context);
    const observationsText = observations.length ? observations.slice(-20).map((o,i)=>`OBSERVATION ${i+1}\n${o}`).join('\n\n') : 'No tool observations yet.';
    const attachmentText = formatAttachmentContext(attachments);
    return truncateMiddle(`CURRENT USER TASK\n${task}\n\nWORKSPACE CONTEXT\n${contextText}\n\nATTACHMENTS\n${attachmentText}\n\nRECENT CHAT\n${recentHistory || 'No previous chat.'}\n\nTOOL OBSERVATIONS\n${observationsText}\n\nReturn the next JSON action envelope now.`, maxCharacters);
  }

  private resolveProposals(ids: string[]) { return ids.map((id) => this.patches.get(id)).filter(Boolean) as AgentRunResult['proposals']; }
}

function toolObservation(action: AgentAction, output: string): string { return `ACTION ${safeJson(action)}\nRESULT\n${output}`; }
function describeAction(action: AgentAction): string {
  switch (action.type) {
    case 'workspace_summary': return 'Analyzing workspace…';
    case 'list_directory': return 'Scanning directory…';
    case 'list_files': return 'Scanning workspace files…';
    case 'read_file': return `Reading ${action.path}…`;
    case 'read_document': return `Parsing document ${action.path}…`;
    case 'inspect_file': return `Inspecting ${action.path}…`;
    case 'search_text': return `Searching for “${action.query}”…`;
    case 'get_diagnostics': return 'Checking editor diagnostics…';
    case 'create_file': return `Producing ${action.path}…`;
    case 'replace_lines': return `Editing ${action.path}…`;
    case 'delete_lines': return `Editing ${action.path}…`;
    case 'insert_lines': return `Editing ${action.path}…`;
    case 'create_document': return `Producing document ${action.path}…`;
    case 'edit_document': return `Editing document ${action.path}…`;
    case 'propose_file': return `Editing ${action.path}…`;
    case 'delete_file': return `Editing workspace…`;
    case 'run_file': return `Running ${action.path}…`;
    case 'run_project': return 'Running project…';
    case 'run_command': return `Running command…`;
    case 'run_tests': return `Running tests…`;
  }
}
function formatWorkspaceContext(context: WorkspaceContext): string {
  const s: string[] = [`Workspace folders: ${context.workspaceFolders.join(', ') || 'none'}`, `Open files: ${context.openFiles.join(', ') || 'none'}`];
  if (context.workspaceOverview) s.push(`Workspace overview:
${context.workspaceOverview}`);
  if (context.activeFile) s.push(`Active file: ${context.activeFile}${context.activeLanguage ? ` (${context.activeLanguage})` : ''}`);
  if (context.selectionText) s.push(`EXACT CURRENT SELECTION lines ${context.selectionStartLine}-${context.selectionEndLine}:\n${context.selectionText}`);
  if (context.activeFileContent) s.push(`Active file content snapshot:\n${context.activeFileContent}`);
  if (context.diagnostics.length) s.push(`Active diagnostics:\n${context.diagnostics.join('\n')}`);
  return s.join('\n\n');
}
function formatAttachmentContext(attachments: Attachment[]): string {
  if (!attachments.length) return 'No user or tool attachments.';
  return attachments.slice(-12).map((a) => {
    const text = a.text?.trim() ? `\nExtracted/text content:\n${truncateMiddle(a.text, 30_000)}` : '';
    return `- ${a.name} (${a.kind}, ${a.mime}, ${a.size} bytes)${text}`;
  }).join('\n\n');
}


async function addLocalVisionPdfPages(attachments: Attachment[]): Promise<void> {
  const PDFs = attachments.filter((a) => a.kind === 'pdf' && a.base64).slice(0, 3);
  for (const pdf of PDFs) {
    try {
      const pages = await renderPdfPagesFromBuffer(Buffer.from(pdf.base64!, 'base64'), pdf.name, 6);
      for (const page of pages) attachments.push({ id: randomUUID(), name: page.name, mime: page.mime, size: page.size, kind: 'image', source: pdf.source, base64: page.base64 });
    } catch {
      // PDF text extraction still remains available; visual rendering is a best-effort local enhancement.
    }
  }
}
