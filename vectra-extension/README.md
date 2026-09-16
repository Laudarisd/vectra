<p align="center">
  <img src="https://raw.githubusercontent.com/Laudarisd/vectra/main/vectra-extension/media/VectraLogo.png" alt="Vectra AI logo" width="128" height="128">
</p>

<h1 align="center">Vectra AI for VS Code</h1>

<p align="center">
  An AI coding agent with local CPU/GPU and cloud model support.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=laudarisd.vectra-ai"><img src="https://img.shields.io/badge/Visual_Studio_Marketplace-Install_Vectra_AI-007ACC?logo=visualstudiocode" alt="Install Vectra AI from the Visual Studio Marketplace"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=laudarisd.vectra-ai"><img src="https://img.shields.io/visual-studio-marketplace/v/laudarisd.vectra-ai?label=version" alt="Visual Studio Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=laudarisd.vectra-ai"><img src="https://img.shields.io/visual-studio-marketplace/i/laudarisd.vectra-ai?label=installs" alt="Visual Studio Marketplace installs"></a>
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/VS_Code-1.90%2B-007ACC?logo=visualstudiocode" alt="Requires VS Code 1.90 or newer"></a>
  <a href="LICENSE.txt"><img src="https://img.shields.io/badge/license-Proprietary-orange" alt="Proprietary license"></a>
</p>

Vectra AI is a repository-aware coding agent inside VS Code. It can investigate a codebase, plan work, edit files with reviewable changes, inspect diagnostics, run approved commands, test its work, research current information, and work with documents and images.

Use a GGUF model directly through llama.cpp, connect a running local API, use Ollama, or select OpenAI, Anthropic, or Gemini.

> Published on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=laudarisd.vectra-ai) as **Vectra AI** (`laudarisd.vectra-ai`).

Current extension release: **1.1.8**.

