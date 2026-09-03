const test=require('node:test');
const assert=require('node:assert/strict');
const{VisibleModelTextStream,visibleModelText}=require('../build/utils/modelText.js');

test('completed Qwen reasoning and tool markup never reaches visible text',()=>{
  const raw='<think>private reasoning</think>\nHello!<tool_call>{"name":"hidden"}</tool_call>';
  assert.equal(visibleModelText(raw),'Hello!');
});

test('stream filter hides think blocks split across arbitrary chunks',()=>{
  const deltas=[];
  const filter=new VisibleModelTextStream(delta=>deltas.push(delta));
  for(const chunk of ['<th','ink>secret ','chain</th','ink>Hi ','there!'])filter.push(chunk);
  assert.equal(filter.finish(),'Hi there!');
  assert.equal(deltas.join(''),'Hi there!');
  assert.doesNotMatch(deltas.join(''),/secret|think/i);
});

test('stream filter discards an unclosed think block',()=>{
  const deltas=[];
  const filter=new VisibleModelTextStream(delta=>deltas.push(delta));
  filter.push('<think>unfinished private reasoning');
  assert.equal(filter.finish(),'');
  assert.deepEqual(deltas,[]);
});

test('ordinary streamed text passes through unchanged',()=>{
  const deltas=[];
  const filter=new VisibleModelTextStream(delta=>deltas.push(delta));
  filter.push('Hello, ');filter.push('world!');
  assert.equal(filter.finish(),'Hello, world!');
  assert.equal(deltas.join(''),'Hello, world!');
});
