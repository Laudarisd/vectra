"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanManager = void 0;
const shared_core_1 = require("../../shared-core");
/**
 * Owns the single active plan for the session. Mirrors PatchManager's
 * propose-then-decide shape: propose() never blocks, and the decision is
 * delivered asynchronously to whoever is awaiting waitForDecision().
 */
class PlanManager extends shared_core_1.PlanState {
}
exports.PlanManager = PlanManager;
//# sourceMappingURL=PlanManager.js.map