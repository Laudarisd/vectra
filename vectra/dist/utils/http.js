"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchJson = fetchJson;
exports.streamSse = streamSse;
exports.streamNdjson = streamNdjson;
async function fetchJson(url, init, timeoutMs = 120_000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = init.signal;
    const abortFromExternal = () => controller.abort();
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const raw = await response.text();
        let parsed = undefined;
        if (raw) {
            try {
                parsed = JSON.parse(raw);
            }
            catch {
                parsed = raw;
            }
        }
        if (!response.ok) {
            const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${detail.slice(0, 2000)}`);
        }
        return parsed;
    }
    catch (error) {
        if (controller.signal.aborted) {
            throw new Error(externalSignal?.aborted ? 'Request cancelled.' : `Request timed out after ${timeoutMs / 1000}s.`);
        }
        throw error;
    }
    finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', abortFromExternal);
    }
}
/**
 * Consumes an OpenAI-compatible `text/event-stream` chat-completions response
 * (`data: {...}\n\n`, terminated by `data: [DONE]`) and returns the full text.
 * The idle timer — not a total-duration timer — is what lets slow local/CPU
 * token generation run for as long as it keeps producing output.
 */
async function streamSse(url, init, options = {}) {
    return consumeStream(url, init, options, (line, onDelta) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:'))
            return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]')
            return;
        try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content ?? '';
            if (delta)
                onDelta(delta);
        }
        catch {
            // Ignore keep-alive/partial lines; the buffer carries the remainder to the next chunk.
        }
    });
}
/** Consumes an Ollama-style newline-delimited JSON stream (`{"message":{"content":"..."}}\n`). */
async function streamNdjson(url, init, options = {}) {
    return consumeStream(url, init, options, (line, onDelta) => {
        const trimmed = line.trim();
        if (!trimmed)
            return;
        try {
            const json = JSON.parse(trimmed);
            if (json.error)
                throw new Error(json.error);
            const delta = json.message?.content ?? '';
            if (delta)
                onDelta(delta);
        }
        catch (error) {
            if (error instanceof Error && trimmed.includes('"error"'))
                throw error;
        }
    });
}
async function consumeStream(url, init, options, handleLine) {
    const { onDelta, idleTimeoutMs = 120_000, signal: externalSignal } = options;
    const controller = new AbortController();
    let idleTimer;
    const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
    };
    const abortFromExternal = () => controller.abort();
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    resetIdle();
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok || !response.body) {
            const raw = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${raw.slice(0, 2000)}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let full = '';
        const collect = (delta) => { full += delta; onDelta?.(delta); };
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            resetIdle();
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines)
                handleLine(line, collect);
        }
        if (buffer.trim())
            handleLine(buffer, collect);
        return full;
    }
    catch (error) {
        if (controller.signal.aborted) {
            throw new Error(externalSignal?.aborted
                ? 'Request cancelled.'
                : `Local model produced no output for ${Math.round(idleTimeoutMs / 1000)}s and was stopped.`);
        }
        throw error;
    }
    finally {
        clearTimeout(idleTimer);
        externalSignal?.removeEventListener('abort', abortFromExternal);
    }
}
//# sourceMappingURL=http.js.map