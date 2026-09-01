# Changelog

## 1.1.5

- Added remote/self-hosted OpenAI-compatible API configuration with optional self-signed TLS support.
- Added shared local chat history for the web app and VS Code extension; reloads now begin with a fresh chat.

## 1.1.4

- Fixed plan approval as a hard execution boundary so approved file operations continue in the same request instead of requiring repeated prompts.
- Moved plan review into the chat flow with checklist steps, duplicate-step cleanup, and automatic collapse after approval or rejection.

## 1.1.3

- Added a specialized Deep Agents subagent team — planner, researcher, coder, tester, reviewer, security, and documentation — each limited to only the host tools its role needs (coordination tools and further delegation are never available to any of them).
- Delegated work now shows as a live, collapsible group in the activity log instead of interleaving with the main run, in both the extension sidebar and Vectra Web.
- Added `vectra.maxConcurrentSubagents` to bound how many subagent tool calls run at once, protecting the single local llama.cpp process from being hammered by several delegated tasks together.
- Fixed Vectra Web's activity log: it previously cycled a handful of canned strings on a timer instead of reflecting the agent's real progress; it now renders the same live events the extension does.

## 1.1.2

- Bounded local model detection with a wall-clock deadline, per-tier depth limits, and a per-directory read timeout, so a first scan finishes in seconds instead of crawling every drive letter to depth 12.
- Rebuilt the Local Model flow as one live picker that appears before any scanning, streams results in, and no longer dismisses itself when focus returns to the chat view.
- A chosen model folder is now remembered and scanned on its own, with "Change model folder" and "Scan whole computer" always available; selecting a model no longer narrows that folder to the file's own directory.
- Resolved symlinked and junctioned directories by real path so self-referential Windows profile junctions can no longer stall a scan.

## 1.1.1

- Accelerated broad GGUF discovery with bounded concurrent directory reads and user cancellation.
- Restored automatic `llama-server` detection for Vectra-managed installs, model-adjacent binaries, and Windows WinGet installs.

## 1.1.0

- Unified tool metadata, aliases, risk policy, progress wording, web-safe file generation, and installed-model discovery in the shared TypeScript core used by both the extension and Node.js web host.

## 1.0.1

- Added the shared Vectra agent core and Deep Agents orchestration while keeping workspace access behind Vectra's reviewed host tools.
- Expanded the workspace toolset with explicit folder creation, rename, move, copy, and confirmed directory deletion.
- Restored live generation progress, token streaming where supported, and the Stop control.
- Fixed human-in-the-loop plan approval so agent runs pause for a decision and never report unexecuted file or folder creation as complete.
- Automatically removes resolved plan and file-review cards from chat after approval or rejection.
- Improved tool naming, local-model discovery, context handling, and extension/web capability parity.
- Added adaptive llama.cpp launch profiles, native function calling with a compatibility fallback, model-driven tool discovery, prompt-cache reuse, and separate larger hybrid GPU/RAM model recommendations.

## 1.0.0

Initial public release, published on the VS Code Marketplace as **Vectra AI** (`laudarisd.vectra-ai`) — an upgraded, continued version of the previous Vectra agent, now released under a new Marketplace identifier.

Vectra is a local-first AI coding agent for VS Code: point it at a GGUF model through llama.cpp (or your own OpenAI/Anthropic/Gemini/Ollama/OpenAI-compatible endpoint), and it reads your repository, proposes reviewed edits, and runs approved commands.

- Local and cloud model providers: llama.cpp (GGUF), Ollama, OpenAI, Anthropic, Gemini, and any OpenAI-compatible endpoint.
- Repo-aware Agent and Ask modes with read/search/edit tools, a mandatory reviewed-plan step before any write or execution action, and a live todo checklist for multi-step tasks.
- Every file change is a reviewed diff (create, replace, line-level edit, or delete) — nothing is written until you accept it.
- Command and test execution always requires explicit confirmation.
- Document support: read PDF/DOCX/PPTX/XLSX/RTF, generate/edit PDF/DOCX, and inspect images or scanned pages with a vision-capable local model.
- Git-aware context: read-only `git status`/`git diff` tools and automatic loading of project instructions from `VECTRA.md`.
- Streaming conversational replies, persistent chat history across reloads, and markdown/fenced-code rendering with copy buttons.
- Automatic context-window clamping and configurable idle timeouts so local CPU/GPU inference isn't cut off or rejected for exceeding `n_ctx`.
- Shared engine and UI with Vectra Web, so the same agent runs in VS Code and in the browser.
