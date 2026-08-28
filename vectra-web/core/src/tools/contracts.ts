import type { z } from 'zod';

export type VectraToolRisk = 'read' | 'write' | 'execute' | 'network' | 'coordination';
export type VectraToolSurface = 'extension' | 'web' | 'all';

export interface VectraToolDefinition<TName extends string = string> {
  name: TName;
  /** Human vocabulary indexed by model-driven discovery; aliases do not create duplicate tools. */
  aliases?: readonly string[];
  /** Friendly label for settings, logs, capability lists, and review UI. */
  displayName: string;
  description: string;
  risk: VectraToolRisk;
  surface: VectraToolSurface;
}

export interface VectraDeepTool<TContext = unknown> {
  name: string;
  description: string;
  schema?: z.ZodType<Record<string, unknown>>;
  execute(input: Record<string, unknown>, context: TContext): Promise<unknown> | unknown;
}

export type VectraHostToolExecutor<TContext> = (
  toolName: string,
  input: Record<string, unknown>,
  context: TContext
) => Promise<unknown> | unknown;
