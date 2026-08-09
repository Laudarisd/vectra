# Vectra Web

Vectra Web is the browser edition included with the VS Code extension source. It provides local GGUF chat through llama.cpp, optional cloud providers, file understanding, and downloadable generated documents.

## Run

```bash
npm start
```

Open the localhost URL printed in the terminal. No runtime npm dependencies are required.

## Local llama.cpp

1. Install [llama.cpp](https://github.com/ggml-org/llama.cpp).
2. Choose **Local llama.cpp → Model** and select an instruction-tuned `.gguf` file.
3. Optionally select a matching `mmproj*.gguf` file for vision.
4. Select **Start model** and wait until it is ready.

Vectra binds the model server to `127.0.0.1`, chooses a free port when necessary, creates a private key for each launch, and disables llama.cpp's bundled web UI.

## Files

Vectra can extract content from PDF, DOCX, PPTX, XLSX, RTF, text, code, CSV, Markdown, and JSON files. Compatible vision models can also inspect images and visual documents. Generated PDF, DOCX, text, data, web, and common code files can be downloaded from the conversation.

## Project

Created by [Sudip Laudari](https://github.com/Laudarisd). Support and source: [github.com/Laudarisd/vectra](https://github.com/Laudarisd/vectra).

Vectra is proprietary software. See [LICENSE.txt](../LICENSE.txt).
