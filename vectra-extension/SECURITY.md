# Security

Vectra is a local agent but can send selected context to configured cloud providers.

- VS Code workspace writes are review-before-apply.
- File proposals use stale-content hashes.
- Commands/tests require explicit confirmation.
- Sensitive files are blocked by default.
- Workspace Trust is enforced for inspection/mutation/tool execution.
- Local GGUF files stay on the local computer.
- Vectra Web binds to localhost by default and blocks cross-origin API requests.
- Vectra Web API keys are accepted per browser request/session and are not persisted by the Node server.
- PDF/DOCX parsing happens locally before text-model requests.
- Raw binary PDF/DOCX bytes are never decoded as arbitrary UTF-8 model text.
- Web local-model file pickers/process APIs are available only while bound to localhost.
