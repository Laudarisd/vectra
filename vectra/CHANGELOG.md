# Changelog

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
