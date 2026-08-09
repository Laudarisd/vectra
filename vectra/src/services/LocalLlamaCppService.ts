import * as vscode from 'vscode';
import { ChildProcess, execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { getConfig, updateLlamaMmprojPath, updateLlamaServerPath, updateLocalModel, updateModel, updateProvider } from '../utils/config';
import { OpenAICompatibleProvider } from '../providers/OpenAICompatibleProvider';

const execFileAsync = promisify(execFile);

export class LocalLlamaCppService implements vscode.Disposable {
  private process?: ChildProcess;
  private output = vscode.window.createOutputChannel('Vectra · llama.cpp');
  private currentModelPath = '';
  private currentMmprojPath = '';
  get isRunning(): boolean { return Boolean(this.process && !this.process.killed); }
  get baseUrl(): string { return `http://127.0.0.1:${getConfig().llamaCppPort}/v1`; }
  get modelPath(): string { return this.currentModelPath || getConfig().localModelPath; }
  get mmprojPath(): string { return this.currentMmprojPath || getConfig().llamaCppMmprojPath; }
  get visionEnabled(): boolean { return Boolean(this.mmprojPath); }

  async selectAndStartModel(): Promise<string | undefined> {
    const config = getConfig();
    let defaultUri: vscode.Uri | undefined;
    const candidate = config.localModelDirectory || path.dirname(config.localModelPath || '') || os.homedir();
    if (candidate && candidate !== '.') { try { await fs.access(candidate); defaultUri=vscode.Uri.file(candidate); } catch { /* default */ } }
    const picked = await vscode.window.showOpenDialog({ title:'Vectra: Select local GGUF model', defaultUri, canSelectFiles:true, canSelectFolders:false, canSelectMany:false, filters:{'GGUF models':['gguf']}, openLabel:'Use this model' });
    if(!picked?.[0])return undefined;
    let modelPath=normalizeShardPath(picked[0].fsPath);
    if(!modelPath.toLowerCase().endsWith('.gguf'))throw new Error('Vectra local models must be GGUF files for llama.cpp.');
    await fs.access(modelPath);
    const previousModel = config.localModelPath;
    await updateLocalModel(modelPath);
    const detected=await this.detectMmproj(modelPath);
    if (previousModel !== modelPath) await updateLlamaMmprojPath(detected ?? '');
    else if (detected && !getConfig().llamaCppMmprojPath) await updateLlamaMmprojPath(detected);
    await this.start(modelPath);
    await updateProvider('llamaCpp');
    const provider=new OpenAICompatibleProvider(this.baseUrl);
    let modelId=path.basename(modelPath);
    try{const models=await provider.listModels();modelId=models[0]?.id||modelId}catch{/* single model */}
    await updateModel(modelId); return modelId;
  }

  async selectMmproj(): Promise<string|undefined>{
    const cfg=getConfig(); const modelDir=cfg.localModelPath?path.dirname(cfg.localModelPath):os.homedir();
    const picked=await vscode.window.showOpenDialog({title:'Vectra: Select multimodal projector (mmproj GGUF)',defaultUri:vscode.Uri.file(modelDir),canSelectFiles:true,canSelectFolders:false,canSelectMany:false,filters:{'GGUF projector':['gguf']},openLabel:'Use projector'});
    if(!picked?.[0])return undefined; await updateLlamaMmprojPath(picked[0].fsPath); return picked[0].fsPath;
  }

  async startConfiguredModel():Promise<boolean>{const modelPath=getConfig().localModelPath;if(!modelPath)return false;try{await fs.access(modelPath)}catch{return false}await this.start(modelPath);return true;}

  async start(modelPath:string):Promise<void>{
    await this.stop(); const executable=await this.resolveServerExecutable(); const config=getConfig();
    const normalized=normalizeShardPath(modelPath); const mmproj=await this.resolveMmproj(normalized);
    const args=['-m',normalized,'--host','127.0.0.1','--port',String(config.llamaCppPort),'-c',String(config.llamaCppContextSize),'--fit','on','--gpu-layers',config.llamaCppGpuLayers,'--split-mode',config.llamaCppSplitMode];
    if(config.llamaCppCpuMoe)args.push('--cpu-moe');
    if(config.llamaCppNoMmap)args.push('--no-mmap');
    if(mmproj)args.push('--mmproj',mmproj);
    if(config.llamaCppExtraArgs.length)args.push(...config.llamaCppExtraArgs);
    this.output.show(true); this.output.appendLine('[Vectra] Starting llama.cpp'); this.output.appendLine(`[Vectra] Server: ${executable}`); this.output.appendLine(`[Vectra] Model: ${normalized}`); if(mmproj)this.output.appendLine(`[Vectra] Vision projector: ${mmproj}`); this.output.appendLine(`[Vectra] Endpoint: ${this.baseUrl}`); this.output.appendLine(`[Vectra] Args: ${args.map(shellQuote).join(' ')}`);
    const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}); this.process=child;this.currentModelPath=normalized;this.currentMmprojPath=mmproj||'';
    child.stdout?.on('data',(d:Buffer)=>this.output.append(d.toString())); child.stderr?.on('data',(d:Buffer)=>this.output.append(d.toString())); child.on('exit',(code,signal)=>{this.output.appendLine(`\n[Vectra] llama-server exited (${code??'no code'}${signal?`, ${signal}`:''}).`);if(this.process===child)this.process=undefined;});
    await this.waitUntilHealthy(child, config.llamaCppLoadTimeoutSeconds*1000); this.output.appendLine(`[Vectra] Local model is ready${mmproj?' with multimodal vision':''}.`);
  }

  async stop():Promise<void>{const child=this.process;this.process=undefined;this.currentModelPath='';this.currentMmprojPath='';if(!child||child.killed)return;child.kill();await new Promise<void>((resolve)=>{const timer=setTimeout(()=>{try{child.kill('SIGKILL')}catch{}resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})});}
  async chooseServerExecutable():Promise<string|undefined>{const picked=await vscode.window.showOpenDialog({title:'Vectra: Select llama-server executable',canSelectFiles:true,canSelectFolders:false,canSelectMany:false,openLabel:'Use llama-server'});if(!picked?.[0])return undefined;await updateLlamaServerPath(picked[0].fsPath);return picked[0].fsPath;}
  dispose():void{void this.stop();this.output.dispose();}

  private async resolveMmproj(modelPath:string):Promise<string|undefined>{const cfg=getConfig();if(cfg.llamaCppMmprojPath){try{await fs.access(cfg.llamaCppMmprojPath);return cfg.llamaCppMmprojPath}catch{/* detect */}}const detected=await this.detectMmproj(modelPath);if(detected)await updateLlamaMmprojPath(detected);return detected;}
  private async detectMmproj(modelPath:string):Promise<string|undefined>{try{const dir=path.dirname(modelPath);const names=await fs.readdir(dir);const candidates=names.filter(n=>/^mmproj.*\.gguf$/i.test(n)).sort((a,b)=>scoreMmproj(b)-scoreMmproj(a));return candidates[0]?path.join(dir,candidates[0]):undefined}catch{return undefined}}
  private async resolveServerExecutable():Promise<string>{const configured=getConfig().llamaCppServerPath;if(configured){if(path.isAbsolute(configured)){try{await fs.access(configured);return configured}catch{}}else if(await commandExists(configured))return configured}const command=process.platform==='win32'?'llama-server.exe':'llama-server';if(await commandExists(command))return command;const common=process.platform==='darwin'?['/opt/homebrew/bin/llama-server','/usr/local/bin/llama-server']:process.platform==='win32'?[path.join(process.env.LOCALAPPDATA??'','Programs','llama.cpp','llama-server.exe'),path.join(os.homedir(),'llama.cpp','build','bin','Release','llama-server.exe')]:['/usr/local/bin/llama-server','/usr/bin/llama-server',path.join(os.homedir(),'.local','bin','llama-server')];for(const c of common){if(!c)continue;try{await fs.access(c);await updateLlamaServerPath(c);return c}catch{}}const choice=await vscode.window.showWarningMessage('Vectra found your GGUF model, but llama-server could not be found.','Select llama-server','Open llama.cpp');if(choice==='Open llama.cpp'){await vscode.env.openExternal(vscode.Uri.parse('https://github.com/ggml-org/llama.cpp'));throw new Error('Install llama.cpp, then select the local model again.')}if(choice==='Select llama-server'){const s=await this.chooseServerExecutable();if(s)return s}throw new Error('llama-server executable is required to run local GGUF models.');}
  private async waitUntilHealthy(child:ChildProcess,timeout:number):Promise<void>{const health=`${this.baseUrl.replace(/\/v1$/,'')}/health`;const deadline=Date.now()+timeout;let last='';while(Date.now()<deadline){if(child.exitCode!==null||child.killed)throw new Error('llama-server stopped before the model became ready. See “Vectra · llama.cpp” output.');try{const r=await fetch(health);if(r.ok)return;last=`HTTP ${r.status}`}catch(e){last=e instanceof Error?e.message:String(e)}await delay(750)}throw new Error(`Timed out waiting for llama-server. Large models may need a longer vectra.llamaCppLoadTimeoutSeconds. ${last}`.trim())}
}
function normalizeShardPath(p:string):string{const m=p.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);if(!m)return p;return `${m[1]}-00001-of-${m[3]}.gguf`;}
function scoreMmproj(n:string):number{return /f16/i.test(n)?3:/bf16/i.test(n)?2:/q8/i.test(n)?1:0}
async function commandExists(command:string):Promise<boolean>{try{if(process.platform==='win32')await execFileAsync('where',[command]);else await execFileAsync('which',[command]);return true}catch{return false}}
function delay(ms:number):Promise<void>{return new Promise(r=>setTimeout(r,ms))}
function shellQuote(v:string):string{return /\s/.test(v)?JSON.stringify(v):v}
