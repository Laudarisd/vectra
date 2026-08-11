# Vectra for VS Code

<p align="center">
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/VS_Code-1.90%2B-007ACC?logo=visualstudiocode" alt="VS Code"></a>
  <a href="https://github.com/ggml-org/llama.cpp"><img src="https://img.shields.io/badge/AI-Local--first-2ea44f" alt="Local AI"></a>
  <a href="https://github.com/Laudarisd/vectra/releases"><img src="https://img.shields.io/badge/version-2.0.0-blue" alt="Version 2.0.0"></a>
  <a href="LICENSE.txt"><img src="https://img.shields.io/badge/license-Proprietary-orange" alt="License"></a>
</p>

Vectra is a local-first coding agent that works inside VS Code. Use a downloaded GGUF model to avoid recurring API-token costs, or connect an optional cloud provider when you need one.

![Vectra with a local Qwen3 4B model selected](https://raw.githubusercontent.com/Laudarisd/vectra/main/src/1.png)

## Features

- **Local AI agent:** run instruction-tuned GGUF models on your machine through llama.cpp.
- **Repository awareness:** list, search, and read files across the open workspace.
- **Reviewed edits:** inspect proposed file changes before they are applied.
- **Approved execution:** run files, projects, tests, or commands with confirmation.
- **Three workflows:** use Agent, Ask, or Check Selection from the Vectra sidebar.
- **Edit and resend:** revise a previous prompt or restart a stopped request without copying and pasting it.
- **Documents and images:** work with PDF, DOCX, PPTX, XLSX, RTF, text, code, and supported visual inputs. Make sure your model supports vision if you want to use images.
- **Provider choice:** optionally use OpenAI, Anthropic, Gemini, Ollama, or an OpenAI-compatible endpoint.
- **GPU or CPU, your choice:** pick Auto, GPU, or CPU from the sidebar; Vectra detects available GPUs and keeps an already-loaded local model resident instead of reloading it on every request.

## Run a local model

Vectra currently uses the llama.cpp server for local inference.

1. Install [llama.cpp](https://github.com/ggml-org/llama.cpp). Confirm that `llama-server` is on your `PATH`, or set **Vectra: Llama Cpp Server Path** in Settings.
2. Download an instruction-tuned `.gguf` model. Quantized 3B–4B models are a good lightweight starting point; choose one that fits your system memory.
3. Open the Vectra sidebar and select **Local Model**.
4. Pick the downloaded `.gguf` file.
5. If the model supports vision, select its matching `mmproj*.gguf` projector.
6. Let Vectra start the local server, then select **Test** to confirm the connection.

The **Local Model** control can also detect GGUF files in common model folders and models from a running local Ollama installation. Detected results appear in a searchable picker.

The screenshot above shows Qwen3 4B loaded locally. A larger context size improves capacity but uses more memory; adjust it under **Settings → Extensions → Vectra** if needed.

## How to use Vectra

- **Agent** can inspect the repository, propose edits, and request permission to run tools.
- **Ask** answers questions using workspace context without an autonomous tool loop.
- **Check Selection** reviews the code currently selected in the editor.
- Use the attachment control for code, documents, or images.
- Review every proposed write and execution request before approving it.

## Extension information

| Field | Value |
| --- | --- |
| Name | Vectra |
| Version | 1.0.2 |
| Publisher | `laudarisd` |
| Author | [Sudip Laudari](https://github.com/Laudarisd) |
| Runtime | VS Code 1.90+; llama.cpp for local GGUF models |
| Repository and support | [github.com/Laudarisd/vectra](https://github.com/Laudarisd/vectra) |
| License | Proprietary — see [LICENSE.txt](LICENSE.txt) |

Contributing? Build and test instructions are in [CONTRIBUTING.md](CONTRIBUTING.md) on GitHub.

## Privacy and safety

Local models and their prompts stay on your machine. Cloud requests are sent only when you select a cloud provider. Workspace writes are review-before-apply, command execution requires confirmation, and sensitive paths are blocked by default.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Copyright © 2026 Sudip Laudari. All rights reserved.
