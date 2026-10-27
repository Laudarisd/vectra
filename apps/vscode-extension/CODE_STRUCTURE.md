# Vectra Code Structure

The repository contains two applications and two shared packages:

```text
docs/assets/                 Documentation images
apps/vscode-extension/       VS Code extension
apps/web/                    Browser application
packages/agent-core/         Shared agent runtime and contracts
packages/local-runtime/      Shared local-model discovery and profiles
```

## VS Code extension

```text
apps/vscode-extension/
|-- src/
|   |-- agent/               Everything used to reason and act
|   |   |-- runtime/         Deep Agents adapter, sessions, and model streaming
|   |   |-- skills/          Specialist roles and workspace SKILL.md discovery
|   |   |-- tools/           Tool contracts, routing, web, and workspace capabilities
|   |   `-- state/           Plans and todos
|   |-- core/                Extension infrastructure
|   |   |-- documents/       Attachment parsing and document codecs
|   |   |-- history/         Local conversation persistence
|   |   |-- models/          Model discovery, catalog, and downloads
|   |   |-- providers/       Cloud and local provider clients
|   |   |-- runtime/llama/   llama.cpp process and launch policy
|   |   |-- ui/              VS Code webview provider
|   |   `-- utils/           Configuration and focused shared helpers
|   `-- extension.ts         Extension composition root
|-- media/                   Extension webview assets
|-- scripts/                 Build and release checks
|-- dist/extension.js        Single bundled Marketplace runtime
`-- test/                    Extension and core tests
```

`build/` is ignored intermediate test output. VS Code requires the JavaScript entry point declared by `main`; TypeScript source is not included in the VSIX.

## Web application

```text
apps/web/
|-- tools/                   Web-only tools and adapters
|-- public/                  Browser client, HTML, and styles
|-- server/                  HTTP API and product services
|-- scripts/build.mjs        Web build
`-- test/                    Web and core tests
```

Shared packages and `tools/dist/` are generated before Web start, test, and build commands. Web does not get copied into the Extension package.

## Important boundaries

- `agent/runtime/AgentController` coordinates Extension runs but does not directly mutate the workspace.
- `ExtensionToolExecutor` routes validated actions to guarded host implementations.
- `agent/tools/workspace/EditProposalManager` owns pending reviewed edits.
- `agent/tools/workspace/WorkspacePathOperations` owns confirmed directory and path changes.
- `core/runtime/llama/LlamaCppRuntime` owns the local llama-server process.
- Host-neutral runtime contracts live in `packages/agent-core`; platform adapters remain product-specific.
- Browser-only upload, image-viewer, chart, live-web, and artifact tools belong only to `apps/web/tools` and are not packaged in the extension.

## Build commands

- From the repository root, `npm run build` builds both apps and both shared packages.
- `npm test` runs the Extension and Web suites.
- `npm run check` checks all TypeScript packages.
- `npm run package:extension` tests and bundles the Extension, validates release metadata, and creates the VSIX.
