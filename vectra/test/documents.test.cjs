const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDocx, buildPdf } = require('../dist/services/DocumentService.js');
const { extractDocxTextFromBuffer, extractPdfTextFromBuffer } = require('../dist/services/DocumentExtractor.js');

test('Vectra creates a DOCX that can be parsed back into text', async () => {
  const bytes = buildDocx('# Summary\nHello Vectra document.\nSecond paragraph.', 'Demo');
  assert.equal(Buffer.from(bytes).subarray(0,2).toString('hex'), '504b');
  const text = await extractDocxTextFromBuffer(bytes);
  assert.match(text, /Hello Vectra document/);
  assert.match(text, /Second paragraph/);
});

test('Vectra creates a PDF that yields readable text', async () => {
  const bytes = buildPdf('Hello Vectra PDF\nThis document is readable by a text model.', 'Demo PDF');
  assert.match(Buffer.from(bytes).subarray(0,8).toString('latin1'), /^%PDF-/);
  const text = await extractPdfTextFromBuffer(bytes);
  assert.match(text, /Hello Vectra PDF/);
});
