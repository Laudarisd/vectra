// Discovers and reads small, project-owned SKILL.md instruction files.
import * as vscode from 'vscode';
import { safeJson } from '../../core/utils/text';

const SKILL_GLOB = '**/.vectra/skills/*/SKILL.md';
const MAX_SKILLS = 50;
const MAX_SKILL_BYTES = 100_000;

interface WorkspaceSkill {
  name: string;
  description: string;
  path: string;
  uri: vscode.Uri;
}

/**
 * A deliberately small skill system for Marketplace users.
 *
 * A project skill lives at `.vectra/skills/<name>/SKILL.md`. Listing returns
 * only short metadata; the agent reads full instructions only when useful, so
 * ordinary prompts do not pay the context cost of every installed skill.
 * Skills are instructions only: they cannot execute scripts or bypass normal
 * tool approvals.
 */
export class SkillRegistry {
  async list(): Promise<string> {
    const skills = await this.discover();
    return safeJson(skills.map(({ name, description, path }) => ({ name, description, path })));
  }

  async read(name: string): Promise<string> {
    const requested = name.trim().toLowerCase();
    if (!requested) throw new Error('read_skill requires a skill name.');
    const skill = (await this.discover()).find((item) => item.name.toLowerCase() === requested);
    if (!skill) throw new Error(`Unknown workspace skill: ${name}. Call list_skills to see what is available.`);

    const bytes = await vscode.workspace.fs.readFile(skill.uri);
    if (bytes.byteLength > MAX_SKILL_BYTES) {
      throw new Error(`Skill instructions are too large (${bytes.byteLength} bytes; limit ${MAX_SKILL_BYTES}).`);
    }
    return `WORKSPACE SKILL ${skill.name}\nPath: ${skill.path}\n\n${new TextDecoder().decode(bytes)}`;
  }

  private async discover(): Promise<WorkspaceSkill[]> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before loading project skills.');
    const uris = await vscode.workspace.findFiles(SKILL_GLOB, undefined, MAX_SKILLS);
    const skills: WorkspaceSkill[] = [];
    for (const uri of uris) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) continue;
      const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
      const parts = relative.split('/');
      const name = parts.at(-2)?.trim();
      if (!name) continue;
      let description = '';
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength <= MAX_SKILL_BYTES) description = skillDescription(new TextDecoder().decode(bytes));
      } catch { /* A disappearing skill is simply omitted from metadata. */ }
      skills.push({ name, description, path: relative, uri });
    }
    return skills.sort((left, right) => left.name.localeCompare(right.name));
  }
}

/** Prefer a frontmatter description, then the first useful prose line. */
function skillDescription(markdown: string): string {
  const frontmatter = markdown.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
  const declared = frontmatter?.[1].match(/^description:\s*(.+)$/im)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (declared) return declared.slice(0, 300);
  const prose = markdown.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#') && line !== '---');
  return (prose ?? 'Project-specific agent instructions.').slice(0, 300);
}
