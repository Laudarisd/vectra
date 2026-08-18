"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanManager = void 0;
const node_crypto_1 = require("node:crypto");
/**
 * Owns the single active plan for the session. Mirrors PatchManager's
 * propose-then-decide shape: propose() never blocks, and the decision is
 * delivered asynchronously to whoever is awaiting waitForDecision().
 */
class PlanManager {
    current;
    waiters = new Map();
    propose(stepTexts, reason) {
        const steps = stepTexts.map((text, index) => ({ id: String(index + 1), text }));
        const plan = {
            id: (0, node_crypto_1.randomUUID)(),
            steps,
            reason,
            status: 'pending',
            revision: (this.current?.revision ?? 0) + 1,
            createdAt: Date.now()
        };
        this.current = plan;
        return plan;
    }
    get() {
        return this.current;
    }
    /** Called at the start of each new agent-mode run: an approval from a finished task must not silently authorize an unrelated one. */
    reset() {
        this.current = undefined;
    }
    approve() {
        this.decide('approved');
    }
    reject() {
        this.decide('rejected');
    }
    decide(decision) {
        if (!this.current || this.current.status !== 'pending')
            return;
        this.current.status = decision;
        const waiter = this.waiters.get(this.current.id);
        if (waiter) {
            this.waiters.delete(this.current.id);
            waiter(decision);
        }
    }
    waitForDecision(planId, signal) {
        if (this.current?.id === planId && this.current.status !== 'pending') {
            return Promise.resolve(this.current.status);
        }
        if (signal?.aborted)
            return Promise.reject(new Error('Request cancelled.'));
        return new Promise((resolve, reject) => {
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
exports.PlanManager = PlanManager;
//# sourceMappingURL=PlanManager.js.map