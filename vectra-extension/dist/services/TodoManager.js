"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TodoManager = void 0;
const shared_core_1 = require("../../shared-core");
/**
 * Holds the agent's live task checklist for the current session. Full-replace
 * semantics: every todo_write call supplies the complete list, so this class
 * never merges partial updates.
 */
class TodoManager extends shared_core_1.TodoState {
}
exports.TodoManager = TodoManager;
//# sourceMappingURL=TodoManager.js.map