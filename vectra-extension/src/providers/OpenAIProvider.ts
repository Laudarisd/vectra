// Beginner guide: Handles o pe na ip ro vi de r responsibilities for Vectra.
import { Attachment, ModelInfo, ProviderRequest, TextProvider } from '../types';
import { fetchJson } from '../utils/http';

interface OpenAIResponse { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }
interface OpenAIModelsResponse { data?: Array<{ id: string; owned_by?: string }> }

export class OpenAIProvider implements TextProvider {
  readonly id = 'openai' as const;
  constructor(private readonly apiKey: string, private readonly baseUrl: string) {}

  async complete(request: ProviderRequest): Promise<string> {
    const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: request.userPrompt }];
    for (const file of request.attachments ?? []) appendOpenAIAttachment(content, file);
    const data = await fetchJson<OpenAIResponse>(`${this.baseUrl}/responses`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: request.model, instructions: request.systemPrompt, input: [{ role: 'user', content }] }), signal: request.signal
    });
    const text = extractOpenAIText(data); if (!text) throw new Error('OpenAI returned no text output.'); return text;
  }
  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const data = await fetchJson<OpenAIModelsResponse>(`${this.baseUrl}/models`, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal });
    return (data.data ?? []).map((m)=>({id:m.id,detail:m.owned_by})).sort((a,b)=>a.id.localeCompare(b.id));
  }
  async testConnection(signal?: AbortSignal): Promise<string> { const models=await this.listModels(signal); return `Connected to OpenAI. ${models.length} model(s) available.`; }
}
function appendOpenAIAttachment(content: Array<Record<string, unknown>>, file: Attachment): void {
  if ((file.kind === 'text' || file.kind === 'document') && file.text) content.push({ type:'input_text', text:`\n[Attachment: ${file.name}]\n${file.text}` });
  else if (file.kind === 'image' && file.base64) content.push({ type:'input_image', image_url:`data:${file.mime};base64,${file.base64}`, detail:'auto' });
  else if (file.kind === 'pdf' && file.base64) content.push({ type:'input_file', filename:file.name, file_data:`data:${file.mime};base64,${file.base64}` });
  if (file.kind === 'pdf' && file.text) content.push({ type:'input_text', text:`\n[Extracted PDF text fallback: ${file.name}]\n${file.text}` });
}
function extractOpenAIText(data: OpenAIResponse): string { if(data.output_text?.trim()) return data.output_text.trim(); const p:string[]=[]; for(const i of data.output??[]) for(const c of i.content??[]) if((c.type==='output_text'||c.type==='text')&&c.text)p.push(c.text); return p.join('\n').trim(); }
