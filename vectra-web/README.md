<p align="center">
  <img src="https://raw.githubusercontent.com/Laudarisd/vectra/main/vectra-extension/media/VectraLogo.png" alt="Vectra Web logo" width="128" height="128">
</p>

<h1 align="center">Vectra Web</h1>

<p align="center">
  An agentic AI workspace for research, files, images, and document creation.
</p>

<p align="center">
  <a href="../vectra-extension"><img src="https://img.shields.io/badge/Also_available-VS_Code_Extension-007ACC?logo=visualstudiocode" alt="Vectra AI for VS Code"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=laudarisd.vectra-ai"><img src="https://img.shields.io/badge/Visual_Studio_Marketplace-Install_Vectra_AI-007ACC?logo=visualstudiocode" alt="Install Vectra AI from the Visual Studio Marketplace"></a>
  <a href="https://github.com/ggml-org/llama.cpp"><img src="https://img.shields.io/badge/Models-CPU%20%7C%20GPU%20%7C%20Cloud-2ea44f" alt="CPU, GPU, and cloud model support"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-Proprietary-orange" alt="Proprietary license"></a>
</p>

Vectra Web is the browser edition of Vectra. It combines conversational AI with persistent research, live web tools, document and image understanding, local model discovery, file generation, and a universal preview viewer.

Run it with a GGUF model on CPU or GPU, connect an OpenAI-compatible inference server already running on your network, or use OpenAI, Anthropic, or Gemini.

## What it can do

- Answer general questions and complete multi-step agent tasks.
- Search current web sources, weather, stocks, cryptocurrencies, and academic papers.
- Continue researching across multiple sources when one result is insufficient.
- Read PDF, DOCX, PPTX, XLSX, RTF, Markdown, text, source code, and images.
- Apply OCR and visual analysis to scans, screenshots, diagrams, and PDF pages.
- Generate PDF, DOCX, Markdown, JSON, CSV, HTML, and source-code artifacts.
- Preview images, OCR/detection regions, PDFs, Markdown, code, text, and document content before download.
- Preserve chat conversations in a local SQLite history store.
- Edit and resend prompts and reopen generated artifacts from saved conversations.
- Use specialized planner, researcher, coder, tester, reviewer, security, and documentation roles.

## Quick start

Requirements: Node.js 22.13 or newer.

```bash
cd vectra-web
npm install
npm start
```

Open the URL printed in the terminal, normally:

```text
http://127.0.0.1:4173
```

Open **Model settings**, choose a model source, test the connection, and save it.

## Model sources

| Source | What Vectra does | Requirements |
| --- | --- | --- |
| **OpenAI API** | Connects to OpenAI | API key |
| **Anthropic API** | Connects to Claude models | API key |
| **Google Gemini API** | Connects to Gemini models | API key |
| **Local API** | Connects to a remote or self-hosted OpenAI-compatible server | Base URL and key/placeholder |
| **Auto-detect models on this PC** | Finds Ollama models, running local APIs, and GGUF files | A model or runtime installed locally |
| **Choose a llama.cpp model** | Starts and manages a selected GGUF model | `.gguf` model and `llama-server` |
| **Download a recommended model** | Suggests GGUF models for detected hardware | Download location and internet access |

## Automatic model discovery

Vectra combines three discovery methods:

1. Scans common model folders, Hugging Face caches, mounted storage, and user-selected folders for `.gguf` files.
2. Reads installed Ollama models from its API, CLI, and local manifest index.
3. Probes the standard local ports for Ollama, LM Studio, Jan, GPT4All, KoboldCpp, text-generation-webui, llama.cpp/LocalAI, vLLM, and Msty.

Select **Auto-detect models on this PC**, then use **Scan this PC again** if a server or model was added after Vectra started. Use **Add another model folder** for a custom location.

## Run a GGUF model

Select **Choose a llama.cpp model from this PC**, choose the GGUF file, and configure:

- **Device**: Auto, GPU, or CPU.
- **Context**: available prompt and conversation window.
- **GPU layers**: model layers offloaded to the GPU.
- **Split mode**: distribution strategy for multiple GPUs.
- **CPU thread profile**: balanced, maximum-performance, or efficiency-focused CPU use.
- **Keep MoE weights on CPU**: reduces VRAM use for large mixture-of-experts models.
- **Vision projector**: matching `mmproj*.gguf` for supported vision models.

Vectra can locate `llama-server` on `PATH` or use an executable selected in Advanced settings.

You can also start it yourself:

