<p align="center">
  <img src="https://raw.githubusercontent.com/Laudarisd/vectra/main/apps/vscode-extension/media/VectraLogo.png" alt="Vectra AI logo" width="112">
</p>

<h1 align="center">Vectra AI for VS Code</h1>

<p align="center"><strong>Your code. Your models. Your approval.</strong></p>

<p align="center">
  An AI coding agent for VS Code. Works with GGUF models through llama.cpp, Ollama, LM Studio, and OpenAI, Anthropic, or Gemini.
</p>

<p align="center">
  <a href="https://github.com/Laudarisd/vectra">GitHub</a>
  · <a href="https://github.com/Laudarisd/vectra/blob/main/apps/vscode-extension/CHANGELOG.md">Changelog</a>
  · <a href="https://github.com/Laudarisd/vectra/blob/main/docs/ko/vscode-extension.md">한국어</a>
  · <a href="https://github.com/Laudarisd/vectra/issues">Issues</a>
</p>

<p align="center">Current release: <strong>1.2.1</strong></p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Laudarisd/vectra/main/docs/assets/extension_gif.gif" alt="Vectra AI coding workflow" width="900">
</p>

## Why Vectra

Vectra brings a repository-aware AI agent into the VS Code sidebar. It reads your workspace, explains and reviews code, plans larger tasks, generates and edits files, and runs development commands. Every file change is shown as a diff before it is written, and every command waits for your confirmation.

Run a private model on your own hardware, or connect the cloud provider you already use. Nothing leaves your machine unless you choose a cloud provider.

## What you can do

- **Ask about your codebase.** Vectra uses workspace files, open editors, selections, diagnostics, and attached documents as context.
- **Create and edit projects.** Generate complete files or coordinated multi-file changes, then review each diff before applying.
- **Check selected code.** Highlight code, right-click, and ask Vectra to explain, diagnose, improve, or review it.
- **Plan complex work.** Review and approve the plan before the agent continues.
- **Use specialist agents.** Planner, researcher, coder, tester, reviewer, security, and documentation roles share the work through guarded tools.
- **Run development tools.** Execute approved commands in the integrated terminal, inspect Git state, search symbols, and follow definitions and references.
- **Get inline suggestions.** Opt-in ghost-text completions while you type, powered by any configured model.
- **Attach documents and images.** Images, PDF, DOCX, PPTX, XLSX, Markdown, and text files.
- **Research live information.** Bounded web search and page reading when a task needs current data.
- **Add project skills.** Drop reusable instructions in `.vectra/skills/<name>/SKILL.md` and Vectra loads them on demand.

<p align="center">
  <img src="https://raw.githubusercontent.com/Laudarisd/vectra/main/docs/assets/extenions_view.png" alt="Vectra AI sidebar and working modes" width="900">
</p>

## Modes

| Mode | Best for |
| --- | --- |
| **Agent** | Planning, editing files, running approved tools, and completing multi-step work |
| **Ask** | Questions, explanations, architecture discussions, and read-only guidance |
| **Check Selection** | Reviewing or improving highlighted code |
| **Line Suggestion** | Focused suggestions around the current cursor position |

## Models

Vectra does not lock you into one provider. Switch any time from the sidebar.

| Provider | How it connects |
| --- | --- |
| **Local GGUF (llama.cpp)** | Pick a model file, or let Vectra scan your computer. Vectra finds `llama-server` on your PATH or installs a compatible runtime. |
| **Ollama** | Connects to a running Ollama server (default `http://localhost:11434`). |
| **Local API** | Any OpenAI-compatible endpoint, such as LM Studio or a self-hosted server. Self-signed TLS is supported. |
| **OpenAI** | API key. |
| **Anthropic** | API key. |
| **Google Gemini** | API key. |

Local inference can run in automatic, GPU-preferred, or CPU-only mode. Multi-GPU split, thread profiles, MoE-on-CPU, and vision projectors (mmproj) are available in settings. API keys are stored in VS Code SecretStorage. Model files are not bundled with the extension.

<p align="center">
  <img src="https://raw.githubusercontent.com/Laudarisd/vectra/main/docs/assets/model_selection.png" alt="Vectra local GGUF model discovery and selection" width="900">
</p>

## Getting started

1. Install **Vectra AI** from the Marketplace.
2. Click the Vectra icon in the Activity Bar.
3. Choose **API Key** for a cloud provider, or **Local Model** for GGUF, Ollama, or a Local API.
4. Click **Test** to confirm the connection.
5. Pick a mode and describe what you want to understand or build.

Large local models need enough RAM or VRAM and can take a while to load the first time. Use **Download Model** from the Command Palette to fetch a GGUF model into `~/.vectra/models`.

## Terminal and inline suggestions

