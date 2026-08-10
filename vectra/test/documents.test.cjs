const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDocx, buildPdf } = require('../dist/services/DocumentService.js');
const { extractDocxTextFromBuffer, extractPdfTextFromBuffer } = require('../dist/services/DocumentExtractor.js');
const { parseAttachmentBytes } = require('../dist/services/AttachmentParser.js');

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

test('attachment parser preserves TXT and Markdown as model-ready text', async () => {
  const txt = await parseAttachmentBytes('notes.txt', Buffer.from('Plain text evidence', 'utf8'));
  const md = await parseAttachmentBytes('requirements.md', Buffer.from('# Requirements\nBuild all files.', 'utf8'));
  assert.equal(txt.kind, 'text');
  assert.equal(txt.mime, 'text/plain');
  assert.equal(txt.text, 'Plain text evidence');
  assert.equal(md.kind, 'text');
  assert.equal(md.mime, 'text/markdown');
  assert.match(md.text, /Build all files/);
});

test('attachment parser extracts model-ready PDF and Word content', async () => {
  const pdf = await parseAttachmentBytes('brief.pdf', buildPdf('PDF project requirements', 'Brief'));
  const word = await parseAttachmentBytes('brief.docx', buildDocx('Word project requirements', 'Brief'));
  assert.equal(pdf.kind, 'pdf');
  assert.match(pdf.text, /PDF project requirements/);
  assert.ok(pdf.base64.length > 20);
  assert.equal(word.kind, 'document');
  assert.match(word.text, /Word project requirements/);
  assert.ok(word.base64.length > 20);
});
