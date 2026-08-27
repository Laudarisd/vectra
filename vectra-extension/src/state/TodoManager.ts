import { TodoState } from '../../generated/agent-core';
import { TodoItem } from '../types';

/**
 * Holds the agent's live task checklist for the current session. Full-replace
 * semantics: every todo_write call supplies the complete list, so this class
 * never merges partial updates.
 */
export class TodoManager extends TodoState<TodoItem> {}
