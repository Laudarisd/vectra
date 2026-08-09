## 1.0.0

- Fixed TypeScript document-format typing mismatch between parseable Office formats and writable PDF/DOCX formats.
- PPTX, XLSX and RTF remain parse/read formats; PDF and DOCX remain generated/editable binary document formats.

# Changelog

## 1.0.0

- Added filesystem-backed `workspace_summary` and `list_directory` tools so Ask/Agent can answer project structure and exact file-count questions.
- Fixed workspace-root name resolution (for example asking about directory `vectra` when `vectra` is the open root).
- Fixed the agent loop so read/search/run tool results are always synthesized in a subsequent model turn instead of returning a pre-tool provisional message.
- Added automatic workspace evidence preloading for Ask and Agent.
- Added `run_file`, `run_project`, and auto-detected `run_tests` with explicit user confirmation across common Python, Node, C/C++, .NET/C#, Java, Go, Rust and other runtimes.
- Added extension parsing for PPTX, XLSX and RTF alongside PDF/DOC/DOCX.
- Added Vectra Web pre-parse endpoint and parse-status attachment UI for PDF/DOCX/PPTX/XLSX/RTF.
- Added Web false-attachment-refusal recovery for models that incorrectly say they cannot access already-parsed files.
- Added downloadable Web artifacts for PDF, DOCX and common text/code file extensions.
- Added proprietary license, notice and privacy metadata and aligned VS Code typings with the declared VS Code engine.


## 2.0.2
- Fixed local llama.cpp startup when the preferred port is already occupied: Vectra now selects the next free localhost port and reports the actual endpoint.
- Prevented false Ready states caused by probing an unrelated llama-server already listening on the requested port.
- Added a private per-launch llama.cpp API key and disabled llama.cpp's bundled Web UI to reduce local attack surface.
- Unified the Web top-bar Models / Local Model controls into one Model button.

# Changelog

## 2.0.1

- Fixed VSIX packaging so all compiled agent, provider, service, UI, and utility runtime modules are included.
- Added a fresh first-run reveal key so Vectra is surfaced after upgrading from affected builds.
- Added release validation that checks every local runtime import referenced by the extension entry point exists in the packaged VSIX.

## 2.0.0

- Added robust PDF extraction with `pdftotext` when available and a safe fallback that rejects binary/gibberish output.
- Added DOCX parsing for both the VS Code extension and Vectra Web.
- Added reviewed `create_document` and `edit_document` actions for real PDF/DOCX output.
- Added focused `replace_lines`, `delete_lines`, and `insert_lines` code-edit actions.
- `delete_file` now supports text, documents, images, and other workspace files after review.
- Added downloadable PDF/DOCX artifacts to Vectra Web when the user requests document generation.
- Added automatic web-port fallback when the preferred port is already in use.
- Reworked VS Code UI: larger Settings control, compact API/Local/Test controls, model/runtime details moved into Settings, simplified composer controls.
- Replaced numbered agent-step text with live activity states such as Analyzing, Reading, Editing, Running tests, and Producing.
- Added document and local-runtime regression tests.
