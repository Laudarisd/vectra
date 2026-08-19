# Vectra — Code Structure Map

Vectra ships **two products from one repo**:

1. **VS Code extension** (`src/` → compiled to `dist/`) — runs inside VS Code, has real workspace/filesystem access.
2. **Vectra Web** (`web/`) — a standalone Node.js + browser app, sandboxed, no filesystem write access. It's a **build artifact** synced from a sibling `../vectra-web` checkout (`npm run sync:web`) — never edit `vectra/web/` directly.

Both talk to the same set of AI providers and share the same agent *concepts* (tool loop, JSON envelope), but are separate implementations (TypeScript vs. plain `.mjs`/browser JS).

---

## 1. Directory tree

```
vectra/
├── package.json              # extension manifest: commands, views, settings, npm scripts
├── tsconfig.json             # compiles src/ → dist/
├── ARCHITECTURE.md           # design rationale (why), this file is the map (what/where)
│
├── src/                              ── VS CODE EXTENSION (TypeScript) ──
│   ├── extension.ts                  # activate()/deactivate() — wires everything, registers commands
│   ├── types.ts                      # shared types: ChatMessage, AgentAction, EditProposal, ModelInfo…
│   │
│   ├── agent/                        # the "brain": tool loop + prompt protocol
│   │   ├── AgentController.ts        # runs the read/reason/act loop for one user request
│   │   ├── AgentToolRegistry.ts      # executes a validated AgentAction against real services
│   │   ├── AgentToolCatalog.ts       # JSON-schema of every tool + prompt guidance text
│   │   ├── protocol.ts               # builds system prompts, parses the model's JSON envelope
│   │   └── ConversationContext.ts    # chat vs. task classification, recent-history formatting
│   │
│   ├── providers/                    # one class per AI backend, all implement TextProvider
│   │   ├── ProviderManager.ts        # picks the active provider from config, caches instances
│   │   ├── LlamaCppProvider.ts       # local GGUF via llama-server (HTTP)
│   │   ├── OllamaProvider.ts         # local/remote Ollama server
│   │   ├── OpenAIProvider.ts         # OpenAI API
│   │   ├── AnthropicProvider.ts      # Anthropic/Claude API
│   │   ├── GeminiProvider.ts         # Google Gemini API
│   │   └── OpenAICompatibleProvider.ts # LM Studio / vLLM / any OpenAI-shaped endpoint
│   │
│   ├── services/                     # everything the agent tools + UI call into
│   │   ├── WorkspaceTools.ts         # list/search/read files inside the trusted workspace
│   │   ├── PatchManager.ts           # turns writes into reviewable EditProposal objects (diff/accept/reject)
│   │   ├── DiffContentProvider.ts    # renders EditProposal diffs via a vscode:// content scheme
│   │   ├── CommandRunner.ts          # runs shell commands, only after explicit user confirmation
│   │   ├── GitTools.ts               # read-only git_status/git_diff (no stage/commit/push)
│   │   ├── WebTools.ts               # agent web search / fetch tool
│   │   ├── ContextCollector.ts       # builds WorkspaceContext, auto-loads VECTRA.md instructions
│   │   ├── PlanManager.ts            # agent-mode plan proposal/approval state
│   │   ├── TodoManager.ts            # agent's todo-list tool state
│   │   ├── AttachmentService.ts / AttachmentParser.ts  # user-attached files → agent-readable content
│   │   ├── DocumentService.ts / DocumentExtractor.ts   # PDF (pdftotext/embedded-text) & DOCX (zip/xml) parsing + generation
│   │   ├── LocalCredentialStore.ts   # local-only API key storage (never synced)
│   │   ├── LocalLlamaCppService.ts   # spawns/manages the local llama-server process
│   │   ├── LocalModelDiscovery.ts    # finds local GGUF files on disk
│   │   ├── ModelCatalog.ts / ModelDownloader.ts / ModelRecommender.ts  # HF model browsing/download/recommendation
│   │   └── HuggingFaceSearch.ts      # Hugging Face Hub search for downloadable models
│   │
│   ├── ui/
│   │   └── ChatViewProvider.ts       # webview host: message protocol between extension ⇄ webview
│   │
│   └── utils/
│       ├── config.ts                 # typed reads/writes of `vectra.*` settings
│       ├── text.ts                   # truncation, context-char-budget estimation, safeJson
│       ├── http.ts                   # fetch helpers incl. SSE/NDJSON streaming with idle timeout
│       ├── hardware.ts / gpu.ts      # CPU/GPU/VRAM detection for local model sizing
│       └── path.ts                   # workspace-relative path normalization/validation
│
├── media/                            ── EXTENSION WEBVIEW CLIENT (plain JS/CSS, sandboxed) ──
│   ├── main.js                       # chat UI logic; only talks to ChatViewProvider via postMessage
│   ├── main.css
│   └── VectraLogo.png
│
├── web/                              ── VECTRA WEB (synced build artifact — edit ../vectra-web instead) ──
│   ├── server.mjs                    # Node HTTP server: provider calls, document parsing, SQLite history
│   ├── lib/                          # local-llama.mjs, local-discovery.mjs, gpu-detect.mjs, documents.mjs, history.mjs
│   ├── public/                       # app.js, index.html, styles.css — browser chat client
│   └── scripts/build.mjs             # packaging for the standalone web app
│
├── scripts/
│   └── sync-web.mjs                  # overwrites web/ from ../vectra-web before build/test/run
│
├── test/                             # node --test unit tests (.cjs) against compiled dist/
│
└── dist/                             # compiled output of src/ (tsc) — this is what package.json "main" loads
```

