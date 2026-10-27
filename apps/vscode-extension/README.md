<p align="center">
  <img src="media/VectraLogo.png" alt="Vectra AI logo" width="112">
</p>

<h1 align="center">Vectra AI for VS Code</h1>

<p align="center"><strong>Your code. Your models. Your approval.</strong></p>

<p align="center">
  A practical coding agent that works with local GGUF models, Ollama, and leading cloud providers.
</p>

<p align="center">
  <a href="https://github.com/Laudarisd/vectra/blob/main/docs/ko/vscode-extension.md">한국어</a>
  · <a href="https://github.com/Laudarisd/vectra">GitHub</a>
  · <a href="CHANGELOG.md">Changelog</a>
</p>

Current release: **1.2.0**

<p align="center">
  <img src="https://raw.githubusercontent.com/Laudarisd/vectra/main/docs/assets/extension_gif.gif" alt="Vectra AI coding workflow" width="900">
</p>

## Build with AI without giving up control

Vectra brings repository-aware AI assistance into VS Code. Ask questions, inspect selected code, plan larger work, generate files, review proposed edits, and run approved commands from one focused sidebar.

Use a private local model on your own hardware or connect the provider you already trust. Vectra keeps file changes and command execution behind clear review and confirmation steps.

## What you can do

- **Ask about your codebase** — use workspace context, open files, selections, diagnostics, and attached documents.
- **Create and edit projects** — generate complete files or coordinated multi-file changes with review before writing.
- **Check selected code** — explain, diagnose, improve, or review a highlighted section directly from the editor.
- **Plan complex work** — inspect the plan before the agent continues with a larger task.
- **Use specialist agents** — planning, research, coding, testing, review, security, and documentation roles cooperate through guarded tools.
- **Run development tools** — execute approved commands, inspect Git state, search symbols, and follow definitions and references.
- **Work with documents and images** — attach images, PDF, DOCX, PPTX, XLSX, Markdown, and text files.
- **Research current information** — use bounded web search and page-reading tools when live information is needed.

<p align="center">
  <img src="https://raw.githubusercontent.com/Laudarisd/vectra/main/docs/assets/extenions_view.png" alt="Vectra AI sidebar and working modes" width="900">
</p>

## Four focused modes

| Mode | Best for |
| --- | --- |
| **Agent** | Planning, editing files, running approved tools, and completing multi-step work |
| **Ask** | Questions, explanations, architecture discussions, and read-only guidance |
| **Check Selection** | Reviewing or improving highlighted code |
| **Line Suggestion** | Focused suggestions around the current editor location |

## Local and cloud models

Vectra does not lock you into one model provider.

### Local

- **GGUF through llama.cpp** — select an existing model or let Vectra discover models on your computer.
- **Ollama** — connect to an existing local Ollama server.
- **OpenAI-compatible local APIs** — use tools such as LM Studio or another compatible endpoint.
- **CPU and GPU execution** — choose automatic, GPU-preferred, or CPU-only operation.

### Cloud

- OpenAI
- Anthropic
- Google Gemini
- OpenAI-compatible hosted services

API keys are stored with VS Code SecretStorage. Local GGUF model files are not bundled with the extension.

<p align="center">
  <img src="https://raw.githubusercontent.com/Laudarisd/vectra/main/docs/assets/model_selection.png" alt="Vectra local GGUF model discovery and selection" width="900">
</p>

## Getting started

1. Install **Vectra AI** from the VS Code Marketplace.
2. Open the Vectra icon in the Activity Bar.
3. Select **API Key** for a cloud provider or **Local Model** for GGUF/Ollama.
4. Use **Test** to confirm the connection.
5. Choose a mode and describe what you want to understand or build.

For local GGUF use, Vectra can locate `llama-server` from your PATH or install a compatible llama.cpp runtime. Large models may need significant RAM or VRAM and can take time to load.

## Designed around approval

Vectra separates reasoning from authority:

- Proposed file changes are shown for review before they are applied.
- Terminal commands require confirmation.
- Workspace paths are validated and kept inside the active workspace.
- Common credential and sensitive-file paths are blocked by default.
- Agent runs can be stopped from the sidebar.

Always review AI-generated code and commands before accepting them.

## Privacy

- Local-model prompts stay between VS Code and your configured local runtime.
- Cloud requests go only to the provider and endpoint you select.
- API credentials are stored in VS Code SecretStorage.
- Vectra does not include an advertising or analytics SDK.
- Local chat history and downloaded models remain on your machine.

See the full [privacy policy](PRIVACY.md) and [security policy](SECURITY.md).

## Requirements

- VS Code **1.90.0** or newer
- Node-compatible VS Code desktop environment
- For local models: enough disk space and system memory for the selected GGUF model
- For cloud models: a valid provider credential or compatible API endpoint

## Terminal and inline suggestions (preview)

- Approved commands run in the integrated terminal, where you can watch and type, while Vectra reads the output through shell integration. Set `vectra.commandExecution` to `background` to keep the hidden-shell behaviour.
- Inline ghost-text suggestions (Copilot-style) are opt-in: enable `vectra.inlineSuggestions.enabled` or click "Vectra inline" in the status bar. Point `vectra.inlineSuggestions.model` at a small, fast coder model; a large chat model is too slow for keystroke-level suggestions.

## Commands

Open the Command Palette and search for **Vectra** to:

- Open Vectra
- Check the current selection
- Configure a provider or API host
- Select or download a local model
- Test the model connection
- Open settings or logs

## Feedback and support

Found a problem or have an idea? Open an issue on [GitHub](https://github.com/Laudarisd/vectra/issues).

Vectra is proprietary software. See [LICENSE.txt](LICENSE.txt) for permitted use. Third-party models, providers, runtimes, and libraries remain subject to their own terms.
