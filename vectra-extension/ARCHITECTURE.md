# Vectra Extension Architecture

## Products

- `src/` — VS Code extension written in TypeScript.
- `generated/web/` — packaged copy of the standalone application from `../vectra-web`.

## Agent runtime

`AgentController` uses the shared `VectraDeepAgentRuntime`, backed by the official TypeScript `deepagents` harness. Deep Agents receives an ephemeral scratch filesystem only. Real workspace, document, Git, command, web, and edit operations are namespaced Vectra tools routed through `ExtensionToolExecutor`, preserving plan gates, reviewed edits, confirmations, network restrictions, and sensitive-file policy.

The model never receives direct project filesystem or shell access. llama.cpp models use native OpenAI-format function calls when their chat template supports them. A model-driven `search_tools`/`invoke_tool` pair keeps the repeated prompt small while retaining the complete host catalog behind the guarded executor. For local models without reliable native tool calling, Vectra automatically translates its validated JSON action envelope into LangChain tool calls. The compact Vectra loop remains available through `vectra.agentHarness` and as a safe fallback when Deep Agents fails before executing a host tool.

Shared tool contracts, canonical metadata and aliases, risk policy, live progress wording, routing, Deep Agents factories, extension inventory, and web-safe uploaded/generated-file tools live in `../vectra-agent-core/src/tools/`. Platform implementations stay in their host adapters where VS Code trust APIs or web sandbox rules must be enforced. The Node.js web server imports the compiled JavaScript from this same TypeScript core; a second JavaScript tool catalog is not maintained.

Local-model discovery also lives in `../vectra-agent-core/src/models/`. One concurrent inventory pass merges offline GGUF files from known application/user folders, Ollama API/CLI/manifests, and models advertised by running local OpenAI-compatible servers. Both hosts consume that result.

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
- create empty directories and rename/move/copy files or directories
- delete empty directories, or recursively delete them only when explicitly requested

Content changes become `EditProposal` objects. Text files are diffed directly. PDF/DOCX proposals diff extracted semantic text, while Accept writes the generated binary document. Stale-content hashes prevent accepting a proposal after the underlying file changed. Directory and path operations cannot produce a meaningful text diff, so they require an approved plan plus a separate modal confirmation immediately before execution. They reject collisions, sensitive paths, workspace-root operations, and accidental recursive deletion.

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

`LlamaCppRuntime` and `vectra-web/server/services/local-llama.mjs` launch `llama-server` for local GGUF files. Sharded GGUF, configurable context/GPU fitting, multi-GPU split modes, MoE CPU placement, mmap control, extra args and optional vision projector are supported.

Two things a local server (llama.cpp/Ollama) needs that a cloud API does not:

`LlamaCppRuntime` probes the selected server's `--help` output once and builds a hardware/model-size-aware profile. Supported builds receive prompt-cache reuse, flash-attention auto-selection, single-request parallelism, metrics, and memory-saving KV cache settings for hybrid/CPU loads. Unsupported flags are omitted. Fully resident models keep the configured context up to 16K; hybrid and CPU profiles use smaller context ceilings to reduce KV memory and prompt-ingestion latency.
- **A context-aware prompt budget.** `estimateContextCharBudget()` (`src/utils/text.ts` / `vectra-web/server/server.mjs`) clamps the assembled prompt to the model's actual configured context window (`vectra.llamaCppContextSize`, `vectra.ollamaContextSize`, or the running local server's reported context) instead of the flat cloud-sized `vectra.maxContextCharacters`. Sending more than the server's `n_ctx` gets the request rejected with HTTP 400 rather than gracefully truncated — this was the leading cause of "bad request" errors against local models.
- **An idle timeout, not a total-duration timeout.** `vectra.localRequestTimeoutSeconds` (default 900s) and its `fetchSseText`/`streamSse`/`streamNdjson` counterparts reset the timer on every received token rather than killing the request after a fixed wall-clock cap, so slow-but-still-producing CPU generation is not aborted mid-answer the way a flat 120s cap would.

Conversational (non-tool-loop) replies stream token-by-token over SSE/NDJSON for llama.cpp, Ollama, and OpenAI-compatible endpoints, in both the extension webview and Vectra Web. The schema-constrained agent tool-loop JSON stays non-streaming, since partial JSON isn't renderable or parseable mid-generation.

## Web

Vectra Web does not provide arbitrary browser filesystem write access. Uploaded documents are parsed locally by the Node server; generated PDF/DOCX files are returned as downloadable artifacts. This keeps the ChatGPT-style browser model sandboxed while the VS Code extension owns workspace mutation.

The extension bundles its own copy under `generated/web/` so packaging doesn't depend on a sibling checkout. That copy is a **build artifact**, not a second source of truth: `npm run sync:web` (wired into `build:web`/`web`/`test:web`) always overwrites it from `../vectra-web` first. Edit `vectra-web/` only.

## Agent-facing extras

- **Project instructions.** `ContextCollector` auto-loads `VECTRA.md` (or `.vectra/instructions.md`) from the workspace root, mirroring a CLAUDE.md/.cursorrules-style always-applied instruction file, without the user repeating it every prompt.
- **Git (read-only).** `git_status`/`git_diff` (`src/workspace/GitTools.ts`) let the agent answer "what changed" without a shell-command confirmation prompt — the same trust tier as `search_text`/`get_diagnostics`, never commits/stages/pushes.
- **Chat history persistence.** The VS Code extension sidebar now persists message metadata (not attachment payloads) to `context.workspaceState`, so it survives a reload the same way Vectra Web's SQLite history already did.
