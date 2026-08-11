import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { EditProposal } from '../types';
import { normalizeAgentPath, resolveWorkspacePath } from '../utils/path';
import { sha256, sha256Bytes } from '../utils/text';
import { createDocumentBytes, documentFormatForPath, extractDocumentText, isWritableDocumentFormat } from './DocumentService';
import { WorkspaceTools } from './WorkspaceTools';

/**
 * Owns Vectra's review-before-write boundary.
 *
 * The agent can prepare many related files during one run, but none of those
 * files reaches disk until the user accepts the corresponding proposal. A
 * pending proposal also acts as a small virtual workspace overlay: later agent
 * steps can refine or read the proposed content without producing conflicting
 * proposals for the same path.
 */
export class PatchManager {
  private readonly proposals = new Map<string, EditProposal>();

  constructor(private readonly tools: WorkspaceTools) {}

  list(): EditProposal[] {
    return [...this.proposals.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): EditProposal | undefined {
    return this.proposals.get(id);
  }

  getPendingForPath(filePath: string): EditProposal | undefined {
    const normalized = normalizeAgentPath(filePath);
    return [...this.proposals.values()].find(
      (proposal) => proposal.status === 'pending' && normalizeAgentPath(proposal.path) === normalized
    );
  }

  /** Return proposed text so later tool calls can reason over the pending project. */
  readPendingText(filePath: string): string | undefined {
    const proposal = this.getPendingForPath(filePath);
    if (!proposal || proposal.kind === 'delete' || proposal.contentType !== 'text') return undefined;
    return proposal.proposedContent;
  }

  async proposeFile(
    filePath: string,
    proposedContent: string,
    reason = 'Agent-proposed change'
  ): Promise<EditProposal> {
    const pending = this.getPendingForPath(filePath);
    if (pending) {
      if (pending.kind === 'delete' || pending.contentType !== 'text') {
        throw new Error(`${filePath} already has an incompatible pending proposal.`);
      }

      // Refine the existing virtual file instead of creating proposals that
      // would become stale as soon as the first one is accepted.
      pending.proposedContent = proposedContent;
      pending.reason = reason;
      pending.createdAt = Date.now();
      return pending;
    }

    const current = await this.tools.readWholeFile(filePath);
    return this.store({
      id: randomUUID(),
      path: normalizeAgentPath(filePath),
      reason,
      kind: current.exists ? 'modify' : 'create',
      baseContent: current.content,
      proposedContent,
      baseHash: sha256(current.content),
      createdAt: Date.now(),
      status: 'pending',
      contentType: 'text'
    });
  }

  async proposeLineEdit(
    filePath: string,
    startLine: number,
    endLine: number,
    content: string,
    mode: 'replace' | 'delete' | 'insert-before' | 'insert-after',
    reason = 'Agent-proposed line edit'
  ): Promise<EditProposal> {
    const pendingText = this.readPendingText(filePath);
    const current = pendingText === undefined
      ? await this.tools.readWholeFile(filePath)
      : { exists: true, content: pendingText };
    if (!current.exists) throw new Error(`File does not exist: ${filePath}`);

    const eol = current.content.includes('\r\n') ? '\r\n' : '\n';
    const hasTrailingNewline = /\r?\n$/.test(current.content);
    const lines = current.content.split(/\r?\n/);
    if (hasTrailingNewline) lines.pop();

    const maxLine = Math.max(1, lines.length);
    const start = clamp(startLine, 1, maxLine);
    const end = clamp(endLine, start, maxLine);
    const replacement = content ? content.replace(/\r\n/g, '\n').split('\n') : [];

    if (mode === 'replace') lines.splice(start - 1, end - start + 1, ...replacement);
    else if (mode === 'delete') lines.splice(start - 1, end - start + 1);
    else if (mode === 'insert-before') lines.splice(start - 1, 0, ...replacement);
    else lines.splice(start, 0, ...replacement);

    let proposed = lines.join(eol);
    if (hasTrailingNewline) proposed += eol;
    return this.proposeFile(filePath, proposed, reason);
  }

  async proposeDocument(
    filePath: string,
    content: string,
    reason = 'Agent-proposed document change',
    title?: string,
    requireExisting = false
  ): Promise<EditProposal> {
    if (this.getPendingForPath(filePath)) throw new Error(`${filePath} already has a pending proposal.`);
    const format = documentFormatForPath(filePath);
    if (!format || !isWritableDocumentFormat(format)) {
      throw new Error('Document creation/editing supports .pdf and .docx. PPTX/XLSX/RTF are read/parse only.');
    }

    const current = await this.tools.readRawFile(filePath);
    if (requireExisting && !current.exists) throw new Error(`Document does not exist: ${filePath}`);
    if (!requireExisting && current.exists) throw new Error(`${filePath} already exists. Use edit_document.`);

    const baseText = current.exists ? await extractDocumentText(filePath, current.bytes) : '';
    const output = createDocumentBytes(filePath, content, title);
    return this.store({
      id: randomUUID(),
      path: normalizeAgentPath(filePath),
      reason,
      kind: current.exists ? 'modify' : 'create',
      baseContent: baseText || `[${format.toUpperCase()} document: no extractable text]`,
      proposedContent: content,
      baseHash: sha256Bytes(current.bytes),
      createdAt: Date.now(),
      status: 'pending',
      contentType: 'document',
      documentFormat: format,
      binaryOutputBase64: Buffer.from(output).toString('base64')
    });
  }

  async proposeDelete(filePath: string, reason = 'Agent-proposed deletion'): Promise<EditProposal> {
    if (this.getPendingForPath(filePath)) throw new Error(`${filePath} already has a pending proposal.`);
    const raw = await this.tools.readRawFile(filePath);
    if (!raw.exists) throw new Error(`Cannot delete missing file: ${filePath}`);

    const format = documentFormatForPath(filePath);
    let baseContent = '';
    let contentType: EditProposal['contentType'] = 'binary';
    if (format) {
      baseContent = await extractDocumentText(filePath, raw.bytes);
      contentType = 'document';
    } else {
      try {
        baseContent = (await this.tools.readWholeFile(filePath)).content;
        contentType = 'text';
      } catch {
        baseContent = `[Binary file: ${filePath}]`;
      }
    }

    return this.store({
      id: randomUUID(),
      path: normalizeAgentPath(filePath),
      reason,
      kind: 'delete',
      baseContent: baseContent || `[${format?.toUpperCase() || 'Binary'} file]`,
      proposedContent: '',
      baseHash: sha256Bytes(raw.bytes),
      createdAt: Date.now(),
      status: 'pending',
      contentType,
      documentFormat: format
    });
  }

  async accept(id: string): Promise<void> {
    const proposal = this.requireProposal(id);
    await this.assertFresh(proposal);
    await this.prepareCreateDirectories([proposal]);
    await this.applyProposal(proposal);
    proposal.status = 'accepted';
  }

  async acceptAllPending(): Promise<void> {
    const pending = this.list().filter((proposal) => proposal.status === 'pending');
    for (const proposal of pending) await this.assertFresh(proposal);
    await this.prepareCreateDirectories(pending);
    for (const proposal of pending) {
      await this.applyProposal(proposal);
      proposal.status = 'accepted';
    }
  }

  reject(id: string): void {
    const proposal = this.requireProposal(id);
    proposal.status = 'rejected';
  }

  /**
   * Reverse an already-written change back to its pre-accept content. Only
   * available for accepted text-file proposals, and only while the file on
   * disk still matches what was written — otherwise a later edit would be
   * silently clobbered.
   */
  async undo(id: string): Promise<void> {
    const proposal = this.proposals.get(id);
    if (!proposal) throw new Error('Edit proposal no longer exists.');
    if (proposal.status !== 'accepted') throw new Error(`Only accepted changes can be undone (this one is ${proposal.status}).`);
    if (proposal.contentType !== 'text') throw new Error('Undo is only supported for text file changes.');
    await this.assertMatchesApplied(proposal);
    await this.revertProposal(proposal);
    proposal.status = 'undone';
  }

  rejectAllPending(): void {
    for (const proposal of this.proposals.values()) {
      if (proposal.status === 'pending') proposal.status = 'rejected';
    }
  }

  clearCompleted(): void {
    for (const [id, proposal] of this.proposals) {
      if (proposal.status !== 'pending') this.proposals.delete(id);
    }
  }

  private store(proposal: EditProposal): EditProposal {
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  private requireProposal(id: string): EditProposal {
    const proposal = this.proposals.get(id);
    if (!proposal) throw new Error('Edit proposal no longer exists.');
    if (proposal.status !== 'pending') throw new Error(`Proposal is already ${proposal.status}.`);
    return proposal;
  }

  private async assertFresh(proposal: EditProposal): Promise<void> {
    if (proposal.contentType === 'text' && proposal.kind !== 'delete') {
      const current = await this.tools.readWholeFile(proposal.path);
      const shouldExist = proposal.kind !== 'create';
      if (current.exists !== shouldExist || sha256(current.content) !== proposal.baseHash) {
        proposal.status = 'stale';
        throw new Error(`${proposal.path} changed after the proposal was created. Ask Vectra to regenerate it.`);
      }
      return;
    }

    const raw = await this.tools.readRawFile(proposal.path);
    const shouldExist = proposal.kind !== 'create';
    if (raw.exists !== shouldExist || sha256Bytes(raw.bytes) !== proposal.baseHash) {
      proposal.status = 'stale';
      throw new Error(`${proposal.path} changed after the proposal was created. Ask Vectra to regenerate it.`);
    }
  }

  private async assertMatchesApplied(proposal: EditProposal): Promise<void> {
    if (proposal.kind === 'delete') return;
    const current = await this.tools.readWholeFile(proposal.path);
    if (!current.exists || sha256(current.content) !== sha256(proposal.proposedContent)) {
      throw new Error(`${proposal.path} changed since this was applied. Undo it manually.`);
    }
  }

  /** Mirrors applyProposal in reverse: restores baseContent, or removes/recreates the file. */
  private async revertProposal(proposal: EditProposal): Promise<void> {
    const resolved = resolveWorkspacePath(proposal.path);
    if (proposal.kind === 'create') {
      await vscode.workspace.fs.delete(resolved.uri, { recursive: false, useTrash: false });
      return;
    }
    if (proposal.kind === 'delete') {
      await vscode.workspace.fs.createDirectory(resolved.uri.with({ path: path.posix.dirname(resolved.uri.path) }));
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(resolved.uri, { ignoreIfExists: false, overwrite: false });
      edit.insert(resolved.uri, new vscode.Position(0, 0), proposal.baseContent);
      if (!await vscode.workspace.applyEdit(edit)) {
        throw new Error(`VS Code could not restore ${proposal.path}.`);
      }
      return;
    }

    const document = await vscode.workspace.openTextDocument(resolved.uri);
    const lastLine = Math.max(0, document.lineCount - 1);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      resolved.uri,
      new vscode.Range(new vscode.Position(0, 0), document.lineAt(lastLine).range.end),
      proposal.baseContent
    );
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error(`VS Code could not undo the change to ${proposal.path}.`);
    }
  }

