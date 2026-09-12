<p align="center">
  <img src="vectra-extension/media/VectraLogo.png" alt="Vectra logo" width="128" height="128">
</p>

<h1 align="center">Vectra</h1>

<p align="center">
  A capable AI agent for VS Code and the web, with local and cloud model support.
</p>

<p align="center">
  <a href="./vectra-extension"><img src="https://img.shields.io/badge/VS_Code-Extension-007ACC?logo=visualstudiocode" alt="VS Code extension"></a>
  <a href="./vectra-web"><img src="https://img.shields.io/badge/Web-Local_AI_Workspace-4f46e5" alt="Vectra Web"></a>
  <a href="https://github.com/ggml-org/llama.cpp"><img src="https://img.shields.io/badge/Models-CPU%20%7C%20GPU%20%7C%20Cloud-2ea44f" alt="CPU, GPU, and cloud model support"></a>
  <a href="./vectra-extension/CHANGELOG.md"><img src="https://img.shields.io/badge/extension-1.1.8-blue" alt="Extension version 1.1.8"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Proprietary-orange" alt="Proprietary license"></a>
</p>

Vectra brings a capable AI agent to your editor and browser. Run a downloaded GGUF model on CPU, GPU, or a hybrid configuration; connect an existing inference server; or choose a supported cloud provider.

Your local model, prompts, files, and chat history remain on your computer unless you explicitly select a remote provider.

> The VS Code extension is published as **Vectra AI** (`laudarisd.vectra-ai`). It is the upgraded and actively maintained successor to the original Vectra extension.

![Vectra running a local Qwen3 4B model](docs/assets/vectra-local-model.png)

## What Vectra does

- **Works as an agent, not only a chatbot**: plans multi-step work, selects tools, checks results, and continues researching when more evidence is needed.
- **Understands repositories**: reads and searches files, inspects diagnostics, proposes edits, reviews diffs, and runs approved commands and tests.
- **Uses specialized roles**: planner, researcher, coder, tester, reviewer, security, and documentation agents can handle focused parts of a larger task with restricted tool access.
- **Searches live information**: supports current web research, weather, markets, stocks, cryptocurrencies, and academic-paper discovery with fallback sources.
- **Understands documents and images**: reads PDF, DOCX, PPTX, XLSX, RTF, Markdown, code, text, and images, including OCR and visual inspection.
- **Creates downloadable files**: generates PDF, DOCX, Markdown, JSON, CSV, HTML, source-code files, and other text formats.
- **Previews generated work**: Vectra Web can display images, OCR regions, PDFs, Markdown, text, code, and generated-document content before download.
- **Runs locally or remotely**: use GGUF models, Ollama, an OpenAI-compatible local server, OpenAI, Anthropic, or Gemini.

## Products

| Product | Best for | Documentation |
| --- | --- | --- |
| **Vectra AI for VS Code** | Repository-aware coding, reviewed edits, terminal tasks, and local development | [Extension guide](vectra-extension/README.md) |
| **Vectra Web** | General AI chat, research, attachments, OCR, and document generation | [Web guide](vectra-web/README.md) |

## Local model discovery

Choose **Local Model** in the extension or **Auto-detect models on this PC** in Vectra Web. Vectra performs one bounded discovery pass across three sources:

1. **GGUF files** in common model folders, mounted storage, user-selected directories, and supported environment-variable paths.
2. **Ollama models** reported by the local API, the `ollama` CLI, or the on-disk manifest index.
3. **Running local APIs** at the standard ports used by Ollama, LM Studio, Jan, GPT4All, KoboldCpp, text-generation-webui, llama.cpp/LocalAI, vLLM, and Msty.

Common GGUF locations include:

```text
~/.vectra/models
~/Models
~/models
~/.cache/huggingface/hub
~/llama.cpp/models
LM Studio, Jan, GPT4All, Msty, and text-generation-webui model folders
```

Vectra also respects model paths such as `HF_HOME`, `HUGGINGFACE_HUB_CACHE`, `LLAMA_MODELS`, `MODELS_DIR`, `GPT4ALL_MODEL_PATH`, and `OLLAMA_MODELS` where applicable.

If a model is not found, select its directory manually. Vectra searches a selected folder first and follows directory links while keeping the scan time and breadth bounded.

## Run a GGUF model with llama.cpp

