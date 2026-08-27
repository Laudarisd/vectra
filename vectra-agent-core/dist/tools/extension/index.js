"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXTENSION_TOOL_DEFINITIONS = void 0;
const catalog_1 = require("../catalog");
/** Canonical inventory consumed by the VS Code host adapter. Platform code
 * stays in the extension because it requires VS Code trust, diagnostics, diff,
 * confirmation, and workspace APIs. */
exports.EXTENSION_TOOL_DEFINITIONS = catalog_1.VECTRA_TOOL_DEFINITIONS.filter((item) => item.surface === 'extension' || item.surface === 'all');
//# sourceMappingURL=index.js.map