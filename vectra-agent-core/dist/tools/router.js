"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentToolRouter = void 0;
class AgentToolRouter {
    typeOf;
    events;
    handlers = new Map();
    fallback;
    constructor(typeOf, events) {
        this.typeOf = typeOf;
        this.events = events;
    }
    register(type, handler) {
        if (!type.trim())
            throw new Error('Tool type cannot be empty.');
        if (this.handlers.has(type))
            throw new Error(`Tool already registered: ${type}`);
        this.handlers.set(type, handler);
        return this;
    }
    registerFallback(handler) {
        this.fallback = handler;
        return this;
    }
    list() { return [...this.handlers.keys()].sort(); }
    async execute(action, context, runId) {
        const type = this.typeOf(action);
        const handler = this.handlers.get(type) ?? this.fallback;
        if (!handler)
            throw new Error(`Unknown agent tool: ${type}`);
        this.events?.emit({ type: 'tool.started', runId, tool: type, action });
        try {
            const result = await handler(action, context);
            this.events?.emit({ type: 'tool.completed', runId, tool: type, result });
            return result;
        }
        catch (error) {
            this.events?.emit({ type: 'tool.failed', runId, tool: type, error: messageOf(error) });
            throw error;
        }
    }
}
exports.AgentToolRouter = AgentToolRouter;
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=router.js.map