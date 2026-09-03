// Beginner guide: Starts the Vectra Web server and connects API routes to the underlying services.
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { stat, mkdir } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, totalmem, cpus } from 'node:os';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { LocalLlamaManager } from './services/local-llama.mjs';
import { artifactForRequest } from './services/documents.mjs';
import { ChatHistoryStore } from './services/history.mjs';
import { discoverInstalledModels, discoverLocalRuntimes, searchGgufModels } from './services/local-discovery.mjs';
import { detectGpus, hasNvidiaGpu } from './services/gpu-detect.mjs';
import { CURATED_MODELS } from './services/model-catalog.mjs';
import { recommendCatalogEntries } from './services/model-recommender.mjs';
import { downloadFile } from './services/model-downloader.mjs';
import { searchHuggingFace, resolveDownloadableFile } from './services/huggingface-search.mjs';
import { installLatestLlamaCpp } from './services/llama-cpp-installer.mjs';
import { Semaphore } from './services/concurrency.mjs';
import { preprocessAttachments } from './document-pipeline/preprocess.mjs';
import { prepareVisualOcrEvidence } from './document-pipeline/ocr-orchestrator.mjs';
import { attachmentContextForPrompt, attachmentManifest, attachmentRootName, attachmentScratchFiles, mergeAttachmentSets } from './document-pipeline/evidence.mjs';
import { MAX_DOCUMENT_TEXT_CHARS, OCR_RETRY_COUNT } from './document-pipeline/config.mjs';
const require=createRequire(import.meta.url);
let agentCore;
agentCore=require('../core')
const{AgentSession,VectraDeepAgentRuntime,createWebTools,createWebToolExecutor,WEB_TOOL_DEFINITIONS,buildVectraSubagentSpecs,describeDeepAgentTool}=agentCore;
// Throttles tool calls made by Deep Agents role subagents (planner/researcher/
// coder/tester/reviewer/security/documentation) so several of them can't hammer
// one local llama.cpp process or a rate-limited cloud endpoint at once. Not a
// claim of true parallel inference -- see vectra-extension's maxConcurrentSubagents.
const MAX_CONCURRENT_SUBAGENTS=Number(process.env.VECTRA_MAX_CONCURRENT_SUBAGENTS||2);
const conversationAttachmentCache=new Map();
const MAX_CACHED_CONVERSATIONS=3;
const here=dirname(fileURLToPath(import.meta.url)); const webRoot=resolve(here,'..'); const publicRoot=existsSync(join(webRoot,'dist'))?join(webRoot,'dist'):join(webRoot,'public'); const host=process.env.VECTRA_HOST||'127.0.0.1'; let port=Number(process.env.VECTRA_PORT||4173); const MAX_BODY=260*1024*1024; const localLlama=new LocalLlamaManager(); const history=new ChatHistoryStore();
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
  if(req.method==='DELETE'){conversationAttachmentCache.delete(id);return json(res,200,{deleted:history.delete(id)})}
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
  const isConstrainedProvider=isLocalProvider||provider==='openaiCompatible';
  const compatibleContextTokens=positiveInt(b?.contextSize,262144)||8192;
  const charBudget=isLocalProvider?estimateContextCharBudget(localContextTokens||8192):provider==='openaiCompatible'?estimateContextCharBudget(compatibleContextTokens):600_000;
  const rawMessages=Array.isArray(messages)?messages.slice(-30).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content||'')})):[];
  const latestUser=[...rawMessages].reverse().find(message=>message.role==='user')?.content||'';
  const incomingAttachments=Array.isArray(attachments)?attachments.slice(0,12).map(sanitizeAttachment):[];
  const usePriorContext=wantsPriorContext(latestUser);
  const resetDocumentContext=wantsDocumentContextReset(latestUser);
  const standaloneAnswer=resetDocumentContext||wantsStandaloneAnswer(latestUser)||(incomingAttachments.length>0&&!usePriorContext);
  const safeMessages=standaloneAnswer?rawMessages.filter(message=>message.role==='user').slice(-1):compactConversationMessages(rawMessages,isConstrainedProvider?Math.max(3500,Math.floor(charBudget*.35)):Math.floor(charBudget/2));
  const session=new AgentSession({messages:safeMessages.map((message,index)=>({
    id:`${conversationId||'web'}-${index}-${randomUUID()}`,
    ...message,
    createdAt:Date.now()
  }))});
  if(resetDocumentContext&&!incomingAttachments.length&&conversationId)conversationAttachmentCache.delete(conversationId);
  const previousAttachments=conversationId?conversationAttachmentCache.get(conversationId)||[]:[];
  const parsedIncoming=incomingAttachments.length?await preprocessAttachments(incomingAttachments,provider):[];
  let safeAttachments=parsedIncoming.length?(usePriorContext?mergeAttachmentSets(previousAttachments,parsedIncoming):parsedIncoming):previousAttachments;
  if(incomingAttachments.length&&conversationId)rememberConversationAttachments(conversationId,safeAttachments);
  const attachmentTextBudget=isConstrainedProvider?Math.max(6000,Math.floor(charBudget*.42)):180_000;
  let modelAttachments=attachmentContextForPrompt('',safeAttachments,attachmentTextBudget,12);

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
      events.emit({type:'ui.progress',message:'Loading... tiny gears go brrr!'});
      const readOcrImage=async({attachment,instruction})=>{
        let lastError;
        for(let attempt=1;attempt<=OCR_RETRY_COUNT;attempt++){
          try{
            const result=await callProvider(provider,{
              apiKey,model,baseUrl:baseUrl||'http://127.0.0.1:8080/v1',allowInsecureTls,
              messages:[{role:'user',content:attempt===1?instruction:`${instruction}\nA previous attempt was invalid. Perform literal OCR only; output [UNCLEAR] instead of commentary or guesses.`}],
              attachments:[{name:attachment.name,kind:'image',mime:attachment.mime,base64:attachment.base64,text:'',size:Math.floor(attachment.base64.length*.75)}],
              timeoutMs:idleTimeoutMs,temperature:0,purpose:'ocr'
            });
            if(isUsableOcrResponse(result))return result;
            lastError=new Error('empty or non-transcription OCR response');
          }catch(error){lastError=error}
        }
        return `[OCR FAILED AFTER ${OCR_RETRY_COUNT} ATTEMPTS: ${lastError instanceof Error?lastError.message:String(lastError||'unknown error')}]`;
      };
      const preparedOcr=await prepareVisualOcrEvidence({
        attachments:safeAttachments,
        onProgress:message=>events.emit({type:'ui.progress',message}),
        readImage:readOcrImage,
        cacheNamespace:`${provider}:${baseUrl}:${model}`
      });
      if(preparedOcr.processed){
        safeAttachments=preparedOcr.attachments;
        if(conversationId)rememberConversationAttachments(conversationId,safeAttachments);
        modelAttachments=attachmentContextForPrompt(latestUser,safeAttachments,attachmentTextBudget,12);
        events.emit({type:'ui.progress',message:'Synchronizing... pages, please form an orderly queue!'});
      }
      let generated;
      if(agentHarness==='deepagents'){
        let nativeToolsAvailable=true;
        let lastFinishReason='';
        const bridge={complete:async({systemPrompt:agentPrompt,userPrompt})=>callProvider(provider,{
          apiKey,model,baseUrl:baseUrl||'http://127.0.0.1:8080/v1',allowInsecureTls,
          messages:[{role:'user',content:`${agentPrompt}\n\n${userPrompt}`}],
          attachments:attachmentContextForPrompt(userPrompt,safeAttachments,attachmentTextBudget,12),timeoutMs:idleTimeoutMs
        }),...(['llamaCpp','openaiCompatible','localAuto'].includes(provider)?{completeWithTools:async(request)=>{
          if(!nativeToolsAvailable)throw new Error('NATIVE_TOOL_CALLING_UNSUPPORTED: disabled for this run.');
          try{const result=await compatibleToolChat({apiKey,model,baseUrl:baseUrl||'http://127.0.0.1:8080/v1',allowInsecureTls,timeoutMs:idleTimeoutMs,attachments:attachmentContextForPrompt(request.messages?.filter(message=>message.role==='user').at(-1)?.content||'',safeAttachments,attachmentTextBudget,12),...request});lastFinishReason=result.finishReason||'';return result}
          catch(error){const detail=error instanceof Error?error.message:String(error);if(/HTTP (400|404|422)|tool.?call|chat template|jinja/i.test(detail)){nativeToolsAvailable=false;throw new Error(`NATIVE_TOOL_CALLING_UNSUPPORTED: ${detail}`)}throw error}
        }}:{})};
        const tools=createWebTools(safeAttachments,toolArtifacts);
        const subagentSemaphore=new Semaphore(MAX_CONCURRENT_SUBAGENTS);
        const executeWebTool=createWebToolExecutor(safeAttachments,toolArtifacts);
        const gatedExecuteWebTool=async(name,input,context)=>{await subagentSemaphore.acquire();try{return await executeWebTool(name,input,context)}finally{subagentSemaphore.release()}};
        const subagentSpecs=buildVectraSubagentSpecs(WEB_TOOL_DEFINITIONS,gatedExecuteWebTool,!!bridge.completeWithTools);
        const sourceDocumentCount=new Set(safeAttachments.map(file=>attachmentRootName(file.name))).size;
        const collaborationPrompt=sourceDocumentCount>=4?' This request has multiple source documents. Collaborate through researcher subagents when useful: assign at most three non-overlapping batches of named files, require filename/page-grounded findings, then personally reconcile conflicts and synthesize one final answer. Do not delegate a simple single-document read and do not repeatedly delegate the same batch.':'';
        const runtime=new VectraDeepAgentRuntime({provider:bridge,model,tools,context:{},events,maxSteps:24,systemPrompt:`${systemPrompt(safeAttachments)} The latest user request is authoritative. Use older conversation only to resolve genuine references; never blend earlier document facts, tables, requested formats, or conclusions into a new answer unless the user explicitly asks to compare, combine, continue, or use previous material. Complete work in the current response: never promise later work. The UI already shows loading while work continues.${collaborationPrompt} Dynamically infer the user's goal and each uploaded file's structure without special trigger words. Build a grounded document model from native layout text, page markers, metadata, tables, page classifications, selectively rendered pages, embedded images, dimensions, and literal visual OCR. Inspect all relevant evidence and cross-check exact identifiers, descriptions, revisions, quantities, dates, dimensions, units, and relationships. Native text is authoritative when available; visual OCR is used only where native extraction was insufficient. Never autocorrect or infer source values. For a general parse request, report structure and metadata, then detected tables or records, image or drawing findings, dimensions, notes, and uncertainties. Never impose a generic title, industry template, or fixed columns. If the user supplies headers, reproduce their wording and order exactly; otherwise derive fields only from the evidence and request. Preserve source page order, table boundaries, columns, whitespace cues, and line breaks. Keep [UNCLEAR] and [OCR FAILED] rather than guessing. Verify every structured cell against native text or visual OCR. When evidence contains repeating records, call document_extraction with the complete dataset and return its table verbatim. Preserve filename and page provenance.`,subagentSpecs});
        const hasVisualOcr=safeAttachments.some(file=>/visual OCR$/i.test(file.name));
        const originalTask=safeMessages.at(-1)?.content||'Please analyze the attached files.';
        const last=hasVisualOcr?`${originalTask}\n\n[VECTRA EVIDENCE REQUIREMENT: Selective visual OCR has completed for pages or images without sufficient native text. Account for every visual source in the coverage preview. For complete extraction, read the full visual OCR attachment in consecutive chunks until hasMore is false. Preserve page order and do not invent unreadable values.]`:originalTask;
        const scratchFiles=attachmentScratchFiles(safeAttachments);
        const runDeep=async(task,history)=>{try{return await runtime.run({task,history,threadId:conversationId||undefined,signal:requestAbort.signal,scratchFiles})}catch(error){if(!/recursion limit|GRAPH_RECURSION_LIMIT|REPEATED_TOOL_LOOP/i.test(error instanceof Error?error.message:String(error)))throw error;events.emit({type:'ui.progress',message:'Recovering from a repeated tool loop and completing the document review...'});const recovery=await callProvider(provider,{apiKey,model,baseUrl,allowInsecureTls,messages:[...safeMessages,{role:'user',content:`Runtime correction: answer the original request now from the supplied uploaded-document content. Do not call tools, output JSON, apologize, or discuss the tool error. ${task}`}],attachments:modelAttachments,timeoutMs:idleTimeoutMs});return{text:recovery,state:{recoveredFrom:'tool-loop'},harness:'deepagents'}}};
        let deep=await runDeep(last,safeMessages.slice(0,-1));
        if(looksLikeDeferredPromise(deep.text)){
          events.emit({type:'ui.progress',message:'Finishing and validating the requested document work before showing the answer...'});
          deep=await runDeep('SYSTEM CORRECTION: Finish the original request now. Do not promise future work or give a status-only reply. Infer the required output from the request and source material, use document_extraction for structured records, and return the concrete result.',safeMessages);
        }
        generated=normalizeAgentText(deep.text);
        if(looksLikeDeferredPromise(generated))throw new Error('The selected model returned a future-work promise instead of completing the request. Please retry or use a stronger model.');
        let continuationCount=0;
        while(isOutputLengthStop(lastFinishReason)&&continuationCount<8){
          continuationCount++;
          events.emit({type:'ui.progress',message:`Continuing the response (${continuationCount}) because the model reached its output boundary...`});
          lastFinishReason='';
          const priorSegment=clip(generated,24000);
          const continuation=await runDeep('Continue the previous answer from exactly where it stopped. Do not restart, repeat earlier sections, or shorten the remaining analysis. Finish all remaining document findings and rows.',[...safeMessages,{role:'assistant',content:priorSegment}]);
          const next=normalizeAgentText(continuation.text);
          if(!next||generated.endsWith(next))break;
          generated=`${generated}\n\n${next}`;
        }
      }else{
        generated=streamable
          ? await compatibleChatStream({apiKey,model,baseUrl:baseUrl||'http://127.0.0.1:8080/v1',allowInsecureTls,messages:safeMessages,attachments:modelAttachments},(delta)=>events.emit({type:'ui.delta',delta}),idleTimeoutMs)
          : await callProvider(provider,{apiKey,model,baseUrl,allowInsecureTls,messages:safeMessages,attachments:modelAttachments});
      }
      if(!streamable||agentHarness==='deepagents')events.emit({type:'ui.delta',delta:generated});
      return generated;
    },requestAbort.signal);
    if(hasUsableAttachmentContent(safeAttachments)&&looksLikeFalseAttachmentRefusal(text)){
      const retryMessages=[...safeMessages,{role:'user',content:'SYSTEM CORRECTION FROM VECTRA RUNTIME: The attached files have already been parsed and their actual content is included in this request. Answer the original user request using that content now. Do not ask the user to paste the file, and do not say you cannot access attachments.'}];
      text=await callProvider(provider,{apiKey,model,baseUrl:baseUrl||'http://127.0.0.1:8080/v1',allowInsecureTls,messages:retryMessages,attachments:safeAttachments,timeoutMs:idleTimeoutMs});
      if(!closed)send({replace:text});
    }
    const artifactRequest=[...safeMessages].reverse().find(m=>m.role==='user')?.content||'';
    const inferredArtifacts=artifactForRequest(artifactRequest,text,safeAttachments);
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
function compactConversationMessages(messages,totalChars){
  const useful=messages.filter(message=>!(message.role==='assistant'&&(/ContextWindowExceeded|maximum context length|GRAPH_RECURSION_LIMIT/i.test(message.content)||/^Error:\s*HTTP 400/i.test(message.content))));
  const selected=[];let remaining=Math.max(1000,totalChars);
  for(let index=useful.length-1;index>=0&&remaining>0;index--){const message=useful[index];const allowance=Math.min(remaining,Math.max(600,Math.floor(totalChars*.45)));const content=clip(message.content,allowance);selected.push({...message,content});remaining-=content.length+40}
  return selected.reverse();
}
function wantsDocumentContextReset(text){return /\b(?:forget|ignore|discard|clear)\b.{0,40}\b(?:above|previous|old|earlier|pdf|document|file|attachment)s?\b|\b(?:this|new|current)\s+(?:one|file|pdf|document)\s+only\b|\bonly\s+(?:this|the new|the current)\s+(?:one|file|pdf|document)\b/i.test(String(text||''))}
function wantsStandaloneAnswer(text){return /\b(?:separate|standalone|independent|fresh)\s+(?:answer|analysis|response|result)\b|\b(?:do not|don't|without)\s+(?:use|include|mix|consider)\b.{0,35}\b(?:history|previous|earlier|above|old)\b/i.test(String(text||''))}
function wantsPriorContext(text){return /\b(?:compare|combine|merge|continue|cross[- ]?check|reconcile)\b.{0,80}\b(?:previous|earlier|above|old|prior|all|both|documents?|files?|attachments?)\b|\b(?:use|include|with)\b.{0,30}\b(?:previous|earlier|above|old|prior)\b/i.test(String(text||''))}
async function handleAttachmentInspect(req,res){const body=await readJson(req);const provider=String(body.provider||'llamaCpp');const input=sanitizeAttachment(body.attachment||{});const parsed=await preprocessAttachments([input],provider,{includeVisualAssets:false});const primary=parsed[0]||input;return json(res,200,{name:primary.name,kind:primary.kind,mime:primary.mime,text:primary.text||'',parsedCharacters:(primary.text||'').length,visualPages:Number(primary.visualPages||0)})}
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

async function openAIChat({apiKey,model,baseUrl,messages,attachments,purpose=''}){const content=[{type:'input_text',text:transcript(messages)}];for(const f of attachments){if(f.kind==='text'||f.kind==='document')content.push({type:'input_text',text:`\n[Attachment: ${f.name}]\n${f.text}`});else if(f.mime.startsWith('image/')&&f.base64)content.push({type:'input_image',image_url:`data:${f.mime};base64,${f.base64}`,detail:'high'});else if(f.base64)content.push({type:'input_file',filename:f.name,file_data:`data:${f.mime};base64,${f.base64}`});if(f.kind==='pdf'&&f.text)content.push({type:'input_text',text:`\n[Extracted PDF text fallback: ${f.name}]\n${f.text}`})}const d=await fetchJson(`${trim(baseUrl||'https://api.openai.com/v1')}/responses`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:providerSystemPrompt(purpose,attachments),input:[{role:'user',content}]})});const parts=[];if(d.output_text)parts.push(d.output_text);for(const i of d.output||[])for(const p of i.content||[])if(p.text)parts.push(p.text);if(!parts.join('').trim())throw new Error('OpenAI returned no text output.');return parts.join('\n').trim()}
async function anthropicChat({apiKey,model,baseUrl,messages,attachments,temperature=.2,purpose=''}){const last=messages.at(-1)?.content||'';const history=messages.slice(0,-1).map(m=>({role:m.role,content:m.content}));const content=[{type:'text',text:last||'Please analyze the attached files.'}];for(const f of attachments){if(f.kind==='text'||f.kind==='document')content.push({type:'text',text:`\n[Attachment: ${f.name}]\n${f.text}`});else if(f.mime.startsWith('image/')&&f.base64)content.push({type:'image',source:{type:'base64',media_type:f.mime,data:f.base64}});else if(f.mime==='application/pdf'&&f.base64)content.push({type:'document',source:{type:'base64',media_type:f.mime,data:f.base64}});else if(f.text)content.push({type:'text',text:`\n[Extracted attachment: ${f.name}]\n${f.text}`})}const d=await fetchJson(`${trim(baseUrl||'https://api.anthropic.com/v1')}/messages`,{method:'POST',headers:{'x-api-key':apiKey,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model,max_tokens:8192,system:providerSystemPrompt(purpose,attachments),messages:[...history,{role:'user',content}],temperature})});const text=(d.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n').trim();if(!text)throw new Error('Anthropic returned no text output.');return text}
async function geminiChat({apiKey,model,baseUrl,messages,attachments,temperature=.2,purpose=''}){const parts=[{text:transcript(messages)}];for(const f of attachments){if(f.kind==='text'||f.kind==='document')parts.push({text:`\n[Attachment: ${f.name}]\n${f.text}`});else if(f.base64)parts.push({inline_data:{mime_type:f.mime||'application/octet-stream',data:f.base64}});else if(f.text)parts.push({text:`\n[Attachment: ${f.name}]\n${f.text}`})}const root=trim(baseUrl||'https://generativelanguage.googleapis.com/v1beta');const d=await fetchJson(`${root}/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':apiKey,'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:providerSystemPrompt(purpose,attachments)}]},contents:[{role:'user',parts}],generationConfig:{temperature}})});const text=(d.candidates||[]).flatMap(c=>c.content?.parts||[]).map(p=>p.text||'').join('\n').trim();if(!text)throw new Error('Gemini returned no text output.');return text}
async function compatibleChat({apiKey,model,baseUrl,allowInsecureTls=false,messages,attachments,timeoutMs=3_600_000,temperature=.2,purpose=''}){const content=[{type:'text',text:messages.at(-1)?.content||'Please analyze the attached files.'}];for(const f of attachments){if((f.kind==='text'||f.kind==='pdf'||f.kind==='document')&&f.text)content.push({type:'text',text:`\n[Attachment: ${f.name}]\n${f.text}`});if(f.mime.startsWith('image/')&&f.base64)content.push({type:'image_url',image_url:{url:`data:${f.mime};base64,${f.base64}`}})}const history=messages.slice(0,-1).map(m=>({role:m.role,content:m.content}));const wireMessages=[{role:'system',content:providerSystemPrompt(purpose,attachments)},...history,{role:'user',content}];const url=`${trim(baseUrl)}/chat/completions`;const headers={'Content-Type':'application/json',...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})};let d;try{d=await fetchJson(url,{method:'POST',headers,body:JSON.stringify({model,messages:wireMessages,temperature,cache_prompt:true})},timeoutMs,allowInsecureTls)}catch(error){if(!isContextWindowError(error))throw error;try{d=await fetchJson(url,{method:'POST',headers,body:JSON.stringify({model,messages:compactCompatibleMessages(wireMessages,1),temperature,cache_prompt:false})},timeoutMs,allowInsecureTls)}catch(compactError){if(!isContextWindowError(compactError))throw compactError;d=await fetchJson(url,{method:'POST',headers,body:JSON.stringify({model,messages:compactCompatibleMessages(wireMessages,2),temperature,cache_prompt:false})},timeoutMs,allowInsecureTls)}}logCompatibleTimings(d,model);const text=d.choices?.[0]?.message?.content?.trim();if(!text)throw new Error('Model endpoint returned no text output.');return text}

async function compatibleToolChat({apiKey,model,baseUrl,allowInsecureTls=false,messages,tools,attachments=[],signal,timeoutMs=3_600_000}){
  const lastUserIndex=messages.findLastIndex(message=>message.role==='user');
  const wireMessages=messages.map((message,index)=>{
    let content=message.content;
    if(index===lastUserIndex&&attachments.length){
      const parts=[{type:'text',text:String(message.content||'')}];
      for(const file of attachments){
        if((file.kind==='text'||file.kind==='pdf'||file.kind==='document')&&file.text)parts.push({type:'text',text:`\n[Attachment: ${file.name}]\n${file.text}`});
        if(file.mime?.startsWith('image/')&&file.base64)parts.push({type:'image_url',image_url:{url:`data:${file.mime};base64,${file.base64}`}});
      }
      content=parts;
    }
    return{role:message.role,content,...(message.toolCallId?{tool_call_id:message.toolCallId}:{}),...(message.toolCalls?.length?{tool_calls:message.toolCalls.map(call=>({id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}))}:{})};
  });
  const url=`${trim(baseUrl)}/chat/completions`;const headers={'Content-Type':'application/json',...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})};
  const wireTools=tools.map(item=>({type:'function',function:{name:item.name,description:item.description||'',parameters:item.parameters}}));
  let d;try{d=await fetchJson(url,{method:'POST',headers,body:JSON.stringify({model,messages:wireMessages,tools:wireTools,tool_choice:'auto',temperature:.2,cache_prompt:true,stream:false}),signal},timeoutMs,allowInsecureTls)}catch(error){if(!isContextWindowError(error))throw error;try{d=await fetchJson(url,{method:'POST',headers,body:JSON.stringify({model,messages:compactCompatibleMessages(wireMessages,1),tools:compactCompatibleTools(wireTools,5000),tool_choice:'auto',temperature:.2,cache_prompt:false,stream:false}),signal},timeoutMs,allowInsecureTls)}catch(compactError){if(!isContextWindowError(compactError))throw compactError;d=await fetchJson(url,{method:'POST',headers,body:JSON.stringify({model,messages:compactCompatibleMessages(wireMessages,2),tools:compactCompatibleTools(wireTools,2500),tool_choice:'auto',temperature:.2,cache_prompt:false,stream:false}),signal},timeoutMs,allowInsecureTls)}}
  logCompatibleTimings(d,model);
  const message=d.choices?.[0]?.message;if(!message)throw new Error('Model endpoint returned no assistant message.');
  const toolCalls=(message.tool_calls||[]).flatMap((call,index)=>{const name=call?.function?.name;if(!name)return[];let args={};try{args=typeof call.function.arguments==='string'?JSON.parse(call.function.arguments):(call.function.arguments||{})}catch{}return[{id:call.id||`call-${Date.now()}-${index}`,name,args}]});
  return{text:String(message.content||'').trim(),toolCalls,finishReason:String(d.choices?.[0]?.finish_reason||'')};
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

function providerSystemPrompt(purpose,attachments){return purpose==='ocr'?ocrSystemPrompt():systemPrompt(attachments)}
function ocrSystemPrompt(){return`You are a literal OCR engine, not a conversational assistant. The attached complete document image is the sole source of truth. Transcribe only visible text exactly as printed and in natural reading order. Preserve spelling, whitespace, blank lines, table boundaries and alignment, punctuation, identifiers, dimensions, revisions, and quantities. Never infer, autocomplete, autocorrect, normalize, translate, summarize, or answer the document. Use [UNCLEAR] for unreadable spans. Return plain transcription only, without an introduction, explanation, Markdown, or code fences.`}

function systemPrompt(attachments=[]){const manifest=attachmentManifest(attachments);return`You are Vectra, a precise professional AI assistant with a local runtime that can parse uploaded files and generate downloadable files. ATTACHMENT MANIFEST: ${manifest}. If parsedText is greater than 0, you have the extracted content and must use it. Never ask the user to paste a file Vectra already parsed. PDFs are inspected page by page: usable native text is preferred for exact characters, while pages without sufficient native text receive whole-page visual OCR. An attachment ending in "visual OCR" contains those literal transcriptions. If its supplied excerpt is incomplete, call vectra_read_attachment with increasing offsets until hasMore is false before claiming a complete extraction. Never replace [UNCLEAR] or [OCR FAILED] with a guess. Keep reasoning, chain-of-thought, tool selection, parameters, XML, and JSON tool envelopes internal; show only the completed answer and requested structure. Preserve source section, page, table, and row order unless the user requests otherwise. If the user asks to create or export a file, provide the exact final content; the runtime creates the download. For generated file content, use exactly one language-tagged Markdown code fence containing only raw file content.`}
// Any real extracted text counts. A short document is still content the model
// has, so a refusal that claims otherwise is false and worth one correction.
function hasUsableAttachmentContent(files){return files.some(f=>(f.text||'').trim().length>0||f.mime?.startsWith('image/'))}
function looksLikeFalseAttachmentRefusal(text){const v=String(text||'').toLowerCase();return[/cannot (?:directly )?(?:access|view|open|read)/,/don't have (?:the )?(?:ability|capability) to (?:access|view|open|read)/,/paste (?:the )?text/,/copy and paste/,/share the text/,/cannot generate or send files/,/don't have (?:a )?file-sharing/].some(r=>r.test(v))}
function looksLikeMarkdownTable(text){return /\|[^\n]+\|\s*\n\|\s*:?-{3,}/.test(String(text||''))}
function looksLikeDeferredPromise(text){const v=String(text||'').trim();if(!v||v.length>1200||looksLikeMarkdownTable(v)||/```|\n\s*[-*]\s+|\n\s*\d+[.)]\s+/.test(v))return false;return[/\b(?:i will|i'll|let me)\b.{0,100}\b(?:analy[sz]e|process|prepare|extract|review|provide|return|create|work on)\b/i,/\b(?:soon|shortly|in a (?:moment|while)|future (?:message|response))\b/i,/\bplease (?:wait|stand by)\b/i].some(pattern=>pattern.test(v))}
function transcript(messages){return messages.map(m=>`${m.role==='assistant'?'ASSISTANT':'USER'}: ${m.content}`).join('\n\n')||'USER: Please analyze the attached files.'}
function sanitizeAttachment(f){const width=positiveInt(f?.width,50000),height=positiveInt(f?.height,50000),sourceWidth=positiveInt(f?.sourceWidth,100000),sourceHeight=positiveInt(f?.sourceHeight,100000);const kind=['text','pdf','image','document'].includes(f?.kind)?f.kind:'binary';const base64=typeof f?.base64==='string'?f.base64.slice(0,90_000_000):'';const pageNumber=positiveInt(f?.pageNumber,10000);return{name:String(f?.name||'attachment').slice(0,240),mime:String(f?.mime||'application/octet-stream').slice(0,120),size:Number(f?.size||0),kind,text:typeof f?.text==='string'?f.text.slice(0,MAX_DOCUMENT_TEXT_CHARS):'',base64,...(width&&height?{width,height}:{}),...(sourceWidth&&sourceHeight?{sourceWidth,sourceHeight}:{}),...(pageNumber?{pageNumber}:{}),...(typeof f?.pageClassification==='string'?{pageClassification:f.pageClassification.slice(0,80)}:{}),ocrRequired:f?.ocrRequired===true||(kind==='image'&&Boolean(base64))}}
function isUsableOcrResponse(value){const text=String(value||'').trim();if(!text)return false;return!/^\s*(?:sorry[,!.]|i (?:cannot|can't|am unable)|unable to|as an ai|here (?:is|are)|the image (?:shows|contains)|this (?:image|document) (?:shows|contains))/i.test(text)}
function positiveInt(value,max){const number=Math.floor(Number(value));return Number.isFinite(number)&&number>0?Math.min(number,Math.max(1,max)):0}
function rememberConversationAttachments(conversationId,attachments){conversationAttachmentCache.delete(conversationId);conversationAttachmentCache.set(conversationId,attachments);while(conversationAttachmentCache.size>MAX_CACHED_CONVERSATIONS)conversationAttachmentCache.delete(conversationAttachmentCache.keys().next().value)}
function normalizeAgentText(text){let raw=String(text||'').replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi,'');if(/<\/think>/i.test(raw))raw=raw.replace(/^[\s\S]*?<\/think>/i,'');raw=raw.replace(/<think\b[^>]*>[\s\S]*$/gi,'').replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi,'').trim();try{const value=JSON.parse(raw);if(value&&typeof value==='object'&&typeof value.message==='string')return value.message.trim()}catch{}const partial=raw.match(/^\s*\{\s*"message"\s*:\s*"((?:\\.|[^"\\])*)/);if(partial){try{return JSON.parse(`"${partial[1]}"`).trim()}catch{}}return raw}
function isContextWindowError(error){return /ContextWindowExceeded|maximum context length|context window|input tokens|too many tokens/i.test(error instanceof Error?error.message:String(error))}
function isOutputLengthStop(reason){return /^(?:length|max_tokens|max_output_tokens)$/i.test(String(reason||''))}
function compactCompatibleMessages(messages,level=1){
  const system=messages.find(message=>message.role==='system');const tail=messages.filter(message=>message.role!=='system').slice(level>=2?-3:-5);const systemLimit=level>=2?1800:3200;const contentLimit=level>=2?1000:1800;
  return[...(system?[{...system,content:compactCompatibleContent(system.content,systemLimit,level>=2?1:2)}]:[]),...tail.map(message=>({...message,content:compactCompatibleContent(message.content,message.role==='tool'?contentLimit*2:contentLimit,level>=2?1:2)}))];
}
function compactCompatibleContent(content,maxChars,maxImages=2){if(typeof content==='string')return clip(content,maxChars);if(!Array.isArray(content))return content;let remaining=maxChars;let images=0;return content.flatMap(part=>{if(part?.type==='text'){if(remaining<=0)return[];const text=clip(String(part.text||''),remaining);remaining-=text.length;return[{...part,text}]}if(part?.type==='image_url'&&images++<maxImages)return[part];return[]})}
function compactCompatibleTools(tools,maxChars){const priority=name=>/^vectra_(?:list_attachments|search_attachments|read_attachment|read_files|search_tools|invoke_tool)$/.test(name)?0:name==='document_extraction'?1:name==='task'||name==='write_todos'?2:name.startsWith('vectra_')?3:4;const sorted=[...tools].sort((left,right)=>priority(left.function.name)-priority(right.function.name));const selected=[];let used=2;for(const item of sorted){const size=JSON.stringify(item).length;if(selected.length&&used+size>maxChars)continue;selected.push(item);used+=size;if(used>=maxChars)break}return selected}
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
