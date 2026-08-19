"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TodoManager = void 0;
/**
 * Holds the agent's live task checklist for the current session. Full-replace
 * semantics: every todo_write call supplies the complete list, so this class
 * never merges partial updates.
 */
class TodoManager {
    items = [];
    set(items) {
        this.items = items;
    }
    list() {
        return this.items;
    }
    clear() {
        this.items = [];
    }
}
exports.TodoManager = TodoManager;
//# sourceMappingURL=TodoManager.js.map