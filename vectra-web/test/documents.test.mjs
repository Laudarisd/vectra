import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocx, buildPdf, extractDocxText, extractPdfText, artifactForRequest } from '../server/services/documents.mjs';
import { renderPdfForVision } from '../server/services/pdf-renderer.mjs';

test('web document codec round-trips DOCX text', () => {
  const bytes=buildDocx('Hello Vectra DOCX\nSecond line','Demo');
  assert.equal(bytes.subarray(0,2).toString('hex'),'504b');
  assert.match(extractDocxText(bytes),/Hello Vectra DOCX/);
});

test('web document codec extracts generated PDF text', async () => {
  const bytes=buildPdf('Hello Vectra PDF\nSecond line','Demo');
  assert.match(bytes.subarray(0,8).toString('latin1'),/^%PDF-/);
  assert.match(await extractPdfText(bytes),/Hello Vectra PDF/);
});

test('portable PDF inspector skips vision rendering when native text is usable', async () => {
  const bytes=buildPdf('Table A\tTable B\nValue 1\tValue 2','Vision');
  const rendered=await renderPdfForVision(bytes,{dpi:96,maxPages:2});
  assert.equal(rendered.totalPages,1);
  assert.equal(rendered.processedPages,1);
  assert.equal(rendered.visualPages,0);
  assert.equal(rendered.pages.length,0);
  assert.equal(rendered.pageAnalysis[0].classification,'native-vector');
  assert.equal(rendered.pageAnalysis[0].needsVlm,false);
  assert.match(rendered.nativeText,/Table A/);
});

test('web can create downloadable requested documents', () => {
  const artifacts=artifactForRequest('Create report.docx and a PDF','Generated report body');
  assert.equal(artifacts.length,2);
  assert.ok(artifacts.every(a=>a.base64.length>20));
});


test('web can generate a requested code file artifact', () => {
  const artifacts=artifactForRequest('Create hello.py','```python\nprint(\"hello\")\n```');
  assert.equal(artifacts.length,1);
  assert.equal(artifacts[0].name,'hello.py');
  assert.equal(Buffer.from(artifacts[0].base64,'base64').toString('utf8'),'print(\"hello\")');
});