---

## 2. How a chat message flows through the system (extension)

```
┌─────────────────┐   postMessage    ┌──────────────────────┐
│  media/main.js   │ ───────────────▶│  ChatViewProvider.ts  │
│ (webview, sand-  │◀─────────────── │  (ui/)                │
│  boxed browser)  │   postMessage    │  - owns webview HTML  │
└─────────────────┘                  │  - persists history    │
                                      │    to workspaceState   │
                                      └──────────┬─────────────┘
                                                 │ controller.run(request)
                                                 ▼
                                      ┌──────────────────────┐
                                      │ AgentController.ts    │
                                      │ (agent/)               │
                                      │ - classify chat vs task│
                                      │ - build system prompt  │──uses──▶ protocol.ts, AgentToolCatalog.ts
                                      │ - collect workspace    │──uses──▶ ContextCollector.ts
                                      │   context               │
                                      │ - call provider         │──uses──▶ ProviderManager.ts → *Provider.ts
                                      │ - loop: parse envelope, │
                                      │   run actions, repeat   │
                                      └──────────┬─────────────┘
                                                 │ AgentAction (JSON, validated)
                                                 ▼
                                      ┌──────────────────────┐
                                      │ AgentToolRegistry.ts  │
                                      │ (agent/)               │
                                      │ dispatches to:          │
                                      │  WorkspaceTools, Patch  │
                                      │  Manager, CommandRunner,│
                                      │  GitTools, WebTools,    │
                                      │  TodoManager, PlanManager│
                                      └──────────────────────┘
```

Key rule (from `ARCHITECTURE.md`): **the model never touches the filesystem or shell directly.** It only returns a JSON `AgentAction` envelope (schema in `AgentToolCatalog.ts`, parsed in `protocol.ts`); `AgentToolRegistry` validates and executes it. Every write becomes a `PatchManager` `EditProposal` that the user reviews (diffed via `DiffContentProvider`) before anything touches disk. Shell commands (`CommandRunner`) require explicit user confirmation and can't run while edits are still pending.

---

## 3. Wiring entry point — `extension.ts`

`activate()` is the composition root — it `new`s every service once and injects them into each other:

```
LocalCredentialStore ─┐
LocalLlamaCppService   ├─▶ ProviderManager
                        │
WorkspaceTools ─────────┼─▶ PatchManager ─▶ DiffContentProvider
CommandRunner           │
AttachmentService       │
TodoManager             │
PlanManager             │
                        │
ProviderManager + ContextCollector(new) + WorkspaceTools + PatchManager
   + CommandRunner + TodoManager + PlanManager ──▶ AgentController
                        │
AgentController + PatchManager + TodoManager + PlanManager + DiffContentProvider
   + LocalCredentialStore + LocalLlamaCppService + AttachmentService ──▶ ChatViewProvider
```

