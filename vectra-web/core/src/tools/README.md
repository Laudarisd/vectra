# Shared Vectra tools

This directory is the source of truth for tool contracts, metadata, routing,
and host-neutral implementations used by Vectra Extension and Vectra Web.

- `catalog.ts` defines canonical Vectra capability names, descriptions, risk,
  and supported surfaces.
- `contracts.ts` defines shared tool and executor interfaces.
- `router.ts` dispatches validated actions and emits lifecycle events.
- `deepTools.ts` exposes guarded host capabilities to Deep Agents with a
  collision-free `vectra_*` namespace.
- `deepAgentBuiltins.ts` explicitly catalogs every Deep Agents middleware tool,
  its availability requirements, fallback action alias, and progress label.
- `attachments.ts` implements attachment listing/reading shared by web hosts.
- `policy.ts` owns shared risk groups and the playful live-operation wording.
- `extension/` exports the complete VS Code-facing inventory; execution remains
  in the VS Code adapter because it requires trust, diagnostics, diff, and
  confirmation APIs.
- `web/` implements the portable uploaded-file and downloadable-artifact tools.

Deep Agents scratch tools and Vectra workspace tools are deliberately separate.
Native tool calling uses the upstream names (`read_file`, `task`, and so on).
Vectra's structured JSON fallback uses `deep_*` for upstream middleware tools,
while unprefixed action names continue to address guarded Vectra host tools.
`execute` requires a sandbox backend; async task tools require a configured
async subagent. They are cataloged but never falsely advertised as active.

Every definition keeps a stable machine `name` for model/tool calls and a
plain-English `displayName` for logs, settings, and UI. Renaming a machine name
breaks saved calls; improving a display name is safe.

Host adapters remain close to their platform. VS Code workspace, diagnostics,
diff UI, and command confirmation require the VS Code API; browser/server file
access requires a separately selected sandbox. Both adapters use the contracts
and catalog here instead of defining a second agent tool system.

Capability vocabulary such as `create_files`, `generate_folder_files`, and
`parse_files` is stored as searchable aliases of `propose_files` and
`read_files`. Aliases improve small-model discovery without creating duplicate
tools, competing schemas, or multiple security implementations.
