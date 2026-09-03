# Vectra Privacy Notes

Vectra is designed as a local agent developer tool. Local GGUF inference through
llama.cpp remains on the user's computer. When a user explicitly selects a cloud
provider, prompts and the context needed to fulfill the request are sent to that
provider according to the provider's own terms and privacy policy.

The VS Code extension stores configured provider credentials only on the user's
local computer. Vectra Web keeps cloud API keys in the browser session and sends
them only to its locally running Node server for the requested provider call.
Vectra does not operate a separate hosted key-storage service in this release.

Users should review workspace content before enabling access to sensitive files.
Vectra blocks common credential files by default in the VS Code extension.
