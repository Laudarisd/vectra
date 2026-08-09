import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { EditProposal } from '../types';
import { resolveWorkspacePath } from '../utils/path';
import { sha256, sha256Bytes } from '../utils/text';
import { WorkspaceTools } from './WorkspaceTools';
import { createDocumentBytes, documentFormatForPath, extractDocumentText, isWritableDocumentFormat } from './DocumentService';

export class PatchManager {
  private readonly proposals = new Map<string, EditProposal>();
  constructor(private readonly tools: WorkspaceTools) {}
  list(): EditProposal[] { return [...this.proposals.values()].sort((a,b)=>b.createdAt-a.createdAt); }
  get(id:string):EditProposal|undefined { return this.proposals.get(id); }

  async proposeFile(path:string, proposedContent:string, reason='Agent-proposed change'):Promise<EditProposal>{
    const current=await this.tools.readWholeFile(path);
    return this.store({ id:randomUUID(),path,reason,kind:current.exists?'modify':'create',baseContent:current.content,proposedContent,baseHash:sha256(current.content),createdAt:Date.now(),status:'pending',contentType:'text' });
  }

  async proposeLineEdit(path:string, startLine:number, endLine:number, content:string, mode:'replace'|'delete'|'insert-before'|'insert-after', reason='Agent-proposed line edit'):Promise<EditProposal>{
    const current=await this.tools.readWholeFile(path); if(!current.exists)throw new Error(`File does not exist: ${path}`);
    const eol=current.content.includes('\r\n')?'\r\n':'\n'; const trailing=/\r?\n$/.test(current.content); const lines=current.content.split(/\r?\n/); if(trailing)lines.pop();
    const max=Math.max(1,lines.length); const start=clamp(startLine,1,max); const end=clamp(endLine,start,max); const replacement=content?content.replace(/\r\n/g,'\n').split('\n'):[];
    if(mode==='replace') lines.splice(start-1,end-start+1,...replacement);
    else if(mode==='delete') lines.splice(start-1,end-start+1);
    else if(mode==='insert-before') lines.splice(start-1,0,...replacement);
    else lines.splice(start,0,...replacement);
    let proposed=lines.join(eol); if(trailing)proposed+=eol;
    return this.proposeFile(path,proposed,reason);
  }

  async proposeDocument(path:string, content:string, reason='Agent-proposed document change', title?:string, requireExisting=false):Promise<EditProposal>{
    const format=documentFormatForPath(path); if(!format||!isWritableDocumentFormat(format))throw new Error('Document creation/editing supports .pdf and .docx. PPTX/XLSX/RTF are currently read/parse only.');
    const current=await this.tools.readRawFile(path); if(requireExisting&&!current.exists)throw new Error(`Document does not exist: ${path}`); if(!requireExisting&&current.exists)throw new Error(`${path} already exists. Use edit_document.`);
    const baseText=current.exists?await extractDocumentText(path,current.bytes):''; const output=createDocumentBytes(path,content,title);
    return this.store({id:randomUUID(),path,reason,kind:current.exists?'modify':'create',baseContent:baseText||`[${format.toUpperCase()} document: no extractable text]`,proposedContent:content,baseHash:sha256Bytes(current.bytes),createdAt:Date.now(),status:'pending',contentType:'document',documentFormat:format,binaryOutputBase64:Buffer.from(output).toString('base64')});
  }

  async proposeDelete(path:string,reason='Agent-proposed deletion'):Promise<EditProposal>{
    const raw=await this.tools.readRawFile(path); if(!raw.exists)throw new Error(`Cannot delete missing file: ${path}`);
    const format=documentFormatForPath(path); let baseContent=''; let contentType:EditProposal['contentType']='binary';
    if(format){baseContent=await extractDocumentText(path,raw.bytes);contentType='document';}
    else {try{const text=await this.tools.readWholeFile(path);baseContent=text.content;contentType='text';}catch{baseContent=`[Binary file: ${path}]`;}}
    return this.store({id:randomUUID(),path,reason,kind:'delete',baseContent:baseContent||`[${format?.toUpperCase()||'Binary'} file]`,proposedContent:'',baseHash:sha256Bytes(raw.bytes),createdAt:Date.now(),status:'pending',contentType,documentFormat:format});
  }

