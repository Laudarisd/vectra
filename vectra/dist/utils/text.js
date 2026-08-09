"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.sha256Bytes = sha256Bytes;
exports.truncateMiddle = truncateMiddle;
exports.safeJson = safeJson;
const node_crypto_1 = require("node:crypto");
function sha256(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value, 'utf8').digest('hex');
}
function sha256Bytes(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
}
function truncateMiddle(value, maxCharacters) {
    if (value.length <= maxCharacters) {
        return value;
    }
    const half = Math.max(1, Math.floor((maxCharacters - 80) / 2));
    return `${value.slice(0, half)}\n\n...[context truncated: ${value.length - half * 2} chars omitted]...\n\n${value.slice(-half)}`;
}
function safeJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
    }
}
//# sourceMappingURL=text.js.map