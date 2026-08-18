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

/**
 * A model asked for raw file content sometimes wraps the whole answer in a
 * markdown fence anyway (```python ... ```), despite the JSON action schema
 * asking for a plain string. Written verbatim, that fence becomes literal
 * text inside the .py/.cs/.cpp file. Only strip when the fence wraps the
 * *entire* content (first and last non-blank lines are fence markers) —
 * real source that legitimately contains a fenced block in the middle, or a
 * markdown file about fences, must pass through untouched.
 */
export function stripEnclosingCodeFence(content: string): string {
  const lines = content.split(/\r?\n/);
  let start = 0;
  let end = lines.length - 1;
  while (start <= end && lines[start].trim() === '') start++;
  while (end >= start && lines[end].trim() === '') end--;
  if (end <= start) return content;
  if (!/^```[^\s`]*$/.test(lines[start].trim())) return content;
  if (lines[end].trim() !== '```') return content;
  return lines.slice(start + 1, end).join('\n');
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
