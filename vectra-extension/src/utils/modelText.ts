// Beginner guide: Handles m od el te xt responsibilities for Vectra.
/** Remove private reasoning and serialized tool markup from completed model text. */
export function visibleModelText(raw: string): string {
  let text=String(raw??'');
  text=text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi,'');
  if(/<\/think>/i.test(text))text=text.replace(/^[\s\S]*?<\/think>/i,'');
  text=text.replace(/<think\b[^>]*>[\s\S]*$/gi,'');
  return text
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi,'')
    .replace(/<tool_call\b[^>]*>[\s\S]*$/gi,'')
    .trim();
}

// The streaming think-tag filter now lives in the shared core (with a second
// onThinking channel), so the extension and web split streams identically.
export { VisibleModelTextStream } from '../core/agent/modelTextStream';
