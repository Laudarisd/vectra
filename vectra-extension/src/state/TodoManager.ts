// Beginner guide: Handles t od om an ag er responsibilities for Vectra.
import { TodoState } from '../core';
import { TodoItem } from '../types';

/**
 * Holds the agent's live task checklist for the current session. Full-replace
 * semantics: every todo_write call supplies the complete list, so this class
 * never merges partial updates.
 */
export class TodoManager extends TodoState<TodoItem> {}
