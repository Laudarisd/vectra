import { Attachment, ModelInfo, ProviderRequest, TextProvider } from '../types';
import { fetchJson } from '../utils/http';
interface AnthropicMessageResponse { content?: Array<{ type?: string; text?: string }> }
interface AnthropicModelsResponse { data?: Array<{ id: string; display_name?: string; created_at?: string }> }
export class AnthropicProvider implements TextProvider {
  readonly id='anthropic' as const;
  constructor(private readonly apiKey:string, private readonly baseUrl:string){}
  async complete(request:ProviderRequest):Promise<string>{
    const content:Array<Record<string,unknown>>=[{type:'text',text:request.userPrompt}];
    for(const f of request.attachments??[]) append(content,f);
    const data=await fetchJson<AnthropicMessageResponse>(`${this.baseUrl}/messages`,{method:'POST',headers:this.headers(),body:JSON.stringify({model:request.model,max_tokens:8192,system:request.systemPrompt,messages:[{role:'user',content}]}),signal:request.signal});
    const text=(data.content??[]).filter(p=>p.type==='text'&&p.text).map(p=>p.text).join('\n').trim(); if(!text)throw new Error('Anthropic returned no text output.'); return text;
  }
  async listModels(signal?:AbortSignal):Promise<ModelInfo[]>{const d=await fetchJson<AnthropicModelsResponse>(`${this.baseUrl}/models`,{headers:this.headers(false),signal});return(d.data??[]).map(m=>({id:m.id,label:m.display_name,detail:m.created_at}));}
  async testConnection(signal?:AbortSignal):Promise<string>{const m=await this.listModels(signal);return`Connected to Anthropic. ${m.length} model(s) available.`}
  private headers(ct=true):Record<string,string>{return{'x-api-key':this.apiKey,'anthropic-version':'2023-06-01',...(ct?{'Content-Type':'application/json'}:{})}}
}
function append(content:Array<Record<string,unknown>>,f:Attachment):void{
  if((f.kind==='text'||f.kind==='document')&&f.text)content.push({type:'text',text:`\n[Attachment: ${f.name}]\n${f.text}`});
  else if(f.kind==='image'&&f.base64)content.push({type:'image',source:{type:'base64',media_type:f.mime,data:f.base64}});
  else if(f.kind==='pdf'&&f.base64)content.push({type:'document',source:{type:'base64',media_type:'application/pdf',data:f.base64}});
  else if(f.text)content.push({type:'text',text:`\n[Attachment: ${f.name}]\n${f.text}`});
}
