# Vectra Extension Architecture

## Products

- `src/` contains the VS Code extension.
- `../vectra-web/` is the standalone web application.
- `../vectra-agent-core/` contains the host-neutral agent runtime and shared tool/model contracts.
- `generated/` contains package-time copies of Web and Agent Core. It is generated, not edited directly.

## Extension domains

- `src/agent/` — orchestration and extension tool adapters.
- `src/documents/` — attachment parsing and document codecs.
- `src/models/` — discovery, catalog, download, and recommendations.
- `src/providers/` — cloud and local API provider clients.
- `src/runtime/llama/` — llama.cpp installation, launch, and runtime profiling.
- `src/state/` — plans and todos.
- `src/tools/` — network-facing tools.
- `src/workspace/` — workspace reads, reviewed edits, Git, and approved commands.

## Safety boundary

The shared agent core never receives direct VS Code workspace or shell access. It invokes the extension's guarded host tools, which preserve workspace boundaries, sensitive-file policy, plan approval, edit review, and command confirmation. Vectra Web exposes only uploaded/generated-file tools and does not provide arbitrary browser filesystem access.

## Local model lifecycle

`LlamaCppRuntime` launches `llama-server`, while `LlamaRuntimeProfile` selects hardware-aware context, GPU, KV-cache, and prompt-cache options. Model loading has its own timeout. Inference uses `vectra.localRequestTimeoutSeconds` (3600 seconds by default), so slow loading, prompt ingestion, or CPU inference is not cut off by the former generic 120-second request limit.

Conversational responses stream when supported. Structured agent/tool responses remain non-streaming because incomplete JSON or tool calls cannot be safely executed.

## Source-of-truth rule

Edit `vectra-agent-core/` and `vectra-web/`, then run the extension synchronization scripts. `sync-agent-core.mjs` stages a complete copy before replacing `generated/agent-core`, preventing tests or packaging from observing a partially copied package.
