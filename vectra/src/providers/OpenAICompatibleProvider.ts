import { Attachment, ModelInfo, ProviderRequest, TextProvider } from '../types';
import { fetchJson } from '../utils/http';
import { AGENT_ENVELOPE_SCHEMA } from '../agent/protocol';
interface ChatResponse{choices?:Array<{message?:{content?:string}}>}
interface ModelsResponse{data?:Array<{id:string;owned_by?:string}>}
export class OpenAICompatibleProvider implements TextProvider{
  readonly id='openaiCompatible' as const;
  constructor(private readonly baseUrl:string,private readonly apiKey?:string,private readonly structuredAgentJson=false){}
  async complete(request:ProviderRequest):Promise<string>{
    const userContent:Array<Record<string,unknown>>=[{type:'text',text:request.userPrompt}];
    for(const f of request.attachments??[]) append(userContent,f);
    const wantsEnvelope=this.structuredAgentJson&&request.structured!==false;
    const data=await fetchJson<ChatResponse>(`${this.baseUrl}/chat/completions`,{method:'POST',headers:this.headers(true),body:JSON.stringify({model:request.model,messages:[{role:'system',content:request.systemPrompt},{role:'user',content:userContent}],temperature:request.structured===false?0.6:0.2,...(wantsEnvelope?{response_format:{type:'json_schema',schema:AGENT_ENVELOPE_SCHEMA}}:{})}),signal:request.signal});
    const text=data.choices?.[0]?.message?.content?.trim();if(!text)throw new Error('OpenAI-compatible endpoint returned no text output.');return text;
  }
  async listModels(signal?:AbortSignal):Promise<ModelInfo[]>{const d=await fetchJson<ModelsResponse>(`${this.baseUrl}/models`,{headers:this.headers(false),signal});return(d.data??[]).map(m=>({id:m.id,detail:m.owned_by}))}
  async testConnection(signal?:AbortSignal):Promise<string>{const m=await this.listModels(signal);return`Connected to OpenAI-compatible endpoint. ${m.length} model(s) available.`}
  private headers(ct:boolean):Record<string,string>{return{...(ct?{'Content-Type':'application/json'}:{}),...(this.apiKey?{Authorization:`Bearer ${this.apiKey}`}:{})}}
}
function append(content:Array<Record<string,unknown>>,f:Attachment):void{
  if((f.kind==='text'||f.kind==='pdf'||f.kind==='document')&&f.text)content.push({type:'text',text:`\n[Attachment: ${f.name}]\n${f.text}`});
  if(f.kind==='image'&&f.base64)content.push({type:'image_url',image_url:{url:`data:${f.mime};base64,${f.base64}`}});
}
