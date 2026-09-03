// Shared state and lifecycle primitives for every Vectra agent session.
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

export class AgentEventStream {
  private readonly listeners = new Set<AgentRuntimeEventListener>();

  subscribe(listener: AgentRuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: Omit<AgentRuntimeEvent, 'timestamp'> & { timestamp?: number }): AgentRuntimeEvent {
    const value = { ...event, timestamp: event.timestamp ?? Date.now() } as AgentRuntimeEvent;
    for (const listener of [...this.listeners]) listener(value);
    return value;
  }

  clear(): void {
    this.listeners.clear();
  }
}

export class TodoState<T extends AgentTodo = AgentTodo> {
  private items: T[] = [];

  constructor(private readonly events?: AgentEventStream) {}

  set(items: readonly T[]): void {
    validateTodos(items);
    this.items = items.map((item) => ({ ...item }));
    this.events?.emit({ type: 'todos.changed', todos: this.list() });
  }

  list(): T[] {
    return this.items.map((item) => ({ ...item }));
  }

  clear(): void {
    this.items = [];
    this.events?.emit({ type: 'todos.changed', todos: [] });
  }
}

type ApprovalDecision = 'approved' | 'rejected';

export class ApprovalState {
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly waiters = new Map<string, Set<(decision: ApprovalDecision | Error) => void>>();

  constructor(private readonly events?: AgentEventStream) {}

  request<T>(kind: string, payload: T, id = createId()): ApprovalRequest<T> {
    const request: ApprovalRequest<T> = {
      id,
      kind,
      payload,
      status: 'pending',
      createdAt: Date.now()
    };
    this.requests.set(id, request as ApprovalRequest);
    this.events?.emit({ type: 'approval.requested', approval: cloneApproval(request) });
    return cloneApproval(request);
  }

  get<T = unknown>(id: string): ApprovalRequest<T> | undefined {
    const request = this.requests.get(id);
    return request ? cloneApproval(request as ApprovalRequest<T>) : undefined;
  }

  list(): ApprovalRequest[] {
    return [...this.requests.values()].map(cloneApproval);
  }

  approve(id: string): boolean {
    return this.decide(id, 'approved');
  }

  reject(id: string): boolean {
    return this.decide(id, 'rejected');
  }

  cancelPending(kind?: string): void {
    for (const request of this.requests.values()) {
      if (request.status !== 'pending' || (kind && request.kind !== kind)) continue;
      request.status = 'cancelled';
      request.decidedAt = Date.now();
      for (const waiter of this.waiters.get(request.id) ?? []) waiter(new Error('Approval request was cancelled.'));
      this.waiters.delete(request.id);
      this.events?.emit({ type: 'approval.cancelled', approval: cloneApproval(request) });
    }
  }

  waitForDecision(id: string, signal?: AbortSignal): Promise<ApprovalDecision> {
    const existing = this.requests.get(id);
    if (!existing) return Promise.reject(new Error(`Unknown approval request: ${id}`));
    if (existing.status === 'approved' || existing.status === 'rejected') return Promise.resolve(existing.status);
    if (existing.status === 'cancelled') return Promise.reject(new Error('Approval request was cancelled.'));
    if (signal?.aborted) return Promise.reject(abortError());

    return new Promise<ApprovalDecision>((resolve, reject) => {
      let wrapped: (decision: ApprovalDecision | Error) => void;
      const onAbort = () => {
        removeWaiter(this.waiters, id, wrapped);
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      wrapped = (decision: ApprovalDecision | Error) => {
        signal?.removeEventListener('abort', onAbort);
        if (decision instanceof Error) reject(decision);
        else resolve(decision);
      };
      const waiters = this.waiters.get(id) ?? new Set<(decision: ApprovalDecision | Error) => void>();
      waiters.add(wrapped);
      this.waiters.set(id, waiters);
    });
  }

  private decide(id: string, decision: ApprovalDecision): boolean {
    const request = this.requests.get(id);
    if (!request || request.status !== 'pending') return false;
    request.status = decision;
    request.decidedAt = Date.now();
    const waiters = this.waiters.get(id);
    this.waiters.delete(id);
    for (const waiter of waiters ?? []) waiter(decision);
    this.events?.emit({ type: `approval.${decision}`, approval: cloneApproval(request) });
    return true;
  }
}

export class PlanState<T extends AgentPlan = AgentPlan> {
  private current?: T;

  constructor(
    private readonly approvals = new ApprovalState(),
    private readonly events?: AgentEventStream
  ) {}

