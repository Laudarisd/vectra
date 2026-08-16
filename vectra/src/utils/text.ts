import { createHash } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}


export function truncateMiddle(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }
  const half = Math.max(1, Math.floor((maxCharacters - 80) / 2));
  return `${value.slice(0, half)}\n\n...[context truncated: ${value.length - half * 2} chars omitted]...\n\n${value.slice(-half)}`;
}

/**
 * A local llama.cpp/Ollama server rejects a prompt with HTTP 400 once it
 * exceeds the server's own `n_ctx`. `maxContextCharacters` is a flat budget
 * sized for cloud models with 100K+ token windows, so it must be clamped to
 * whatever context size the local server was actually launched with.
 * ~3.3 chars/token is conservative for the mixed prose+code Vectra sends;
 * reserving 35% leaves room for the system prompt, tool schema, and the
 * model's own response tokens within the same context window.
 */
export function estimateContextCharBudget(contextTokens: number, maxCharacters: number): number {
  const CHARS_PER_TOKEN = 3.3;
  const RESERVED_RATIO = 0.35;
  const budget = Math.floor(contextTokens * CHARS_PER_TOKEN * (1 - RESERVED_RATIO));
  return Math.max(4_000, Math.min(maxCharacters, budget));
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
