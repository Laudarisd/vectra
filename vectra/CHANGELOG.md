# Changelog

## 1.0.4

- Added a Device setting (Auto/GPU/CPU) in the Vectra sidebar and in Vectra Web's local runtime settings, with automatic GPU detection so choosing GPU shows what was found.
- Local GGUF models no longer stop and reload from disk when the same model and settings are already running.
- Ollama requests now keep the model resident with `keep_alive` instead of hitting Ollama's default 5-minute unload, and CPU mode forces true CPU-only inference.
- Shortened and clarified the Marketplace description and README.

## 1.0.3

- Added a conversational fast path so greetings and questions about Vectra get a direct, natural reply instead of triggering a workspace scan or an invented task.
- Fixed replies that surfaced bare engine status text ("action completed", "task completed") in place of a real answer.
- Fixed local/OpenAI-compatible providers being forced into the tool JSON schema even for plain conversation, which prevented natural prose replies.
- Removed internal loop-guard wording from user-facing messages in favor of plain explanations with a way forward.
- Added a self-verification turn after a completed write batch: the agent now checks its own prepared files (directory listing, contents, references) before reporting the task finished.
- Fixed the web app's false-attachment-refusal recovery not triggering for short (but valid) extracted document text.

## 1.0.2

- Prevented earlier malformed tool responses and stale actions from hijacking a new chat topic.
- Made the current user task authoritative and suppressed repeated tool-action loops.
- Recovered readable messages from truncated JSON tool responses without exposing incomplete actions.
- Corrected Node test discovery for reliable development and VSIX packaging on Node 24.

## 1.0.1

- Added session-only Edit & Resend for user prompts, including stopped requests and retained recent attachments.
- Added a searchable Local Model workflow with manual GGUF selection and automatic GGUF/Ollama model detection.
- Added a centralized agent tool catalog and dispatcher so schemas, model guidance, progress messages, and execution remain aligned.
- Added multi-file reading and batch file proposals for complete project creation in one agent request.
- Kept pending proposals available as a virtual workspace so the agent can inspect and refine a project before review.
- Consolidated PDF, Word, TXT, Markdown, Office, source-code, and image attachment parsing behind one tested extension service.
- Reduced duplicated attachment context sent to providers, preserving more context for repository and project files.
- Made the extension test command cross-platform for development and publishing.

## 1.0.0

- Initial public release of the local-first Vectra coding agent for VS Code.
- Added repository discovery, file reading/search, diagnostics, and reviewed file edits.
- Added focused line editing and reviewed PDF/DOCX creation and editing.
- Added PDF, DOC, DOCX, PPTX, XLSX, RTF, text, source-code, and image attachment support.
- Added approved file, project, test, and command execution across common development runtimes.
- Added local GGUF inference through llama.cpp with model, GPU, multi-GPU, MoE, and vision-projector configuration.
- Added optional OpenAI, Anthropic, Gemini, Ollama, and OpenAI-compatible providers.
