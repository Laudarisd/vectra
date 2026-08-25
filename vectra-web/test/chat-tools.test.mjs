import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { buildPdf } from '../lib/documents.mjs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

async function freePort(){return await new Promise((resolve,reject)=>{const s=http.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function waitFor(url, timeout=8000){const start=Date.now();while(Date.now()-start<timeout){try{const r=await fetch(url);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,80));}throw new Error(`Timed out waiting for ${url}`);}

async function withVectraServer(fn){const port=await freePort();const databasePath=join(tmpdir(),`vectra-test-${randomUUID()}.sqlite`);const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,VECTRA_PORT:String(port),VECTRA_HOST:'127.0.0.1',VECTRA_DATABASE_PATH:databasePath},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);try{try{await waitFor(`http://127.0.0.1:${port}/`,15000);}catch(error){throw new Error(`${error.message}\nServer output:\n${logs||'(server produced no output)'}`);}return await fn(`http://127.0.0.1:${port}`);}finally{child.kill('SIGTERM');await new Promise(r=>setTimeout(r,100));if(!child.killed)child.kill('SIGKILL');await Promise.all(['','-wal','-shm'].map(suffix=>rm(`${databasePath}${suffix}`,{force:true}).catch(()=>{})));}}

function mockCompatibleServer(handler){return new Promise(async(resolve,reject)=>{const port=await freePort();const server=http.createServer(async(req,res)=>{try{if(req.url==='/v1/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'mock'}]}));}if(req.url==='/v1/chat/completions'){let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw||'{}');const text=await handler(body);if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write(`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\n`);res.write('data: [DONE]\n\n');return res.end();}res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{message:{content:text}}]}));}res.statusCode=404;res.end('{}');}catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e)}));}});server.listen(port,'127.0.0.1',()=>resolve({server,baseUrl:`http://127.0.0.1:${port}/v1`}));server.once('error',reject);});}

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
    const data=await readSseChat(response);assert.equal(response.status,200);assert.equal(calls,2);assert.equal(sawPdfText,true);assert.match(data.text,/Vectra PDF Evidence/);assert.ok(data.attachments[0].parsedCharacters>0);
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
