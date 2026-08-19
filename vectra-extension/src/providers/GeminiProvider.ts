import { Attachment, ModelInfo, ProviderRequest, TextProvider } from '../types';
import { fetchJson } from '../utils/http';
interface GeminiResponse { candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>; output_text?:string }
interface GeminiModelsResponse { models?:Array<{name:string;displayName?:string;description?:string;supportedGenerationMethods?:string[]}> }
export class GeminiProvider implements TextProvider{
  readonly id='gemini' as const;
  constructor(private readonly apiKey:string,private readonly baseUrl:string){}
  async complete(request:ProviderRequest):Promise<string>{
    const parts:Array<Record<string,unknown>>=[{text:request.userPrompt}]; for(const f of request.attachments??[])append(parts,f);
    const root=this.baseUrl.replace(/\/$/,'');
    const data=await fetchJson<GeminiResponse>(`${root}/models/${encodeURIComponent(request.model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':this.apiKey,'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:request.systemPrompt}]},contents:[{role:'user',parts}]}),signal:request.signal});
    const text=data.output_text?.trim()||(data.candidates??[]).flatMap(c=>c.content?.parts??[]).map(p=>p.text??'').join('\n').trim(); if(!text)throw new Error('Gemini returned no text output.');return text;
  }
  async listModels(signal?:AbortSignal):Promise<ModelInfo[]>{try{return await this.listAt(`${this.baseUrl}/models`,signal)}catch(e){if(!this.baseUrl.endsWith('/v1'))throw e;return this.listAt(`${this.baseUrl.replace(/\/v1$/,'/v1beta')}/models`,signal)}}
  async testConnection(signal?:AbortSignal):Promise<string>{const m=await this.listModels(signal);return`Connected to Gemini. ${m.length} model(s) available.`}
  private async listAt(url:string,signal?:AbortSignal):Promise<ModelInfo[]>{const d=await fetchJson<GeminiModelsResponse>(url,{headers:{'x-goog-api-key':this.apiKey},signal});return(d.models??[]).filter(m=>!m.supportedGenerationMethods||m.supportedGenerationMethods.some(x=>x.toLowerCase().includes('generate'))).map(m=>({id:m.name.replace(/^models\//,''),label:m.displayName,detail:m.description}))}
}
function append(parts:Array<Record<string,unknown>>,f:Attachment):void{if((f.kind==='text'||f.kind==='document')&&f.text)parts.push({text:`\n[Attachment: ${f.name}]\n${f.text}`});else if((f.kind==='image'||f.kind==='pdf')&&f.base64)parts.push({inline_data:{mime_type:f.mime,data:f.base64}});else if(f.text)parts.push({text:`\n[Attachment: ${f.name}]\n${f.text}`});}
