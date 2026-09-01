import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { readFile, stat, mkdtemp, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir, totalmem, cpus } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { LocalLlamaManager } from './services/local-llama.mjs';
import { extractPdfText as extractPdfTextRobust, extractDocumentText, artifactForRequest } from './services/documents.mjs';
import { ChatHistoryStore } from './services/history.mjs';
import { discoverInstalledModels, discoverLocalRuntimes, searchGgufModels } from './services/local-discovery.mjs';
import { detectGpus, hasNvidiaGpu } from './services/gpu-detect.mjs';
import { CURATED_MODELS } from './services/model-catalog.mjs';
import { recommendCatalogEntries } from './services/model-recommender.mjs';
import { downloadFile } from './services/model-downloader.mjs';
import { searchHuggingFace, resolveDownloadableFile } from './services/huggingface-search.mjs';
import { installLatestLlamaCpp } from './services/llama-cpp-installer.mjs';
import { Semaphore } from './services/concurrency.mjs';
const require=createRequire(import.meta.url);
let agentCore;
agentCore=require('../core')
const{AgentSession,VectraDeepAgentRuntime,createWebTools,createWebToolExecutor,WEB_TOOL_DEFINITIONS,buildVectraSubagentSpecs,describeDeepAgentTool}=agentCore;
// Throttles tool calls made by Deep Agents role subagents (planner/researcher/
// coder/tester/reviewer/security/documentation) so several of them can't hammer
// one local llama.cpp process or a rate-limited cloud endpoint at once. Not a
// claim of true parallel inference -- see vectra-extension's maxConcurrentSubagents.
const MAX_CONCURRENT_SUBAGENTS=Number(process.env.VECTRA_MAX_CONCURRENT_SUBAGENTS||2);
const execFileAsync=promisify(execFile);
const here=dirname(fileURLToPath(import.meta.url)); const webRoot=resolve(here,'..'); const publicRoot=existsSync(join(webRoot,'dist'))?join(webRoot,'dist'):join(webRoot,'public'); const host=process.env.VECTRA_HOST||'127.0.0.1'; let port=Number(process.env.VECTRA_PORT||4173); const MAX_BODY=110*1024*1024; const localLlama=new LocalLlamaManager(); const history=new ChatHistoryStore();
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const pathname=url.pathname;if(pathname.startsWith('/api/'))assertApiRequest(req);if(pathname==='/api/chats'||pathname.startsWith('/api/chats/'))return await handleHistory(req,res,pathname,url);if(req.method==='POST'&&pathname==='/api/chat')return await handleChat(req,res);if(req.method==='POST'&&pathname==='/api/models')return await handleModels(req,res);if(req.method==='POST'&&pathname==='/api/test-connection')return await handleTestConnection(req,res);if(req.method==='POST'&&pathname==='/api/attachments/inspect')return await handleAttachmentInspect(req,res);if(req.method==='GET'&&pathname==='/api/local/status')return json(res,200,localLlama.snapshot());if(req.method==='GET'&&pathname==='/api/local/gpu-info'){assertLocalRuntimeAllowed();return json(res,200,{gpus:await detectGpus()})}if(req.method==='POST'&&pathname==='/api/local/discover'){assertLocalRuntimeAllowed();const extra=localLlama.snapshot().running?[{name:'Vectra llama.cpp',baseUrl:localLlama.snapshot().baseUrl,apiKey:localLlama.connection().apiKey}]:[];return json(res,200,await discoverInstalledModels({extraRoots:localLlama.modelSearchRoots(),runtimeTargets:extra}))}if(req.method==='POST'&&pathname==='/api/local/search-models'){assertLocalRuntimeAllowed();const body=await readJson(req);return json(res,200,{models:await searchGgufModels({query:body.query,limit:body.limit,roots:localLlama.modelSearchRoots()})})}if(req.method==='POST'&&pathname==='/api/local/models/catalog'){assertLocalRuntimeAllowed();return json(res,200,await handleModelCatalog())}if(req.method==='POST'&&pathname==='/api/local/models/search'){assertLocalRuntimeAllowed();return json(res,200,{results:await searchHuggingFace((await readJson(req)).query)})}if(req.method==='POST'&&pathname==='/api/local/models/resolve'){assertLocalRuntimeAllowed();const resolved=await resolveDownloadableFile((await readJson(req)).repoId);return resolved?json(res,200,resolved):json(res,404,{error:'Could not determine a single downloadable GGUF file for this repo.'})}if(req.method==='POST'&&pathname==='/api/local/models/download'){assertLocalRuntimeAllowed();return await handleModelDownload(req,res,await readJson(req))}if(req.method==='POST'&&pathname==='/api/local/llama-cpp/install'){assertLocalRuntimeAllowed();return await handleLlamaCppInstall(req,res)}if(req.method==='POST'&&pathname==='/api/local/choose-model'){assertLocalRuntimeAllowed();return json(res,200,await localLlama.chooseModel())}if(req.method==='POST'&&pathname==='/api/local/choose-model-directory'){assertLocalRuntimeAllowed();return json(res,200,await localLlama.chooseModelDirectory())}if(req.method==='POST'&&pathname==='/api/local/choose-download-directory'){assertLocalRuntimeAllowed();return json(res,200,await localLlama.chooseDownloadDirectory())}if(req.method==='POST'&&pathname==='/api/local/choose-mmproj'){assertLocalRuntimeAllowed();return json(res,200,await localLlama.chooseMmproj())}if(req.method==='POST'&&pathname==='/api/local/choose-server'){assertLocalRuntimeAllowed();return json(res,200,await localLlama.chooseServer())}if(req.method==='POST'&&pathname==='/api/local/start'){assertLocalRuntimeAllowed();return json(res,200,await localLlama.start(await readJson(req)))}if(req.method==='POST'&&pathname==='/api/local/stop'){assertLocalRuntimeAllowed();return json(res,200,await localLlama.stop())}if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});return await serveStatic(req,res)}catch(e){console.error('[Vectra Web]',e instanceof Error?e.message:e);return json(res,500,{error:e instanceof Error?e.message:String(e),code:e?.code})}});
listenWithFallback(port);
function listenWithFallback(candidate, remaining=20){port=candidate;const onListening=()=>{server.removeListener('error',onError);console.log(`Vectra Web: http://${host}:${candidate}`);console.log('Keys are accepted per request and never written to disk by this server.');console.log('Local GGUF loading is available when Vectra Web is bound to localhost.');};const onError=(error)=>{server.removeListener('listening',onListening);if(error?.code==='EADDRINUSE'&&remaining>0){console.warn(`Port ${candidate} is busy. Trying ${candidate+1}…`);setTimeout(()=>listenWithFallback(candidate+1,remaining-1),20);return;}console.error('Vectra Web failed to start:',error);process.exitCode=1;};server.once('error',onError);server.once('listening',onListening);server.listen(candidate,host);}
process.on('SIGINT',async()=>{await localLlama.stop().catch(()=>{});history.close();server.close(()=>process.exit(0))});
process.on('SIGTERM',async()=>{await localLlama.stop().catch(()=>{});history.close();server.close(()=>process.exit(0))});
function assertLocalRuntimeAllowed(){if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('Local GGUF file selection and llama-server launch are disabled when Vectra Web is not bound to localhost. Start with VECTRA_HOST=127.0.0.1.');}
function assertApiRequest(req){const origin=req.headers.origin;if(!origin)return;let parsed;try{parsed=new URL(origin)}catch{throw new Error('Invalid request origin.')}if(parsed.host!==req.headers.host)throw new Error('Cross-origin API requests are not allowed by Vectra Web.');}

