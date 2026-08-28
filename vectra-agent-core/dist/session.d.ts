export type AgentMessageRole = 'user' | 'assistant' | 'system' | 'tool';
export interface AgentMessage {
    id: string;
    role: AgentMessageRole;
    content: string;
    createdAt: number;
}
export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export interface AgentTodo {
    id: string;
    content: string;
    status: TodoStatus;
}
export type PlanStatus = 'pending' | 'approved' | 'rejected';
export interface AgentPlanStep {
    id: string;
    text: string;
}
export interface AgentPlan {
    id: string;
    steps: AgentPlanStep[];
    reason?: string;
    status: PlanStatus;
    revision: number;
    createdAt: number;
}
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export interface ApprovalRequest<T = unknown> {
    id: string;
    kind: string;
    payload: T;
    status: ApprovalStatus;
    createdAt: number;
    decidedAt?: number;
}
export interface AgentRuntimeEvent {
    type: string;
    timestamp: number;
    runId?: string;
    [key: string]: unknown;
}
export type AgentRuntimeEventListener = (event: AgentRuntimeEvent) => void;
export declare class AgentEventStream {
    private readonly listeners;
    subscribe(listener: AgentRuntimeEventListener): () => void;
    emit(event: Omit<AgentRuntimeEvent, 'timestamp'> & {
        timestamp?: number;
    }): AgentRuntimeEvent;
    clear(): void;
}
export declare class TodoState<T extends AgentTodo = AgentTodo> {
    private readonly events?;
    private items;
    constructor(events?: AgentEventStream | undefined);
    set(items: readonly T[]): void;
    list(): T[];
    clear(): void;
}
type ApprovalDecision = 'approved' | 'rejected';
export declare class ApprovalState {
    private readonly events?;
    private readonly requests;
    private readonly waiters;
    constructor(events?: AgentEventStream | undefined);
    request<T>(kind: string, payload: T, id?: string): ApprovalRequest<T>;
    get<T = unknown>(id: string): ApprovalRequest<T> | undefined;
    list(): ApprovalRequest[];
    approve(id: string): boolean;
    reject(id: string): boolean;
    cancelPending(kind?: string): void;
    waitForDecision(id: string, signal?: AbortSignal): Promise<ApprovalDecision>;
    private decide;
}
export declare class PlanState<T extends AgentPlan = AgentPlan> {
    private readonly approvals;
    private readonly events?;
    private current?;
    constructor(approvals?: ApprovalState, events?: AgentEventStream | undefined);
    propose(stepTexts: readonly string[], reason?: string): T;
    get(): T | undefined;
    reset(): void;
    approve(): void;
    reject(): void;
    waitForDecision(planId: string, signal?: AbortSignal): Promise<ApprovalDecision>;
    private decide;
    private snapshot;
}
export interface AgentRunContext<M extends AgentMessage = AgentMessage> {
    runId: string;
    signal?: AbortSignal;
    messages: M[];
    events: AgentEventStream;
    todos: TodoState;
    plans: PlanState;
    approvals: ApprovalState;
}
export declare class AgentSession<M extends AgentMessage = AgentMessage> {
    readonly events: AgentEventStream;
    readonly approvals: ApprovalState;
    readonly todos: TodoState;
    readonly plans: PlanState;
    private messageState;
    private activeRunId?;
    constructor(options?: {
        events?: AgentEventStream;
        approvals?: ApprovalState;
        todos?: TodoState;
        plans?: PlanState;
        messages?: readonly M[];
    });
    get isBusy(): boolean;
    get messages(): M[];
    replaceMessages(messages: readonly M[]): void;
    addMessage(message: M): void;
    clear(): void;
    run<T>(executor: (context: AgentRunContext<M>) => Promise<T>, signal?: AbortSignal): Promise<T>;
    private snapshotMessages;
}
export {};
//# sourceMappingURL=session.d.ts.map