// Runs approved commands in VS Code's integrated terminal and captures their output through shell integration.
import * as vscode from 'vscode';

export interface TerminalRunResult { stdout: string; stderr: string; exitCode: number; timedOut: boolean; cancelled: boolean }

/**
 * Copilot-style execution: the user watches the command run in a real terminal
 * they can also type into, while Vectra still receives the output and exit code
 * through the Shell Integration API. Approval happens in CommandRunner before
 * anything reaches here; this class never decides policy.
 */
export class TerminalRunner implements vscode.Disposable {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly closeListener = vscode.window.onDidCloseTerminal((terminal) => {
    for (const [cwd, value] of this.terminals) if (value === terminal) this.terminals.delete(cwd);
  });

  /** Resolves undefined when shell integration is unavailable (e.g. cmd.exe), so the caller can fall back to a background shell. */
  async run(command: string, cwd: string, timeoutMs: number, onData: (chunk: string) => void, signal?: AbortSignal): Promise<TerminalRunResult | undefined> {
    const terminal = this.terminalFor(cwd);
    const shell = await this.waitForShellIntegration(terminal, 5_000);
    if (!shell) {
      terminal.dispose();
      this.terminals.delete(cwd);
      return undefined;
    }
    terminal.show(true);
    return new Promise<TerminalRunResult>((resolve) => {
      let stdout = ''; let timedOut = false; let cancelled = false; let settled = false;
      let exitCode: number | undefined; let streamDone = false;
      let execution: vscode.TerminalShellExecution | undefined;
      const finish = (code: number) => {
        if (settled) return; settled = true;
        clearTimeout(timer); signal?.removeEventListener('abort', onAbort); endListener.dispose();
        resolve({ stdout, stderr: '', exitCode: code, timedOut, cancelled });
      };
      const maybeFinish = () => { if (exitCode !== undefined && streamDone) finish(exitCode); };
      const interrupt = (code: number) => { terminal.sendText('', false); setTimeout(() => finish(code), 1_500); };
      const timer = setTimeout(() => { timedOut = true; interrupt(124); }, timeoutMs);
      const onAbort = () => { cancelled = true; interrupt(130); };
      signal?.addEventListener('abort', onAbort, { once: true });
      const endListener = vscode.window.onDidEndTerminalShellExecution((event) => {
        if (event.execution !== execution) return;
        exitCode = event.exitCode ?? 0;
        maybeFinish();
        // The output stream normally closes first; never hang on it.
        setTimeout(() => finish(exitCode!), 1_000);
      });
      execution = shell.executeCommand(command);
      void (async () => {
        try {
          for await (const chunk of execution.read()) {
            const text = stripAnsi(chunk);
            if (text) { onData(text); stdout = cap(stdout + text); }
          }
        } catch { /* the stream ends with the command; the end event carries the exit code */ }
        finally { streamDone = true; maybeFinish(); }
      })();
    });
  }

  dispose(): void { this.closeListener.dispose(); }

  /** One reusable "Vectra" terminal per working directory; user-visible terminals are never closed by Vectra. */
  private terminalFor(cwd: string): vscode.Terminal {
    const existing = this.terminals.get(cwd);
    if (existing && existing.exitStatus === undefined) return existing;
    const terminal = vscode.window.createTerminal({ name: 'Vectra', cwd, isTransient: true });
    this.terminals.set(cwd, terminal);
    return terminal;
  }

  private waitForShellIntegration(terminal: vscode.Terminal, timeoutMs: number): Promise<vscode.TerminalShellIntegration | undefined> {
    if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { listener.dispose(); resolve(undefined); }, timeoutMs);
      const listener = vscode.window.onDidChangeTerminalShellIntegration((event) => {
        if (event.terminal !== terminal) return;
        clearTimeout(timer); listener.dispose(); resolve(event.shellIntegration);
      });
    });
  }
}

/** Terminal output carries colour and cursor escape sequences that mean nothing to the model. */
function stripAnsi(text: string): string {
  return text
    .replace(/\][^]*(?:|\\)/g, '')
    .replace(/\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
}

function cap(value: string): string { return value.length > 120_000 ? value.slice(-120_000) : value; }