- **Terminal execution.** Approved commands run in the integrated terminal, so you can watch and type while Vectra reads the output through shell integration. Set `vectra.commandExecution` to `background` to run in a hidden shell instead.
- **Inline suggestions (preview).** Enable `vectra.inlineSuggestions.enabled` or click **Vectra inline** in the status bar. Point `vectra.inlineSuggestions.model` at a small, fast coder model (1.5B to 3B). A large chat model is too slow for keystroke-level suggestions.

## Built around approval

- File changes are shown as diffs for review before they are applied.
- Terminal commands require confirmation.
- Paths are validated and kept inside the active workspace.
- Files that commonly hold credentials are blocked unless you enable `vectra.allowSensitiveFiles`.
- Any agent run can be stopped from the sidebar.

Always review AI-generated code and commands before accepting them.

## Privacy

- Local-model prompts stay between VS Code and your local runtime.
- Cloud requests go only to the provider and endpoint you select.
- API keys are stored in VS Code SecretStorage.
- No advertising or analytics SDK is included.
- Chat history and downloaded models stay on your machine.

See the [privacy policy](https://github.com/Laudarisd/vectra/blob/main/apps/vscode-extension/PRIVACY.md) and [security policy](https://github.com/Laudarisd/vectra/blob/main/apps/vscode-extension/SECURITY.md).

## Commands

Open the Command Palette and type **Vectra**:

| Command | What it does |
| --- | --- |
| Open Vectra | Open the sidebar |
| Check Selection with Vectra | Review the highlighted code (also in the editor right-click menu) |
| Configure API Provider or Host | Set a cloud API key or a Local API endpoint |
| Select Local GGUF Model | Pick or scan for a local model |
| Download Model | Download a GGUF model |
| Select AI Model | Choose the active model for the current provider |
| Select Local Vision Projector (mmproj) | Attach a vision projector to a local model |
| Test Model Connection | Verify the current provider works |
| Attach Files | Add documents or images to the chat |
| Toggle Inline Suggestions | Turn ghost-text completions on or off |
| Open Settings | Jump to Vectra settings |
| Show Vectra Logs | Open the output channel |

## Key settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `vectra.provider` | `llamaCpp` | Active provider |
| `vectra.deviceMode` | `auto` | `auto`, `gpu`, or `cpu` for local inference |
| `vectra.llamaCppContextSize` | `16384` | Context window for llama.cpp |
| `vectra.ollamaContextSize` | `8192` | Context window requested from Ollama |
| `vectra.openaiCompatibleBaseUrl` | `http://localhost:1234/v1` | Local API endpoint |
| `vectra.commandExecution` | `terminal` | Run commands in the terminal or a hidden shell |
| `vectra.inlineSuggestions.enabled` | `false` | Inline ghost-text suggestions |
| `vectra.agentHarness` | `deepagents` | Agent orchestration (`deepagents` or `vectra`) |
| `vectra.localReasoning` | `fast` | Hidden-reasoning policy for local models |
| `vectra.maxAgentSteps` | `12` | Read/reason cycles per Agent request |
| `vectra.maxConcurrentSubagents` | `2` | Parallel subagent tool calls |
| `vectra.excludeGlob` | `node_modules`, `.git`, `dist`, … | Folders hidden from workspace search |
| `vectra.allowSensitiveFiles` | `false` | Allow access to credential-like files |

All settings are under **Vectra** in the Settings editor.

## Requirements

- VS Code **1.90.0** or newer (desktop).
- Local models: enough disk space and RAM or VRAM for the chosen GGUF model.
- Cloud models: a valid API key or a reachable OpenAI-compatible endpoint.

## Troubleshooting

- **Local model will not start.** Check **Show Vectra Logs**. Set `vectra.llamaCppServerPath` if `llama-server` is not on your PATH.
- **Out of memory.** Choose a smaller quantization, lower `vectra.llamaCppContextSize`, or set `vectra.deviceMode` to `cpu`.
- **Slow replies.** Local loading and CPU inference can be slow. Vectra waits up to an hour by default (`vectra.localRequestTimeoutSeconds`).
- **Ollama ignores context.** Raise `vectra.ollamaContextSize`; Ollama defaults to a small window.

## Feedback and license

Found a problem or have an idea? Open an issue on [GitHub](https://github.com/Laudarisd/vectra/issues).

If Vectra saved you from typing one more boilerplate file, a ⭐ on [GitHub](https://github.com/Laudarisd/vectra) costs nothing and makes the developer smile (and the models reportedly run 0% faster, but it still helps). 
Vectra is proprietary software. See [LICENSE.txt](https://github.com/Laudarisd/vectra/blob/main/apps/vscode-extension/LICENSE.txt) for permitted use. Third-party models, providers, runtimes, and libraries remain subject to their own terms.