async function handleHistory(req,res,pathname,url){
  if(req.method==='GET'&&pathname==='/api/chats')return json(res,200,{chats:history.list(url.searchParams.get('limit'))});
  if(req.method==='POST'&&pathname==='/api/chats')return json(res,201,history.save(await readJson(req)));
  const match=pathname.match(/^\/api\/chats\/([a-zA-Z0-9-]{8,80})$/);
  if(!match)return json(res,404,{error:'Chat not found'});
  const id=match[1];
  if(req.method==='GET'){const chat=history.get(id);return chat?json(res,200,chat):json(res,404,{error:'Chat not found'});}
  if(req.method==='PUT')return json(res,200,history.save({...await readJson(req),id}));
  if(req.method==='DELETE')return json(res,200,{deleted:history.delete(id)});
  return json(res,405,{error:'Method not allowed'});
}

async function handleChat(req,res){
  const b=await readJson(req);let{provider='openai',apiKey='',model='',baseUrl='',allowInsecureTls=false,agentHarness='deepagents',conversationId='',messages=[],attachments=[]}=b;
  allowInsecureTls=provider==='openaiCompatible'&&allowInsecureTls===true;
  if(provider==='localAuto'&&!baseUrl){const runtimes=await discoverRuntimes();const runtime=runtimes.find(item=>item.models.includes(model))||runtimes[0];if(!runtime)return json(res,400,{error:'No supported local model server was detected. Start Ollama, LM Studio, llama.cpp, vLLM, or another OpenAI-compatible runtime.'});baseUrl=runtime.baseUrl;model=model||runtime.models[0]}
  let localContextTokens=0;
  if(provider==='llamaCpp'){
    const local=localLlama.snapshot();
    if(local.status==='ready'&&local.running){const connection=localLlama.connection();baseUrl=connection.baseUrl;model=model||connection.modelId;apiKey=connection.apiKey;localContextTokens=local.contextSize||0}
    else if(!baseUrl)return json(res,400,{error:'No local llama.cpp model is running. Open Model, choose a GGUF file, and start it first.'});
  }
  if(!model)return json(res,400,{error:'Select or enter a model.'});
  if(!['llamaCpp','openaiCompatible','localAuto'].includes(provider)&&!apiKey)return json(res,400,{error:'API key is required for this provider.'});
  if(provider==='openaiCompatible'&&!baseUrl)return json(res,400,{error:'Remote host is required for Local API.'});

  // A local llama.cpp/Ollama-class server has a real, often small, context
  // window and returns HTTP 400 rather than truncating gracefully when a
  // request exceeds it — this is the leading cause of "bad request" errors
  // against local models. Cloud providers keep a generous budget.
  const isLocalProvider=provider==='llamaCpp'||provider==='localAuto';
  const charBudget=isLocalProvider?estimateContextCharBudget(localContextTokens||8192):600_000;
  const safeMessages=Array.isArray(messages)?messages.slice(-30).map(m=>({role:m.role==='assistant'?'assistant':'user',content:clip(String(m.content||''),Math.floor(charBudget/2))})):[];
  const session=new AgentSession({messages:safeMessages.map((message,index)=>({
    id:`${conversationId||'web'}-${index}-${randomUUID()}`,
    ...message,
    createdAt:Date.now()
  }))});
  const safeAttachments=await preprocessAttachments(Array.isArray(attachments)?attachments.slice(0,12).map(sanitizeAttachment):[],provider);
  if(isLocalProvider){const perAttachment=Math.max(2_000,Math.floor((charBudget/2)/Math.max(1,safeAttachments.length)));for(const f of safeAttachments)if(f.text)f.text=clip(f.text,perAttachment)}

  // Every provider streams through the same SSE contract so the client has
  // one code path: llama.cpp/Ollama/OpenAI-compatible stream token-by-token
  // for visible progress on slow local generation; OpenAI/Anthropic/Gemini
  // (already fast, and each with its own non-OpenAI-compatible response
  // shape) arrive as a single delta event.
  const streamable=!['openai','anthropic','gemini'].includes(provider);
  const idleTimeoutMs=isLocalProvider||provider==='openaiCompatible'?3_600_000:120_000;
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
  const send=(obj)=>{try{res.write(`data: ${JSON.stringify(obj)}\n\n`)}catch{}};
  let closed=false;
  const requestAbort=new AbortController();
  req.on('close',()=>{closed=true;requestAbort.abort()});
  const unsubscribe=session.events.subscribe((event)=>{
    if(event.type==='ui.delta'&&!closed)send({delta:event.delta});
    if(event.type==='ui.progress'&&!closed)send({progress:event.message});
    if(event.type==='deepagent.tool.started'&&!closed&&typeof event.tool==='string')send({progress:describeDeepAgentTool(event.tool)});
    if(event.type==='deepagent.subagent.started'&&!closed)send({subagent:{event:'started',runId:event.runId,role:event.role,description:event.description}});
    if(event.type==='deepagent.subagent.finished'&&!closed)send({subagent:{event:'finished',runId:event.runId,role:event.role}});
    if(event.type==='deepagent.subagent.failed'&&!closed)send({subagent:{event:'failed',runId:event.runId,role:event.role,error:event.error}});
  });
  const toolArtifacts=[];

  try{
    let text=await session.run(async({events})=>{
      events.emit({type:'ui.progress',message:'Generating response'});
      let generated;
      if(agentHarness==='deepagents'){
        let nativeToolsAvailable=true;
        const bridge={complete:async({systemPrompt:agentPrompt,userPrompt})=>callProvider(provider,{
          apiKey,model,baseUrl:baseUrl||'http://127.0.0.1:8080/v1',allowInsecureTls,
          messages:[{role:'user',content:`${agentPrompt}\n\n${userPrompt}`}],
          attachments:safeAttachments,timeoutMs:idleTimeoutMs
        }),...(['llamaCpp','openaiCompatible','localAuto'].includes(provider)?{completeWithTools:async(request)=>{
          if(!nativeToolsAvailable)throw new Error('NATIVE_TOOL_CALLING_UNSUPPORTED: disabled for this run.');
          try{return await compatibleToolChat({apiKey,model,baseUrl:baseUrl||'http://127.0.0.1:8080/v1',allowInsecureTls,timeoutMs:idleTimeoutMs,...request})}
          catch(error){const detail=error instanceof Error?error.message:String(error);if(/HTTP (400|404|422)|tool.?call|chat template|jinja/i.test(detail)){nativeToolsAvailable=false;throw new Error(`NATIVE_TOOL_CALLING_UNSUPPORTED: ${detail}`)}throw error}
        }}:{})};
        const tools=createWebTools(safeAttachments,toolArtifacts);
        const subagentSemaphore=new Semaphore(MAX_CONCURRENT_SUBAGENTS);
        const executeWebTool=createWebToolExecutor(safeAttachments,toolArtifacts);
        const gatedExecuteWebTool=async(name,input,context)=>{await subagentSemaphore.acquire();try{return await executeWebTool(name,input,context)}finally{subagentSemaphore.release()}};
        const subagentSpecs=buildVectraSubagentSpecs(WEB_TOOL_DEFINITIONS,gatedExecuteWebTool,!!bridge.completeWithTools);
        const runtime=new VectraDeepAgentRuntime({provider:bridge,model,tools,context:{},events,maxSteps:12,systemPrompt:systemPrompt(safeAttachments),subagentSpecs});
        const last=safeMessages.at(-1)?.content||'Please analyze the attached files.';
        const deep=await runtime.run({task:last,history:safeMessages.slice(0,-1),threadId:conversationId||undefined,signal:requestAbort.signal});
        generated=deep.text;
      }else{
        generated=streamable
          ? await compatibleChatStream({apiKey,model,baseUrl:baseUrl||'http://127.0.0.1:8080/v1',allowInsecureTls,messages:safeMessages,attachments:safeAttachments},(delta)=>events.emit({type:'ui.delta',delta}),idleTimeoutMs)
          : await callProvider(provider,{apiKey,model,baseUrl,allowInsecureTls,messages:safeMessages,attachments:safeAttachments});
      }
      if(!streamable||agentHarness==='deepagents')events.emit({type:'ui.delta',delta:generated});
      return generated;
    },requestAbort.signal);
    if(hasUsableAttachmentContent(safeAttachments)&&looksLikeFalseAttachmentRefusal(text)){
      const retryMessages=[...safeMessages,{role:'user',content:'SYSTEM CORRECTION FROM VECTRA RUNTIME: The attached files have already been parsed and their actual content is included in this request. Answer the original user request using that content now. Do not ask the user to paste the file, and do not say you cannot access attachments.'}];
      text=await callProvider(provider,{apiKey,model,baseUrl:baseUrl||'http://127.0.0.1:8080/v1',allowInsecureTls,messages:retryMessages,attachments:safeAttachments,timeoutMs:idleTimeoutMs});
      if(!closed)send({replace:text});
    }
    const latestUser=[...safeMessages].reverse().find(m=>m.role==='user')?.content||'';
    const inferredArtifacts=artifactForRequest(latestUser,text,safeAttachments);
    const artifacts=[...toolArtifacts,...inferredArtifacts.filter(item=>!toolArtifacts.some(existing=>existing.name===item.name))];
    if(!closed){
      send({done:true,artifacts,attachments:safeAttachments.map(a=>({name:a.name,kind:a.kind,mime:a.mime,parsedCharacters:(a.text||'').length}))});
      res.write('data: [DONE]\n\n');
    }
  }catch(error){
    if(!closed)send({error:error instanceof Error?error.message:String(error)});
  }finally{
    unsubscribe();
    res.end();
  }
}
function clip(text,maxChars){
  if(text.length<=maxChars)return text;
  const half=Math.max(1,Math.floor((maxChars-80)/2));
  return `${text.slice(0,half)}\n\n...[truncated ${text.length-half*2} chars]...\n\n${text.slice(-half)}`;
}
async function handleAttachmentInspect(req,res){const body=await readJson(req);const provider=String(body.provider||'llamaCpp');const input=sanitizeAttachment(body.attachment||{});const parsed=await preprocessAttachments([input],provider);const primary=parsed[0]||input;return json(res,200,{name:primary.name,kind:primary.kind,mime:primary.mime,text:primary.text||'',parsedCharacters:(primary.text||'').length,visualPages:Math.max(0,parsed.length-1)})}
async function callProvider(provider,args){if(provider==='openai')return openAIChat(args);if(provider==='anthropic')return anthropicChat(args);if(provider==='gemini')return geminiChat(args);return compatibleChat({...args,baseUrl:args.baseUrl||'http://127.0.0.1:8080/v1'})}

