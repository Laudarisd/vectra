# Vectra Extension Architecture

## Products

- `src/` contains the VS Code extension, including its product-owned core in `src/core/`.
- `../vectra-web/` is the standalone web application, including its product-owned core in `core/`.
- The two products do not depend on a repository-level shared package or generated copies of one another.

## Extension domains

- `src/agent/` - orchestration and extension tool adapters.
- `src/core/` - the Extension's agent runtime, model rules, and tool contracts.
- `src/documents/` - attachment parsing and document codecs.
- `src/models/` - discovery, catalog, download, and recommendations.
- `src/providers/` - cloud and local API provider clients.
- `src/runtime/llama/` - llama.cpp installation, launch, and runtime profiling.
- `src/state/` - plans and todos.
- `src/tools/` - network-facing tools.
- `src/workspace/` - workspace reads, reviewed edits, Git, and approved commands.

## Safety boundary

The Extension core never receives direct VS Code workspace or shell access. It invokes guarded host tools that preserve workspace boundaries, sensitive-file policy, plan approval, edit review, and command confirmation. Vectra Web's core exposes only uploaded/generated-file tools and does not provide arbitrary browser filesystem access.

## Local model lifecycle

`LlamaCppRuntime` launches `llama-server`, while `LlamaRuntimeProfile` selects hardware-aware context, GPU, KV-cache, and prompt-cache options. Model loading has its own timeout. Inference uses `vectra.localRequestTimeoutSeconds` (3600 seconds by default), so slow loading, prompt ingestion, or CPU inference is not cut off by the former generic 120-second request limit.

Conversational responses stream when supported. Structured agent/tool responses remain non-streaming because incomplete JSON or tool calls cannot be safely executed.

## Build boundary

Extension TypeScript compiles to the ignored `build/` directory for tests, then the esbuild CLI creates the single Marketplace runtime file `dist/extension.js`. The VSIX excludes TypeScript source, intermediate output, scripts, dependencies, and Web files. Extension packaging does not build or package Web. Vectra Web compiles `core/src/` into its own ignored `core/dist/` before starting, testing, or building.
