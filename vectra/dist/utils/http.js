"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchJson = fetchJson;
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
//# sourceMappingURL=http.js.map