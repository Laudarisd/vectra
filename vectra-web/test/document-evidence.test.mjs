import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentContextForPrompt } from '../server/document-pipeline/evidence.mjs';
import { prepareVisualOcrEvidence } from '../server/document-pipeline/ocr-orchestrator.mjs';

test('whole-image OCR preserves literal text and source order',async()=>{
  const calls=[];
  const attachments=[
    {name:'drawing.pdf · page 1',kind:'image',mime:'image/png',base64:'cGFnZTE=',pageNumber:1,pageClassification:'scanned-raster',ocrRequired:true},
    {name:'drawing.pdf · page 2',kind:'image',mime:'image/png',base64:'cGFnZTI=',pageNumber:2,pageClassification:'vector-outlines',ocrRequired:true}
  ];
  const prepared=await prepareVisualOcrEvidence({
    attachments,
    cacheNamespace:`test-${Date.now()}`,
    readImage:async({attachment,instruction})=>{calls.push({attachment,instruction});return attachment.pageNumber===1?'  PART NO.    QTY\n\n  A-001       02\n':'SECOND PAGE';}
  });
  assert.equal(calls.length,2);
  assert.match(calls[0].instruction,/complete document image/i);
  assert.doesNotMatch(calls[0].instruction,/likely part/i);
  assert.match(calls[0].instruction,/Do not summarize/);
  const evidence=prepared.attachments.find(file=>/visual OCR$/.test(file.name));
  assert.ok(evidence);
  assert.ok(evidence.text.indexOf('page 1')<evidence.text.indexOf('page 2'));
  assert.match(evidence.text,/  PART NO\.    QTY\n\n  A-001       02/);
  assert.ok(prepared.attachments.filter(file=>file.kind==='image').every(file=>file.base64===''&&!file.ocrRequired));
});

test('image metadata does not steal the parsed-document text budget',()=>{
  const nativeText=`NATIVE_START\n${'native exact row\n'.repeat(400)}NATIVE_END`;
  const ocrText=`[VISUAL SOURCE: drawing.pdf · page 1]\nOCR_START\n${'ocr exact row\n'.repeat(400)}OCR_END`;
  const images=Array.from({length:20},(_,index)=>({name:`drawing.pdf · page ${index+1}`,kind:'image',mime:'image/png',text:'Page dimensions only',base64:''}));
  const attachments=[
    {name:'drawing.pdf',kind:'pdf',mime:'application/pdf',text:nativeText},
    ...images,
    {name:'drawing.pdf · visual OCR',kind:'document',mime:'text/plain',text:ocrText}
  ];
  const selected=attachmentContextForPrompt('',attachments,12000,2);
  const native=selected.find(file=>file.name==='drawing.pdf');
  const ocr=selected.find(file=>/visual OCR$/.test(file.name));
  assert.ok(native.text.length>4000);
  assert.ok(ocr.text.length>4000);
  assert.match(native.text,/NATIVE_START/);
  assert.match(ocr.text,/OCR_START/);
});
