# Vectra Extension Architecture

## Products and shared packages

- `src/` contains the VS Code extension and its VS Code-specific adapters and tools.
- `../web/` is the standalone web application and owns its server, browser UI, and web-only tools.
- `../../packages/agent-core/` contains host-neutral agent sessions, Deep Agents orchestration, contracts, catalogs, and subagents.
- `../../packages/local-runtime/` contains portable local-model discovery and runtime-profile logic.

## Extension domains

- `src/agent/` - everything that makes the coding agent act: orchestration, skills, state, and guarded tools.
- `src/agent/skills/` - specialized planner, researcher, reviewer, coder, tester, security, and documentation skills.
- `src/agent/tools/` - tool contracts, routing, web research, workspace access, reviewed edits, Git, and approved commands.
- `src/core/` - extension infrastructure: documents, history, models, providers, local runtime, UI, configuration, and shared types.
- `src/extension.ts` - the small VS Code composition root that connects `agent` and `core`.

Workspace-specific instructions use `.vectra/skills/<name>/SKILL.md`. The agent lists lightweight metadata first and reads a skill only when needed. Skills are instruction-only and remain subject to the same guarded tools and approvals as every other request.

## Safety boundary

The Extension core never receives direct VS Code workspace or shell access. It invokes guarded host tools that preserve workspace boundaries, sensitive-file policy, plan approval, edit review, and command confirmation. Vectra Web's core exposes only uploaded/generated-file tools and does not provide arbitrary browser filesystem access.

One deterministic shortcut exists: an explicit single-folder request in Agent mode skips model startup and the agent loop and calls the same guarded directory tool directly. It still receives workspace-path validation and a confirmation dialog, and the session stays busy until that dialog closes.

## Local model lifecycle

`LlamaCppRuntime` launches `llama-server`, while `LlamaRuntimeProfile` selects hardware-aware context, GPU, KV-cache, and prompt-cache options. Model loading has its own timeout. Inference uses `vectra.localRequestTimeoutSeconds` (3600 seconds by default), so slow loading, prompt ingestion, or CPU inference is not cut off by the former generic 120-second request limit.

Conversational responses stream when supported. Structured agent/tool responses remain non-streaming because incomplete JSON or tool calls cannot be safely executed.

## Build boundary

Extension TypeScript compiles to the ignored `build/` directory for tests, then the esbuild CLI creates the single Marketplace runtime file `dist/extension.js`. The VSIX excludes TypeScript source, intermediate output, scripts, dependencies, and browser-product files. Extension packaging does not build or package Vectra Web. Shared packages and Web tools compile to their own ignored `dist/` directories before Web starts, tests, or builds.

The extension and browser product are tested independently. Platform adapters stay with their product: VS Code workspace tools live in `apps/vscode-extension/src/agent/tools`, while browser uploads, viewers, live-web access, charts, and downloadable artifacts live in `apps/web/tools`.
