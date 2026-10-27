// Beginner guide: Collects and re-exports the public pieces from this folder.
import { VECTRA_TOOL_DEFINITIONS } from '../catalog';

/** Canonical inventory consumed by the VS Code host adapter. Platform code
 * stays in the extension because it requires VS Code trust, diagnostics, diff,
 * confirmation, and workspace APIs. */
export const EXTENSION_TOOL_DEFINITIONS = VECTRA_TOOL_DEFINITIONS.filter(
  (item) => item.surface === 'extension' || item.surface === 'all'
);
