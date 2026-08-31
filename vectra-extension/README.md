# Vectra for VS Code

<p align="center">
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/VS_Code-1.90%2B-007ACC?logo=visualstudiocode" alt="VS Code"></a>
  <a href="https://github.com/ggml-org/llama.cpp"><img src="https://img.shields.io/badge/AI-Local--first-2ea44f" alt="Local AI"></a>
  <a href="https://github.com/Laudarisd/vectra/releases"><img src="https://img.shields.io/badge/version-1.1.4-blue" alt="Version 1.1.4"></a>
  <a href="LICENSE.txt"><img src="https://img.shields.io/badge/license-Proprietary-orange" alt="License"></a>
</p>

**Your own AI pair programmer — running on your machine, not someone else's GPU.**

> Published on the VS Code Marketplace as **Vectra AI** (`laudarisd.vectra-ai`) — an upgraded, continued release of the original Vectra agent, now under a new Marketplace listing.

Vectra is a repo-aware coding agent for VS Code. Point it at a GGUF model and llama.cpp, and it reads your code, proposes reviewed edits, and runs approved commands — no API key, no per-token bill, no code leaving your laptop.

![Vectra with a local Qwen3 4B model selected](https://raw.githubusercontent.com/Laudarisd/vectra/main/docs/assets/vectra-local-model.png)

## Why Vectra

- **Local-first** — run instruction-tuned GGUF models through llama.cpp; your model and prompts never leave your machine.
- **Adaptive local runtime** — Vectra profiles the selected llama.cpp build and hardware, enables supported acceleration/cache options, and offers larger hybrid GPU/RAM models separately from latency-first choices.
- **Repo-aware agent** — reads, searches, and edits your workspace; every write is a reviewed diff, never a silent change.
- **Specialized agent team** — delegate to planner, researcher, coder, tester, reviewer, security, and documentation subagents, each limited to only the tools its role actually needs; delegated work shows as a live, collapsible group in the sidebar instead of interleaving with the main run.
- **Approved execution** — files, tests, and commands only run after you confirm them.
- **Documents built in** — parse and generate PDF, DOCX, PPTX, XLSX, RTF, code, and images.
- **Any model, any hardware** — switch to OpenAI, Anthropic, Gemini, or Ollama anytime; Auto/GPU/CPU device modes adapt to what you've got.

## Quick start

1. Install [llama.cpp](https://github.com/ggml-org/llama.cpp) so `llama-server` is on your `PATH`.
2. Download an instruction-tuned `.gguf` model (a quantized 3B–4B model is a good start).
3. Open the Vectra sidebar → **Local Model** → pick the file → **Test**.

Prefer a cloud model? Skip straight to **API Key** and pick a provider instead.

## Requirements

VS Code 1.90+. llama.cpp only if you're running a model locally.

## Privacy

Local prompts never leave your machine; cloud requests are sent only when you choose a cloud provider. Every edit is reviewed before it's applied, and command execution always asks first. Details: [PRIVACY.md](PRIVACY.md) · [SECURITY.md](SECURITY.md).

---

Created by [Sudip Laudari](https://github.com/Laudarisd). [Source & issues](https://github.com/Laudarisd/vectra) · [Changelog](CHANGELOG.md) · Proprietary — see [LICENSE.txt](LICENSE.txt).
