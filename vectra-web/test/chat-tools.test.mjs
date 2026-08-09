import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { buildPdf } from '../lib/documents.mjs';

async function freePort(){return await new Promise((resolve,reject)=>{const s=http.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function waitFor(url, timeout=8000){const start=Date.now();while(Date.now()-start<timeout){try{const r=await fetch(url);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,80));}throw new Error(`Timed out waiting for ${url}`);}

async function withVectraServer(fn){const port=await freePort();const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,VECTRA_PORT:String(port),VECTRA_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);try{await waitFor(`http://127.0.0.1:${port}/`);return await fn(`http://127.0.0.1:${port}`);}finally{child.kill('SIGTERM');await new Promise(r=>setTimeout(r,100));if(!child.killed)child.kill('SIGKILL');}}

function mockCompatibleServer(handler){return new Promise(async(resolve,reject)=>{const port=await freePort();const server=http.createServer(async(req,res)=>{try{if(req.url==='/v1/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'mock'}]}));}if(req.url==='/v1/chat/completions'){let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw||'{}');const text=await handler(body);res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{message:{content:text}}]}));}res.statusCode=404;res.end('{}');}catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e)}));}});server.listen(port,'127.0.0.1',()=>resolve({server,baseUrl:`http://127.0.0.1:${port}/v1`}));server.once('error',reject);});}

test('web recovers from false PDF attachment refusal using parsed content', async()=>{
  let calls=0;let sawPdfText=false;
  const mock=await mockCompatibleServer(body=>{calls++;const serialized=JSON.stringify(body);if(serialized.includes('Vectra PDF Evidence'))sawPdfText=true;return calls===1?'I cannot directly access or read the attached PDF. Please paste the text.':'The PDF contains: Vectra PDF Evidence.';});
  try{await withVectraServer(async(root)=>{
    const pdf=buildPdf('Vectra PDF Evidence','Evidence');
    const response=await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',messages:[{role:'user',content:'Check this PDF file and tell me what it says.'}],attachments:[{name:'evidence.pdf',mime:'application/pdf',size:pdf.length,kind:'pdf',base64:pdf.toString('base64')} ]})});
    const data=await response.json();assert.equal(response.status,200);assert.equal(calls,2);assert.equal(sawPdfText,true);assert.match(data.text,/Vectra PDF Evidence/);assert.ok(data.attachments[0].parsedCharacters>0);
  });}finally{await new Promise(r=>mock.server.close(r));}
});

test('web generation request returns downloadable PDF and code artifacts', async()=>{
  const mock=await mockCompatibleServer(()=> '```python\nprint("hello")\n```\n\nSimple generated document content.');
  try{await withVectraServer(async(root)=>{
    const response=await fetch(`${root}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'openaiCompatible',baseUrl:mock.baseUrl,model:'mock',messages:[{role:'user',content:'Generate simple.pdf and hello.py'}],attachments:[]})});
    const data=await response.json();assert.equal(response.status,200);assert.equal(data.artifacts.length,2);assert.deepEqual(data.artifacts.map(a=>a.name).sort(),['hello.py','simple.pdf']);const py=data.artifacts.find(a=>a.name==='hello.py');assert.equal(Buffer.from(py.base64,'base64').toString('utf8'),'print("hello")');
  });}finally{await new Promise(r=>mock.server.close(r));}
});