  async accept(id:string):Promise<void>{const proposal=this.requireProposal(id);await this.assertFresh(proposal);await this.prepareCreateDirectories([proposal]);await this.applyProposal(proposal);proposal.status='accepted';}
  async acceptAllPending():Promise<void>{const pending=this.list().filter(p=>p.status==='pending');for(const p of pending)await this.assertFresh(p);for(const p of pending){await this.prepareCreateDirectories([p]);await this.applyProposal(p);p.status='accepted';}}
  reject(id:string):void{const p=this.requireProposal(id);if(p.status==='pending')p.status='rejected';}
  rejectAllPending():void{for(const p of this.proposals.values())if(p.status==='pending')p.status='rejected';}
  clearCompleted():void{for(const [id,p] of this.proposals)if(p.status!=='pending')this.proposals.delete(id);}

  private store(proposal:EditProposal):EditProposal{this.proposals.set(proposal.id,proposal);return proposal;}
  private requireProposal(id:string):EditProposal{const p=this.proposals.get(id);if(!p)throw new Error('Edit proposal no longer exists.');if(p.status!=='pending')throw new Error(`Proposal is already ${p.status}.`);return p;}
  private async assertFresh(proposal:EditProposal):Promise<void>{
    if(proposal.contentType==='text'&&proposal.kind!=='delete'){
      const current=await this.tools.readWholeFile(proposal.path);const expected=proposal.kind!=='create';if(current.exists!==expected||sha256(current.content)!==proposal.baseHash){proposal.status='stale';throw new Error(`${proposal.path} changed after the proposal was created. Ask Vectra to regenerate it.`);}return;
    }
    const raw=await this.tools.readRawFile(proposal.path);const expected=proposal.kind!=='create';if(raw.exists!==expected||sha256Bytes(raw.bytes)!==proposal.baseHash){proposal.status='stale';throw new Error(`${proposal.path} changed after the proposal was created. Ask Vectra to regenerate it.`);}
  }
  private async prepareCreateDirectories(proposals:EditProposal[]):Promise<void>{for(const p of proposals){if(p.kind!=='create')continue;const resolved=resolveWorkspacePath(p.path);await vscode.workspace.fs.createDirectory(resolved.uri.with({path:path.posix.dirname(resolved.uri.path)}));}}
  private async applyProposal(proposal:EditProposal):Promise<void>{
    const resolved=resolveWorkspacePath(proposal.path);
    if(proposal.kind==='delete'){await vscode.workspace.fs.delete(resolved.uri,{recursive:false,useTrash:false});return;}
    if(proposal.contentType==='document'&&proposal.binaryOutputBase64){await vscode.workspace.fs.writeFile(resolved.uri,Buffer.from(proposal.binaryOutputBase64,'base64'));return;}
    const edit=new vscode.WorkspaceEdit();
    if(proposal.kind==='create'){edit.createFile(resolved.uri,{ignoreIfExists:false,overwrite:false});edit.insert(resolved.uri,new vscode.Position(0,0),proposal.proposedContent);}
    else {const doc=await vscode.workspace.openTextDocument(resolved.uri);const last=Math.max(0,doc.lineCount-1);edit.replace(resolved.uri,new vscode.Range(new vscode.Position(0,0),doc.lineAt(last).range.end),proposal.proposedContent);}
    if(!await vscode.workspace.applyEdit(edit))throw new Error(`VS Code could not apply the proposed change to ${proposal.path}.`);
  }
}
function clamp(value:number,min:number,max:number):number{const n=Number.isFinite(value)?Math.floor(value):min;return Math.min(max,Math.max(min,n));}
