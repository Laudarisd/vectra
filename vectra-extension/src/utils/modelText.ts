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

/**
 * Stateful filter for streamed Qwen output. Tags may be split across chunks,
 * so incomplete tag prefixes are buffered instead of briefly shown in the UI.
 */
export class VisibleModelTextStream {
  private pending='';
  private hidden=false;
  private value='';

  constructor(private readonly onVisible?: (delta: string)=>void){}

  push(chunk: string): void {
    this.pending+=String(chunk??'');
    this.drain(false);
  }

  finish(): string {
    this.drain(true);
    return this.value.trim();
  }

  private emit(text: string): void {
    if(!text)return;
    this.value+=text;
    this.onVisible?.(text);
  }

  private drain(final: boolean): void {
    while(this.pending){
      const lower=this.pending.toLowerCase();
      if(this.hidden){
        const close=lower.indexOf('</think>');
        if(close>=0){
          this.pending=this.pending.slice(close+'</think>'.length);
          this.hidden=false;
          continue;
        }
        if(final){this.pending='';return}
        const keep=partialTagSuffix(this.pending,'</think>');
        this.pending=keep?this.pending.slice(-keep):'';
        return;
      }

      const open=lower.indexOf('<think');
      const strayClose=lower.indexOf('</think>');
      if(strayClose>=0&&(open<0||strayClose<open)){
        this.emit(this.pending.slice(0,strayClose));
        this.pending=this.pending.slice(strayClose+'</think>'.length);
        continue;
      }
      if(open>=0){
        this.emit(this.pending.slice(0,open));
        const end=this.pending.indexOf('>',open);
        if(end<0){
          this.pending=this.pending.slice(open);
          if(final)this.pending='';
          return;
        }
        this.pending=this.pending.slice(end+1);
        this.hidden=true;
        continue;
      }

      if(final){
        this.emit(this.pending.replace(/<\/?think\b[^>]*>/gi,''));
        this.pending='';
        return;
      }
      const keep=Math.max(partialTagSuffix(this.pending,'<think'),partialTagSuffix(this.pending,'</think>'));
      this.emit(keep?this.pending.slice(0,-keep):this.pending);
      this.pending=keep?this.pending.slice(-keep):'';
      return;
    }
  }
}

function partialTagSuffix(value: string,tag: string): number {
  const lower=value.toLowerCase();
  const wanted=tag.toLowerCase();
  const maximum=Math.min(lower.length,wanted.length-1);
  for(let length=maximum;length>0;length--){
    if(lower.endsWith(wanted.slice(0,length)))return length;
  }
  return 0;
}
