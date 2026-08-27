import { Attachment, ModelInfo, ProviderRequest, TextProvider } from '../types';
import { fetchJson, streamSse } from '../utils/http';
import { AGENT_ENVELOPE_SCHEMA } from '../agent/protocol';
interface ChatResponse{choices?:Array<{message?:{content?:string}}>}
interface ModelsResponse{data?:Array<{id:string;owned_by?:string}>}
export class OpenAICompatibleProvider implements TextProvider{
  readonly id='openaiCompatible' as const;
  constructor(private readonly baseUrl:string,private readonly apiKey?:string,private readonly structuredAgentJson=false,private readonly timeoutMs=900_000){}
  async complete(request:ProviderRequest):Promise<string>{
    const userContent:Array<Record<string,unknown>>=[{type:'text',text:request.userPrompt}];
    for(const f of request.attachments??[]) append(userContent,f);
    const wantsEnvelope=this.structuredAgentJson&&request.structured!==false;
    // llama.cpp has supported this schema-bearing json_object form across more
    // releases than the OpenAI-style json_schema wrapper. The latter changed
    // shape between server versions and can be silently accepted but ignored.
    const body={model:request.model,messages:[{role:'system',content:request.systemPrompt},{role:'user',content:userContent}],temperature:request.structured===false?0.6:0.2,...(this.structuredAgentJson?{cache_prompt:true}:{}),...(wantsEnvelope?{response_format:{type:'json_object',schema:AGENT_ENVELOPE_SCHEMA}}:{})};
    // Free-form conversational replies stream token-by-token so a slow local
    // model shows visible progress instead of an unresponsive wait. The
    // schema-constrained tool-loop JSON stays non-streaming: partial JSON is
    // not useful to render and cannot be parsed until it is complete.
    if(request.structured===false&&request.onDelta){
      const text=await streamSse(`${this.baseUrl}/chat/completions`,{method:'POST',headers:this.headers(true),body:JSON.stringify({...body,stream:true}),signal:request.signal},{onDelta:request.onDelta,idleTimeoutMs:this.timeoutMs,signal:request.signal});
      if(!text.trim())throw new Error('OpenAI-compatible endpoint returned no text output.');
      return text.trim();
    }
    try{
      const data=await fetchJson<ChatResponse>(`${this.baseUrl}/chat/completions`,{method:'POST',headers:this.headers(true),body:JSON.stringify(body),signal:request.signal},this.timeoutMs);
      const text=data.choices?.[0]?.message?.content?.trim();if(!text)throw new Error('OpenAI-compatible endpoint returned no text output.');return text;
    }catch(error){
      // Some llama.cpp builds crash their grammar interpreter mid-string on
      // particular tokens (observed with a literal "|", e.g. a markdown table
      // in the free-form message field) and return 400 instead of degrading.
      // The schema is a decoding aid, not a correctness requirement — the
      // system prompt already spells out the JSON envelope shape, so retrying
      // once unconstrained keeps the turn alive instead of surfacing a crash.
      if(wantsEnvelope&&isGrammarInitError(error)){
        const{response_format:_dropped,...unconstrained}=body as typeof body&{response_format?:unknown};
        const data=await fetchJson<ChatResponse>(`${this.baseUrl}/chat/completions`,{method:'POST',headers:this.headers(true),body:JSON.stringify(unconstrained),signal:request.signal},this.timeoutMs);
        const text=data.choices?.[0]?.message?.content?.trim();if(!text)throw new Error('OpenAI-compatible endpoint returned no text output.');return text;
      }
      throw error;
    }
  }
  async listModels(signal?:AbortSignal):Promise<ModelInfo[]>{const d=await fetchJson<ModelsResponse>(`${this.baseUrl}/models`,{headers:this.headers(false),signal});return(d.data??[]).map(m=>({id:m.id,detail:m.owned_by}))}
  async testConnection(signal?:AbortSignal):Promise<string>{const m=await this.listModels(signal);return`Connected to OpenAI-compatible endpoint. ${m.length} model(s) available.`}
  private headers(ct:boolean):Record<string,string>{return{...(ct?{'Content-Type':'application/json'}:{}),...(this.apiKey?{Authorization:`Bearer ${this.apiKey}`}:{})}}
}
function isGrammarInitError(error:unknown):boolean{
  const message=error instanceof Error?error.message:String(error);
  return /HTTP 400/.test(message)&&/grammar|initialize samplers/i.test(message);
}
function append(content:Array<Record<string,unknown>>,f:Attachment):void{
  if((f.kind==='text'||f.kind==='pdf'||f.kind==='document')&&f.text)content.push({type:'text',text:`\n[Attachment: ${f.name}]\n${f.text}`});
  if(f.kind==='image'&&f.base64)content.push({type:'image_url',image_url:{url:`data:${f.mime};base64,${f.base64}`}});
}
