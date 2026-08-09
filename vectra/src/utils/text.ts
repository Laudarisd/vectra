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

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
