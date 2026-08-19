import { TodoItem } from '../types';

/**
 * Holds the agent's live task checklist for the current session. Full-replace
 * semantics: every todo_write call supplies the complete list, so this class
 * never merges partial updates.
 */
export class TodoManager {
  private items: TodoItem[] = [];

  set(items: TodoItem[]): void {
    this.items = items;
  }

  list(): TodoItem[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
  }
}
