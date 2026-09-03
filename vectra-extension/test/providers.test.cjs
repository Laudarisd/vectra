// Beginner guide: Checks that p ro vi de rs.t es t behavior stays correct as the project changes.
const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');
const{OpenAIProvider}=require('../build/providers/OpenAIProvider.js');const{AnthropicProvider}=require('../build/providers/AnthropicProvider.js');const{GeminiProvider}=require('../build/providers/GeminiProvider.js');const{OllamaProvider}=require('../build/providers/OllamaProvider.js');const{OpenAICompatibleProvider}=require('../build/providers/OpenAICompatibleProvider.js');
const{LlamaCppProvider}=require('../build/providers/LlamaCppProvider.js');
async function withServer(handler,run){const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const payload=body?JSON.parse(body):undefined;const result=await handler(req,payload);res.statusCode=result.status||200;res.setHeader('content-type','application/json');res.end(JSON.stringify(result.body))});await new Promise(r=>server.listen(0,'127.0.0.1',r));const{port}=server.address();try{await run(`http://127.0.0.1:${port}`)}finally{await new Promise(r=>server.close(r))}}
const request={systemPrompt:'system',userPrompt:'user',model:'model-x',attachments:[{id:'1',name:'a.txt',mime:'text/plain',size:3,kind:'text',text:'abc'}]};
test('OpenAI provider sends Responses multimodal content and parses models',async()=>{await withServer((req,body)=>{if(req.url==='/v1/responses'){assert.equal(req.headers.authorization,'Bearer secret');assert.equal(body.model,'model-x');assert.equal(body.input[0].content[0].type,'input_text');assert.equal(body.input[0].content[1].type,'input_text');return{body:{output:[{content:[{type:'output_text',text:'openai-ok'}]}]}}}if(req.url==='/v1/models')return{body:{data:[{id:'gpt-test',owned_by:'openai'}]}};return{status:404,body:{}}},async(base)=>{const p=new OpenAIProvider('secret',`${base}/v1`);assert.equal(await p.complete(request),'openai-ok');assert.equal((await p.listModels())[0].id,'gpt-test')})});
test('Anthropic provider sends content blocks',async()=>{await withServer((req,body)=>{assert.equal(req.headers['x-api-key'],'secret');if(req.url==='/v1/messages'){assert.equal(body.messages[0].content[0].type,'text');return{body:{content:[{type:'text',text:'anthropic-ok'}]}}}if(req.url==='/v1/models')return{body:{data:[{id:'claude-test',display_name:'Claude Test'}]}};return{status:404,body:{}}},async(base)=>{const p=new AnthropicProvider('secret',`${base}/v1`);assert.equal(await p.complete(request),'anthropic-ok');assert.equal((await p.listModels())[0].id,'claude-test')})});
test('Gemini provider uses generateContent and lists models',async()=>{await withServer((req,body)=>{assert.equal(req.headers['x-goog-api-key'],'secret');if(req.url==='/v1/models/model-x:generateContent'){assert.equal(body.contents[0].parts[0].text,'user');return{body:{candidates:[{content:{parts:[{text:'gemini-ok'}]}}]}}}if(req.url==='/v1/models')return{body:{models:[{name:'models/gemini-test',displayName:'Gemini Test'}]}};return{status:404,body:{}}},async(base)=>{const p=new GeminiProvider('secret',`${base}/v1`);assert.equal(await p.complete(request),'gemini-ok');assert.equal((await p.listModels())[0].id,'gemini-test')})});
test('Ollama provider parses local chat and tags',async()=>{await withServer((req,body)=>{if(req.url==='/api/chat'){assert.equal(body.stream,false);return{body:{message:{content:'ollama-ok'}}}}if(req.url==='/api/tags')return{body:{models:[{name:'qwen-test',size:1024}]}};return{status:404,body:{}}},async(base)=>{const p=new OllamaProvider(base);assert.equal(await p.complete({systemPrompt:'system',userPrompt:'user',model:'model-x'}),'ollama-ok');assert.equal((await p.listModels())[0].id,'qwen-test')})});
test('OpenAI-compatible provider sends content array',async()=>{await withServer((req,body)=>{if(req.url==='/v1/chat/completions'){assert.equal(body.model,'model-x');assert.equal(body.messages[1].content[0].type,'text');return{body:{choices:[{message:{content:'compatible-ok'}}]}}}if(req.url==='/v1/models')return{body:{data:[{id:'local-model'}]}};return{status:404,body:{}}},async(base)=>{const p=new OpenAICompatibleProvider(`${base}/v1`);assert.equal(await p.complete(request),'compatible-ok');assert.equal((await p.listModels())[0].id,'local-model')})});

test('llama.cpp compatible mode requests schema-constrained JSON', async () => {
  await withServer((req, body) => {
    if (req.url === '/v1/chat/completions') {
      assert.equal(body.response_format.type, 'json_object');
      assert.ok(body.response_format.schema.properties.actions);
      assert.equal(body.cache_prompt, true);
      return { body: { choices: [{ message: { content: '{"message":"ok","actions":[],"done":true}' } }] } };
    }
    return { body: { data: [] } };
  }, async (base) => {
    const provider = new OpenAICompatibleProvider(`${base}/v1`, undefined, true);
    assert.match(await provider.complete({ systemPrompt: 's', userPrompt: 'u', model: 'm' }), /"done":true/);
  });
});

test('llama.cpp provider sends native functions and parses tool calls', async () => {
  await withServer((req, body) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(body.tool_choice, 'auto');
    assert.equal(body.cache_prompt, true);
    assert.equal(body.tools[0].function.name, 'create_directory');
    return { body: { choices: [{ message: { content: 'Creating it', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'create_directory', arguments: '{"path":"education"}' } }] } }] } };
  }, async (base) => {
    const provider = new LlamaCppProvider(`${base}/v1`);
    const result = await provider.completeWithTools({
      model: 'local',
      messages: [{ role: 'user', content: 'Create education' }],
      tools: [{ name: 'create_directory', description: 'Create a folder', parameters: { type: 'object' } }]
    });
    assert.deepEqual(result.toolCalls[0], { id: 'call-1', name: 'create_directory', args: { path: 'education' } });
  });
});
