import { VectraDeepTool, VectraHostToolExecutor, VectraToolDefinition } from './contracts';
import { z } from 'zod';

/** Convert canonical host capabilities into collision-free Deep Agents tools. */
export function createVectraHostTools<TContext>(
  definitions: readonly VectraToolDefinition[],
  execute: VectraHostToolExecutor<TContext>,
  namespace = 'vectra'
): VectraDeepTool<TContext>[] {
  return definitions.map((definition) => ({
    name: `${namespace}_${definition.name}`,
    description: `${definition.description} This operates through Vectra's guarded ${definition.risk} capability.`,
    execute: (input, context) => execute(definition.name, input, context)
  }));
}

/**
 * Keep the native tool prompt small while leaving routing decisions with the
 * model. The model searches the canonical catalog, then invokes only a tool it
 * discovered during this run. Host approval and permission checks remain in
 * the original executor.
 */
export function createVectraDiscoveryTools<TContext>(
  definitions: readonly VectraToolDefinition[],
  execute: VectraHostToolExecutor<TContext>,
  namespace = 'vectra'
): VectraDeepTool<TContext>[] {
  const available = definitions.filter((item) => item.name !== 'delegate_task');
  const byName = new Map(available.map((item) => [item.name, item]));
  const discovered = new Set<string>();
  return [
    {
      name: `${namespace}_search_tools`,
      description: 'Search Vectra workspace capabilities by intent. Call this before using a real project capability. The result gives exact tool names and descriptions.',
      schema: z.object({
        query: z.string().min(1).describe('What capability is needed, such as create a folder, read files, run tests, or search the web.'),
        limit: z.number().int().min(1).max(12).optional()
      }),
      execute: ({ query, limit }, _context) => {
        const matches = searchToolCatalog(available, String(query), typeof limit === 'number' ? limit : 8);
        for (const item of matches) discovered.add(item.name);
        return {
          tools: matches.map((item) => ({
            name: item.name,
            displayName: item.displayName,
            description: item.description,
            risk: item.risk
          })),
          instruction: 'Call vectra_invoke_tool with one returned name and its arguments. Search again if the needed capability is absent.'
        };
      }
    },
    {
      name: `${namespace}_invoke_tool`,
      description: 'Invoke one real Vectra capability returned by vectra_search_tools. All normal plan, review, confirmation, permission, and network protections still apply.',
      schema: z.object({
        name: z.string().min(1).describe('Exact capability name returned by vectra_search_tools.'),
        arguments: z.record(z.string(), z.unknown()).default({}).describe('Arguments for that capability, using workspace-relative paths.')
      }),
      execute: ({ name, arguments: input }, context) => {
        const toolName = String(name);
        if (!byName.has(toolName)) throw new Error(`Unknown Vectra capability: ${toolName}`);
        if (!discovered.has(toolName)) throw new Error(`Search for ${toolName} with vectra_search_tools before invoking it.`);
        const args = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
        return execute(toolName, args, context);
      }
    }
  ];
}

export function searchToolCatalog(
  definitions: readonly VectraToolDefinition[],
  query: string,
  limit = 8
): VectraToolDefinition[] {
  const words = tokenize(query);
  const broad = /\b(all|every|available|capabilities|tools)\b/i.test(query);
  return definitions
    .map((item, index) => {
      const haystack = `${item.name} ${item.displayName} ${item.description} ${item.risk}`.toLowerCase();
      const score = broad ? 1 : words.reduce((total, word) => total + (haystack.includes(word) ? (item.name.includes(word) ? 4 : 1) : 0), 0);
      return { item, index, score };
    })
    .filter((value) => value.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, Math.min(12, limit)))
    .map((value) => value.item);
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word.length > 2))];
}
