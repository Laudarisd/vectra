import type { AgentEventStream } from '../index';

export type ToolHandler<TAction, TContext, TResult> = (action: TAction, context: TContext) => Promise<TResult> | TResult;

export class AgentToolRouter<TAction, TContext, TResult> {
  private readonly handlers = new Map<string, ToolHandler<TAction, TContext, TResult>>();
  private fallback?: ToolHandler<TAction, TContext, TResult>;

  constructor(
    private readonly typeOf: (action: TAction) => string,
    private readonly events?: AgentEventStream
  ) {}

  register(type: string, handler: ToolHandler<TAction, TContext, TResult>): this {
    if (!type.trim()) throw new Error('Tool type cannot be empty.');
    if (this.handlers.has(type)) throw new Error(`Tool already registered: ${type}`);
    this.handlers.set(type, handler);
    return this;
  }

  registerFallback(handler: ToolHandler<TAction, TContext, TResult>): this {
    this.fallback = handler;
    return this;
  }

  list(): string[] { return [...this.handlers.keys()].sort(); }

  async execute(action: TAction, context: TContext, runId?: string): Promise<TResult> {
    const type = this.typeOf(action);
    const handler = this.handlers.get(type) ?? this.fallback;
    if (!handler) throw new Error(`Unknown agent tool: ${type}`);
    this.events?.emit({ type: 'tool.started', runId, tool: type, action });
    try {
      const result = await handler(action, context);
      this.events?.emit({ type: 'tool.completed', runId, tool: type, result });
      return result;
    } catch (error) {
      this.events?.emit({ type: 'tool.failed', runId, tool: type, error: messageOf(error) });
      throw error;
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
