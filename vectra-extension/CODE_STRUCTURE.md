# Vectra Code Structure

The repository contains two independent products:

```text
docs/assets/                 Documentation images
tools/                       Repository maintenance scripts
vectra-extension/            VS Code extension
vectra-web/                  Browser application
```

## VS Code extension

```text
vectra-extension/
|-- src/
|   |-- agent/               Conversation orchestration and host dispatch
|   |-- core/                Extension-owned agent runtime and contracts
|   |-- documents/           Attachment parsing and document codecs
|   |-- models/              Model discovery, catalog, and downloads
|   |-- providers/           Cloud and local provider clients
|   |-- runtime/llama/       llama.cpp process and launch policy
|   |-- state/               Plan and todo session state
|   |-- tools/               Non-workspace host tools
|   |-- ui/                  VS Code webview provider
|   |-- workspace/           Guarded workspace, Git, and command operations
|   `-- extension.ts         Extension composition root
|-- media/                   Extension webview assets
|-- scripts/                 Build and release checks
|-- dist/extension.js        Single bundled Marketplace runtime
`-- test/                    Extension and core tests
```

`build/` is ignored intermediate test output. VS Code requires the JavaScript entry point declared by `main`; TypeScript source is not included in the VSIX.

## Web application

```text
vectra-web/
|-- core/
|   `-- src/                 Web-owned agent runtime and contracts
|-- public/                  Browser client, HTML, and styles
|-- server/                  HTTP API and product services
|-- scripts/build.mjs        Web build
`-- test/                    Web and core tests
```

`core/dist/` is generated before Web start, test, and build commands. Web does not get copied into the Extension package.

## Important boundaries

- `AgentController` coordinates Extension runs but does not directly mutate the workspace.
- `ExtensionToolExecutor` routes validated actions to guarded host implementations.
- `EditProposalManager` owns pending reviewed edits.
- `WorkspacePathOperations` owns confirmed directory and path changes.
- `LlamaCppRuntime` owns the local llama-server process.
- Each product owns its core. A core change must be applied and tested in both products when the behavior should remain aligned.

## Build commands

- From `vectra-extension/`, `npm run compile` builds test output and the single runtime bundle.
- `npm test` runs Extension tests followed by canonical Web tests.
- `npm run build:web` builds the canonical Web product directly.
- `npm run package` tests both products, validates release metadata, and creates the VSIX.
