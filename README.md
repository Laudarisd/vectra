<p align="center"><img src="apps/vscode-extension/media/VectraLogo.png" alt="Vectra logo" width="112"></p>

<h1 align="center">Vectra</h1>

<p align="center">An AI workspace for VS Code and the web.</p>

<p align="center">
  <a href="./apps/vscode-extension"><img src="https://img.shields.io/badge/VS_Code-Extension-007ACC?logo=visualstudiocode" alt="VS Code extension"></a>
  <a href="./apps/web"><img src="https://img.shields.io/badge/Web-AI_Workspace-4f46e5" alt="Web app"></a>
  <a href="./apps/vscode-extension/CHANGELOG.md"><img src="https://img.shields.io/badge/extension-1.2.1-blue" alt="Extension version 1.2.1"></a>
</p>

<p align="center"><a href="docs/ko/README.md">한국어</a></p>

## What is Vectra?

> ⭐ **Stars are free, and they power the developer's coffee machine.** If Vectra helps you, hit the star button up top. The models will not run faster, but the maintainer will.

Vectra works with local GGUF/Ollama models and cloud providers. The VS Code extension understands and edits your workspace with approval controls. The web app supports chat, research, attachments, OCR, charts, and downloadable files.

## Repository

```text
apps/vscode-extension   VS Code extension
apps/web                Web application
packages/agent-core     Shared agent runtime
packages/local-runtime Shared local-model utilities
docs                    Documentation
```

## Development

Requires Node.js 22 or newer. Install the shared workspace dependencies once from the repository root:

```sh
npm install
```

### VS Code extension

Build and test only the extension:

```sh
npm run build -w vectra-ai
npm test -w vectra-ai
```

Create the Marketplace-ready VSIX:

```sh
npm run package:extension
```

### Web application

Start the web application locally:

```sh
npm run start:web
```

Build and test only the web application:

```sh
npm run build -w @vectra/web
npm test -w @vectra/web
```

### Everything

Build or test the complete monorepo when changing shared packages:

```sh
npm run build
npm test
```

See the [extension guide](apps/vscode-extension/README.md), [web guide](apps/web/README.md), and [architecture](docs/architecture.md).

## License

Vectra is proprietary software. See the [license](LICENSE) for permitted use.
