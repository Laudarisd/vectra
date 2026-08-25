"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentSession = exports.PlanState = exports.ApprovalState = exports.TodoState = exports.AgentEventStream = void 0;
class AgentEventStream {
    listeners = new Set();
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit(event) {
        const value = { ...event, timestamp: event.timestamp ?? Date.now() };
        for (const listener of [...this.listeners])
            listener(value);
        return value;
    }
    clear() {
        this.listeners.clear();
    }
}
exports.AgentEventStream = AgentEventStream;
class TodoState {
    events;
    items = [];
    constructor(events) {
        this.events = events;
    }
    set(items) {
        validateTodos(items);
        this.items = items.map((item) => ({ ...item }));
        this.events?.emit({ type: 'todos.changed', todos: this.list() });
    }
    list() {
        return this.items.map((item) => ({ ...item }));
    }
    clear() {
        this.items = [];
        this.events?.emit({ type: 'todos.changed', todos: [] });
    }
}
exports.TodoState = TodoState;
class ApprovalState {
    events;
    requests = new Map();
    waiters = new Map();
    constructor(events) {
        this.events = events;
    }
    request(kind, payload, id = createId()) {
        const request = {
            id,
            kind,
            payload,
            status: 'pending',
            createdAt: Date.now()
        };
        this.requests.set(id, request);
        this.events?.emit({ type: 'approval.requested', approval: cloneApproval(request) });
        return cloneApproval(request);
    }
    get(id) {
        const request = this.requests.get(id);
        return request ? cloneApproval(request) : undefined;
    }
    list() {
        return [...this.requests.values()].map(cloneApproval);
    }
    approve(id) {
        return this.decide(id, 'approved');
    }
    reject(id) {
        return this.decide(id, 'rejected');
    }
    cancelPending(kind) {
        for (const request of this.requests.values()) {
            if (request.status !== 'pending' || (kind && request.kind !== kind))
                continue;
            request.status = 'cancelled';
            request.decidedAt = Date.now();
            for (const waiter of this.waiters.get(request.id) ?? [])
                waiter(new Error('Approval request was cancelled.'));
            this.waiters.delete(request.id);
            this.events?.emit({ type: 'approval.cancelled', approval: cloneApproval(request) });
        }
    }
    waitForDecision(id, signal) {
        const existing = this.requests.get(id);
        if (!existing)
            return Promise.reject(new Error(`Unknown approval request: ${id}`));
        if (existing.status === 'approved' || existing.status === 'rejected')
            return Promise.resolve(existing.status);
        if (existing.status === 'cancelled')
            return Promise.reject(new Error('Approval request was cancelled.'));
        if (signal?.aborted)
            return Promise.reject(abortError());
        return new Promise((resolve, reject) => {
            let wrapped;
            const onAbort = () => {
                removeWaiter(this.waiters, id, wrapped);
                reject(abortError());
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            wrapped = (decision) => {
                signal?.removeEventListener('abort', onAbort);
                if (decision instanceof Error)
                    reject(decision);
                else
                    resolve(decision);
            };
            const waiters = this.waiters.get(id) ?? new Set();
            waiters.add(wrapped);
            this.waiters.set(id, waiters);
        });
    }
    decide(id, decision) {
        const request = this.requests.get(id);
        if (!request || request.status !== 'pending')
            return false;
        request.status = decision;
        request.decidedAt = Date.now();
        const waiters = this.waiters.get(id);
        this.waiters.delete(id);
        for (const waiter of waiters ?? [])
            waiter(decision);
        this.events?.emit({ type: `approval.${decision}`, approval: cloneApproval(request) });
        return true;
    }
}
exports.ApprovalState = ApprovalState;
class PlanState {
    approvals;
    events;
    current;
    constructor(approvals = new ApprovalState(), events) {
        this.approvals = approvals;
        this.events = events;
    }
    propose(stepTexts, reason) {
        const steps = stepTexts.map((text, index) => ({ id: String(index + 1), text: String(text).trim() }));
        if (!steps.length || steps.some((step) => !step.text))
            throw new Error('A plan requires at least one non-empty step.');
        const plan = {
            id: createId(),
            steps,
            reason,
            status: 'pending',
            revision: (this.current?.revision ?? 0) + 1,
            createdAt: Date.now()
        };
        this.current = plan;
        this.approvals.request('plan', this.snapshot(plan), plan.id);
        this.events?.emit({ type: 'plan.changed', plan: this.snapshot(plan) });
        return plan;
    }
    get() {
        return this.current;
    }
    reset() {
        this.approvals.cancelPending('plan');
        this.current = undefined;
        this.events?.emit({ type: 'plan.changed', plan: undefined });
    }
    approve() {
        this.decide('approved');
    }
    reject() {
        this.decide('rejected');
    }
    waitForDecision(planId, signal) {
        return this.approvals.waitForDecision(planId, signal);
    }
    decide(decision) {
        if (!this.current || this.current.status !== 'pending')
            return;
        const accepted = decision === 'approved'
            ? this.approvals.approve(this.current.id)
            : this.approvals.reject(this.current.id);
        if (!accepted)
            return;
        this.current.status = decision;
        this.events?.emit({ type: 'plan.changed', plan: this.snapshot(this.current) });
    }
    snapshot(plan) {
        return { ...plan, steps: plan.steps.map((step) => ({ ...step })) };
    }
}
exports.PlanState = PlanState;
class AgentSession {
    events;
    approvals;
    todos;
    plans;
    messageState = [];
    activeRunId;
    constructor(options = {}) {
        this.events = options.events ?? new AgentEventStream();
        this.approvals = options.approvals ?? new ApprovalState(this.events);
        this.todos = options.todos ?? new TodoState(this.events);
        this.plans = options.plans ?? new PlanState(this.approvals, this.events);
        this.replaceMessages(options.messages ?? []);
    }
    get isBusy() {
        return Boolean(this.activeRunId);
    }
    get messages() {
        return this.messageState;
    }
    replaceMessages(messages) {
        this.messageState = messages.map((message) => ({ ...message }));
        this.events.emit({ type: 'messages.changed', messages: this.snapshotMessages() });
    }
    addMessage(message) {
        this.messageState.push({ ...message });
        this.events.emit({ type: 'message.added', message: { ...message } });
    }
    clear() {
        if (this.isBusy)
            throw new Error('Cannot clear an agent session while a run is active.');
        this.messageState = [];
        this.todos.clear();
        this.plans.reset();
        this.approvals.cancelPending();
        this.events.emit({ type: 'session.cleared' });
    }
    async run(executor, signal) {
        if (this.activeRunId)
            throw new Error('Agent session is already running.');
        if (signal?.aborted)
            throw abortError();
        const runId = createId();
        this.activeRunId = runId;
        this.events.emit({ type: 'run.started', runId });
        try {
            const result = await executor({
                runId,
                signal,
                messages: this.snapshotMessages(),
                events: this.events,
                todos: this.todos,
                plans: this.plans,
                approvals: this.approvals
            });
            this.events.emit({ type: 'run.completed', runId, result });
            return result;
        }
        catch (error) {
            this.events.emit({ type: signal?.aborted ? 'run.cancelled' : 'run.failed', runId, error: messageOf(error) });
            throw error;
        }
        finally {
            this.activeRunId = undefined;
        }
    }
    snapshotMessages() {
        return this.messageState.map((message) => ({ ...message }));
    }
}
exports.AgentSession = AgentSession;
function validateTodos(items) {
    if (items.length > 100)
        throw new Error('A todo list cannot contain more than 100 items.');
    const ids = new Set();
    for (const item of items) {
        if (!item.id?.trim() || !item.content?.trim())
            throw new Error('Every todo requires an id and content.');
        if (!['pending', 'in_progress', 'completed'].includes(item.status))
            throw new Error(`Invalid todo status: ${item.status}`);
        if (ids.has(item.id))
            throw new Error(`Duplicate todo id: ${item.id}`);
        ids.add(item.id);
    }
}
function cloneApproval(request) {
    return { ...request };
}
function removeWaiter(waiters, id, waiter) {
    const values = waiters.get(id);
    values?.delete(waiter);
    if (!values?.size)
        waiters.delete(id);
}
function createId() {
    if (typeof globalThis.crypto?.randomUUID === 'function')
        return globalThis.crypto.randomUUID();
    return `vectra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function abortError() {
    const error = new Error('Agent run cancelled.');
    error.name = 'AbortError';
    return error;
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
__exportStar(require("./deepAgent"), exports);
__exportStar(require("./tools"), exports);
//# sourceMappingURL=index.js.map