import type { AgentEventStream } from '../index';
export type ToolHandler<TAction, TContext, TResult> = (action: TAction, context: TContext) => Promise<TResult> | TResult;
export declare class AgentToolRouter<TAction, TContext, TResult> {
    private readonly typeOf;
    private readonly events?;
    private readonly handlers;
    private fallback?;
    constructor(typeOf: (action: TAction) => string, events?: AgentEventStream | undefined);
    register(type: string, handler: ToolHandler<TAction, TContext, TResult>): this;
    registerFallback(handler: ToolHandler<TAction, TContext, TResult>): this;
    list(): string[];
    execute(action: TAction, context: TContext, runId?: string): Promise<TResult>;
}
//# sourceMappingURL=router.d.ts.map