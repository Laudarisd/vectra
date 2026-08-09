import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolveWorkspacePath } from '../utils/path';

export class CommandRunner implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('Vectra · Commands');

  async run(command: string, cwdInput = '', timeoutMs = 120_000, reason = '', kind: 'command' | 'tests' | 'file' | 'project' = 'command'): Promise<string> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before Vectra can run commands.');
    if (!command.trim()) throw new Error('Command is empty.');
    const cwd = this.resolveCwd(cwdInput);
    const action = kind === 'tests' ? 'Run tests' : kind === 'file' ? 'Run file' : kind === 'project' ? 'Run project' : 'Run command';
    const detail = `${reason ? `${reason}\n\n` : ''}${command}\n\nWorking directory: ${cwd}`;
    const choice = await vscode.window.showWarningMessage(`Vectra wants to ${action.toLowerCase()}:`, { modal: true, detail }, action, 'Cancel');
    if (choice !== action) return 'DENIED BY USER: command was not run.';
    const limit = Math.min(Math.max(Number(timeoutMs) || 120_000, 1_000), 15 * 60_000);
    this.output.show(true);
    this.output.appendLine(`\n$ ${command}\n[cwd] ${cwd}`);
    const result = await spawnShell(command, cwd, limit, chunk => this.output.append(chunk));
    this.output.appendLine(`\n[exit ${result.exitCode}${result.timedOut ? ', timed out' : ''}]`);
    const joined = `${result.stdout}${result.stderr ? `\nSTDERR\n${result.stderr}` : ''}`.trim();
    const clipped = joined.length > 80_000 ? `${joined.slice(0, 40_000)}\n\n… output truncated …\n\n${joined.slice(-40_000)}` : joined;
    return `COMMAND ${JSON.stringify(command)}\nCWD ${cwd}\nEXIT ${result.exitCode}${result.timedOut ? ' (TIMEOUT)' : ''}\n${clipped || '(no output)'}`;
  }

  async runFile(pathInput: string, args: string[] = [], timeoutMs = 120_000, reason = ''): Promise<string> {
    const resolved = resolveWorkspacePath(pathInput);
    const stat = await vscode.workspace.fs.stat(resolved.uri);
    if (!(stat.type & vscode.FileType.File)) throw new Error(`${pathInput} is not a file.`);
    const command = this.commandForFile(resolved.uri.fsPath, args);
    const cwdRel = path.posix.dirname(resolved.relativePath.replace(/\\/g, '/'));
    return this.run(command, cwdRel === '.' ? '' : cwdRel, timeoutMs, reason || `Run ${resolved.relativePath}`, 'file');
  }

  async runProject(pathInput = '', timeoutMs = 180_000, reason = ''): Promise<string> {
    const cwd = this.resolveCwd(pathInput);
    const detection = await detectProject(cwd);
    if (!detection.runCommand) throw new Error(`Vectra could not determine how to run this project. Detected: ${detection.kind}. Use run_command with the project's documented command.`);
    return this.run(detection.runCommand, pathInput, timeoutMs, reason || `Run detected ${detection.kind} project`, 'project');
  }

  async runTestsAuto(cwdInput = '', timeoutMs = 180_000, reason = ''): Promise<string> {
    const cwd = this.resolveCwd(cwdInput);
    const detection = await detectProject(cwd);
    if (!detection.testCommand) throw new Error(`Vectra could not determine a test command for this ${detection.kind} project. Provide run_tests.command explicitly.`);
    return this.run(detection.testCommand, cwdInput, timeoutMs, reason || `Run detected ${detection.kind} tests`, 'tests');
  }

  dispose(): void { this.output.dispose(); }

  private resolveCwd(cwdInput: string): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error('Open a workspace folder before running commands.');
    if (!cwdInput.trim() || cwdInput.trim() === folders[0].name) return folders[0].uri.fsPath;
    const resolved = resolveWorkspacePath(cwdInput);
    return resolved.uri.fsPath;
  }

  private commandForFile(filePath: string, args: string[]): string {
    const ext = path.extname(filePath).toLowerCase();
    const q = shellQuote(filePath);
    const argText = args.map(shellQuote).join(' ');
    const withArgs = (base: string) => argText ? `${base} ${argText}` : base;
    const tmpBase = path.join(os.tmpdir(), `vectra-${randomUUID()}`);
    switch (ext) {
      case '.py': return withArgs(`python3 ${q}`);
      case '.js': case '.mjs': case '.cjs': return withArgs(`node ${q}`);
      case '.ts': case '.tsx': return withArgs(`npx --no-install tsx ${q}`);
      case '.sh': case '.bash': return withArgs(`bash ${q}`);
      case '.zsh': return withArgs(`zsh ${q}`);
      case '.ps1': return withArgs(`pwsh -File ${q}`);
      case '.rb': return withArgs(`ruby ${q}`);
      case '.php': return withArgs(`php ${q}`);
      case '.go': return withArgs(`go run ${q}`);
      case '.java': return withArgs(`java ${q}`);
      case '.cs': return withArgs(`dotnet script ${q}`);
      case '.csproj': return withArgs(`dotnet run --project ${q}`);
      case '.fsproj': return withArgs(`dotnet run --project ${q}`);
      case '.cpp': case '.cc': case '.cxx': {
        const out = `${tmpBase}${process.platform === 'win32' ? '.exe' : ''}`;
        return `${cppCompiler()} ${q} -std=c++17 -O0 -o ${shellQuote(out)} && ${withArgs(shellQuote(out))}`;
      }
      case '.c': {
        const out = `${tmpBase}${process.platform === 'win32' ? '.exe' : ''}`;
        return `cc ${q} -O0 -o ${shellQuote(out)} && ${withArgs(shellQuote(out))}`;
      }
      case '.rs': {
        const out = `${tmpBase}${process.platform === 'win32' ? '.exe' : ''}`;
        return `rustc ${q} -o ${shellQuote(out)} && ${withArgs(shellQuote(out))}`;
      }
      case '.swift': return withArgs(`swift ${q}`);
      case '.kt': case '.kts': return withArgs(`kotlinc -script ${q}`);
      case '.lua': return withArgs(`lua ${q}`);
      case '.r': return withArgs(`Rscript ${q}`);
      default: throw new Error(`No automatic runner is configured for ${ext || 'this file type'}. Use run_command for a custom runtime.`);
    }
  }
}

