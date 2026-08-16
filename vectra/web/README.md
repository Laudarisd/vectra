# Vectra Web

<p align="center">
  <a href="../vectra"><img src="https://img.shields.io/badge/VS_Code-Extension-007ACC?logo=visualstudiocode" alt="VS Code"></a>
  <a href="https://github.com/ggml-org/llama.cpp"><img src="https://img.shields.io/badge/AI-Local--first-2ea44f" alt="Local AI"></a>
  <a href="https://github.com/Laudarisd/vectra/releases"><img src="https://img.shields.io/badge/version-2.0.4-blue" alt="Version 2.0.4"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-Proprietary-orange" alt="License"></a>
</p>

**ChatGPT-style AI chat, running entirely on your machine.**

Vectra Web is the browser edition of Vectra: local-first AI chat with document support, no server-side account, no cloud required.

## Why Vectra Web

- **Local-first** — run GGUF models through llama.cpp, or auto-detect Ollama, LM Studio, vLLM, and other OpenAI-compatible runtimes already on your machine.
- **Any model, any time** — switch to OpenAI, Anthropic, Gemini, or an OpenAI-compatible endpoint whenever you want.
- **Documents in and out** — parse PDF, DOCX, PPTX, XLSX, RTF, code, and images; generate downloadable PDF, DOCX, Markdown, JSON, CSV, HTML, and code files.
- **Real history, kept local** — chats persist in a local SQLite file, with edit, resend, reopen, and delete.
- **Nothing phones home** — cloud keys live only in your browser session; the local server binds to `127.0.0.1`.

## Quick start

```bash
npm start
```

Open the printed localhost URL, choose **Local llama.cpp**, pick a `.gguf` file (and its `mmproj*.gguf` for vision), then **Start model**.

Prefer a cloud model? Open **Settings** and pick a provider instead.

## Requirements

Node.js 22.13+. llama.cpp only if you're running a model locally.

## Privacy

Chat history stays in `vectra.sqlite` under your OS's local app-data directory (override with `VECTRA_DATA_DIR`) — nothing is sent anywhere unless you choose a cloud provider, and API keys are never written to that database.

---

Created by [Sudip Laudari](https://github.com/Laudarisd). [Source & issues](https://github.com/Laudarisd/vectra) · Proprietary — see the repository [license](../LICENSE).
