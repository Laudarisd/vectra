# Vectra monorepo architecture

Vectra is organized as two applications and two shared packages.

- `apps/vscode-extension` owns VS Code activation, commands, workspace access, webviews, and extension packaging.
- `apps/web` owns the HTTP server, browser UI, persistence, document preprocessing, and web-only tools.
- `packages/agent-core` owns the environment-neutral Deep Agents runtime, tool contracts, shared tool catalog, subagent definitions, document types, and web tool implementations used by the web host.
- `packages/local-runtime` owns portable local-model discovery and llama.cpp runtime-profile calculation.

Applications may depend on packages. Packages must never import application code.

The migration deliberately preserves the extension's existing runtime implementation in its app because parts of it are coupled to VS Code approval, configuration, and workspace APIs. Those files should be moved into `agent-core` only after the host dependencies have been expressed as adapter interfaces and parity tests cover both hosts.

## Commands

Run all commands from this directory:

```sh
npm install
npm run build
npm test
npm run package:extension
npm run start:web
```

There is one root lockfile and normally one root `node_modules` directory.
