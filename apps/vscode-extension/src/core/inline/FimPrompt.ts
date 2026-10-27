// Pure prompt assembly and output cleanup for inline (ghost-text) code suggestions.
export interface InlineContext { fileName: string; languageId: string; prefix: string; suffix: string }

export const CURSOR_MARKER = '<|cursor|>';
const MAX_PREFIX_CHARS = 6_000;
const MAX_SUFFIX_CHARS = 1_500;

/** Fill-in-the-middle framed as a chat turn, so every Vectra provider can serve suggestions without a dedicated FIM endpoint. */
export function buildInlinePrompt(context: InlineContext): { systemPrompt: string; userPrompt: string } {
  const prefix = context.prefix.slice(-MAX_PREFIX_CHARS);
  const suffix = context.suffix.slice(0, MAX_SUFFIX_CHARS);
  return {
    systemPrompt:
      `You are an inline code completion engine inside an editor. Continue the code exactly at ${CURSOR_MARKER}. ` +
      'Reply with only the inserted code: no explanations, no markdown fences, no repetition of the text before the cursor, ' +
      'and stop where the existing code after the cursor resumes.',
    userPrompt: `File: ${context.fileName} (${context.languageId})\n\n${prefix}${CURSOR_MARKER}${suffix}`
  };
}

/** Turns a raw model reply into the text to insert at the cursor, or '' when nothing useful remains. */
export function cleanInlineCompletion(raw: string, context: InlineContext, maxLines: number): string {
  let text = String(raw ?? '').replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  const fenced = text.match(/```[^\n]*\n([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  text = text.replace(/\r\n/g, '\n').replace(/^\n+/, '');
  if (!text.trim()) return '';

  // Models often restate the current line; drop that echo so the insertion continues the cursor line.
  const currentLine = context.prefix.slice(context.prefix.lastIndexOf('\n') + 1);
  if (currentLine.trim()) {
    if (text.startsWith(currentLine)) text = text.slice(currentLine.length);
    else if (text.startsWith(currentLine.trimStart())) text = text.slice(currentLine.trimStart().length);
  }

  // Stop where the existing code after the cursor resumes.
  const nextSuffixLine = context.suffix.split('\n').map((line) => line.trim()).find(Boolean);
  if (nextSuffixLine) {
    const at = text.indexOf(nextSuffixLine);
    if (at >= 0) text = text.slice(0, at);
  }

  // A cursor in the middle of a line gets a single-line suggestion; at a line end, up to maxLines.
  const lineBreak = context.suffix.indexOf('\n');
  const restOfLine = lineBreak < 0 ? context.suffix : context.suffix.slice(0, lineBreak);
  const limit = restOfLine.trim() ? 1 : Math.max(1, maxLines);
  return text.split('\n').slice(0, limit).join('\n').replace(/\s+$/, '');
}