Install [llama.cpp](https://github.com/ggml-org/llama.cpp) and make sure `llama-server` is on your `PATH`. Then either let Vectra launch the model or start the server yourself:

```bash
llama-server \
  --model /absolute/path/to/model.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 8192
```

For a vision-capable GGUF model, also provide its matching projector:

```bash
llama-server \
  --model /absolute/path/to/vision-model.gguf \
  --mmproj /absolute/path/to/mmproj-model-f16.gguf \
  --host 127.0.0.1 \
  --port 8080
```

The resulting Vectra base URL is:

```text
http://127.0.0.1:8080/v1
```

## Connect any local API

For consistent support across **Vectra AI for VS Code** and **Vectra Web**, a custom local or self-hosted server must expose an **OpenAI-compatible API**.

At minimum, Vectra expects:

```http
GET  /v1/models
POST /v1/chat/completions
```

The chat endpoint should accept OpenAI-style `messages`, `model`, and optional `tools`, and return `choices[0].message.content`. Streaming servers should use OpenAI-compatible server-sent events.

You can check an endpoint before adding it to Vectra:

```bash
curl http://127.0.0.1:8080/v1/models
```

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "your-model-id",
    "messages": [
      {"role": "user", "content": "Say hello from Vectra."}
    ]
  }'
```

If the server requires a token, add `-H 'Authorization: Bearer YOUR_API_KEY'` and save the same key in Vectra. If it does not use authentication, enter a non-secret placeholder such as `local` when the Vectra UI requests a key. Keep `/v1` in the configured base URL when your runtime requires it.

### Common local API examples

Ollama provides an OpenAI-compatible endpoint after a model is installed:

```bash
ollama pull qwen3:4b
ollama serve
```

Use `http://127.0.0.1:11434/v1`, or choose Vectra's dedicated **Ollama** provider.

Start a model with vLLM's OpenAI-compatible server:

```bash
vllm serve Qwen/Qwen3-4B \
  --host 127.0.0.1 \
  --port 8000
```

Use `http://127.0.0.1:8000/v1` as the base URL.

For LM Studio, load a model and start its local server, then use its displayed OpenAI-compatible URL, normally `http://127.0.0.1:1234/v1`.

## Quick start

### VS Code extension

1. Install Vectra AI and open the Vectra sidebar.
2. Select **Local Model** to discover a GGUF file or running local model server.
3. Select the model, test the connection, and start chatting.

For a custom endpoint, select **Local API**, enter its OpenAI-compatible base URL, add an API key if required, and select a model returned by `/v1/models`.

### Web app

```bash
cd vectra-web
npm install
npm start
```

Open the printed localhost URL. Choose **Local llama.cpp**, **Auto-detect models on this PC**, **Local API**, or a cloud provider in Settings.

## Requirements

- macOS, Windows, or Linux
- VS Code 1.90 or newer for the extension
- Node.js 22.13 or newer for Vectra Web
- `llama-server` only when Vectra should load a GGUF model directly
- Enough RAM or VRAM for the selected model and context size
- An API key only when the selected provider requires one

A quantized instruction-tuned 3B–4B model is a practical starting point. Larger models can improve results but require more memory and may run more slowly.

## Development

Build and test the extension:

```bash
cd vectra-extension
npm install
npm run build
npm test
```

Press `F5` in VS Code to open an Extension Development Host.

Build and test Vectra Web:

```bash
cd vectra-web
npm install
npm run build
npm test
```

Architecture details are in [ARCHITECTURE.md](vectra-extension/ARCHITECTURE.md), [CODE_STRUCTURE.md](vectra-extension/CODE_STRUCTURE.md), and the active roadmap in [TASKS.md](TASKS.md).

## Privacy and safety

- Local prompts and files stay on your computer when using a local provider.
- Remote providers receive only the requests you send through that provider.
- Vectra Web stores chat history locally in SQLite.
- Workspace edits remain reviewable, and command execution requires approval.
- API credentials are stored using the product's local credential/session mechanism rather than conversation history.

See [PRIVACY.md](vectra-extension/PRIVACY.md) and [SECURITY.md](vectra-extension/SECURITY.md) for details.

## Author and license

Created by [Sudip Laudari](https://github.com/Laudarisd). Source and support: [github.com/Laudarisd/vectra](https://github.com/Laudarisd/vectra).

Vectra is proprietary software. See [LICENSE](LICENSE) for permitted use.
