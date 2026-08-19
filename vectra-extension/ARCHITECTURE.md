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

Two things a local server (llama.cpp/Ollama) needs that a cloud API does not:
- **A context-aware prompt budget.** `estimateContextCharBudget()` (`src/utils/text.ts` / `server.mjs`) clamps the assembled prompt to the model's actual configured context window (`vectra.llamaCppContextSize`, `vectra.ollamaContextSize`, or the running local server's reported context) instead of the flat cloud-sized `vectra.maxContextCharacters`. Sending more than the server's `n_ctx` gets the request rejected with HTTP 400 rather than gracefully truncated — this was the leading cause of "bad request" errors against local models.
- **An idle timeout, not a total-duration timeout.** `vectra.localRequestTimeoutSeconds` (default 900s) and its `fetchSseText`/`streamSse`/`streamNdjson` counterparts reset the timer on every received token rather than killing the request after a fixed wall-clock cap, so slow-but-still-producing CPU generation is not aborted mid-answer the way a flat 120s cap would.

Conversational (non-tool-loop) replies stream token-by-token over SSE/NDJSON for llama.cpp, Ollama, and OpenAI-compatible endpoints, in both the extension webview and Vectra Web. The schema-constrained agent tool-loop JSON stays non-streaming, since partial JSON isn't renderable or parseable mid-generation.

## Web

Vectra Web does not provide arbitrary browser filesystem write access. Uploaded documents are parsed locally by the Node server; generated PDF/DOCX files are returned as downloadable artifacts. This keeps the ChatGPT-style browser model sandboxed while the VS Code extension owns workspace mutation.

The extension bundles its own copy of this product under `vectra/web/` so packaging doesn't depend on a sibling checkout. That copy is a **build artifact**, not a second source of truth: `npm run sync:web` (wired into `build:web`/`web`/`test:web`) always overwrites it from `../vectra-web` first. Edit `vectra-web/` only.

## Agent-facing extras

- **Project instructions.** `ContextCollector` auto-loads `VECTRA.md` (or `.vectra/instructions.md`) from the workspace root, mirroring a CLAUDE.md/.cursorrules-style always-applied instruction file, without the user repeating it every prompt.
- **Git (read-only).** `git_status`/`git_diff` (`src/services/GitTools.ts`) let the agent answer "what changed" without a shell-command confirmation prompt — the same trust tier as `search_text`/`get_diagnostics`, never commits/stages/pushes.
- **Chat history persistence.** The VS Code extension sidebar now persists message metadata (not attachment payloads) to `context.workspaceState`, so it survives a reload the same way Vectra Web's SQLite history already did.
