# Changelog

## 2.0.4

- Fixed the leading cause of "bad request" errors against local models: prompts are now clamped to the model's actual configured context window (`vectra.llamaCppContextSize`, `vectra.ollamaContextSize`) instead of a flat cloud-sized budget, so a request no longer exceeds the local server's `n_ctx` and gets rejected.
- Replaced the flat 120s request timeout with an idle timeout (`vectra.localRequestTimeoutSeconds`, default 900s) for local providers, so a slow-but-still-producing CPU generation is no longer aborted mid-answer.
- Ollama requests now explicitly send `num_ctx` (`vectra.ollamaContextSize`), fixing Ollama silently truncating to its small default context.
- Added token-by-token streaming for conversational (Ask/chat) replies against llama.cpp, Ollama, and OpenAI-compatible endpoints, in both the VS Code extension and Vectra Web.
- Added markdown and fenced-code rendering with a copy button in the chat view, in both products.
- VS Code extension chat history now persists across a reload (previously in-memory only).
- Added read-only `git_status`/`git_diff` agent tools and automatic loading of a `VECTRA.md` (or `.vectra/instructions.md`) project-instructions file.
- Fixed a broken GPU-detection request in Vectra Web (`/api/local/gpu-info` was requested with an invalid escaped path and always failed).
- `vectra/web` (the extension's bundled copy of Vectra Web) is now synced from `vectra-web` at build time (`npm run sync:web`) instead of being hand-maintained separately; it had drifted and was missing chat history, GPU detection, and local runtime discovery.

## 1.0.2

- Feature upgrade over 1.0.1.
- Moved proposed-change review (Accept/Reject) into the main chat scroll instead of a separate small scrolling panel, and added Undo for changes that were already accepted.
- Added a clear orange focus border to the chat input box.
- Fixed generic capability questions (e.g. "do you also edit code?") being misrouted into a full workspace scan instead of a direct answer.
- Fixed deleting a file that only existed as an unaccepted pending proposal failing with a confusing "does not exist" error.
- Updated the Vectra logo/icon to the current blue brand mark, in the Marketplace listing and in the extension sidebar.

## 1.0.1

- Feature upgrade over 1.0.0.

## 1.0.0

- Test version.