interface ProjectDetection { kind: string; runCommand?: string; testCommand?: string }
async function detectProject(cwd: string): Promise<ProjectDetection> {
  const exists = async (name: string) => { try { await vscode.workspace.fs.stat(vscode.Uri.file(path.join(cwd, name))); return true; } catch { return false; } };
  if (await exists('package.json')) {
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(cwd, 'package.json')));
      const pkg = JSON.parse(new TextDecoder().decode(raw));
      return { kind: 'Node.js', runCommand: pkg.scripts?.start ? 'npm start' : pkg.scripts?.dev ? 'npm run dev' : undefined, testCommand: pkg.scripts?.test ? 'npm test' : undefined };
    } catch { return { kind: 'Node.js', runCommand: 'npm start', testCommand: 'npm test' }; }
  }
  if (await exists('pyproject.toml') || await exists('pytest.ini') || await exists('requirements.txt')) return { kind: 'Python', runCommand: await exists('main.py') ? 'python3 main.py' : await exists('app.py') ? 'python3 app.py' : undefined, testCommand: 'python3 -m pytest' };
  if (await exists('Cargo.toml')) return { kind: 'Rust/Cargo', runCommand: 'cargo run', testCommand: 'cargo test' };
  if (await exists('go.mod')) return { kind: 'Go', runCommand: 'go run .', testCommand: 'go test ./...' };
  if (await exists('pom.xml')) return { kind: 'Java/Maven', runCommand: 'mvn exec:java', testCommand: 'mvn test' };
  if (await exists('gradlew')) return { kind: 'Gradle', runCommand: './gradlew run', testCommand: './gradlew test' };
  if (await exists('CMakeLists.txt')) return { kind: 'C/C++ CMake', runCommand: 'cmake --build build && ./build/app', testCommand: 'ctest --test-dir build --output-on-failure' };
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(cwd));
  const csproj = entries.find(([name,type]) => (type & vscode.FileType.File) && /\.csproj$/i.test(name));
  if (csproj) return { kind: '.NET/C#', runCommand: `dotnet run --project ${shellQuote(csproj[0])}`, testCommand: `dotnet test ${shellQuote(csproj[0])}` };
  const sln = entries.find(([name,type]) => (type & vscode.FileType.File) && /\.sln$/i.test(name));
  if (sln) return { kind: '.NET solution', testCommand: `dotnet test ${shellQuote(sln[0])}` };
  const mainCpp = entries.find(([name,type]) => (type & vscode.FileType.File) && /^(main|app)\.(cpp|cc|cxx|c)$/i.test(name));
  if (mainCpp) return { kind: 'C/C++ single-file', runCommand: mainCpp[0].endsWith('.c') ? `cc ${shellQuote(mainCpp[0])} -o /tmp/vectra-app && /tmp/vectra-app` : `${cppCompiler()} ${shellQuote(mainCpp[0])} -std=c++17 -o /tmp/vectra-app && /tmp/vectra-app` };
  return { kind: 'unknown' };
}

function cppCompiler(): string { return process.platform === 'win32' ? 'g++' : 'c++'; }
function shellQuote(value: string): string { if (process.platform === 'win32') return `"${value.replace(/"/g, '\\"')}"`; return `'${value.replace(/'/g, `'"'"'`)}'`; }
function spawnShell(command: string, cwd: string, timeoutMs: number, onData: (chunk: string) => void): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, env: process.env });
    let stdout = ''; let stderr = ''; let timedOut = false; let settled = false;
    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => { const text = chunk.toString(); onData(text); if (target === 'stdout') stdout = cap(stdout + text); else stderr = cap(stderr + text); };
    child.stdout?.on('data', (d: Buffer) => append('stdout', d)); child.stderr?.on('data', (d: Buffer) => append('stderr', d)); child.on('error', reject);
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGTERM'); } catch { /* noop */ } setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, 1500); }, timeoutMs);
    child.on('exit', code => { if (settled) return; settled = true; clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? (timedOut ? 124 : 1), timedOut }); });
  });
}
function cap(value: string): string { return value.length > 120_000 ? value.slice(-120_000) : value; }
