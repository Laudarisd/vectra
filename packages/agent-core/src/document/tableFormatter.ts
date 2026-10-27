// Beginner guide: Handles t ab le fo rm at te r responsibilities for Vectra.
import { DocumentTableInput } from './types';

/** Format dynamic extracted records without imposing a document-specific schema. */
export function formatDocumentTable(input: DocumentTableInput): string {
  const seen = new Set<string>();
  const columns = input.columns
    .filter((column) => {
      const key = column.key.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((column) => ({ key: column.key.trim(), header: clean(column.header) || column.key.trim() }));

  if (!columns.length) throw new Error('At least one unique extraction column is required.');

  const rows = input.rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column.key, clean(row[column.key])]))
  );
  crossMatchRows(rows, columns.map((column) => column.key), input.matchKeys ?? []);

  const sources = [...new Set((input.sources ?? []).map(clean).filter(Boolean))];
  const title = clean(input.title) || 'Extracted information';
  const sourceSuffix = sources.length === 1 ? ` — ${sources[0]}` : sources.length > 1 ? ` — ${sources.length} sources` : '';
  const header = `| ${columns.map((column) => escapeMarkdown(column.header)).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((row) => `| ${columns.map((column) => escapeMarkdown(row[column.key])).join(' | ')} |`)
    .join('\n');
  return `### ${escapeMarkdown(title + sourceSuffix)}\n\n${header}\n${divider}\n${body}`;
}

function crossMatchRows(rows: Array<Record<string, string>>, columnKeys: string[], requestedKeys: string[]): void {
  const matchKeys = requestedKeys.filter((key) => columnKeys.includes(key));
  for (const matchKey of matchKeys) {
    const known = new Map<string, Record<string, string>>();
    for (const row of rows) {
      const identity = row[matchKey]?.toLowerCase();
      if (!identity) continue;
      const current = known.get(identity) || {};
      for (const key of columnKeys) if (!current[key] && row[key]) current[key] = row[key];
      known.set(identity, current);
    }
    for (const row of rows) {
      const identity = row[matchKey]?.toLowerCase();
      const match = identity ? known.get(identity) : undefined;
      if (!match) continue;
      for (const key of columnKeys) if (!row[key] && match[key]) row[key] = match[key];
    }
  }
}

function clean(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function escapeMarkdown(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
