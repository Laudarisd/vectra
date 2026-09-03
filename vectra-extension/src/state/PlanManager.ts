// Beginner guide: Handles p la nm an ag er responsibilities for Vectra.
import { PlanState } from '../core';
import { Plan } from '../types';

/**
 * Owns the single active plan for the session. Mirrors EditProposalManager's
 * propose-then-decide shape: propose() never blocks, and the decision is
 * delivered asynchronously to whoever is awaiting waitForDecision().
 */
export class PlanManager extends PlanState<Plan> {
  override propose(stepTexts: readonly string[], reason?: string): Plan {
    const seen = new Set<string>();
    const uniqueSteps = stepTexts.filter((text) => {
      const key = String(text)
        .trim()
        .replace(/^(?:[-*]|\d+[.)])\s+/, '')
        .replace(/[.!:;]+$/, '')
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return super.propose(uniqueSteps, reason);
  }
}