  private async prepareCreateDirectories(proposals: EditProposal[]): Promise<void> {
    for (const proposal of proposals) {
      if (proposal.kind !== 'create') continue;
      const resolved = resolveWorkspacePath(proposal.path);
      await vscode.workspace.fs.createDirectory(resolved.uri.with({ path: path.posix.dirname(resolved.uri.path) }));
    }
  }

  private async applyProposal(proposal: EditProposal): Promise<void> {
    const resolved = resolveWorkspacePath(proposal.path);
    if (proposal.kind === 'delete') {
      await vscode.workspace.fs.delete(resolved.uri, { recursive: false, useTrash: false });
      return;
    }
    if (proposal.contentType === 'document' && proposal.binaryOutputBase64) {
      await vscode.workspace.fs.writeFile(resolved.uri, Buffer.from(proposal.binaryOutputBase64, 'base64'));
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    if (proposal.kind === 'create') {
      edit.createFile(resolved.uri, { ignoreIfExists: false, overwrite: false });
      edit.insert(resolved.uri, new vscode.Position(0, 0), proposal.proposedContent);
    } else {
      const document = await vscode.workspace.openTextDocument(resolved.uri);
      const lastLine = Math.max(0, document.lineCount - 1);
      edit.replace(
        resolved.uri,
        new vscode.Range(new vscode.Position(0, 0), document.lineAt(lastLine).range.end),
        proposal.proposedContent
      );
    }
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error(`VS Code could not apply the proposed change to ${proposal.path}.`);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  const number = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.min(max, Math.max(min, number));
}
