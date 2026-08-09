<p align="center">
  <img src="vectra/media/vectra-icon.png" alt="Vectra logo" width="128" height="128">
</p>

<h1 align="center">Vectra</h1>

<p align="center">
  <a href="./vectra"><img src="https://img.shields.io/badge/VS_Code-Extension-007ACC?logo=visualstudiocode" alt="VS Code"></a>
  <a href="https://github.com/ggml-org/llama.cpp"><img src="https://img.shields.io/badge/AI-Local--first-2ea44f" alt="Local AI"></a>
  <a href="./vectra/CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version 1.0.0"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Proprietary-orange" alt="License"></a>
</p>

Vectra is a local-first AI coding agent for VS Code and the web. It understands your workspace, helps create and review changes, works with documents, and can run approved tools—without forcing every conversation through a paid cloud model.

Download a GGUF model once, load it through llama.cpp, and run your coding agent locally. Your model and prompts remain on your machine, and you avoid recurring API-token costs.

![Vectra running a local Qwen3 4B model](src/1.png)

## Packages

| Package | Description | Documentation |
| --- | --- | --- |
| Vectra for VS Code | Repository-aware coding agent with local GGUF and optional cloud models | [Extension guide](vectra/README.md) |
| Vectra Web | Browser-based local AI chat with file and document support | [Web guide](vectra-web/README.md) |

## Highlights

- Run local `.gguf` models through llama.cpp and reduce API-token costs.
- Explore repositories, read files, search code, and inspect diagnostics.
- Preview workspace changes before applying them.
- Run files, projects, tests, and commands only after approval.
- Read PDF, DOCX, PPTX, XLSX, RTF, code, text, and image attachments.
- Optionally connect OpenAI, Anthropic, Gemini, Ollama, or compatible APIs.

## Load a local model

1. Install [llama.cpp](https://github.com/ggml-org/llama.cpp) and make `llama-server` available on your `PATH` (or set its path in Vectra settings).
2. Download an instruction-tuned GGUF model. A quantized 3B–4B model is a practical starting point for many laptops.
3. Open Vectra in VS Code and select **Local Model**.
4. Choose the model's `.gguf` file. For a vision model, also choose its matching `mmproj*.gguf` file.
5. Wait for the model to load, then select **Test**.

Vectra currently launches local models with the llama.cpp server. Model speed and memory use depend on the model, quantization, context size, and your hardware.

## Development

```bash
cd vectra
npm install
npm run check
npm test
```

Press `F5` in VS Code to open an Extension Development Host. See the package READMEs for extension and web setup details.

## Author and license

Created by [Sudip Laudari](https://github.com/Laudarisd). Source and support: [github.com/Laudarisd/vectra](https://github.com/Laudarisd/vectra).

Vectra is proprietary software. See [LICENSE](LICENSE) for permitted use.
