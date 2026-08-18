import { randomUUID } from 'node:crypto';
import { Plan, PlanStep } from '../types';

type PlanDecision = 'approved' | 'rejected';

/**
 * Owns the single active plan for the session. Mirrors PatchManager's
 * propose-then-decide shape: propose() never blocks, and the decision is
 * delivered asynchronously to whoever is awaiting waitForDecision().
 */
export class PlanManager {
  private current?: Plan;
  private readonly waiters = new Map<string, (decision: PlanDecision) => void>();

  propose(stepTexts: string[], reason?: string): Plan {
    const steps: PlanStep[] = stepTexts.map((text, index) => ({ id: String(index + 1), text }));
    const plan: Plan = {
      id: randomUUID(),
      steps,
      reason,
      status: 'pending',
      revision: (this.current?.revision ?? 0) + 1,
      createdAt: Date.now()
    };
    this.current = plan;
    return plan;
  }

  get(): Plan | undefined {
    return this.current;
  }

  /** Called at the start of each new agent-mode run: an approval from a finished task must not silently authorize an unrelated one. */
  reset(): void {
    this.current = undefined;
  }

  approve(): void {
    this.decide('approved');
  }

  reject(): void {
    this.decide('rejected');
  }

  private decide(decision: PlanDecision): void {
    if (!this.current || this.current.status !== 'pending') return;
    this.current.status = decision;
    const waiter = this.waiters.get(this.current.id);
    if (waiter) {
      this.waiters.delete(this.current.id);
      waiter(decision);
    }
  }

  waitForDecision(planId: string, signal?: AbortSignal): Promise<PlanDecision> {
    if (this.current?.id === planId && this.current.status !== 'pending') {
      return Promise.resolve(this.current.status);
    }
    if (signal?.aborted) return Promise.reject(new Error('Request cancelled.'));

    return new Promise<PlanDecision>((resolve, reject) => {
      const onAbort = () => {
        this.waiters.delete(planId);
        reject(new Error('Request cancelled.'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.set(planId, (decision) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(decision);
      });
    });
  }
}