It then registers all `vectra.*` commands (open, selectModel, setApiKey, testConnection, downloadModel, …) and the `vectra.chat` webview view, and reacts to `onDidChangeConfiguration` / `onDidGrantWorkspaceTrust`.

---

## 4. Provider layer

All six provider classes implement the same `TextProvider` interface (`src/types.ts`) — `ProviderManager.ts` is the only place that picks between them, based on `vectra.provider` in settings:

| Provider | File | Talks to |
|---|---|---|
| `llamaCpp` | `LlamaCppProvider.ts` | local `llama-server` process, started/stopped by `LocalLlamaCppService.ts` |
| `ollama` | `OllamaProvider.ts` | local/remote Ollama server |
| `openai` | `OpenAIProvider.ts` | OpenAI API |
| `anthropic` | `AnthropicProvider.ts` | Anthropic API |
| `gemini` | `GeminiProvider.ts` | Google Gemini API |
| `openaiCompatible` | `OpenAICompatibleProvider.ts` | LM Studio / vLLM / custom gateway |

API keys never leave the machine: `LocalCredentialStore.ts` persists them to a local file, read by `ProviderManager` when constructing a cloud provider.

---

## 5. Vectra Web — parallel implementation, same shape

`web/` mirrors the extension's agent concepts but stays sandboxed (no workspace write access, no shell):

- `server.mjs` — Node HTTP server; equivalent of `ProviderManager` + `services/` combined, plus SQLite-backed chat history (`lib/history.mjs`).
- `public/app.js` + `index.html` — the browser chat client (equivalent of `media/main.js`, but talking HTTP/SSE to `server.mjs` instead of `postMessage`).
- `lib/local-llama.mjs`, `local-discovery.mjs`, `gpu-detect.mjs`, `documents.mjs` — JS twins of `LocalLlamaCppService.ts`, `LocalModelDiscovery.ts`, `utils/gpu.ts`, `DocumentExtractor.ts`.

This directory is **regenerated**, not hand-edited: `npm run sync:web` (called by `build:web`, `web`, `test:web`) copies it from the sibling `../vectra-web` repo checkout every time.

---

## 6. Build & run paths

```
src/*.ts   ─(tsc, tsconfig.json)─▶  dist/*.js   ─(package.json "main")─▶  loaded by VS Code
media/*    ─(no build step)──────────────────────────────────────────▶  loaded by the webview
../vectra-web ─(scripts/sync-web.mjs)─▶ web/ ─(web/scripts/build.mjs)─▶ standalone Vectra Web app
```

npm scripts (`package.json`):
- `npm run compile` / `watch` — build the extension only.
- `npm test` — compile, then run `test/*.test.cjs` against `dist/`.
- `npm run package` — test, then `vsce package` → the `.vsix` files at repo root.
- `npm run web` — sync + start Vectra Web locally (`web/server.mjs`).
- `npm run build:all` — compile extension + build web + test web.

---

## 7. Where to look for a given change

| I want to… | Start here |
|---|---|
| Add/change a settings field | `package.json` (`contributes.configuration`) + `src/utils/config.ts` |
| Add a new agent tool (e.g. new file action) | `AgentToolCatalog.ts` (schema), `AgentToolRegistry.ts` (execution), likely a new/edited `services/*` class |
| Change how prompts are built | `agent/protocol.ts` |
| Change the tool loop / step limits / chat vs. task routing | `agent/AgentController.ts`, `agent/ConversationContext.ts` |
| Add a new AI backend | `src/providers/` (new class implementing `TextProvider`) + `ProviderManager.ts` + `package.json` enum |
| Change the webview UI | `media/main.js` + `main.css`, message handling in `ui/ChatViewProvider.ts` |
| Change how edits are reviewed/diffed | `services/PatchManager.ts`, `services/DiffContentProvider.ts` |
| Change local model launch behavior | `services/LocalLlamaCppService.ts`, `utils/gpu.ts`, `utils/hardware.ts` |
| Change PDF/DOCX handling | `services/DocumentExtractor.ts`, `services/DocumentService.ts` |
| Change the standalone web app | edit sibling `../vectra-web` repo, then `npm run sync:web` — **not** `vectra/web/` directly |
