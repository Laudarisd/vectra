// Adapts shared todo state to the extension's TodoItem type.
import { TodoState } from '../runtime/AgentSession';
import { TodoItem } from '../../core/types';

/**
 * Holds the agent's live task checklist for the current session. Full-replace
 * semantics: every todo_write call supplies the complete list, so this class
 * never merges partial updates.
 */
export class TodoManager extends TodoState<TodoItem> {}
