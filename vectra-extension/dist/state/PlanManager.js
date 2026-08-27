"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanManager = void 0;
const agent_core_1 = require("../../generated/agent-core");
/**
 * Owns the single active plan for the session. Mirrors EditProposalManager's
 * propose-then-decide shape: propose() never blocks, and the decision is
 * delivered asynchronously to whoever is awaiting waitForDecision().
 */
class PlanManager extends agent_core_1.PlanState {
}
exports.PlanManager = PlanManager;
//# sourceMappingURL=PlanManager.js.map