// Shared JSON and streaming HTTP helpers with timeout, cancellation, and TLS policy.
import * as http from 'node:http';
import * as https from 'node:https';
import { Readable } from 'node:stream';
import { VisibleModelTextStream } from './modelText';

/**
 * Node's fetch (undici) fails any request whose response headers take over
 * 300 s and may reuse a pooled socket a local server already closed; both
 * surface only as "fetch failed". Long-running local calls therefore go
 * through node:http on a fresh connection, governed by Vectra's own timeouts.
 */
const UNDICI_HEADERS_TIMEOUT_MS = 300_000;

async function fetchWithTls(url: string, init: RequestInit, allowInsecureTls = false, timeoutMs = 0): Promise<Response> {
  const secure = url.toLowerCase().startsWith('https://');
  if (!(allowInsecureTls && secure) && timeoutMs <= UNDICI_HEADERS_TIMEOUT_MS) return fetch(url, init);
  return new Promise<Response>((resolve, reject) => {
    const target = new URL(url);
    const body = init.body == null ? undefined : Buffer.from(init.body as string | Uint8Array);
    const options: https.RequestOptions = {
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string> | undefined), Connection: 'close', ...(body ? { 'Content-Length': String(body.byteLength) } : {}) },
      ...(secure && allowInsecureTls ? { rejectUnauthorized: false } : {})
    };
    const onResponse = (incoming: http.IncomingMessage) => {
      const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      resolve(new Response(body, {
        status: incoming.statusCode ?? 500,
        statusText: incoming.statusMessage,
        headers: incoming.headers as Record<string, string>
      }));
    };
    const request = secure ? https.request(target, options, onResponse) : http.request(target, options, onResponse);
    request.on('error', reject);
    const abort = () => request.destroy(new Error('Request cancelled.'));
    init.signal?.addEventListener('abort', abort, { once: true });
    request.on('close', () => init.signal?.removeEventListener('abort', abort));
    if (body) request.write(body);
    request.end();
  });
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 120_000,
  allowInsecureTls = false
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = init.signal;

  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

  try {
    const response = await fetchWithTls(url, { ...init, signal: controller.signal }, allowInsecureTls, timeoutMs);
    const raw = await response.text();
    let parsed: unknown = undefined;

    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }

    if (!response.ok) {
      const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${detail.slice(0, 2000)}`);
    }

    return parsed as T;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(externalSignal?.aborted ? 'Request cancelled.' : `Request timed out after ${timeoutMs / 1000}s.`);
    }
    throw describeFetchError(error);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

export interface StreamOptions {
  onDelta?: (delta: string) => void;
  /** Receives text inside <think> tags, streamed live for the "Thinking..." UI. */
  onThinking?: (delta: string) => void;
  /** Reset on every received chunk, so a long-but-still-producing local generation is never killed by a total-duration cap. */
  idleTimeoutMs?: number;
  signal?: AbortSignal;
  allowInsecureTls?: boolean;
}

/**
 * Consumes an OpenAI-compatible `text/event-stream` chat-completions response
 * (`data: {...}\n\n`, terminated by `data: [DONE]`) and returns the full text.
 * The idle timer — not a total-duration timer — is what lets slow local/CPU
 * token generation run for as long as it keeps producing output.
 */
export async function streamSse(
  url: string,
  init: RequestInit,
  options: StreamOptions = {}
): Promise<string> {
  return consumeStream(url, init, options, (line, onDelta, onThinking) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> };
      const delta = json.choices?.[0]?.delta;
      // vLLM-style servers with a reasoning parser stream thinking separately.
      if (delta?.reasoning_content) onThinking?.(delta.reasoning_content);
      if (delta?.content) onDelta(delta.content);
    } catch {
      // Ignore keep-alive/partial lines; the buffer carries the remainder to the next chunk.
    }
  });
}

/** Consumes an Ollama-style newline-delimited JSON stream (`{"message":{"content":"..."}}\n`). */
export async function streamNdjson(
  url: string,
  init: RequestInit,
  options: StreamOptions = {}
): Promise<string> {
  return consumeStream(url, init, options, (line, onDelta) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const json = JSON.parse(trimmed) as { message?: { content?: string }; error?: string };
      if (json.error) throw new Error(json.error);
      const delta = json.message?.content ?? '';
      if (delta) onDelta(delta);
    } catch (error) {
      if (error instanceof Error && trimmed.includes('"error"')) throw error;
    }
  });
}

async function consumeStream(
  url: string,
  init: RequestInit,
  options: StreamOptions,
  handleLine: (line: string, onDelta: (delta: string) => void, onThinking?: (delta: string) => void) => void
): Promise<string> {
  const { onDelta, idleTimeoutMs = 120_000, signal: externalSignal } = options;
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout>;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
  };
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  resetIdle();

  try {
    const response = await fetchWithTls(url, { ...init, signal: controller.signal }, options.allowInsecureTls, idleTimeoutMs);
    if (!response.ok || !response.body) {
      const raw = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}