  propose(stepTexts: readonly string[], reason?: string): T {
    const steps = stepTexts.map((text, index) => ({ id: String(index + 1), text: String(text).trim() }));
    if (!steps.length || steps.some((step) => !step.text)) throw new Error('A plan requires at least one non-empty step.');
    const plan = {
      id: createId(),
      steps,
      reason,
      status: 'pending',
      revision: (this.current?.revision ?? 0) + 1,
      createdAt: Date.now()
    } as T;
    this.current = plan;
    this.approvals.request('plan', this.snapshot(plan), plan.id);
    this.events?.emit({ type: 'plan.changed', plan: this.snapshot(plan) });
    return plan;
  }

  get(): T | undefined {
    return this.current;
  }

  reset(): void {
    this.approvals.cancelPending('plan');
    this.current = undefined;
    this.events?.emit({ type: 'plan.changed', plan: undefined });
  }

  approve(): void {
    this.decide('approved');
  }

  reject(): void {
    this.decide('rejected');
  }

  waitForDecision(planId: string, signal?: AbortSignal): Promise<ApprovalDecision> {
    return this.approvals.waitForDecision(planId, signal);
  }

  private decide(decision: ApprovalDecision): void {
    if (!this.current || this.current.status !== 'pending') return;
    const accepted = decision === 'approved'
      ? this.approvals.approve(this.current.id)
      : this.approvals.reject(this.current.id);
    if (!accepted) return;
    this.current.status = decision;
    this.events?.emit({ type: 'plan.changed', plan: this.snapshot(this.current) });
  }

  private snapshot(plan: T): T {
    return { ...plan, steps: plan.steps.map((step) => ({ ...step })) };
  }
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

export class AgentSession<M extends AgentMessage = AgentMessage> {
  readonly events: AgentEventStream;
  readonly approvals: ApprovalState;
  readonly todos: TodoState;
  readonly plans: PlanState;
  private messageState: M[] = [];
  private activeRunId?: string;

  constructor(options: {
    events?: AgentEventStream;
    approvals?: ApprovalState;
    todos?: TodoState;
    plans?: PlanState;
    messages?: readonly M[];
  } = {}) {
    this.events = options.events ?? new AgentEventStream();
    this.approvals = options.approvals ?? new ApprovalState(this.events);
    this.todos = options.todos ?? new TodoState(this.events);
    this.plans = options.plans ?? new PlanState(this.approvals, this.events);
    this.replaceMessages(options.messages ?? []);
  }

  get isBusy(): boolean {
    return Boolean(this.activeRunId);
  }

  get messages(): M[] {
    return this.messageState;
  }

  replaceMessages(messages: readonly M[]): void {
    this.messageState = messages.map((message) => ({ ...message }));
    this.events.emit({ type: 'messages.changed', messages: this.snapshotMessages() });
  }

  addMessage(message: M): void {
    this.messageState.push({ ...message });
    this.events.emit({ type: 'message.added', message: { ...message } });
  }

  clear(): void {
    if (this.isBusy) throw new Error('Cannot clear an agent session while a run is active.');
    this.messageState = [];
    this.todos.clear();
    this.plans.reset();
    this.approvals.cancelPending();
    this.events.emit({ type: 'session.cleared' });
  }

  async run<T>(executor: (context: AgentRunContext<M>) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.activeRunId) throw new Error('Agent session is already running.');
    if (signal?.aborted) throw abortError();
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
    } catch (error) {
      this.events.emit({ type: signal?.aborted ? 'run.cancelled' : 'run.failed', runId, error: messageOf(error) });
      throw error;
    } finally {
      this.activeRunId = undefined;
    }
  }

  private snapshotMessages(): M[] {
    return this.messageState.map((message) => ({ ...message }));
  }
}

function validateTodos(items: readonly AgentTodo[]): void {
  if (items.length > 100) throw new Error('A todo list cannot contain more than 100 items.');
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id?.trim() || !item.content?.trim()) throw new Error('Every todo requires an id and content.');
    if (!['pending', 'in_progress', 'completed'].includes(item.status)) throw new Error(`Invalid todo status: ${item.status}`);
    if (ids.has(item.id)) throw new Error(`Duplicate todo id: ${item.id}`);
    ids.add(item.id);
  }
}

function cloneApproval<T>(request: ApprovalRequest<T>): ApprovalRequest<T> {
  return { ...request };
}

function removeWaiter(
  waiters: Map<string, Set<(decision: ApprovalDecision | Error) => void>>,
  id: string,
  waiter: (decision: ApprovalDecision | Error) => void
): void {
  const values = waiters.get(id);
  values?.delete(waiter);
  if (!values?.size) waiters.delete(id);
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `vectra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function abortError(): Error {
  const error = new Error('Agent run cancelled.');
  error.name = 'AbortError';
  return error;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
