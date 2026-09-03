// Beginner guide: Checks that c ha t t oo ls.t es t behavior stays correct as the project changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { buildPdf } from '../server/services/documents.mjs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

async function freePort(){return await new Promise((resolve,reject)=>{const s=http.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function waitFor(url, timeout=8000){const start=Date.now();while(Date.now()-start<timeout){try{const r=await fetch(url);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,80));}throw new Error(`Timed out waiting for ${url}`);}

async function withVectraServer(fn){const port=await freePort();const databasePath=join(tmpdir(),`vectra-test-${randomUUID()}.sqlite`);const child=spawn(process.execPath,['server/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,VECTRA_PORT:String(port),VECTRA_HOST:'127.0.0.1',VECTRA_DATABASE_PATH:databasePath},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);try{try{await waitFor(`http://127.0.0.1:${port}/`,15000);}catch(error){throw new Error(`${error.message}\nServer output:\n${logs||'(server produced no output)'}`);}return await fn(`http://127.0.0.1:${port}`);}finally{child.kill('SIGTERM');await new Promise(r=>setTimeout(r,100));if(!child.killed)child.kill('SIGKILL');await Promise.all(['','-wal','-shm'].map(suffix=>rm(`${databasePath}${suffix}`,{force:true}).catch(()=>{})));}}

function mockCompatibleServer(handler){return new Promise(async(resolve,reject)=>{const port=await freePort();const server=http.createServer(async(req,res)=>{try{if(req.url==='/v1/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'mock'}]}));}if(req.url==='/v1/chat/completions'){let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw||'{}');const outcome=await handler(body);if(outcome&&typeof outcome==='object'&&outcome.status){res.statusCode=outcome.status;res.setHeader('content-type','application/json');return res.end(JSON.stringify(outcome.body||{}));}const text=outcome&&typeof outcome==='object'?String(outcome.text||''):String(outcome);const finishReason=outcome&&typeof outcome==='object'?outcome.finishReason:undefined;if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write(`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\n`);res.write('data: [DONE]\n\n');return res.end();}res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{message:{content:text},...(finishReason?{finish_reason:finishReason}:{})}]}));}res.statusCode=404;res.end('{}');}catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e)}));}});server.listen(port,'127.0.0.1',()=>resolve({server,baseUrl:`http://127.0.0.1:${port}/v1`}));server.once('error',reject);});}

/** Mirrors the browser client's SSE consumption of `/api/chat`. */
async function readSseChat(response){
  assert.ok(response.body,'expected a readable stream body');
  const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
  const result={text:'',artifacts:[],attachments:[]};
  while(true){
    const{done,value}=await reader.read();
    if(done)break;
    buffer+=decoder.decode(value,{stream:true});
    const lines=buffer.split('\n');buffer=lines.pop()||'';
    for(const line of lines){
      const trimmed=line.trim();
      if(!trimmed.startsWith('data:'))continue;
      const payload=trimmed.slice(5).trim();
      if(!payload||payload==='[DONE]')continue;
      const event=JSON.parse(payload);
      if(event.error)throw new Error(event.error);
      if(typeof event.delta==='string')result.text+=event.delta;
      if(typeof event.replace==='string')result.text=event.replace;
      if(event.done){result.artifacts=event.artifacts||[];result.attachments=event.attachments||[];}
    }
  }
  return result;
}

test('web recovers from false PDF attachment refusal using parsed content', async()=>{
  let calls=0;let sawPdfText=false;
  const mock=await mockCompatibleServer(body=>{calls++;const serialized=JSON.stringify(body);if(serialized.includes('Vectra PDF Evidence'))sawPdfText=true;return calls===1?'I cannot directly access or read the attached PDF. Please paste the text.':'The PDF contains: Vectra PDF Evidence.';});
  try{await withVectraServer(async(root)=>{
    const pdf=buildPdf('Vectra PDF Evidence','Evidence');
    const response=await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',messages:[{role:'user',content:'Check this PDF file and tell me what it says.'}],attachments:[{name:'evidence.pdf',mime:'application/pdf',size:pdf.length,kind:'pdf',base64:pdf.toString('base64')} ]})});
    const data=await readSseChat(response);assert.equal(response.status,200);assert.ok(calls>=2,'A false attachment refusal triggers one grounded retry');assert.equal(sawPdfText,true);assert.match(data.text,/Vectra PDF Evidence/);assert.ok(data.attachments[0].parsedCharacters>0);
  });}finally{await new Promise(r=>mock.server.close(r));}
});

test('uploaded PDF context remains available on a follow-up turn', async()=>{
  const sawEvidence=[];
  const mock=await mockCompatibleServer(body=>{sawEvidence.push(JSON.stringify(body).includes('Persistent PDF Evidence'));return 'The cached PDF says Persistent PDF Evidence.';});
  try{await withVectraServer(async(root)=>{
    const conversationId=`cache-${randomUUID()}`;const pdf=buildPdf('Persistent PDF Evidence','Cached');
    const first=await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',conversationId,messages:[{role:'user',content:'Parse this document.'}],attachments:[{name:'persistent.pdf',mime:'application/pdf',size:pdf.length,kind:'pdf',base64:pdf.toString('base64')} ]})});
    await readSseChat(first);
    const second=await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',conversationId,messages:[{role:'user',content:'Parse this document.'},{role:'assistant',content:'Reviewed.'},{role:'user',content:'Just check the PDF again.'}],attachments:[]})});
    const result=await readSseChat(second);assert.match(result.text,/Persistent PDF Evidence/);assert.equal(sawEvidence.at(-1),true);
    const third=await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',conversationId,messages:[{role:'user',content:'Parse this document.'},{role:'assistant',content:'Reviewed.'},{role:'user',content:'Forget above PDF.'}],attachments:[]})});
    await readSseChat(third);assert.equal(sawEvidence.at(-1),false);
  });}finally{await new Promise(r=>mock.server.close(r));}
});

test('OpenAI-compatible context overflow retries compactly without capping output tokens', async()=>{
  let calls=0;let compactBody;
  const mock=await mockCompatibleServer(body=>{calls++;if(calls<=2)return{status:400,body:{error:{message:'ContextWindowExceededError: maximum context length is 8192 tokens'}}};compactBody=body;return 'Compact retry succeeded.';});
  try{await withVectraServer(async(root)=>{
    const response=await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',messages:[{role:'user',content:'Summarize briefly.'}],attachments:[]})});
    const result=await readSseChat(response);assert.match(result.text,/Compact retry succeeded/);assert.equal(calls,3);assert.equal('max_tokens' in compactBody,false);assert.equal(compactBody.cache_prompt,false);assert.ok(JSON.stringify(compactBody.tools||[]).length<4000);
  });}finally{await new Promise(r=>mock.server.close(r));}
});

test('a new upload is answered independently unless comparison is requested', async()=>{
  const bodies=[];const mock=await mockCompatibleServer(body=>{bodies.push(JSON.stringify(body));return 'Reviewed current source.';});
  try{await withVectraServer(async(root)=>{
    const conversationId=`separate-${randomUUID()}`;const oldPdf=buildPdf('OLD_DOCUMENT_MARKER','Old');const newPdf=buildPdf('NEW_DOCUMENT_MARKER','New');
    await readSseChat(await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',conversationId,messages:[{role:'user',content:'Review this.'}],attachments:[{name:'old.pdf',mime:'application/pdf',size:oldPdf.length,kind:'pdf',base64:oldPdf.toString('base64')}]})}));
    await readSseChat(await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',conversationId,messages:[{role:'user',content:'Review this.'},{role:'assistant',content:'Old findings.'},{role:'user',content:'Give me a separate answer for this upload.'}],attachments:[{name:'new.pdf',mime:'application/pdf',size:newPdf.length,kind:'pdf',base64:newPdf.toString('base64')}]})}));
    assert.match(bodies.at(-1),/NEW_DOCUMENT_MARKER/);assert.doesNotMatch(bodies.at(-1),/OLD_DOCUMENT_MARKER|Old findings/);
  });}finally{await new Promise(r=>mock.server.close(r));}
});

test('length-stopped model responses continue automatically without max_tokens', async()=>{
  let calls=0;const requestBodies=[];
  const mock=await mockCompatibleServer(body=>{requestBodies.push(body);calls++;return calls===1?{text:'First detailed section.',finishReason:'length'}:{text:'Remaining detailed section.',finishReason:'stop'};});
  try{await withVectraServer(async(root)=>{
    const response=await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',messages:[{role:'user',content:'Write the complete detailed analysis.'}],attachments:[]})});
    const result=await readSseChat(response);assert.match(result.text,/First detailed section/);assert.match(result.text,/Remaining detailed section/);assert.equal(calls,2);assert.ok(requestBodies.every(body=>!('max_tokens' in body)));
  });}finally{await new Promise(r=>mock.server.close(r));}
});

test('large-image OCR runs once on the complete normalized image before reasoning', async()=>{
  let ocrCalls=0;let sawCompleteMerge=false;
  const mock=await mockCompatibleServer(body=>{
    const serialized=JSON.stringify(body);
    if(serialized.includes('literal OCR engine')){
      ocrCalls++;
      if(ocrCalls===1)return'Here is the transcription: probably some text';
      return'COMPLETE_IMAGE_TEXT';
    }
    if(serialized.includes('COMPLETE_IMAGE_TEXT'))sawCompleteMerge=true;
    return 'The complete visual OCR evidence was reconstructed.';
  });
  try{await withVectraServer(async(root)=>{
    const attachment={name:'large-drawing.png',mime:'image/png',size:3,kind:'image',base64:'Yw==',width:3072,height:1536,sourceWidth:8000,sourceHeight:4000,ocrRequired:true};
    const response=await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',messages:[{role:'user',content:'Parse every value in this drawing.'}],attachments:[attachment]})});
    const result=await readSseChat(response);
    assert.match(result.text,/complete visual OCR evidence/i);
    assert.equal(ocrCalls,2);
    assert.equal(sawCompleteMerge,true);
    assert.ok(result.attachments.some(item=>/visual OCR/.test(item.name)&&item.parsedCharacters>0));
  });}finally{await new Promise(r=>mock.server.close(r));}
});

test('web generation request returns downloadable PDF and code artifacts', async()=>{
  const mock=await mockCompatibleServer(()=> '```python\nprint("hello")\n```\n\nSimple generated document content.');
  try{await withVectraServer(async(root)=>{
    const response=await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',messages:[{role:'user',content:'Generate simple.pdf and hello.py'}],attachments:[]})});
    const data=await readSseChat(response);assert.equal(response.status,200);assert.equal(data.artifacts.length,2);assert.deepEqual(data.artifacts.map(a=>a.name).sort(),['hello.py','simple.pdf']);const py=data.artifacts.find(a=>a.name==='hello.py');assert.equal(Buffer.from(py.base64,'base64').toString('utf8'),'print("hello")');
  });}finally{await new Promise(r=>mock.server.close(r));}
});

test('web chat history API persists conversations in SQLite', async()=>{
  await withVectraServer(async(root)=>{
    const createdResponse=await fetch(`${root}/api/chats`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'localAuto',model:'demo',messages:[{role:'user',content:'Remember this locally'}]})});
    const created=await createdResponse.json();assert.equal(createdResponse.status,201);assert.ok(created.id);
    const list=await fetch(`${root}/api/chats`).then(response=>response.json());assert.equal(list.chats.length,1);assert.equal(list.chats[0].title,'Remember this locally');
    const loaded=await fetch(`${root}/api/chats/${created.id}`).then(response=>response.json());assert.equal(loaded.messages[0].content,'Remember this locally');
    const deleted=await fetch(`${root}/api/chats/${created.id}`,{method:'DELETE'}).then(response=>response.json());assert.equal(deleted.deleted,true);
  });
});
