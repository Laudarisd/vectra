// Beginner guide: Handles d ee pt oo ls responsibilities for Vectra.
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
    description: `${definition.description}${definition.aliases?.length ? ` Related capability terms: ${definition.aliases.join(', ')}.` : ''} This operates through Vectra's guarded ${definition.risk} capability.`,
    execute: (input, context) => execute(definition.name, input, context)
  }));
}

/**
 * Keep the native tool prompt small while leaving routing decisions with the
 * model: it searches the canonical catalog by intent, then invokes a capability
 * by exact name. The catalog subset passed in is the allowlist; host approval
 * and permission checks remain in the original executor.
 */
export function createVectraDiscoveryTools<TContext>(
  definitions: readonly VectraToolDefinition[],
  execute: VectraHostToolExecutor<TContext>,
  namespace = 'vectra'
): VectraDeepTool<TContext>[] {
  const available = definitions.filter((item) => item.name !== 'delegate_task');
  const byName = new Map(available.map((item) => [item.name, item]));
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
        return {
          tools: matches.map((item) => ({
            name: item.name,
            aliases: item.aliases,
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
        // Models guess plausible spellings under pressure ("vectra_read_file"
        // for read_file), and an exact catalog name needs no search ceremony:
        // byName is the per-agent allowlist and the host executor still applies
        // every permission, plan, and review check. Forcing a search first only
        // manufactured "Search for X before invoking it" error loops.
        const requested = String(name);
        const toolName = requested.startsWith(`${namespace}_`) ? requested.slice(namespace.length + 1) : requested;
        if (!byName.has(toolName)) {
          const closest = searchToolCatalog(available, toolName, 3).map((item) => item.name);
          throw new Error(
            `Unknown Vectra capability: ${toolName}.` +
            (closest.length ? ` Closest available capabilities: ${closest.join(', ')}.` : '') +
            ' Call vectra_search_tools to list what exists.'
          );
        }
        const args = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
        return execute(toolName, args, context);
      }
    }
  ];
}

/**
 * Adapts an already-built, namespaced VectraDeepTool[] (e.g. from
 * createWebTools) into a generic definitions+executor dispatcher, so
 * per-role subsets can be rebuilt through createVectraHostTools /
 * createVectraDiscoveryTools for subagents without a host needing its own
 * separate action-routing layer.
 */
export function toHostToolExecutor<TContext>(
  tools: readonly VectraDeepTool<TContext>[],
  namespace = 'vectra'
): VectraHostToolExecutor<TContext> {
  const prefix = `${namespace}_`;
  const byName = new Map(tools.map((item) => [
    item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name,
    item.execute
  ]));
  return async (toolName, input, context) => {
    const execute = byName.get(toolName);
    if (!execute) throw new Error(`Unknown Vectra capability: ${toolName}`);
    return execute(input, context);
  };
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
      const haystack = `${item.name} ${(item.aliases ?? []).join(' ')} ${item.displayName} ${item.description} ${item.risk}`.toLowerCase();
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
