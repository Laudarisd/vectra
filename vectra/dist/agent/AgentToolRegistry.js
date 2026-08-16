"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentToolRegistry = void 0;
const path_1 = require("../utils/path");
const text_1 = require("../utils/text");
/**
 * Executes validated agent actions against extension services. This is the only
 * place where model-requested tools are connected to filesystem, proposal, and
 * command capabilities.
 */
class AgentToolRegistry {
    workspace;
    patches;
    commands;
    git;
    constructor(workspace, patches, commands, git) {
        this.workspace = workspace;
        this.patches = patches;
        this.commands = commands;
        this.git = git;
    }
    describe(action) {
        switch (action.type) {
            case 'workspace_summary': return 'Analyzing workspace…';
            case 'list_directory': return 'Scanning directory…';
            case 'list_files': return 'Scanning workspace files…';
            case 'read_file': return `Reading ${action.path}…`;
            case 'read_files': return `Reading ${Array.isArray(action.paths) ? action.paths.length : 0} related files…`;
            case 'read_document': return `Parsing document ${action.path}…`;
            case 'inspect_file': return `Inspecting ${action.path}…`;
            case 'search_text': return `Searching for “${action.query}”…`;
            case 'get_diagnostics': return 'Checking editor diagnostics…';
            case 'git_status': return 'Checking git status…';
            case 'git_diff': return 'Reading git diff…';
            case 'create_file': return `Producing ${action.path}…`;
            case 'propose_file': return `Editing ${action.path}…`;
            case 'propose_files': return `Producing ${Array.isArray(action.files) ? action.files.length : 0} project files…`;
            case 'replace_lines':
            case 'delete_lines':
            case 'insert_lines': return `Editing ${action.path}…`;
            case 'create_document': return `Producing document ${action.path}…`;
            case 'edit_document': return `Editing document ${action.path}…`;
            case 'delete_file': return `Preparing deletion of ${action.path}…`;
            case 'run_file': return `Running ${action.path}…`;
            case 'run_project': return 'Running project…';
            case 'run_command': return 'Running command…';
            case 'run_tests': return 'Running tests…';
        }
    }
    async execute(action, context) {
        if (context.signal?.aborted)
            throw new Error('Request cancelled.');
        try {
            return await this.executeTrusted(action, context);
        }
        catch (error) {
            return this.result(action, `ERROR: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async executeTrusted(action, context) {
        if (action.type === 'read_file') {
            return this.result(action, await this.readFileWithPendingOverlay(action.path, action.startLine, action.endLine));
        }
        if (action.type === 'read_files') {
            const paths = validateStringArray(action.paths, 'read_files paths', 20);
            const outputs = [];
            for (const filePath of [...new Set(paths.map(path_1.normalizeAgentPath))]) {
                if (context.signal?.aborted)
                    throw new Error('Request cancelled.');
                outputs.push(await this.readFileWithPendingOverlay(filePath, action.startLine, action.endLine));
            }
            return this.result(action, outputs.join('\n\n'));
        }
        if (action.type === 'read_document') {
            return this.result(action, await this.workspace.readDocument(action.path));
        }
        if (action.type === 'inspect_file') {
            const attachment = await this.workspace.inspectFile(action.path);
            const alreadyAttached = context.mediaAttachments.some((item) => item.path === attachment.path && item.name === attachment.name);
            if (!alreadyAttached)
                context.mediaAttachments.push(attachment);
            const extracted = attachment.text?.trim();
            const detail = extracted
                ? `Attached ${attachment.name} (${attachment.mime}, ${attachment.size} bytes).\nExtracted text:\n${(0, text_1.truncateMiddle)(extracted, 20_000)}`
                : `Attached ${attachment.name} (${attachment.mime}, ${attachment.size} bytes) for multimodal inspection. No reliable embedded text was found.`;
            return this.result(action, detail);
        }
        if (action.type === 'git_status') {
            return this.result(action, await this.git.status());
        }
        if (action.type === 'git_diff') {
            return this.result(action, await this.git.diff(action.path, action.staged === true));
        }
        if (action.type === 'propose_files') {
            if (context.mode !== 'agent')
                return this.denied(action, 'This mode is read-only.');
            if (!Array.isArray(action.files) || action.files.length === 0 || action.files.length > 30) {
                return this.denied(action, 'propose_files requires between 1 and 30 files.');
            }
            // Validate the complete batch before creating proposals. This prevents a
            // malformed later item from leaving earlier files in an unreported state.
            const batch = action.files.map((file) => {
                if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
                    throw new Error('Every propose_files item requires string path and content fields.');
                }
                return { ...file, path: (0, path_1.normalizeAgentPath)(file.path) };
            });
            const duplicateCheck = new Set();
            for (const file of batch) {
                if (duplicateCheck.has(file.path))
                    throw new Error(`Duplicate path in propose_files: ${file.path}`);
                duplicateCheck.add(file.path);
            }
            const ids = [];
            const paths = [];
            const errors = [];
            for (const file of batch) {
                if (context.signal?.aborted)
                    throw new Error('Request cancelled.');
                try {
                    const proposal = await this.patches.proposeFile(file.path, file.content, file.reason || action.reason || 'Agent-proposed project file');
                    ids.push(proposal.id);
                    paths.push(proposal.path);
                }
                catch (error) {
                    errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            const prepared = paths.length
                ? `Prepared ${paths.length} reviewed project files:\n${paths.map((filePath) => `- ${filePath}`).join('\n')}`
                : 'No project files were prepared.';
            const failures = errors.length ? `\nErrors:\n${errors.map((error) => `- ${error}`).join('\n')}` : '';
            return this.result(action, `${prepared}${failures}`, ids, paths.length > 0 && errors.length === 0);
        }
        if (action.type === 'create_file' || action.type === 'propose_file') {
            if (context.mode !== 'agent')
                return this.denied(action, 'This mode is read-only.');
            if (typeof action.content !== 'string')
                return this.denied(action, 'Complete string content is required.');
            if (action.type === 'create_file') {
                if (this.patches.getPendingForPath(action.path)) {
                    return this.denied(action, `${action.path} already has a pending proposal.`);
                }
                const current = await this.workspace.readWholeFile(action.path);
                if (current.exists)
                    return this.denied(action, `${action.path} already exists. Read it, then use propose_file.`);
            }
            const proposal = await this.patches.proposeFile(action.path, action.content, action.reason);
            return this.result(action, `Prepared reviewed ${proposal.kind} proposal for ${proposal.path}.`, [proposal.id], true);
        }
        if (action.type === 'replace_lines' || action.type === 'delete_lines' || action.type === 'insert_lines') {
            if (context.mode !== 'agent')
                return this.denied(action, 'This mode is read-only.');
            const proposal = action.type === 'replace_lines'
                ? await this.patches.proposeLineEdit(action.path, action.startLine, action.endLine, action.content, 'replace', action.reason)
                : action.type === 'delete_lines'
                    ? await this.patches.proposeLineEdit(action.path, action.startLine, action.endLine, '', 'delete', action.reason)
                    : await this.patches.proposeLineEdit(action.path, action.line, action.line, action.content, action.position === 'before' ? 'insert-before' : 'insert-after', action.reason);
            return this.result(action, `Prepared reviewed line edit for ${proposal.path}.`, [proposal.id], true);
        }
        if (action.type === 'create_document' || action.type === 'edit_document') {
            if (context.mode !== 'agent')
                return this.denied(action, 'This mode is read-only.');
            const proposal = await this.patches.proposeDocument(action.path, action.content, action.reason, action.title, action.type === 'edit_document');
            return this.result(action, `Prepared reviewed document proposal for ${proposal.path}.`, [proposal.id], true);
        }
        if (action.type === 'delete_file') {
            if (context.mode !== 'agent')
                return this.denied(action, 'This mode is read-only.');
            // A pending "create" proposal was never written to disk, so there is
            // nothing there to delete yet. Cancel the pending creation instead of
            // asking the filesystem to delete a file it has never seen.
            const pending = this.patches.getPendingForPath(action.path);
            if (pending && pending.kind === 'create') {
                this.patches.reject(pending.id);
                return this.result(action, `Cancelled the pending creation of ${pending.path}; it was never written to disk.`, [], true);
            }
            const proposal = await this.patches.proposeDelete(action.path, action.reason);
            return this.result(action, `Prepared reviewed deletion for ${proposal.path}.`, [proposal.id], true);
        }
        if (action.type === 'run_file' || action.type === 'run_project' || action.type === 'run_command' || action.type === 'run_tests') {
            if (context.mode !== 'agent')
                return this.denied(action, 'Execution tools are available only in Agent mode.');
            if (this.patches.list().some((proposal) => proposal.status === 'pending')) {
                return this.denied(action, 'Pending proposals must be accepted or rejected before execution.');
            }
            if (action.type === 'run_file') {
                return this.result(action, await this.commands.runFile(action.path, action.args ?? [], action.timeoutMs, action.reason, context.signal));
            }
            if (action.type === 'run_project') {
                return this.result(action, await this.commands.runProject(action.path ?? '', action.timeoutMs, action.reason, context.signal));
            }
            if (action.type === 'run_tests') {
                const output = action.command
                    ? await this.commands.run(action.command, action.cwd, action.timeoutMs, action.reason, 'tests', context.signal)
                    : await this.commands.runTestsAuto(action.cwd ?? '', action.timeoutMs, action.reason, context.signal);
                return this.result(action, output);
            }
            return this.result(action, await this.commands.run(action.command, action.cwd, action.timeoutMs, action.reason, 'command', context.signal));
        }
        return this.result(action, await this.workspace.execute(action));
    }
    async readFileWithPendingOverlay(filePath, startLine = 1, endLine) {
        const pending = this.patches.readPendingText(filePath);
        if (pending === undefined)
            return this.workspace.readFile(filePath, startLine, endLine);
        const lines = pending.split(/\r?\n/);
        const start = clamp(startLine, 1, Math.max(1, lines.length));
        const end = clamp(endLine ?? Math.min(lines.length, start + 399), start, lines.length);
        const numbered = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`);
        return `PENDING FILE ${(0, path_1.normalizeAgentPath)(filePath)} lines ${start}-${end} of ${lines.length}\n${numbered.join('\n')}`;
    }
    denied(action, reason) {
        const guidance = /read-only|only in Agent mode/i.test(reason)
            ? ' Do not retry this or any other write/execute action in the current mode. Answer the CURRENT USER TASK with actions=[].'
            : ' Do not repeat the identical action; correct it or finish the current task.';
        return this.result(action, `Denied: ${reason}${guidance}`);
    }
    result(action, output, proposalIds = [], wrote = false) {
        return {
            // Never echo complete generated files back into the next model prompt.
            // The pending overlay can supply a file on demand, while this compact
            // action summary preserves far more context for the rest of the project.
            observation: `ACTION ${(0, text_1.safeJson)(summarizeAction(action))}\nRESULT\n${output}`,
            proposalIds,
            wrote
        };
    }
}
exports.AgentToolRegistry = AgentToolRegistry;
function summarizeAction(action) {
    if (action.type === 'propose_files') {
        return {
            type: action.type,
            files: Array.isArray(action.files)
                ? action.files.map((file) => ({
                    path: typeof file?.path === 'string' ? file.path : '(invalid path)',
                    characters: typeof file?.content === 'string' ? file.content.length : 0
                }))
                : []
        };
    }
    if ('content' in action && typeof action.content === 'string') {
        const { content: _content, ...summary } = action;
        return { ...summary, contentCharacters: action.content.length };
    }
    return action;
}
function validateStringArray(value, label, maxItems) {
    if (!Array.isArray(value) || value.length === 0)
        throw new Error(`${label} must contain at least one path.`);
    if (value.length > maxItems)
        throw new Error(`${label} supports at most ${maxItems} paths per call.`);
    if (!value.every((item) => typeof item === 'string' && item.trim())) {
        throw new Error(`${label} must contain only non-empty strings.`);
    }
    return value;
}
function clamp(value, min, max) {
    const number = Number.isFinite(value) ? Math.floor(value) : min;
    return Math.min(max, Math.max(min, number));
}
//# sourceMappingURL=AgentToolRegistry.js.map