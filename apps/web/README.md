<p align="center"><img src="public/VectraLogo.png" alt="Vectra Web logo" width="112"></p>

<h1 align="center">Vectra Web</h1>

<p align="center">An AI workspace in your browser.</p>

<p align="center"><a href="../../docs/ko/web.md">한국어</a></p>

Current web release: **1.0.0**

<p align="center">
  <img src="https://raw.githubusercontent.com/Laudarisd/vectra/main/docs/assets/web.gif" alt="Vectra Web demo" width="900">
</p>

## Features

- Local GGUF/llama.cpp, Ollama, and cloud model support
- Locally stored chat history
- PDF, DOCX, PPTX, XLSX, text, and image attachments
- OCR and structured document extraction
- Live web research with safe URL handling
- Downloadable documents, code, images, and charts

## Run locally

From the repository root:

```sh
npm install
npm run start:web
```

Open the local address shown in the terminal.

Build and test:

```sh
npm run build -w @vectra/web
npm test -w @vectra/web
```

Local models and chat data stay on your machine. Cloud requests are sent only to the provider you configure.