/** Shared by /api/models and /api/test-connection for every cloud/OpenAI-compatible provider (llamaCpp and localAuto keep their own runtime-aware branches, out of this helper). */
async function fetchProviderModels(provider,apiKey,baseUrl,allowInsecureTls=false){
  if(provider==='openai'){const d=await fetchJson(`${trim(baseUrl||'https://api.openai.com/v1')}/models`,{headers:{Authorization:`Bearer ${apiKey}`}});return (d.data||[]).map(x=>x.id).filter(Boolean).sort()}
  if(provider==='anthropic'){const d=await fetchJson(`${trim(baseUrl||'https://api.anthropic.com/v1')}/models`,{headers:{'x-api-key':apiKey,'anthropic-version':'2023-06-01'}});return (d.data||[]).map(x=>x.id).filter(Boolean)}
  if(provider==='gemini'){const root=trim(baseUrl||'https://generativelanguage.googleapis.com/v1beta');const d=await fetchJson(`${root}/models`,{headers:{'x-goog-api-key':apiKey}});return (d.models||[]).map(x=>String(x.name||'').replace(/^models\//,'')).filter(Boolean)}
  const d=await fetchJson(
    `${trim(baseUrl||'http://127.0.0.1:8080/v1')}/models`,
    {headers:apiKey?{Authorization:`Bearer ${apiKey}`}:{ }},
    3_600_000,
    provider==='openaiCompatible'&&allowInsecureTls===true
  );
  return (d.data||[]).map(x=>x.id).filter(Boolean);
}
async function handleModels(req,res){
  let{provider='openai',apiKey='',baseUrl='',allowInsecureTls=false}=await readJson(req);
  if(!['llamaCpp','openaiCompatible','localAuto'].includes(provider)&&!apiKey)return json(res,400,{error:'API key required.'});
  if(provider==='openaiCompatible'&&!baseUrl)return json(res,400,{error:'Remote host is required for Local API.'});
  let models=[];let runtimes=[];
  if(provider==='llamaCpp'){
    const local=localLlama.snapshot();
    if(local.status==='ready'&&local.running)models=await localLlama.listModels();
    else if(baseUrl){const d=await fetchJson(`${trim(baseUrl)}/models`,{},3_600_000);models=(d.data||[]).map(x=>x.id).filter(Boolean)}
    else throw new Error('No local llama.cpp model is running. Open Model, choose and start a GGUF model first.');
  }else if(provider==='localAuto'){
    runtimes=await discoverRuntimes();
    models=[...new Set(runtimes.flatMap(runtime=>runtime.models))];
  }else{
    models=await fetchProviderModels(provider,apiKey,baseUrl,allowInsecureTls);
  }
  return json(res,200,{models,runtimes});
}
/** Lightweight connectivity check: for cloud/OpenAI-compatible providers this lists models as proof the key/endpoint works; for local runtimes it checks the runtime is actually reachable. Always resolves 200 with {ok,message} so the client can show a plain result either way. */
async function handleTestConnection(req,res){
  const {provider='openai',apiKey='',baseUrl='',allowInsecureTls=false,model=''}=await readJson(req);
  try{
    if(provider==='llamaCpp'){
      const local=localLlama.snapshot();
      if(!(local.status==='ready'&&local.running))throw new Error('No local llama.cpp model is running. Open Local Model and start a GGUF model first.');
      const ids=await localLlama.listModels();
      return json(res,200,{ok:true,message:`Connected to local llama.cpp (${ids[0]||local.modelId||'model running'}).`});
    }
    if(provider==='localAuto'){
      const runtimes=await discoverRuntimes();
      if(!runtimes.length)throw new Error('No local model server was detected. Start Ollama, LM Studio, llama.cpp, vLLM, or another OpenAI-compatible runtime.');
      return json(res,200,{ok:true,message:`Connected to ${runtimes.map(r=>r.name).join(', ')}.`});
    }
    if(provider!=='openaiCompatible'&&!apiKey)throw new Error('API key is required for this provider.');
    if(provider==='openaiCompatible'&&!baseUrl)throw new Error('Remote host is required for Local API.');
    const models=await fetchProviderModels(provider,apiKey,baseUrl,allowInsecureTls);
    if(model&&models.length&&!models.includes(model))return json(res,200,{ok:true,message:`Connected, but "${model}" was not among the ${models.length} model(s) this endpoint returned.`});
    return json(res,200,{ok:true,message:`Connected. ${models.length} model${models.length===1?'':'s'} available.`});
  }catch(error){
    return json(res,200,{ok:false,message:error instanceof Error?error.message:String(error)});
  }
}

async function discoverRuntimes(){const local=localLlama.snapshot();const extra=local.running&&local.status==='ready'?[{name:'Vectra llama.cpp',baseUrl:local.baseUrl,discoveryUrl:`${local.baseUrl}/models`,apiKey:localLlama.connection().apiKey}]:[];return discoverLocalRuntimes(extra)}

function resolveModelsDirectory(){return localLlama.selectedModelsDirectory||process.env.VECTRA_MODELS_DIR||join(homedir(),'.vectra','models')}

/**
 * Streams progress events over SSE for a long-running download so the client
 * can show a live percentage instead of one static "downloading…" line —
 * same text/event-stream contract as /api/chat, just carrying {bytesDone,
 * totalBytes} progress events instead of text deltas. Errors from `run` are
 * caught here and sent as a final {error} event rather than thrown, since the
 * response headers are already committed to SSE by the time `run` executes.
 * `run` also receives an AbortSignal that fires when the client disconnects
 * (tab closed, or the Stop button aborts the client's fetch) so the actual
 * upstream download stops instead of continuing to burn bandwidth/disk for
 * nobody.
 */
async function streamSseResult(req,res,run){
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
  const send=(obj)=>{try{res.write(`data: ${JSON.stringify(obj)}\n\n`)}catch{}};
  let closed=false;
  const controller=new AbortController();
  req.on('close',()=>{closed=true;controller.abort()});
  try{
    const result=await run((progress)=>{if(!closed)send(progress)},controller.signal);
    if(!closed){send({done:true,...result});res.write('data: [DONE]\n\n')}
  }catch(error){
    if(!closed)send({error:error instanceof Error?error.message:String(error)});
  }finally{
    res.end();
  }
}

/** Hardware-aware model shortlist: same catalog/recommend logic as the VS Code extension's Download Model flow. */
async function handleModelCatalog(){
  const gpus=await detectGpus();
  const vramValues=gpus.map(g=>g.vramMiB).filter(v=>typeof v==='number');
  const hardware={gpus,maxVramMiB:vramValues.length?Math.max(...vramValues):undefined,cpuCores:cpus().length,totalRamMiB:Math.round(totalmem()/1024/1024)};
  const recommended=recommendCatalogEntries(hardware,CURATED_MODELS);
  return {recommended,hardware};
}

/**
 * Downloads a model (and its vision projector, if any) into the local models
 * directory and returns the paths, mirroring the VS Code extension's
 * downloadAndSelectModel(): the client fills localModelPath/localMmprojPath
 * from the result and can start the model immediately, so a vision model's
 * mmproj lands next to it automatically (LocalLlamaManager.detectMmproj()
 * only looks beside the model file).
 */
async function handleModelDownload(req,res,body){
  await streamSseResult(req,res,async(onProgress,signal)=>{
    const downloadUrl=String(body?.downloadUrl||'');
    const filename=String(body?.filename||'');
    if(!downloadUrl||!filename)throw new Error('A downloadUrl and filename are required.');
    const destDir=resolveModelsDirectory();
    await mkdir(destDir,{recursive:true});
    const modelPath=join(destDir,filename);
    await downloadFile(downloadUrl,modelPath,{signal,onProgress:(bytesDone,totalBytes)=>onProgress({phase:'model',bytesDone,totalBytes})});

    let mmprojPath='';
    if(body?.mmprojUrl&&body?.mmprojFilename){
      mmprojPath=join(destDir,String(body.mmprojFilename));
      await downloadFile(String(body.mmprojUrl),mmprojPath,{signal,onProgress:(bytesDone,totalBytes)=>onProgress({phase:'mmproj',bytesDone,totalBytes})});
    }
    return {modelPath,mmprojPath};
  });
}

/** Downloads and installs the llama.cpp build matching this machine when /api/local/start reports LLAMA_SERVER_MISSING, mirroring the VS Code extension's "Install llama.cpp automatically" flow. */
async function handleLlamaCppInstall(req,res){
  await streamSseResult(req,res,async(onProgress,signal)=>{
    const gpus=await detectGpus();
    const result=await installLatestLlamaCpp({
      hasCuda:hasNvidiaGpu(gpus),
      signal,
      onProgress:(bytesDone,totalBytes)=>onProgress({phase:'llama.cpp',bytesDone,totalBytes})
    });
    return {serverPath:result.execPath,name:result.name,version:result.version,fellBackToCpu:result.fellBackToCpu};
  });
}

async function openAIChat({apiKey,model,baseUrl,messages,attachments}){const content=[{type:'input_text',text:transcript(messages)}];for(const f of attachments){if(f.kind==='text'||f.kind==='document')content.push({type:'input_text',text:`\n[Attachment: ${f.name}]\n${f.text}`});else if(f.mime.startsWith('image/')&&f.base64)content.push({type:'input_image',image_url:`data:${f.mime};base64,${f.base64}`,detail:'auto'});else if(f.base64)content.push({type:'input_file',filename:f.name,file_data:`data:${f.mime};base64,${f.base64}`});if(f.kind==='pdf'&&f.text)content.push({type:'input_text',text:`\n[Extracted PDF text fallback: ${f.name}]\n${f.text}`})}const d=await fetchJson(`${trim(baseUrl||'https://api.openai.com/v1')}/responses`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:systemPrompt(attachments),input:[{role:'user',content}]})});const parts=[];if(d.output_text)parts.push(d.output_text);for(const i of d.output||[])for(const p of i.content||[])if(p.text)parts.push(p.text);if(!parts.join('').trim())throw new Error('OpenAI returned no text output.');return parts.join('\n').trim()}
async function anthropicChat({apiKey,model,baseUrl,messages,attachments}){const last=messages.at(-1)?.content||'';const history=messages.slice(0,-1).map(m=>({role:m.role,content:m.content}));const content=[{type:'text',text:last||'Please analyze the attached files.'}];for(const f of attachments){if(f.kind==='text'||f.kind==='document')content.push({type:'text',text:`\n[Attachment: ${f.name}]\n${f.text}`});else if(f.mime.startsWith('image/')&&f.base64)content.push({type:'image',source:{type:'base64',media_type:f.mime,data:f.base64}});else if(f.mime==='application/pdf'&&f.base64)content.push({type:'document',source:{type:'base64',media_type:f.mime,data:f.base64}});else if(f.text)content.push({type:'text',text:`\n[Extracted attachment: ${f.name}]\n${f.text}`})}const d=await fetchJson(`${trim(baseUrl||'https://api.anthropic.com/v1')}/messages`,{method:'POST',headers:{'x-api-key':apiKey,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model,max_tokens:8192,system:systemPrompt(attachments),messages:[...history,{role:'user',content}]})});const text=(d.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n').trim();if(!text)throw new Error('Anthropic returned no text output.');return text}
async function geminiChat({apiKey,model,baseUrl,messages,attachments}){const parts=[{text:transcript(messages)}];for(const f of attachments){if(f.kind==='text'||f.kind==='document')parts.push({text:`\n[Attachment: ${f.name}]\n${f.text}`});else if(f.base64)parts.push({inline_data:{mime_type:f.mime||'application/octet-stream',data:f.base64}});else if(f.text)parts.push({text:`\n[Attachment: ${f.name}]\n${f.text}`})}const root=trim(baseUrl||'https://generativelanguage.googleapis.com/v1beta');const d=await fetchJson(`${root}/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':apiKey,'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:systemPrompt(attachments)}]},contents:[{role:'user',parts}]})});const text=(d.candidates||[]).flatMap(c=>c.content?.parts||[]).map(p=>p.text||'').join('\n').trim();if(!text)throw new Error('Gemini returned no text output.');return text}
async function compatibleChat({apiKey,model,baseUrl,allowInsecureTls=false,messages,attachments,timeoutMs=3_600_000}){const content=[{type:'text',text:messages.at(-1)?.content||'Please analyze the attached files.'}];for(const f of attachments){if((f.kind==='text'||f.kind==='pdf'||f.kind==='document')&&f.text)content.push({type:'text',text:`\n[Attachment: ${f.name}]\n${f.text}`});if(f.mime.startsWith('image/')&&f.base64)content.push({type:'image_url',image_url:{url:`data:${f.mime};base64,${f.base64}`}})}const history=messages.slice(0,-1).map(m=>({role:m.role,content:m.content}));const d=await fetchJson(`${trim(baseUrl)}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})},body:JSON.stringify({model,messages:[{role:'system',content:systemPrompt(attachments)},...history,{role:'user',content}],temperature:.2,cache_prompt:true})},timeoutMs,allowInsecureTls);logCompatibleTimings(d,model);const text=d.choices?.[0]?.message?.content?.trim();if(!text)throw new Error('Model endpoint returned no text output.');return text}

