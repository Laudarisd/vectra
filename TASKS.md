# Vectra Advanced Agent Tasks

## Goal

Make Vectra more capable than Deep Agents while remaining local-first, cross-platform, safe, and usable from both the VS Code extension and Vectra Web.

## Tasks

### 1. Shared agent core

- [X] Create a shared TypeScript agent runtime for the extension and web server.
- [X] Move agent state, tools, plans, todos, streaming, and approvals into the shared core.
- [X] Give the extension and web version the same agent capabilities.

### 2. Deep Agents integration

- [ ] Add the TypeScript `deepagents` package to the shared Node runtime.
- [ ] Wrap Deep Agents behind a Vectra interface so it is not tied to the UI or one model provider.
- [ ] Connect Vectra workspace, document, Git, command, web, and edit tools.
- [ ] Preserve Vectra's JSON/grammar fallback for small local models without reliable native tool calling.
- [ ] Keep Vectra's human approval rules for file changes, commands, network access, and sensitive tools.

### 3. Durable execution

- [ ] Store conversations, plans, todos, tool results, artifacts, and checkpoints in SQLite.
- [ ] Support pause, resume, cancellation, retry, and recovery after restart.
- [ ] Add replay and branching from an earlier agent step.

### 4. Advanced context engine

- [ ] Replace character clipping with model-aware token budgeting.
- [ ] Add automatic conversation and tool-result summarization.
- [ ] Offload large results into per-task scratch files and load them on demand.
- [ ] Build a repository index using text search, symbols, dependencies, embeddings, and reranking.
- [ ] Track source file, line, freshness, relevance, and trust for injected context.

### 5. Memory and skills

- [ ] Add user, project, session, and agent-scoped memory.
- [ ] Let users inspect, edit, pin, expire, and delete memories.
- [ ] Support `AGENTS.md`, `VECTRA.md`, and progressively loaded `SKILL.md` files.
- [ ] Allow Vectra to suggest new memories or skills only with user approval.

### 6. Advanced agent teams

- [ ] Add specialized planner, researcher, coder, tester, reviewer, security, and documentation agents.
- [ ] Give each agent isolated context, tools, permissions, model, and budget.
- [ ] Run independent subagents concurrently when hardware permits.
- [ ] Support background agents with progress, steering, cancellation, and result review.

### 7. Modern LLM runtimes

- [ ] Add a runtime capability interface and automatic hardware detection.
- [ ] Keep optimized llama.cpp as the cross-platform default.
- [ ] Enable prompt/KV caching, speculative decoding, Flash Attention, parallel slots, embeddings, reranking, multimodal input, and runtime metrics in llama.cpp.
- [ ] Add optional MLX-LM support for Apple Silicon.
- [ ] Add optional vLLM and SGLang support for GPU servers and parallel agents.
- [ ] Add optional WebLLM support for browser-only local inference.
- [ ] Integrate Unsloth for fine-tuning, LoRA, quantization, model export, and optional serving.
- [ ] Treat AirLLM as an experimental oversized-model mode.

### 8. Intelligent model routing

- [ ] Select different models for planning, coding, vision, embeddings, reranking, drafting, and review.
- [ ] Route by model capability, hardware, latency, privacy, and task difficulty.
- [ ] Support hot model switching and project-specific LoRA adapters.

### 9. Safe autonomous coding

- [ ] Run risky work in disposable sandboxes or Git worktrees.
- [ ] Add snapshots, rollback, secret protection, network controls, and least-privilege tool permissions.
- [ ] Require tests and an evidence-backed verification pass before presenting changes.
- [ ] Show a complete audit timeline and final reviewable diff.

### 10. Open protocols and quality

- [ ] Support MCP for external tools and data.
- [ ] Support ACP so the Vectra agent can run in compatible editors.
- [ ] Support A2A for interoperable remote and local agents.
- [ ] Add agent evaluations for coding quality, context recall, tool correctness, safety, speed, and local-model reliability.
- [ ] Add local-first traces, runtime metrics, benchmark comparisons, and regression tests.

## Definition of done

- [ ] Extension and web use the same durable agent core.
- [ ] Vectra includes Deep Agents capabilities without losing local-model compatibility.
- [ ] Long tasks survive restarts and retain useful context without prompt overflow.
- [ ] Specialized agents can work safely in parallel and return grounded results.
- [ ] Vectra automatically chooses and optimizes the best available runtime.
- [ ] All writes, commands, network operations, memories, and learned skills remain reviewable and controllable by the user.



## Allow user to type and send queue promt in extension 
## Add line suggestions like copilot

