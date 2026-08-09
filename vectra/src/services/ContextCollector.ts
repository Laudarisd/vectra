import * as vscode from 'vscode';
import { AgentMode, WorkspaceContext } from '../types';
import { getConfig } from '../utils/config';
import { isSensitiveAgentPath, relativeToWorkspace } from '../utils/path';
import { truncateMiddle } from '../utils/text';

export class ContextCollector {
  async collect(mode: AgentMode): Promise<WorkspaceContext> {
    const config = getConfig();
    const editor = vscode.window.activeTextEditor;
    const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((folder: vscode.WorkspaceFolder) => folder.name);
    const openFiles = vscode.workspace.textDocuments
      .filter((document) => document.uri.scheme === 'file' && !document.isClosed)
      .map((document) => relativeToWorkspace(document.uri))
      .filter((value): value is string => Boolean(value))
      .filter((value) => config.allowSensitiveFiles || !isSensitiveAgentPath(value))
      .slice(0, 40);

    if (!editor || !vscode.workspace.isTrusted) {
      return { workspaceFolders, openFiles, diagnostics: [] };
    }

    const document = editor.document;
    const activeFile = relativeToWorkspace(document.uri) ?? document.fileName;
    const sensitive = !config.allowSensitiveFiles && isSensitiveAgentPath(activeFile);
    if (sensitive) {
      return { workspaceFolders, openFiles, activeFile, activeLanguage: document.languageId, diagnostics: [] };
    }
    const selection = editor.selection;
    const selectionText = selection.isEmpty ? undefined : document.getText(selection);
    const shouldIncludeWholeActiveFile = mode !== 'agent' || document.getText().length <= 40_000;
    const activeFileContent = shouldIncludeWholeActiveFile
      ? truncateMiddle(document.getText(), 50_000)
      : undefined;

    const diagnostics = config.showDiagnosticsInContext
      ? vscode.languages.getDiagnostics(document.uri)
          .filter((diagnostic: vscode.Diagnostic) => diagnostic.severity <= vscode.DiagnosticSeverity.Warning)
          .slice(0, 30)
          .map((diagnostic: vscode.Diagnostic) => {
            const severity = diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning';
            return `${severity} L${diagnostic.range.start.line + 1}: ${diagnostic.message}`;
          })
      : [];

    return {
      workspaceFolders,
      activeFile,
      activeLanguage: document.languageId,
      activeFileContent,
      selectionText: selectionText ? truncateMiddle(selectionText, 50_000) : undefined,
      selectionStartLine: selection.isEmpty ? undefined : selection.start.line + 1,
      selectionEndLine: selection.isEmpty ? undefined : selection.end.line + 1,
      openFiles,
      diagnostics
    };
  }
}
