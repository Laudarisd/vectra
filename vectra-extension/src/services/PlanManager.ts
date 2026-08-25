import { PlanState } from '../../shared-core';
import { Plan } from '../types';

/**
 * Owns the single active plan for the session. Mirrors PatchManager's
 * propose-then-decide shape: propose() never blocks, and the decision is
 * delivered asynchronously to whoever is awaiting waitForDecision().
 */
export class PlanManager extends PlanState<Plan> {}
