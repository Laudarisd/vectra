"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VECTRA_SUBAGENT_DENIED_TOOL_NAMES = exports.VECTRA_WRITE_OR_EXECUTE_TOOL_NAMES = void 0;
exports.describeVectraTool = describeVectraTool;
const catalog_1 = require("./catalog");
exports.VECTRA_WRITE_OR_EXECUTE_TOOL_NAMES = new Set(catalog_1.VECTRA_TOOL_DEFINITIONS.filter((item) => item.risk === 'write' || item.risk === 'execute').map((item) => item.name));
exports.VECTRA_SUBAGENT_DENIED_TOOL_NAMES = new Set([
    ...exports.VECTRA_WRITE_OR_EXECUTE_TOOL_NAMES,
    'delegate_task',
    'propose_plan',
    'todo_write'
]);
/** Shared progress wording used by every host. The playful style is a product
 * feature, while the exact path/count keeps each live step understandable. */
function describeVectraTool(name, input = {}) {
    const path = typeof input.path === 'string' ? input.path : '';
    switch (name) {
        case 'workspace_summary': return "Analyzin' the whole workspace…";
        case 'list_directory': return "Peekin' in the foldie…";
        case 'list_files': return "Countin' up all the file-friends…";
        case 'read_file': return `Readin' ${path}, readin' it good…`;
        case 'read_files': return `Parsin' ${Array.isArray(input.paths) ? input.paths.length : 0} file-friends…`;
        case 'read_document': return `Parsin' ${path}, nom nom…`;
        case 'inspect_file': return `Snoopin' at ${path}…`;
        case 'search_text': return `Findy-findy “${String(input.query ?? '')}”…`;
        case 'get_diagnostics': return 'Checky-checky for boo-boos…';
        case 'git_status': return "Peekin' at the git-git…";
        case 'git_diff': return "Readin' the git-git changes…";
        case 'create_file': return `Generatin' ${path}, brand new!…`;
        case 'propose_file': return `Fixin' up ${path}…`;
        case 'propose_files': return `Generatin' ${Array.isArray(input.files) ? input.files.length : 0} shiny new file-friends…`;
        case 'replace_lines':
        case 'delete_lines':
        case 'insert_lines': return `Fixin' up ${path}…`;
        case 'create_document': return `Generatin' the document ${path}…`;
        case 'edit_document': return `Fixin' up the document ${path}…`;
        case 'delete_file': return `Gettin' ready to bye-bye ${path}…`;
        case 'create_directory': return `Makin' the lil' folder ${path}…`;
        case 'rename_path': return `Giving ${path} a shiny new name…`;
        case 'move_path': return `Scootin' ${path} to its new home…`;
        case 'copy_path': return `Making a file-friend copy of ${path}…`;
        case 'delete_directory': return `Gettin' ready to bye-bye the folder ${path}…`;
        case 'run_file': return `Runny-run ${path}…`;
        case 'run_project': return 'Runny-run the whole project…';
        case 'run_command': return 'Runny-run a lil’ command…';
        case 'run_tests': return 'Testy-test time, go go go…';
        case 'todo_write': return 'Jotting down the plan…';
        case 'propose_plan': return 'Sketchin’ out a plan for ya…';
        case 'web_search': return `Googlin' "${String(input.query ?? '')}"…`;
        case 'web_fetch': return `Fetchin' ${String(input.url ?? '')}…`;
        case 'delegate_task': return 'Delegatin’ a sub-task…';
        default: return 'Checking a tool step…';
    }
}
//# sourceMappingURL=policy.js.map