```bash
llama-server \
  --model /absolute/path/to/model.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 16384
```

## Connect a local or self-hosted API

The endpoint must use the OpenAI-compatible format expected by every Vectra product:

```http
GET  /v1/models
POST /v1/chat/completions
```

Configure a base URL such as:

```text
http://127.0.0.1:8080/v1
```

Test the server manually:

```bash
curl http://127.0.0.1:8080/v1/models
```

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "your-model-id",
    "messages": [
      {"role": "user", "content": "Hello from Vectra Web."}
    ]
  }'
```

Enter a real API key when authentication is enabled. Otherwise, use a non-secret placeholder such as `local`. Enable self-signed certificate support only for a trusted development server; disabling certificate verification weakens connection security.

## Documents, images, and generated files

Attach one or more files with the **+** button or drag them into the composer. Vectra extracts usable text and visual evidence before sending bounded context to the selected model.

Generated artifacts appear with two actions:

- **Preview** opens the file in the universal viewer.
- **Download** saves the original generated bytes.

The viewer supports:

| Artifact | Preview behavior |
| --- | --- |
| Images | Scaled visual preview with OCR/detection overlays when available |
| PDF | Native embedded PDF viewer |
| Markdown | Rendered document view |
| Code and text | Preserved monospace formatting |
| DOCX and other generated documents | Readable generated-content preview |

On smaller screens, the viewer opens as a full-screen panel.

## Live research

Vectra can use dedicated tools for current information instead of relying on model memory. Search providers have fallbacks, page retrieval can use a reader fallback for blocked or dynamic pages, and academic queries use structured paper metadata.

For best results, ask clearly for current data or sourced research, for example:

```text
Compare today's weather in Seoul and Kathmandu and cite the sources.
Research the latest releases of this library and explain the migration risks.
Find recent papers about multimodal document extraction and summarize the evidence.
```

## Local data and privacy

- The server binds to `127.0.0.1` by default.
- Chats are stored in a local SQLite database.
- API keys stay in the browser session and are not written into chat history.
- Local-runtime requests remain on the configured machine.
- Cloud providers receive only requests sent while that provider is selected.
- Local GGUF file selection and runtime launch are disabled when Vectra binds to a non-loopback host.

Default history and database paths use the operating system's local application-data directory.

## Configuration environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `VECTRA_HOST` | Web server bind address | `127.0.0.1` |
| `VECTRA_PORT` | Web server port | `4173` |
| `VECTRA_DATA_DIR` | Parent directory for local application data | OS application-data directory |
| `VECTRA_DATABASE_PATH` | Exact SQLite database path | Derived automatically |
| `VECTRA_HISTORY_DIR` | JSON history mirror directory | Beside the database |
| `VECTRA_MODELS_DIR` | Default model storage/search directory | `~/.vectra/models` |
| `VECTRA_MAX_PDF_VISUAL_PAGES` | Maximum PDF pages sent through visual analysis | Application default |
| `VECTRA_MAX_CONCURRENT_SUBAGENTS` | Concurrent delegated tool calls | `2` |

Example:

```bash
VECTRA_PORT=4180 VECTRA_MODELS_DIR=/path/to/models npm start
```

## Troubleshooting

### Weather or web research times out

Confirm the machine running Vectra Web can access the internet. Retry the request so another configured search fallback can be used, and inspect the server terminal for the failed provider.

### No local models appear

Start the local runtime first, select **Scan this PC again**, or add the folder containing the GGUF file. Confirm the runtime exposes its models endpoint.

### `@napi-rs/canvas` cannot be found

Install the web dependencies before starting the server:

```bash
cd vectra-web
npm install
npm start
```

### A large model fails to load

Try Auto device mode, fewer GPU layers, a smaller context window, a smaller quantization, or **Keep MoE weights on CPU**. Inspect the runtime logs in Advanced llama.cpp settings.

### A generated preview is blank

Refresh the browser after rebuilding. For a previously generated artifact, reopen its saved conversation and select **Preview** again.

## Development

```bash
npm install
npm run build
npm test
```

The production build compiles the shared core, copies browser assets into `dist`, and enforces a browser bundle size budget.

## Related links

- [Main Vectra documentation](../README.md)
- [Vectra AI for VS Code](../vectra-extension/README.md)
- [Install from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=laudarisd.vectra-ai)
- [Source and issues](https://github.com/Laudarisd/vectra)

Created by [Sudip Laudari](https://github.com/Laudarisd). Vectra is proprietary software; see the repository [license](../LICENSE).
