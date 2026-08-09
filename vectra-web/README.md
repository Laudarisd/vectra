# Vectra Web

Vectra Web is the browser edition of Vectra: a local-first AI chat and document workspace with local GGUF support through llama.cpp and optional cloud providers.

## Features

- Run downloaded GGUF models locally with llama.cpp.
- Connect OpenAI, Anthropic, Gemini, or OpenAI-compatible services.
- Parse PDF, DOCX, PPTX, XLSX, RTF, code, text, and image uploads.
- Generate downloadable PDF, DOCX, Markdown, JSON, CSV, HTML, and code files.
- Keep cloud keys in the browser session and communicate through the local Vectra server.

## Run

```bash
npm start
```

Open the localhost URL printed in the terminal. Vectra selects another free port when the preferred port is unavailable.

## Load a local model

1. Install [llama.cpp](https://github.com/ggml-org/llama.cpp).
2. Start Vectra Web and choose **Local llama.cpp**.
3. Under **Model**, select an instruction-tuned `.gguf` file.
4. For vision, optionally select the model's matching `mmproj*.gguf` file.
5. Select **Start model** and wait for the connection to become ready.

The local server binds to `127.0.0.1`, uses a private key for each launch, and disables llama.cpp's bundled web UI.

## Project

Created by [Sudip Laudari](https://github.com/Laudarisd). Support and source: [github.com/Laudarisd/vectra](https://github.com/Laudarisd/vectra).

Vectra is proprietary software. See the repository [license](../LICENSE).
