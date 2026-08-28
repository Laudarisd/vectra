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
exports.ChatViewProvider = void 0;
const node_crypto_1 = require("node:crypto");
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const config_1 = require("../utils/config");
const gpu_1 = require("../utils/gpu");
const agent_core_1 = require("../../generated/agent-core");
/** Coordinates the sidebar webview with extension-owned session state. */
class ChatViewProvider {
    extensionUri;
    controller;
    patches;
    todos;
    plans;
    diffs;
    credentials;
    localLlama;
    attachmentService;
    workspaceState;
    extensionVersion;
    static viewType = 'vectra.chat';
    static HISTORY_KEY = 'vectra.chatHistory';
    static MAX_STORED_MESSAGES = 300;
    view;
    session;
    pendingAttachments = [];
    messageAttachments = new Map();
    abortController;
    pendingSelectionCheck = false;
    get messages() { return this.session.messages; }
    get busy() { return this.session.isBusy; }
    constructor(extensionUri, controller, patches, todos, plans, diffs, credentials, localLlama, attachmentService, workspaceState, extensionVersion = '') {
        this.extensionUri = extensionUri;
        this.controller = controller;
        this.patches = patches;
        this.todos = todos;
        this.plans = plans;
        this.diffs = diffs;
        this.credentials = credentials;
        this.localLlama = localLlama;
        this.attachmentService = attachmentService;
        this.workspaceState = workspaceState;
        this.extensionVersion = extensionVersion;
        // Attachment payloads (base64/text) are deliberately not persisted here —
        // ChatMessage only carries attachment metadata, so history survives a
        // reload without workspaceState ballooning from re-stored file content.
        const saved = this.workspaceState.get(ChatViewProvider.HISTORY_KEY, []);
        this.session = new agent_core_1.AgentSession({
            messages: Array.isArray(saved) ? saved : [],
            todos: this.todos,
            plans: this.plans
        });
        this.session.events.subscribe((event) => this.forwardRuntimeEvent(event));
    }
    persistMessages() {
        const trimmed = this.messages.length > ChatViewProvider.MAX_STORED_MESSAGES
            ? this.messages.slice(-ChatViewProvider.MAX_STORED_MESSAGES)
            : this.messages;
        void this.workspaceState.update(ChatViewProvider.HISTORY_KEY, trimmed);
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);
        webviewView.webview.onDidReceiveMessage((message) => void this.handleMessage(message));
        webviewView.onDidDispose(() => { this.view = undefined; });
        void this.postState();
        if (this.pendingSelectionCheck) {
            this.pendingSelectionCheck = false;
            void this.runPrompt('selection', defaultSelectionPrompt());
        }
    }
    async reveal() {
        await vscode.commands.executeCommand('workbench.view.extension.vectraSidebar');
    }
    async checkSelection() {
        await this.reveal();
        if (!this.view) {
            this.pendingSelectionCheck = true;
            return;
        }
        await this.runPrompt('selection', defaultSelectionPrompt());
    }
    async refresh() {
        await this.postState();
    }
    async attachFiles() {
        try {
            const files = await this.attachmentService.pick();
            for (const file of files) {
                if (!this.pendingAttachments.some((item) => item.name === file.name && item.size === file.size)) {
                    this.pendingAttachments.push(file);
                }
            }
            await this.postState();
        }
        catch (error) {
            void vscode.window.showErrorMessage(`Vectra attachment failed: ${messageOf(error)}`);
        }
    }
    async handleMessage(message) {
        try {
            switch (message.type) {
                case 'ready':
                    await this.postState();
                    break;
                case 'send':
                    if (message.text?.trim() && message.mode) {
                        await this.runPrompt(message.mode, message.text.trim(), message.editMessageId);
                    }
                    break;
                case 'stop':
                    this.abortController?.abort();
                    break;
                case 'attachFiles':
                    await this.attachFiles();
                    break;
                case 'removeAttachment':
                    if (message.id) {
                        const index = this.pendingAttachments.findIndex((item) => item.id === message.id);
                        if (index >= 0)
                            this.pendingAttachments.splice(index, 1);
                        await this.postState();
                    }
                    break;
                case 'showDiff':
                    if (message.id)
                        await this.diffs.showDiff(message.id);
                    break;
                case 'accept':
                    if (message.id) {
                        await this.patches.accept(message.id);
                        this.patches.clearCompleted();
                        await this.postState();
                    }
                    break;
                case 'reject':
                    if (message.id) {
                        this.patches.reject(message.id);
                        this.patches.clearCompleted();
                        await this.postState();
                    }
                    break;
                case 'undo':
                    if (message.id) {
                        await this.patches.undo(message.id);
                        await this.postState();
                    }
                    break;
                case 'acceptAll':
                    await this.patches.acceptAllPending();
                    this.patches.clearCompleted();
                    await this.postState();
                    break;
                case 'rejectAll':
                    this.patches.rejectAllPending();
                    this.patches.clearCompleted();
                    await this.postState();
                    break;
                case 'clearCompleted':
                    this.patches.clearCompleted();
                    await this.postState();
                    break;
                case 'approvePlan':
                    this.plans.approve();
                    await this.postState();
                    break;
                case 'rejectPlan':
                    this.plans.reject();
                    await this.postState();
                    break;
                case 'clearChat':
                    this.session.clear();
                    this.pendingAttachments.splice(0);
                    this.messageAttachments.clear();
                    this.persistMessages();
                    await this.postState();
                    break;
                case 'setApiKey':
                    await vscode.commands.executeCommand('vectra.setApiKey');
                    break;
                case 'selectLocalModel':
                    await vscode.commands.executeCommand('vectra.selectLocalModel');
                    break;
                case 'downloadModel':
                    await vscode.commands.executeCommand('vectra.downloadModel');
                    break;
                case 'selectMmproj':
                    await vscode.commands.executeCommand('vectra.selectMmproj');
                    break;
                case 'selectModel':
                    await vscode.commands.executeCommand('vectra.selectModel');
                    break;
                case 'openSettings':
                    await vscode.commands.executeCommand('vectra.openSettings');
                    break;
                case 'setDeviceMode':
                    if (message.value === 'auto' || message.value === 'gpu' || message.value === 'cpu') {
                        await (0, config_1.updateDeviceMode)(message.value);
                        await this.postState();
                    }
                    break;
                case 'setTheme':
                    if (message.value === 'auto' || message.value === 'grayWhite') {
                        await (0, config_1.updateTheme)(message.value);
                        await this.postState();
                    }
                    break;
                case 'testConnection':
                    await vscode.commands.executeCommand('vectra.testConnection');
                    break;
                case 'supportDeveloper':
                    await vscode.commands.executeCommand('vectra.supportDeveloper');
                    break;
                case 'openExternal':
                    if (message.value && /^https?:\/\//i.test(message.value)) {
                        await vscode.env.openExternal(vscode.Uri.parse(message.value));
                    }
                    break;
            }
        }
        catch (error) {
            const text = messageOf(error);
            void vscode.window.showErrorMessage(`Vectra: ${text}`);
            await this.post({ type: 'error', message: text });
        }
    }
    async runPrompt(mode, text, editMessageId) {
        if (this.busy) {
            void vscode.window.showInformationMessage('Vectra is already working. Stop the current request first.');
            return;
        }
        const config = (0, config_1.getConfig)();
        if (config.provider === 'llamaCpp' && !this.localLlama.isReady) {
            const started = await this.localLlama.startConfiguredModel();
            if (!started)
                throw new Error('No local GGUF model selected. Click Local Model first, or API Key for cloud.');
        }
        const attachments = editMessageId
            ? this.branchFromEditedMessage(editMessageId)
            : this.pendingAttachments.splice(0);
        const userMessage = {
            id: (0, node_crypto_1.randomUUID)(),
            role: 'user',
            content: text,
            createdAt: Date.now(),
            mode,
            attachments: attachments.map(toAttachmentMeta)
        };
        this.session.addMessage(userMessage);
        this.rememberAttachments(userMessage.id, attachments);
        this.persistMessages();
        // A resolved plan from a finished task must not linger in the UI as if it
        // still applied to this new one — AgentController.run() resets it too,
        // but doing it here keeps the very next postState() in sync immediately.
        if (mode === 'agent')
            this.plans.reset();
        this.abortController = new AbortController();
        // Streamed deltas (chat/ask replies only — see AgentController.converse)
        // are shown live under this id; the real message pushed below on
        // completion is what actually persists and survives a reload.
        const streamId = (0, node_crypto_1.randomUUID)();
        try {
            const result = await this.session.run(async ({ events, signal }) => {
                // AgentSession is already busy here. Publish that state before any
                // progress or token event so the webview reveals Stop and does not
                // clear the first playful activity line as a stale idle update.
                await this.postState();
                events.emit({ type: 'ui.progress', message: "Wakey-wakey, lookin' 'round..." });
                return this.controller.run({
                    mode,
                    userText: text,
                    history: this.messages.slice(0, -1),
                    attachments,
                    signal,
                    onProgress: (progress) => events.emit({ type: 'ui.progress', message: progress }),
                    onDelta: (delta) => events.emit({ type: 'ui.delta', id: streamId, delta }),
                    onTodosChanged: (todos) => events.emit({ type: 'ui.todos', todos }),
                    onPlanChanged: (plan) => events.emit({ type: 'ui.plan', plan })
                });
            }, this.abortController.signal);
            this.session.addMessage({
                id: streamId,
                role: 'assistant',
                content: result.text,
                createdAt: Date.now()
            });
        }
        catch (error) {
            this.session.addMessage({
                id: streamId,
                role: 'assistant',
                content: this.abortController.signal.aborted ? 'Request stopped.' : `Error: ${messageOf(error)}`,
                createdAt: Date.now()
            });
        }
        finally {
            this.abortController = undefined;
            this.persistMessages();
            await this.postState();
        }
    }
    /**
     * Remove the abandoned conversation branch and reuse the original message's
     * in-memory attachments. Pending proposals belong to the abandoned answer,
     * so they are rejected before the edited prompt runs again.
     */
    branchFromEditedMessage(messageId) {
        const index = this.messages.findIndex((message) => message.id === messageId && message.role === 'user');
        if (index < 0)
            throw new Error('The message being edited is no longer available in this chat session.');
        const originalAttachments = this.messageAttachments.get(messageId) ?? [];
        const removed = this.messages.splice(index);
        for (const message of removed)
            this.messageAttachments.delete(message.id);
        const discarded = this.patches.list().filter((proposal) => proposal.status === 'pending').length;
        this.patches.rejectAllPending();
        if (discarded > 0) {
            const noun = discarded === 1 ? 'proposal' : 'proposals';
            void vscode.window.showInformationMessage(`Vectra discarded ${discarded} pending ${noun} from the message you're replacing. Nothing from it was written to disk.`);
        }
        // Attachments added while editing are included alongside the original set.
        const newlyAttached = this.pendingAttachments.splice(0);
        return deduplicateAttachments([...originalAttachments, ...newlyAttached]);
    }
    /** Retain a bounded number of attachment payloads for session-only resend. */
    rememberAttachments(messageId, attachments) {
        if (!attachments.length)
            return;
        this.messageAttachments.set(messageId, [...attachments]);
        while (this.messageAttachments.size > 8) {
            const oldest = this.messageAttachments.keys().next().value;
            if (!oldest)
                break;
            this.messageAttachments.delete(oldest);
        }
    }
    async postState() {
        const config = (0, config_1.getConfig)();
        const activePlan = this.plans.get();
        const isLocal = config.provider === 'llamaCpp' || config.provider === 'ollama';
        const hasKey = isLocal || config.provider === 'openaiCompatible' || await this.credentials.has(config.provider);
        const localModelName = config.provider === 'llamaCpp'
            ? (config.localModelPath ? path.basename(config.localModelPath) : '')
            : config.provider === 'ollama'
                ? config.model
                : '';
        await this.post({
            type: 'state',
            messages: this.messages,
            proposals: this.patches.list().map(toWebviewProposal),
            todos: this.todos.list(),
            // Resolved HITL cards are execution state, not permanent chat history.
            // Keep the approved plan internally for write gating, but remove its UI
            // card immediately after the user decides.
            plan: activePlan?.status === 'pending' ? activePlan : undefined,
            attachments: this.pendingAttachments.map(toAttachmentMeta),
            busy: this.busy,
            provider: config.provider,
            model: config.model,
            localModelName,
            localModelRunning: config.provider === 'llamaCpp' && this.localLlama.isReady,
            visionEnabled: config.provider === 'llamaCpp' && this.localLlama.visionEnabled,
            hasKey,
            isLocal,
            workspaceTrusted: vscode.workspace.isTrusted,
            deviceMode: config.deviceMode,
            theme: config.theme,
            gpuInfo: await this.describeGpus(config.deviceMode)
        });
    }
    /** Only shells out to probe hardware when the user is actually looking at GPU mode. */
    async describeGpus(deviceMode) {
        if (deviceMode === 'cpu')
            return '';
        try {
            const gpus = await (0, gpu_1.detectGpus)();
            if (!gpus.length)
                return 'No GPU detected — falling back to CPU.';
            return `${gpus.length} GPU${gpus.length > 1 ? 's' : ''} detected: ${gpus.map((gpu) => gpu.name).join(', ')}`;
        }
        catch {
            return '';
        }
    }
    async post(payload) {
        await this.view?.webview.postMessage(payload);
    }
    /** Translate host-neutral runtime events into the extension webview protocol. */
    forwardRuntimeEvent(event) {
        switch (event.type) {
            case 'ui.progress':
                void this.post({ type: 'progress', message: event.message });
                break;
            case 'ui.delta':
                void this.post({ type: 'chatDelta', id: event.id, delta: event.delta });
                break;
            case 'ui.todos':
                void this.post({ type: 'todoUpdate', todos: event.todos });
                break;
            case 'ui.plan':
                void this.post({ type: 'planUpdate', plan: event.plan });
                break;
        }
    }
    getHtml(webview) {
        const nonce = (0, node_crypto_1.randomBytes)(16).toString('hex');
        const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
        const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
        const icon = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'VectraLogo.png'));
        const theme = (0, config_1.getConfig)().theme === 'grayWhite' ? 'grayWhite' : '';
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';"/><link rel="stylesheet" href="${style}"/><title>Vectra</title></head><body data-theme="${theme}">
<main id="app">
<header class="topbar"><div class="brand-wrap"><img class="brand-icon" src="${icon}" alt=""/><span class="brand">Vectra</span></div><button id="settingsButton" class="settings-button" title="Vectra settings" aria-label="Vectra settings">⚙</button></header>
<section class="connection-bar"><button id="apiKeyButton" class="connection-button">API Key</button><button id="localModelButton" class="connection-button">Local Model</button><button id="testButton" class="connection-button">Test</button><button id="downloadModelButton" class="connection-button">Download Model</button></section>
<nav class="modes"><button class="mode active" data-mode="agent">Agent</button><button class="mode" data-mode="ask">Ask</button><button class="mode" data-mode="selection">Check Selection</button></nav>
<section id="messages" class="messages" aria-live="polite"></section>
<section class="composer-wrap"><div id="attachments" class="attachment-list"></div><textarea id="prompt" rows="3" placeholder="Ask Vectra…"></textarea><div class="composer-actions"><div class="left-actions"><button id="attachButton" class="secondary">＋ File</button><button id="clearButton" class="secondary">Clear Chat</button></div><button id="sendButton" class="primary">Send</button><button id="stopButton" class="danger hidden">Stop</button></div></section>
</main>
<dialog id="settingsDialog" class="settings-dialog"><form method="dialog" class="settings-card"><div class="settings-title"><div><strong>Vectra Settings</strong><div class="settings-subtitle">Runtime, model capability and support</div></div><button class="dialog-close" value="cancel" aria-label="Close">×</button></div><section class="settings-section"><h3>Runtime</h3><div id="runtimeInfo" class="runtime-info"></div><div class="device-row"><span>Device</span><select id="deviceMode"><option value="auto">Auto</option><option value="gpu">GPU</option><option value="cpu">CPU</option></select></div><div class="device-row"><span>Theme</span><select id="themeMode"><option value="auto">Match VS Code</option><option value="grayWhite">Gray / White</option></select></div><div id="gpuInfo" class="capability-info hidden"></div><div id="capabilityInfo" class="capability-info"></div></section><section class="settings-section"><h3>General information</h3><div class="contact-grid"><span>Version</span><strong>v${this.extensionVersion}</strong><span>Email</span><strong>test@gmail.com</strong><span>Contact</span><strong>+0000000000</strong><span>GitHub</span><strong>Laudarisd</strong></div></section><section class="settings-section"><h3>Support & advanced</h3><div class="settings-actions"><button id="advancedSettingsButton" type="button" class="secondary">Advanced Settings</button><button id="supportButton" type="button" class="secondary">Support Developer</button></div></section><div class="dialog-actions"><button value="cancel" class="primary">Done</button></div></form></dialog>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
    }
}
exports.ChatViewProvider = ChatViewProvider;
function defaultSelectionPrompt() {
    return 'Explain and review the EXACT current selection in detail. Walk through the selected lines/fields, what they do, how they relate, assumptions, bugs or edge cases, and improvements. Do not edit files.';
}
function toWebviewProposal(proposal) {
    const { baseContent: _baseContent, proposedContent: _proposedContent, baseHash: _baseHash, binaryOutputBase64: _binaryOutput, ...safe } = proposal;
    return safe;
}
function toAttachmentMeta(attachment) {
    return {
        id: attachment.id,
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        kind: attachment.kind
    };
}
function deduplicateAttachments(attachments) {
    const seen = new Set();
    return attachments.filter((attachment) => {
        const key = `${attachment.path || attachment.name}:${attachment.size}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=ChatViewProvider.js.map