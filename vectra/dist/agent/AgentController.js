"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentController = void 0;
const node_crypto_1 = require("node:crypto");
const vscode = __importStar(require("vscode"));
const config_1 = require("../utils/config");
const text_1 = require("../utils/text");
const DocumentExtractor_1 = require("../services/DocumentExtractor");
const AgentToolRegistry_1 = require("./AgentToolRegistry");
const protocol_1 = require("./protocol");
const ConversationContext_1 = require("./ConversationContext");
/**
 * Runs the model/tool loop for one user request.
 *
 * Unlike the previous single-edit flow, a write no longer ends the request.
 * The model can inspect, prepare a complete multi-file project, read its own
 * pending files through the virtual overlay, refine them, and then return one
 * coherent batch for the user to review.
 */
class AgentController {
    providers;
    contextCollector;
    patches;
    toolRegistry;
    constructor(providers, contextCollector, tools, patches, commands) {
        this.providers = providers;
        this.contextCollector = contextCollector;
        this.patches = patches;
        this.toolRegistry = new AgentToolRegistry_1.AgentToolRegistry(tools, patches, commands);
    }
    async run(request) {
        if (!vscode.workspace.isTrusted) {
            throw new Error('This workspace is not trusted. Trust it before using Vectra.');
        }
        const config = (0, config_1.getConfig)();
        if (!config.model)
            throw new Error('No model selected. Choose API Key or Local Model first.');
        const provider = await this.providers.getProvider();
        // A greeting or a question about Vectra is answered as conversation, before
        // any workspace I/O. Routing small talk through the tool loop is what made
        // it trigger a repository scan and come back as invented tasks or bare
        // status lines.
        const hasAttachments = (request.attachments ?? []).length > 0;
        if ((0, ConversationContext_1.classifyTurn)(request.userText, request.mode, hasAttachments) === 'chat') {
            return { text: await this.converse(provider, request, config), proposals: [] };
        }
        const workspaceContext = await this.contextCollector.collect(request.mode);
        const mediaAttachments = [...(request.attachments ?? [])];
        if (config.provider === 'llamaCpp' && config.llamaCppMmprojPath) {
            await addLocalVisionPdfPages(mediaAttachments);
        }
        const observations = [];
        const proposalIds = new Set();
        const attemptedActions = new Set();
        let duplicateOnlySteps = 0;
        let verificationTurnUsed = false;
        let lastMessage = '';
        // Ask and Agent begin with real workspace evidence. This makes a directory
        // question answerable in one user prompt even when a small model forgets to
        // request discovery on its first turn.
        if (request.mode !== 'selection') {
            request.onProgress?.('Scanning workspace…');
            const preload = await this.toolRegistry.execute({ type: 'workspace_summary' }, { mode: request.mode, mediaAttachments });
            observations.push(preload.observation);
        }
        for (let step = 1; step <= config.maxAgentSteps; step++) {
            if (request.signal?.aborted)
                throw new Error('Request cancelled.');
            request.onProgress?.(step === 1 ? 'Analyzing…' : 'Generating…');
            const userPrompt = buildUserPrompt(request.userText, request.history, workspaceContext, observations, mediaAttachments, this.resolveProposals([...proposalIds]), config.maxContextCharacters);
            const raw = await provider.complete({
                systemPrompt: (0, protocol_1.buildSystemPrompt)(request.mode),
                userPrompt,
                model: config.model,
                // Extracted text already lives in userPrompt. Providers only receive
                // native visual/PDF bytes here, avoiding duplicate token-heavy text.
                attachments: providerMediaAttachments(mediaAttachments),
                signal: request.signal
            });
            const envelope = (0, protocol_1.parseAgentEnvelope)(raw);
            lastMessage = envelope.message || lastMessage;
            if (!envelope.actions.length) {
                request.onProgress?.('Producing…');
                const answer = envelope.message || lastMessage;
                return this.finish((0, ConversationContext_1.isStatusOnlyReply)(answer)
                    ? 'I finished, but I do not have a useful summary to show for it. Could you rephrase what you need?'
                    : answer, [...proposalIds]);
            }
            let allActionsWereSuccessfulWrites = true;
            let executedActionCount = 0;
            for (const action of envelope.actions.slice(0, 40)) {
                if (request.signal?.aborted)
                    throw new Error('Request cancelled.');
                const fingerprint = actionFingerprint(action);
                if (attemptedActions.has(fingerprint)) {
                    observations.push(`ERROR: Repeated tool action suppressed: ${action.type}. ` +
                        'Do not retry it. Follow the CURRENT USER TASK and either choose a different evidence-gathering action or finish with actions=[].');
                    allActionsWereSuccessfulWrites = false;
                    continue;
                }
                attemptedActions.add(fingerprint);
                executedActionCount++;
                request.onProgress?.(this.toolRegistry.describe(action));
                const result = await this.toolRegistry.execute(action, {
                    mode: request.mode,
                    mediaAttachments
                });
                observations.push(result.observation);
                for (const id of result.proposalIds)
                    proposalIds.add(id);
                if (!result.wrote || /\b(?:ERROR|Denied):/i.test(result.observation)) {
                    allActionsWereSuccessfulWrites = false;
                }
            }
            duplicateOnlySteps = executedActionCount === 0 ? duplicateOnlySteps + 1 : 0;
            if (duplicateOnlySteps >= 2) {
                // The loop guard is an engine detail. The user gets a plain explanation
                // and a way forward instead of the internal reason.
                const progress = (0, ConversationContext_1.isStatusOnlyReply)(lastMessage) ? '' : `${lastMessage}\n\n`;
                return this.finish(`${progress}I stopped because I kept repeating the same step without making progress. ` +
                    'Could you tell me a bit more about what you need, or point me at the file or folder to start from?', [...proposalIds]);
            }
            // A model may submit a complete batch and explicitly mark it done. Before
            // accepting that, give it exactly one turn to check its own work against
            // the real filesystem, so the final summary is evidence-based rather than
            // an assertion. Read and error results always get another turn anyway.
            if (envelope.done && allActionsWereSuccessfulWrites) {
                if (verificationTurnUsed) {
                    return this.finish(lastMessage || 'Project changes prepared.', [...proposalIds]);
                }
                verificationTurnUsed = true;
                request.onProgress?.('Verifying changes…');
                observations.push('VERIFICATION STEP: Your files are prepared but not yet reviewed by the user. ' +
                    'Check your own work now: use list_directory to confirm the layout, read_file on the files you just prepared ' +
                    '(the pending overlay serves their new content), and search_text to confirm imports, names, and references line up. ' +
                    'Fix anything wrong with a new action. If everything is correct, reply with actions=[] and a final summary that ' +
                    'states what you created or changed and what you verified. Do not repeat an unchanged proposal.');
                continue;
            }
        }
        const progress = (0, ConversationContext_1.isStatusOnlyReply)(lastMessage) ? '' : `${lastMessage}\n\n`;
        return this.finish(`${progress}I reached my limit of ${config.maxAgentSteps} steps for this request, so this is as far as I got. ` +
            'Ask me to continue, or narrow the request and I will pick it up from here.', [...proposalIds]);
    }
    /**
     * Single plain-prose completion for a conversational turn. No tools, no
     * workspace context, and no forced JSON schema.
     */
    async converse(provider, request, config) {
        request.onProgress?.('Thinking…');
        const history = (0, ConversationContext_1.formatRecentHistory)(request.history);
        const ask = (nudge = '') => provider.complete({
            systemPrompt: (0, protocol_1.buildChatSystemPrompt)(),
            userPrompt: (0, text_1.truncateMiddle)(`${history ? `RECENT CHAT (finished history, for reference only)\n${history}\n\n` : ''}` +
                `THE USER JUST SAID\n${request.userText}\n\n` +
                `Reply to them directly and naturally.${nudge}`, Math.min(config.maxContextCharacters, 24_000)),
            model: config.model,
            structured: false,
            signal: request.signal
        });
        // Tool-tuned local models sometimes answer a greeting with an envelope or a
        // status line anyway. Unwrap it, then retry once with an explicit nudge.
        let reply = (0, protocol_1.parseAgentEnvelope)(await ask()).message.trim();
        if ((0, ConversationContext_1.isStatusOnlyReply)(reply)) {
            if (request.signal?.aborted)
                throw new Error('Request cancelled.');
            reply = (0, protocol_1.parseAgentEnvelope)(await ask(' Do not reply with a status line such as "task completed" — the user asked you a question, so answer it in a friendly sentence.')).message.trim();
        }
        return (0, ConversationContext_1.isStatusOnlyReply)(reply)
            ? 'Hi! I am Vectra, your coding assistant in VS Code. What would you like to work on?'
            : reply;
    }
    finish(message, ids) {
        const proposals = this.resolveProposals(ids);
        if (!proposals.length)
            return { text: message, proposals };
        const noun = proposals.length === 1 ? 'change is' : 'changes are';
        const suffix = `${proposals.length} ${noun} ready for review. Accept them to write the project to disk.`;
        return { text: [message, suffix].filter(Boolean).join('\n\n'), proposals };
    }
    resolveProposals(ids) {
        return ids.map((id) => this.patches.get(id)).filter(Boolean);
    }
}
exports.AgentController = AgentController;
function buildUserPrompt(task, history, context, observations, attachments, proposals, maxCharacters) {
    const recentHistory = (0, ConversationContext_1.formatRecentHistory)(history);
    const observationsText = observations.length
        ? observations.slice(-32).map((observation, index) => `OBSERVATION ${index + 1}\n${observation}`).join('\n\n')
        : 'No tool observations yet.';
    const pendingText = proposals.length
        ? proposals.map((proposal) => `- ${proposal.kind}: ${proposal.path}`).join('\n')
        : 'No proposals prepared in this run.';
    // The task stays at the beginning and recent evidence stays at the end. If a
    // very large session must be truncated, these are the two highest-value areas.
    return (0, text_1.truncateMiddle)(`CURRENT USER TASK\n${task}\n\n` +
        `WORKSPACE CONTEXT\n${formatWorkspaceContext(context)}\n\n` +
        `PARSED ATTACHMENTS\n${formatAttachmentContext(attachments)}\n\n` +
        `RECENT CHAT\n${recentHistory || 'No previous chat.'}\n\n` +
        `PENDING REVIEW BATCH\n${pendingText}\n\n` +
        `TOOL OBSERVATIONS\n${observationsText}\n\n` +
        `ACTIVE TASK REMINDER\n${task}\n` +
        'This task replaces any conflicting or unfinished request in RECENT CHAT. Never repeat an old tool action unless this task explicitly requests it.\n\n' +
        'Return the next JSON action envelope. Finish the complete task in this run.', maxCharacters);
}
function actionFingerprint(action) {
    return JSON.stringify(action);
}
function formatWorkspaceContext(context) {
    const sections = [
        `Workspace folders: ${context.workspaceFolders.join(', ') || 'none'}`,
        `Open files: ${context.openFiles.join(', ') || 'none'}`
    ];
    if (context.workspaceOverview)
        sections.push(`Workspace overview:\n${context.workspaceOverview}`);
    if (context.activeFile) {
        sections.push(`Active file: ${context.activeFile}${context.activeLanguage ? ` (${context.activeLanguage})` : ''}`);
    }
    if (context.selectionText) {
        sections.push(`EXACT CURRENT SELECTION lines ${context.selectionStartLine}-${context.selectionEndLine}:\n${context.selectionText}`);
    }
    if (context.activeFileContent)
        sections.push(`Active file content snapshot:\n${context.activeFileContent}`);
    if (context.diagnostics.length)
        sections.push(`Active diagnostics:\n${context.diagnostics.join('\n')}`);
    return sections.join('\n\n');
}
function formatAttachmentContext(attachments) {
    if (!attachments.length)
        return 'No user or tool attachments.';
    const selected = attachments.slice(-12);
    const perAttachmentBudget = Math.max(4_000, Math.floor(80_000 / selected.length));
    return selected.map((attachment) => {
        const extracted = attachment.text?.trim();
        const content = extracted
            ? `\nParsed content:\n${(0, text_1.truncateMiddle)(extracted, Math.min(40_000, perAttachmentBudget))}`
            : '\nParsed content: unavailable; use visual inspection when supported.';
        return `- ${attachment.name} (${attachment.kind}, ${attachment.mime}, ${attachment.size} bytes)${content}`;
    }).join('\n\n');
}
function providerMediaAttachments(attachments) {
    return attachments
        .filter((attachment) => attachment.kind === 'image' || attachment.kind === 'pdf')
        .map((attachment) => ({ ...attachment, text: undefined }));
}
async function addLocalVisionPdfPages(attachments) {
    const pdfs = attachments.filter((attachment) => attachment.kind === 'pdf' && attachment.base64).slice(0, 3);
    for (const pdf of pdfs) {
        try {
            const pages = await (0, DocumentExtractor_1.renderPdfPagesFromBuffer)(Buffer.from(pdf.base64, 'base64'), pdf.name, 6);
            for (const page of pages) {
                attachments.push({
                    id: (0, node_crypto_1.randomUUID)(),
                    name: page.name,
                    mime: page.mime,
                    size: page.size,
                    kind: 'image',
                    source: pdf.source,
                    base64: page.base64
                });
            }
        }
        catch {
            // Embedded PDF text remains available when optional rendering tools are absent.
        }
    }
}
//# sourceMappingURL=AgentController.js.map