async function compatibleToolChat({apiKey,model,baseUrl,allowInsecureTls=false,messages,tools,signal,timeoutMs=3_600_000}){
  const wireMessages=messages.map(message=>({role:message.role,content:message.content,...(message.toolCallId?{tool_call_id:message.toolCallId}:{}),...(message.toolCalls?.length?{tool_calls:message.toolCalls.map(call=>({id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}))}:{})}));
  const d=await fetchJson(`${trim(baseUrl)}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})},body:JSON.stringify({model,messages:wireMessages,tools:tools.map(item=>({type:'function',function:{name:item.name,description:item.description||'',parameters:item.parameters}})),tool_choice:'auto',temperature:.2,cache_prompt:true,stream:false}),signal},timeoutMs,allowInsecureTls);
  logCompatibleTimings(d,model);
  const message=d.choices?.[0]?.message;if(!message)throw new Error('Model endpoint returned no assistant message.');
  const toolCalls=(message.tool_calls||[]).flatMap((call,index)=>{const name=call?.function?.name;if(!name)return[];let args={};try{args=typeof call.function.arguments==='string'?JSON.parse(call.function.arguments):(call.function.arguments||{})}catch{}return[{id:call.id||`call-${Date.now()}-${index}`,name,args}]});
  return{text:String(message.content||'').trim(),toolCalls};
}
async function compatibleChatStream({apiKey,model,baseUrl,allowInsecureTls=false,messages,attachments},onDelta,idleTimeoutMs){
  const content=[{type:'text',text:messages.at(-1)?.content||'Please analyze the attached files.'}];
  for(const f of attachments){
    if((f.kind==='text'||f.kind==='pdf'||f.kind==='document')&&f.text)content.push({type:'text',text:`\n[Attachment: ${f.name}]\n${f.text}`});
    if(f.mime.startsWith('image/')&&f.base64)content.push({type:'image_url',image_url:{url:`data:${f.mime};base64,${f.base64}`}});
  }
  const history=messages.slice(0,-1).map(m=>({role:m.role,content:m.content}));
  const text=await fetchSseText(`${trim(baseUrl)}/chat/completions`,{
    method:'POST',
    headers:{'Content-Type':'application/json',...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})},
    body:JSON.stringify({model,messages:[{role:'system',content:systemPrompt(attachments)},...history,{role:'user',content}],temperature:.2,cache_prompt:true,stream:true})
  },{onDelta,idleTimeoutMs,allowInsecureTls});
  if(!text.trim())throw new Error('Model endpoint returned no text output.');
  return text;
}
function logCompatibleTimings(data,model){const t=data?.timings;if(!t)return;console.log(`[Vectra timings] ${model}: prompt=${Number(t.prompt_per_second||0).toFixed(1)} tok/s, generation=${Number(t.predicted_per_second||0).toFixed(1)} tok/s, cached=${Number(t.cache_n||0)} tokens`)}

async function preprocessAttachments(files,provider){const out=[];for(const f of files){const lower=f.name.toLowerCase();if(f.mime==='application/pdf'&&f.base64){if(!f.text)f.text=(await extractPdfTextRobust(Buffer.from(f.base64,'base64'))).slice(0,2_000_000);f.kind='pdf';out.push(f);if((f.text||'').length<1500&&['llamaCpp','openAICompatible','openaiCompatible','localAuto'].includes(provider)){const pages=await renderPdfPages(f).catch(()=>[]);out.push(...pages)}}else if(/\.(doc|docx|pptx|xlsx|rtf)$/i.test(lower)&&f.base64){f.kind='document';if(!f.text)f.text=(await extractDocumentText(f.name,Buffer.from(f.base64,'base64'))).slice(0,2_000_000);out.push(f)}else out.push(f)}return out}

async function renderPdfPages(file){const dir=await mkdtemp(join(tmpdir(),'vectra-web-'));try{const pdf=join(dir,'doc.pdf');await writeFile(pdf,Buffer.from(file.base64,'base64'));await execFileAsync('pdftoppm',['-png','-f','1','-l','6','-r','120',pdf,join(dir,'page')],{timeout:60000,maxBuffer:2_000_000});const names=(await readdir(dir)).filter(n=>/^page-\d+\.png$/.test(n)).sort();const pages=[];for(const n of names){const b=await readFile(join(dir,n));pages.push({name:`${file.name} · ${n.replace('page-','page ').replace('.png','')}`,mime:'image/png',size:b.length,kind:'image',text:'',base64:b.toString('base64')})}return pages}finally{await rm(dir,{recursive:true,force:true}).catch(()=>{})}}
function extractPdfText(bytes){const latin=bytes.toString('latin1');const chunks=[];collect(latin,chunks);const r=/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;let m;while((m=r.exec(latin))){if(/\/FlateDecode\b/.test(m[1])){try{collect(inflateSync(Buffer.from(m[2],'latin1')).toString('latin1'),chunks)}catch{}}else collect(m[2],chunks)}return chunks.join('\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/\n{4,}/g,'\n\n\n').trim()}
function collect(src,out){let m;const lit=/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g;while((m=lit.exec(src)))out.push(m[1].replace(/\\([nrt()\\])/g,(_x,c)=>({n:'\n',r:'\r',t:'\t','(':'(',')':')','\\':'\\'}[c]||c)));const arr=/\[((?:.|\n|\r)*?)\]\s*TJ/g;while((m=arr.exec(src))){const p=[];const q=/\(((?:\\.|[^\\)])*)\)/g;let x;while((x=q.exec(m[1])))p.push(x[1]);if(p.length)out.push(p.join(''))}}
function systemPrompt(attachments=[]){const manifest=attachments.length?attachments.map(a=>`${a.name}: ${a.kind}, parsedText=${(a.text||'').length} chars${a.mime.startsWith('image/')?', image bytes provided':''}`).join('; '):'none';return`You are Vectra, a precise professional AI assistant with a local runtime that can parse uploaded files and generate downloadable files. ATTACHMENT MANIFEST: ${manifest}. If parsedText is greater than 0, you HAVE the file's extracted content in the request and must use it. Never tell the user to paste a PDF/DOCX/PPTX/XLSX that Vectra already parsed. If image bytes are provided to a vision-capable model, inspect them. A text-only local model may lack visual understanding, but that does not prevent it from reading extracted PDF/Office text. If the user asks to create/generate/export a PDF, DOCX, text, code, JSON, CSV, HTML or similar file, provide the exact final content; the Vectra runtime creates the downloadable artifact. Never claim Vectra cannot create/download files. When producing that final content, wrap it in exactly one markdown code fence tagged with the file's language (e.g. \`\`\`python, \`\`\`csharp, \`\`\`cpp) containing ONLY the raw file content, with no prose before or after the fence — the runtime extracts the file straight from that fenced block, so any commentary placed inside it becomes literal broken output in the saved file.`}
// Any real extracted text counts. A short document is still content the model
// has, so a refusal that claims otherwise is false and worth one correction.
function hasUsableAttachmentContent(files){return files.some(f=>(f.text||'').trim().length>0||f.mime?.startsWith('image/'))}
function looksLikeFalseAttachmentRefusal(text){const v=String(text||'').toLowerCase();return[/cannot (?:directly )?(?:access|view|open|read)/,/don't have (?:the )?(?:ability|capability) to (?:access|view|open|read)/,/paste (?:the )?text/,/copy and paste/,/share the text/,/cannot generate or send files/,/don't have (?:a )?file-sharing/].some(r=>r.test(v))}
function transcript(messages){return messages.map(m=>`${m.role==='assistant'?'ASSISTANT':'USER'}: ${m.content}`).join('\n\n')||'USER: Please analyze the attached files.'}
function sanitizeAttachment(f){return{name:String(f?.name||'attachment').slice(0,240),mime:String(f?.mime||'application/octet-stream').slice(0,120),size:Number(f?.size||0),kind:['text','pdf','image','document'].includes(f?.kind)?f.kind:'binary',text:typeof f?.text==='string'?f.text.slice(0,2_000_000):'',base64:typeof f?.base64==='string'?f.base64.slice(0,48_000_000):''}}
async function fetchWithTls(url,init={},allowInsecureTls=false){
  if(!allowInsecureTls||!String(url).toLowerCase().startsWith('https://'))return fetch(url,init);
  return new Promise((resolve,reject)=>{
    const request=https.request(new URL(url),{method:init.method||'GET',headers:init.headers,rejectUnauthorized:false},incoming=>{
      resolve(new Response(Readable.toWeb(incoming),{status:incoming.statusCode||500,statusText:incoming.statusMessage,headers:incoming.headers}));
    });
    request.on('error',reject);
    const abort=()=>request.destroy(new Error('Request cancelled.'));
    init.signal?.addEventListener('abort',abort,{once:true});
    request.on('close',()=>init.signal?.removeEventListener('abort',abort));
    if(init.body!=null)request.write(init.body);
    request.end();
  });
}
async function fetchJson(url,init={},timeoutMs=120_000,allowInsecureTls=false){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const external=init.signal;const onExternalAbort=()=>controller.abort();
  external?.addEventListener('abort',onExternalAbort,{once:true});
  try{
    const r=await fetchWithTls(url,{...init,signal:controller.signal},allowInsecureTls);
    const raw=await r.text();let d;try{d=raw?JSON.parse(raw):{}}catch{d={raw}}
    if(!r.ok)throw new Error(`HTTP ${r.status}: ${typeof d==='object'?JSON.stringify(d).slice(0,3000):raw.slice(0,3000)}`);
    return d;
  }catch(error){
    if(controller.signal.aborted)throw new Error(external?.aborted?'Request cancelled.':`Request timed out after ${Math.round(timeoutMs/1000)}s.`);
    throw error;
  }finally{clearTimeout(timer);external?.removeEventListener('abort',onExternalAbort)}
}

/**
 * Consumes an OpenAI-compatible `text/event-stream` response and forwards
 * each token delta to `onDelta` as it arrives. The idle timer resets on every
 * received chunk instead of running against a fixed total duration, so a slow
 * but still-producing local/CPU generation is never killed mid-answer.
 */
async function fetchSseText(url,init={},{onDelta,idleTimeoutMs=120_000,signal,allowInsecureTls=false}={}){
  const controller=new AbortController();let idleTimer;
  const resetIdle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>controller.abort(),idleTimeoutMs)};
  const onExternalAbort=()=>controller.abort();
  signal?.addEventListener('abort',onExternalAbort,{once:true});
  resetIdle();
  try{
    const response=await fetchWithTls(url,{...init,signal:controller.signal},allowInsecureTls);
    if(!response.ok||!response.body){const raw=await response.text().catch(()=>'');throw new Error(`HTTP ${response.status}: ${raw.slice(0,2000)}`)}
    const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let full='';
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      resetIdle();
      buffer+=decoder.decode(value,{stream:true});
      const lines=buffer.split('\n');buffer=lines.pop()??'';
      for(const line of lines){
        const trimmed=line.trim();
        if(!trimmed.startsWith('data:'))continue;
        const payload=trimmed.slice(5).trim();
        if(!payload||payload==='[DONE]')continue;
        try{const json=JSON.parse(payload);const delta=json.choices?.[0]?.delta?.content??'';if(delta){full+=delta;onDelta?.(delta)}}catch{}
      }
    }
    return full;
  }catch(error){
    if(controller.signal.aborted)throw new Error(signal?.aborted?'Request cancelled.':`Local model produced no output for ${Math.round(idleTimeoutMs/1000)}s and was stopped.`);
    throw error;
  }finally{clearTimeout(idleTimer);signal?.removeEventListener('abort',onExternalAbort)}
}

