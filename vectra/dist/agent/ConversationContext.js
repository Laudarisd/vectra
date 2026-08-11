"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatRecentHistory = formatRecentHistory;
exports.sanitizeHistoricalContent = sanitizeHistoricalContent;
exports.classifyTurn = classifyTurn;
exports.isStatusOnlyReply = isStatusOnlyReply;
const text_1 = require("../utils/text");
/**
 * Preserve useful conversational continuity without allowing a previous tool
 * envelope to become an instruction for a later request.
 *
 * History is always retained. A follow-up such as "what do you mean?" is only
 * answerable with the previous turn in view; what must never happen is a
 * finished request being treated as outstanding work, which is handled by
 * sanitizing envelopes here and by the ACTIVE TASK REMINDER in the prompt.
 */
function formatRecentHistory(history, _task) {
    return history
        .filter((message) => message.role !== 'system')
        .slice(-8)
        .map((message) => `${message.role.toUpperCase()}: ${sanitizeHistoricalContent(message.content)}`)
        .filter((value) => !/^(?:USER|ASSISTANT):\s*$/.test(value))
        .join('\n\n');
}
function sanitizeHistoricalContent(content) {
    const value = String(content || '').trim();
    if (!value)
        return '';
    if (/^(?:Error:|Request stopped\.|Stopped after \d+ agent steps\.)/i.test(value)) {
        return '[Previous request did not complete.]';
    }
    // Valid envelopes contribute only their user-facing summary. Actions are
    // execution records and must never be replayed as conversational context.
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed.actions)) {
            return (0, text_1.truncateMiddle)(String(parsed.message || '[Previous tool response]'), 2_000);
        }
    }
    catch {
        // Small local models can truncate a large JSON response. Recover its
        // leading message, while dropping the incomplete stale action payload.
        if (/^[\s`]*\{[\s\S]*"actions"\s*:/i.test(value)) {
            const match = value.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/i);
            if (match) {
                try {
                    return (0, text_1.truncateMiddle)(JSON.parse(`"${match[1]}"`), 2_000);
                }
                catch {
                    return '[Previous malformed tool response omitted.]';
                }
            }
            return '[Previous malformed tool response omitted.]';
        }
    }
    return (0, text_1.truncateMiddle)(value, 4_000);
}
/** Greetings, pleasantries, and questions about the assistant itself. */
const CONVERSATIONAL_PATTERNS = [
    /^(?:hi|hey|hello|hiya|howdy|yo|greetings|sup)\b/,
    /^good\s+(?:morning|afternoon|evening|day)\b/,
    /\bhow(?:'s| is| are| r)?\s+(?:you|u|it going|things|your day)\b/,
    /\bhow(?:'?re| are)\s+you\s+doing\b/,
    /\bwho\s+(?:are|r)\s+(?:you|u)\b/,
    /\bwhat\s+(?:are|r)\s+(?:you|u)\b/,
    /\bwhat(?:'s| is)\s+your\s+name\b/,
    /\bwhat\s+can\s+you\s+(?:do|help)\b/,
    /\bwhat\s+do\s+you\s+mean\b/,
    /\bare\s+you\s+(?:there|ok|okay|alive|working|real|human|a\s+bot)\b/,
    /^(?:thanks|thank\s+you|thx|ty|cheers|appreciate\s+it)\b/,
    /^(?:bye|goodbye|see\s+ya|good\s?night|later)\b/,
    /^(?:sorry|my\s+bad|oops)\b/,
    /^(?:nothing|never\s?mind|nvm|forget\s+it)\b/,
    /^(?:lol|haha|hmm+|wow|nice|cool|great|awesome)\b/
];
/**
 * Anything suggesting real repository work vetoes the conversational path.
 * A false "work" costs one extra scan; a false "chat" would silently skip the
 * user's actual request, so the veto list is deliberately broad.
 */
const WORK_SIGNALS = [
    /```/,
    /[/\\]/,
    /\w\.[a-z0-9]{1,6}\b/i,
    /\b(?:continue|proceed|go\s+ahead|carry\s+on|keep\s+going|do\s+it|next\s+step|resume|retry|again)\b/,
    /\b(?:create|make|build|write|generate|add|implement|fix|refactor|update|edit|modify|change|delete|remove|rename|move|copy|run|execute|test|install|debug|explain|describe|review|analyz\w*|summar\w*|list|find|search|show|open|read|check|convert|export|import|translate|document|count|compare|deploy|commit)\b/,
    /\b(?:file|files|folder|folders|directory|directories|repo|repository|project|codebase|workspace|code|function|class|method|module|script|package|component|library|api|endpoint|bug|error|exception|warning|test|tests|readme|config|dependency|dependencies)\b/
];
/**
 * Decide whether a turn is small talk or a task.
 *
 * Selection mode is always work — it is invoked from an editor selection, never
 * typed as chat. Attachments always imply work: the user uploaded something to
 * be used.
 */
function classifyTurn(task, mode, hasAttachments = false) {
    if (mode === 'selection' || hasAttachments)
        return 'work';
    const value = String(task || '').trim().toLowerCase();
    if (!value || value.length > 200)
        return 'work';
    if (WORK_SIGNALS.some((pattern) => pattern.test(value)))
        return 'work';
    return CONVERSATIONAL_PATTERNS.some((pattern) => pattern.test(value)) ? 'chat' : 'work';
}
/**
 * Status text a tool-tuned model emits when it mistakes a conversational turn
 * for a task. These are never a valid reply to the user.
 */
const STATUS_ONLY_REPLY = /^(?:(?:the\s+)?(?:requested\s+)?(?:task|action|request|operation|job|step|work)\s+(?:has\s+been\s+|have\s+been\s+|was\s+|were\s+|is\s+|are\s+)?(?:completed|complete|done|finished|executed|performed|successful)|done|completed|complete|finished|success(?:ful)?|ok(?:ay)?|acknowledged|no\s+action\s+(?:needed|required)|n\/a)\b[\s.!]*$/i;
function isStatusOnlyReply(text) {
    const value = String(text || '').trim();
    return !value || STATUS_ONLY_REPLY.test(value);
}
//# sourceMappingURL=ConversationContext.js.map