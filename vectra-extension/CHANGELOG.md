# Changelog

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