/**
 * A local llama.cpp/Ollama-class server rejects an over-budget prompt with
 * HTTP 400 instead of gracefully truncating it. `contextTokens` is whatever
 * the server was actually launched/detected with; ~3.3 chars/token is
 * conservative for mixed prose+code, and 35% is reserved for the system
 * prompt and the model's own response.
 */
function estimateContextCharBudget(contextTokens,maxCharacters=200_000){
  const budget=Math.floor((contextTokens||8192)*3.3*0.65);
  return Math.max(4_000,Math.min(maxCharacters,budget));
}
async function readJson(req){let total=0;const chunks=[];for await(const chunk of req){total+=chunk.length;if(total>MAX_BODY)throw new Error('Request body is too large.');chunks.push(chunk)}const raw=Buffer.concat(chunks).toString('utf8');return raw?JSON.parse(raw):{}}
async function serveStatic(req,res){let pathname=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`).pathname;if(pathname==='/')pathname='/index.html';const requested=normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');const full=resolve(publicRoot,`.${requested}`);if(!full.startsWith(resolve(publicRoot)))return json(res,403,{error:'Forbidden'});try{const s=await stat(full);if(!s.isFile())return json(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':mime(extname(full)),'Content-Length':s.size,'Cache-Control':'no-store'});if(req.method==='HEAD')return res.end();createReadStream(full).pipe(res)}catch{return json(res,404,{error:'Not found'})}}
function mime(ext){return({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'})[ext]||'application/octet-stream'}
function json(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});res.end(body)}
function trim(v){return String(v||'').replace(/\/+$/,'')}
