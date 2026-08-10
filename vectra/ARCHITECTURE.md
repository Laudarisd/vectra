# Vectra Extension Architecture

## Products

- `src/` — VS Code extension written in TypeScript.
- `web/` — standalone local web application written with Node.js and browser JavaScript.

## Agent runtime

`AgentController` owns the tool loop. The model never receives direct filesystem or shell access. It returns a JSON action envelope; Vectra validates and executes supported actions.

### Read tools

- workspace listing/search
- code/text reads
- diagnostics
- PDF/DOCX parsing
- image/visual-document inspection through multimodal providers

### Reviewed write tools

- create/replace code and text files
- focused line replacement/insertion/deletion
- create/edit PDF and DOCX documents
- delete workspace files

Every write becomes an `EditProposal`. Text files are diffed directly. PDF/DOCX proposals diff extracted semantic text, while Accept writes the generated binary document. Stale-content hashes prevent accepting a proposal after the underlying file changed.

### Execution tools

Commands and tests are executed by `CommandRunner` only after explicit user confirmation. Pending edits must be reviewed first.

## Document pipeline

1. Detect format.
2. PDF: use `pdftotext` when available, then a safe embedded-text fallback. Gibberish/binary-like extraction is discarded.
3. DOCX: parse `word/document.xml` from the ZIP package.
4. Text models receive extracted text.
5. Visual/scanned PDFs and images require a multimodal provider or local VLM + matching `mmproj`.
6. Generated DOCX/PDF files are produced locally by Vectra and can be reviewed/downloaded.

## Local models

`LocalLlamaCppService` and `web/lib/local-llama.mjs` launch `llama-server` for local GGUF files. Sharded GGUF, configurable context/GPU fitting, multi-GPU split modes, MoE CPU placement, mmap control, extra args and optional vision projector are supported.

## Web

Vectra Web does not provide arbitrary browser filesystem write access. Uploaded documents are parsed locally by the Node server; generated PDF/DOCX files are returned as downloadable artifacts. This keeps the ChatGPT-style browser model sandboxed while the VS Code extension owns workspace mutation.