![Vectra AI with a local Qwen3 4B model](https://raw.githubusercontent.com/Laudarisd/vectra/main/docs/assets/vectra-local-model.png)

## What it can do

- Read, search, and understand files across your workspace.
- Explain code, investigate errors, and inspect VS Code diagnostics.
- Plan and complete multi-step coding tasks instead of stopping after one answer.
- Create, update, rename, and organize files with reviewable edits.
- Run builds, scripts, tests, and terminal commands after approval.
- Review changes for correctness, regressions, maintainability, and security.
- Search the web for current information, technical sources, markets, and research papers.
- Read PDF, DOCX, PPTX, XLSX, RTF, Markdown, source code, text, and images.
- Use OCR and vision-capable models for screenshots, scans, diagrams, and visual documents.
- Generate PDF, DOCX, Markdown, JSON, CSV, HTML, and source-code files.
- Delegate focused work to planner, researcher, coder, tester, reviewer, security, and documentation roles.
- Continue long tool-driven work until it is complete, cancelled, or genuinely blocked.

## Install from the Marketplace

[Install Vectra AI](https://marketplace.visualstudio.com/items?itemName=laudarisd.vectra-ai), then select the Vectra icon in the VS Code Activity Bar.

You can also install it from VS Code:

1. Open **Extensions**.
2. Search for **Vectra AI**.
3. Confirm the publisher is **laudarisd**.
4. Select **Install**.

## Choose how your model runs

| Mode | Use it when | Requirements |
| --- | --- | --- |
| **Local GGUF** | You want Vectra to load and manage a model directly | A `.gguf` model and `llama-server` |
| **Local API** | LM Studio, LocalAI, vLLM, Jan, or another server already hosts the model | An OpenAI-compatible endpoint |
| **Ollama** | You already manage models with Ollama | A running Ollama installation |
| **Cloud API** | You want a hosted OpenAI, Anthropic, or Gemini model | Provider API key |

Local GGUF inference supports:

- **Auto**: detects available acceleration and selects practical defaults.
- **GPU**: prefers GPU offloading and can distribute layers across multiple GPUs.
- **CPU**: forces CPU-only execution.
- **Hybrid**: keeps part of the model in system memory when the entire model does not fit in VRAM.

## Quick start with a GGUF model

1. Open the Vectra sidebar.
2. Select **Local Model**.
3. Choose an installed `.gguf` model or download a recommended model.
4. Let Vectra locate `llama-server`, or select the executable manually.
5. Choose **Auto**, **GPU**, or **CPU** and test the connection.
6. Send a message about the current workspace.

Vectra searches common model folders, Hugging Face caches, mounted storage, application model directories, and previously selected locations. It also detects Ollama models and running local inference servers.

A quantized instruction-tuned 3B–4B model is a practical starting point. Larger models often improve reasoning but require more RAM or VRAM.

## Connect a local API

Custom inference servers must provide an OpenAI-compatible API. Vectra uses:

```http
GET  /v1/models
POST /v1/chat/completions
```

For example, start llama.cpp yourself:

```bash
llama-server \
  --model /absolute/path/to/model.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 16384
```

Then configure:

```text
Provider: Local API
Base URL: http://127.0.0.1:8080/v1
API key: local
```

Use a real token instead of `local` when the server requires authentication. Tool calling works best when the selected model and server both support OpenAI-style tool calls.

## Vision models

Vision-capable GGUF models normally require a matching `mmproj*.gguf` file. Keep it beside the main model for automatic detection, or run **Vectra: Select Local Vision Projector (mmproj)**.

The projector must match the model family and release. An unrelated projector can cause load failures or incorrect visual results.

## Working safely

- File modifications are presented as reviewed changes.
- Commands and tests require approval before execution.
- Sensitive files are excluded by default.
- Common generated and dependency directories are excluded from repository search.
- Local prompts remain on your computer while a local provider is active.
- A cloud provider receives context only when you select that provider and send a request.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Useful commands

Open the Command Palette and run:

| Command | Purpose |
| --- | --- |
| **Vectra: Open Vectra** | Focus the Vectra sidebar |
| **Vectra: Check Selection with Vectra** | Ask about selected editor text |
| **Vectra: Select Local GGUF Model** | Find or choose a GGUF model |
| **Vectra: Download Model** | Find and download a compatible model |
| **Vectra: Configure API Key** | Configure local or cloud access |
| **Vectra: Select AI Model** | Change the active model |
| **Vectra: Test Model Connection** | Validate the current provider |
| **Vectra: Attach Files** | Add documents or images to the chat |
| **Vectra: Show Vectra Logs** | Inspect model and runtime diagnostics |

You can also select code in the editor, right-click it, and choose **Check Selection with Vectra**.

## Troubleshooting

### Vectra cannot find `llama-server`

Install [llama.cpp](https://github.com/ggml-org/llama.cpp), add `llama-server` to your `PATH`, or set **Vectra › Llama Cpp: Server Path** in Settings.

### A model is not discovered

Run **Select Local GGUF Model** and choose the file or its folder manually. Confirm the main model ends in `.gguf`; projector-only `mmproj` files are not selectable as chat models.

### The model is slow or the computer gets hot

Use the **Auto** CPU thread profile, reduce context size, select a smaller quantization, or increase GPU offloading when enough VRAM is available.

### Local API model discovery fails

Verify the base URL includes `/v1` when required and test it directly:

```bash
curl http://127.0.0.1:8080/v1/models
```

### Where are the logs?

Run **Vectra: Show Vectra Logs** and inspect the **Vectra · llama.cpp** output channel for runtime startup details.

## Requirements

- VS Code 1.90 or newer
- macOS, Windows, or Linux
- Enough RAM or VRAM for the selected model
- `llama-server` only for directly loaded GGUF models
- An API key only when the selected provider requires one

## Development

```bash
npm install
npm run build
npm test
```

Press `F5` in VS Code to launch an Extension Development Host.

Create a Marketplace-ready VSIX:

```bash
npm run package
```

The production bundle is minified and checked against a size budget during the build.

## Links

- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=laudarisd.vectra-ai)
- [Source and issues](https://github.com/Laudarisd/vectra)
- [Changelog](CHANGELOG.md)
- [Architecture](ARCHITECTURE.md)
- [Code structure](CODE_STRUCTURE.md)

Created by [Sudip Laudari](https://github.com/Laudarisd). Vectra is proprietary software; see [LICENSE.txt](LICENSE.txt).
