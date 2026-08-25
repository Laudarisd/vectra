import { VectraDeepTool, VectraHostToolExecutor, VectraToolDefinition } from './contracts';
/** Convert canonical host capabilities into collision-free Deep Agents tools. */
export declare function createVectraHostTools<TContext>(definitions: readonly VectraToolDefinition[], execute: VectraHostToolExecutor<TContext>, namespace?: string): VectraDeepTool<TContext>[];
/**
 * Keep the native tool prompt small while leaving routing decisions with the
 * model. The model searches the canonical catalog, then invokes only a tool it
 * discovered during this run. Host approval and permission checks remain in
 * the original executor.
 */
export declare function createVectraDiscoveryTools<TContext>(definitions: readonly VectraToolDefinition[], execute: VectraHostToolExecutor<TContext>, namespace?: string): VectraDeepTool<TContext>[];
export declare function searchToolCatalog(definitions: readonly VectraToolDefinition[], query: string, limit?: number): VectraToolDefinition[];
//# sourceMappingURL=deepTools.d.ts.map