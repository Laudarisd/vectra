# Vectra Code Structure

The repository contains two applications and one shared package:

```text
docs/assets/                 Documentation images
tools/                       Repository maintenance scripts
vectra-agent-core/           Shared agent runtime, models, and tool policy
vectra-extension/            VS Code extension
vectra-web/                  Canonical browser application
```

## VS Code extension

```text
vectra-extension/
├── src/
│   ├── agent/               Conversation orchestration and extension tool dispatch
│   ├── documents/           Attachment parsing and document codecs
│   ├── models/              Model discovery, catalog, download, and recommendations
│   ├── providers/           Cloud/local API providers and credentials
│   ├── runtime/llama/       llama.cpp process lifecycle and launch policy
│   ├── state/               Plan and todo session state
│   ├── tools/               Non-workspace host tools
│   ├── ui/                  VS Code webview provider
│   ├── utils/               Small shared utilities
│   ├── workspace/           Workspace reads, reviewed edits, Git, and commands
│   ├── extension.ts         Extension composition root
│   └── types.ts             Extension protocol types
├── media/                   Extension webview assets
├── scripts/                 Build, sync, and release checks
├── generated/               Regenerated package payloads; never edit directly
│   ├── agent-core/          Copy of compiled `vectra-agent-core`
│   └── web/                 Copy of canonical `vectra-web`
├── dist/                    Compiled extension JavaScript
└── test/                    Extension tests
```

Important boundaries:

- `AgentController` coordinates runs but does not directly mutate the workspace.
- `ExtensionToolExecutor` routes validated actions to guarded host implementations.
- `EditProposalManager` owns pending reviewed edits.
- `WorkspacePathOperations` owns confirmed directory and path changes.
- `LlamaCppRuntime` owns the local llama-server process.
- `generated/` and `dist/` are build outputs.

## Shared agent core

```text
vectra-agent-core/src/
├── deepAgentRuntime.ts      Deep Agents and LangChain adapter
├── index.ts                 Session state and public exports
├── models/                  Portable model discovery/runtime policy
└── tools/                   Tool contracts, catalog, routing, and host adapters
```

The shared package contains no direct VS Code workspace access. Platform-specific
operations remain in the extension or web host.

## Web application

```text
vectra-web/
├── public/
│   ├── js/app.js            Browser client
│   ├── index.html
│   └── styles.css
├── server/
│   ├── server.mjs           HTTP/API composition root
│   └── services/            Documents, history, models, downloads, and llama.cpp
├── scripts/build.mjs
└── test/
```

The canonical web source lives only in `vectra-web/`. Run `npm run sync:web` from
`vectra-extension/` to refresh `generated/web/`.

## Common changes

| Change | Primary location |
|---|---|
| Add or change an extension tool | `src/agent/ExtensionToolCatalog.ts`, `ExtensionToolExecutor.ts` |
| Change workspace edits | `src/workspace/EditProposalManager.ts` |
| Change local model launch | `src/runtime/llama/` |
| Change model discovery/catalog | `src/models/` and `vectra-agent-core/src/models/` |
| Change document handling | `src/documents/` |
| Change browser APIs/runtime | `vectra-web/server/` |
| Change browser UI | `vectra-web/public/` |
| Change shared tool policy | `vectra-agent-core/src/tools/` |

## Build commands

- `npm run compile` — rebuild shared core and extension output.
- `npm run build:web` — sync and build `generated/web`.
- `npm test` — compile and run extension and web tests.
- `npm run package` — test, build, validate release metadata, and create the VSIX.
