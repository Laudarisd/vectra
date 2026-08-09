import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { AgentController } from '../agent/AgentController';
import { AgentMode, Attachment, ChatMessage, EditProposal } from '../types';
import { getConfig } from '../utils/config';
import { DiffContentProvider } from '../services/DiffContentProvider';
import { PatchManager } from '../services/PatchManager';
import { LocalCredentialStore } from '../services/LocalCredentialStore';
import { LocalLlamaCppService } from '../services/LocalLlamaCppService';
import { AttachmentService } from '../services/AttachmentService';

interface WebviewMessage { type:string;text?:string;mode?:AgentMode;id?:string }
export class ChatViewProvider implements vscode.WebviewViewProvider{
  static readonly viewType='vectra.chat';
  private view?:vscode.WebviewView; private readonly messages:ChatMessage[]=[]; private readonly pendingAttachments:Attachment[]=[]; private abortController?:AbortController; private busy=false; private pendingSelectionCheck=false;
  constructor(private readonly extensionUri:vscode.Uri,private readonly controller:AgentController,private readonly patches:PatchManager,private readonly diffs:DiffContentProvider,private readonly credentials:LocalCredentialStore,private readonly localLlama:LocalLlamaCppService,private readonly attachmentService:AttachmentService){}
  resolveWebviewView(webviewView:vscode.WebviewView):void{this.view=webviewView;webviewView.webview.options={enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(this.extensionUri,'media')]};webviewView.webview.html=this.getHtml(webviewView.webview);webviewView.webview.onDidReceiveMessage((m:WebviewMessage)=>void this.handleMessage(m));webviewView.onDidDispose(()=>{this.view=undefined});void this.postState();if(this.pendingSelectionCheck){this.pendingSelectionCheck=false;void this.runPrompt('selection',defaultSelectionPrompt())}}
  async reveal():Promise<void>{await vscode.commands.executeCommand('workbench.view.extension.vectraSidebar')}
  async checkSelection():Promise<void>{await this.reveal();if(!this.view){this.pendingSelectionCheck=true;return}await this.runPrompt('selection',defaultSelectionPrompt())}
  async refresh():Promise<void>{await this.postState()}
  async attachFiles():Promise<void>{try{const files=await this.attachmentService.pick();for(const f of files){if(!this.pendingAttachments.some(x=>x.name===f.name&&x.size===f.size))this.pendingAttachments.push(f)}await this.postState()}catch(e){void vscode.window.showErrorMessage(`Vectra attachment failed: ${messageOf(e)}`)}}

  private async handleMessage(message:WebviewMessage):Promise<void>{try{switch(message.type){
    case'ready':await this.postState();break;case'send':if(message.text?.trim()&&message.mode)await this.runPrompt(message.mode,message.text.trim());break;case'stop':this.abortController?.abort();break;
    case'attachFiles':await this.attachFiles();break;case'removeAttachment':if(message.id){const i=this.pendingAttachments.findIndex(x=>x.id===message.id);if(i>=0)this.pendingAttachments.splice(i,1);await this.postState()}break;
    case'showDiff':if(message.id)await this.diffs.showDiff(message.id);break;case'accept':if(message.id){await this.patches.accept(message.id);await this.postState()}break;case'reject':if(message.id){this.patches.reject(message.id);await this.postState()}break;case'acceptAll':await this.patches.acceptAllPending();await this.postState();break;case'rejectAll':this.patches.rejectAllPending();await this.postState();break;case'clearCompleted':this.patches.clearCompleted();await this.postState();break;case'clearChat':this.messages.splice(0);this.pendingAttachments.splice(0);await this.postState();break;
    case'setApiKey':await vscode.commands.executeCommand('vectra.setApiKey');break;case'selectLocalModel':await vscode.commands.executeCommand('vectra.selectLocalModel');break;case'selectMmproj':await vscode.commands.executeCommand('vectra.selectMmproj');break;case'selectModel':await vscode.commands.executeCommand('vectra.selectModel');break;case'openSettings':await vscode.commands.executeCommand('vectra.openSettings');break;case'testConnection':await vscode.commands.executeCommand('vectra.testConnection');break;case'supportDeveloper':await vscode.commands.executeCommand('vectra.supportDeveloper');break;
  }}catch(error){const text=messageOf(error);void vscode.window.showErrorMessage(`Vectra: ${text}`);await this.post({type:'error',message:text})}}

  private async runPrompt(mode:AgentMode,text:string):Promise<void>{if(this.busy){void vscode.window.showInformationMessage('Vectra is already working. Stop the current request first.');return}const config=getConfig();if(config.provider==='llamaCpp'&&!this.localLlama.isRunning){const started=await this.localLlama.startConfiguredModel();if(!started)throw new Error('No local GGUF model selected. Click Local Model first, or API Key for cloud.')}const attachments=this.pendingAttachments.splice(0);this.messages.push({id:randomUUID(),role:'user',content:text,createdAt:Date.now(),attachments:attachments.map(toAttachmentMeta)});this.busy=true;this.abortController=new AbortController();await this.postState();await this.post({type:'progress',message:'Analyzing…'});try{const result=await this.controller.run({mode,userText:text,history:this.messages.slice(0,-1),attachments,signal:this.abortController.signal,onProgress:(progress)=>void this.post({type:'progress',message:progress})});this.messages.push({id:randomUUID(),role:'assistant',content:result.text,createdAt:Date.now()})}catch(error){const t=messageOf(error);this.messages.push({id:randomUUID(),role:'assistant',content:this.abortController.signal.aborted?'Request stopped.':`Error: ${t}`,createdAt:Date.now()})}finally{this.busy=false;this.abortController=undefined;await this.postState()}}

  private async postState():Promise<void>{const c=getConfig();const local=c.provider==='llamaCpp'||c.provider==='ollama';const hasKey=local||c.provider==='openaiCompatible'||await this.credentials.has(c.provider);await this.post({type:'state',messages:this.messages,proposals:this.patches.list().map(toWebviewProposal),attachments:this.pendingAttachments.map(toAttachmentMeta),busy:this.busy,provider:c.provider,model:c.model,localModelName:c.localModelPath?path.basename(c.localModelPath):'',localModelRunning:c.provider==='llamaCpp'&&this.localLlama.isRunning,visionEnabled:c.provider==='llamaCpp'&&this.localLlama.visionEnabled,hasKey,isLocal:local,workspaceTrusted:vscode.workspace.isTrusted})}
  private async post(payload:unknown):Promise<void>{await this.view?.webview.postMessage(payload)}
  private getHtml(webview:vscode.Webview):string{
    const nonce=randomBytes(16).toString('hex');
    const script=webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri,'media','main.js'));
    const style=webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri,'media','main.css'));
    const icon=webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri,'media','vectra.svg'));
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';"/><link rel="stylesheet" href="${style}"/><title>Vectra</title></head><body>
<main id="app">
<header class="topbar"><div class="brand-wrap"><img class="brand-icon" src="${icon}" alt=""/><span class="brand">Vectra</span></div><button id="settingsButton" class="settings-button" title="Vectra settings" aria-label="Vectra settings">⚙</button></header>
<section class="connection-bar"><button id="apiKeyButton" class="connection-button">API Key</button><button id="localModelButton" class="connection-button">Local Model</button><button id="testButton" class="connection-button">Test</button></section>
<nav class="modes"><button class="mode active" data-mode="agent">Agent</button><button class="mode" data-mode="ask">Ask</button><button class="mode" data-mode="selection">Check Selection</button></nav>
<section id="messages" class="messages" aria-live="polite"></section><section id="proposals" class="proposals"></section>
<section class="composer-wrap"><div id="attachments" class="attachment-list"></div><textarea id="prompt" rows="3" placeholder="Ask Vectra…"></textarea><div class="composer-actions"><div class="left-actions"><button id="attachButton" class="secondary">＋ File</button><button id="clearButton" class="secondary">Clear Chat</button></div><button id="sendButton" class="primary">Send</button><button id="stopButton" class="danger hidden">Stop</button></div></section>
</main>
<dialog id="settingsDialog" class="settings-dialog"><form method="dialog" class="settings-card"><div class="settings-title"><div><strong>Vectra Settings</strong><div class="settings-subtitle">Runtime, model capability and support</div></div><button class="dialog-close" value="cancel" aria-label="Close">×</button></div><section class="settings-section"><h3>Runtime</h3><div id="runtimeInfo" class="runtime-info"></div><div id="capabilityInfo" class="capability-info"></div></section><section class="settings-section"><h3>General information</h3><div class="contact-grid"><span>Email</span><strong>test@gmail.com</strong><span>Contact</span><strong>+0000000000</strong><span>GitHub</span><strong>test</strong></div></section><section class="settings-section"><h3>Support & advanced</h3><div class="settings-actions"><button id="advancedSettingsButton" type="button" class="secondary">Advanced Settings</button><button id="supportButton" type="button" class="secondary">Support Developer</button></div></section><div class="dialog-actions"><button value="cancel" class="primary">Done</button></div></form></dialog>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}
function defaultSelectionPrompt():string{return'Explain and review the EXACT current selection in detail. Walk through the selected lines/fields, what they do, how they relate, assumptions, bugs or edge cases, and improvements. Do not edit files.'}
function toWebviewProposal(p:EditProposal):Omit<EditProposal,'baseContent'|'proposedContent'|'baseHash'|'binaryOutputBase64'>{const{baseContent:_b,proposedContent:_p,baseHash:_h,binaryOutputBase64:_bin,...safe}=p;return safe}
function toAttachmentMeta(a:Attachment){return{id:a.id,name:a.name,mime:a.mime,size:a.size,kind:a.kind}}
function messageOf(e:unknown):string{return e instanceof Error?e.message:String(e)}
