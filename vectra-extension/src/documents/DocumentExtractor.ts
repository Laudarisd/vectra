// Beginner guide: Handles d oc um en te xt ra ct or responsibilities for Vectra.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { inflateRawSync, inflateSync } from 'node:zlib';

const execFileAsync = promisify(execFile);

export async function extractPdfTextFromPath(filePath: string): Promise<string> {
  const native = await tryPdfToText(filePath);
  if (isMeaningfulText(native)) return normalizeExtractedText(native);
  const bytes = await fs.readFile(filePath);
  return extractPdfTextFallback(bytes);
}

export async function extractPdfTextFromBuffer(bytes: Uint8Array): Promise<string> {
  return withTempFile('.pdf', bytes, async (filePath) => {
    const native = await tryPdfToText(filePath);
    if (isMeaningfulText(native)) return normalizeExtractedText(native);
    return extractPdfTextFallback(bytes);
  });
}

export async function extractDocxTextFromBuffer(bytes: Uint8Array): Promise<string> {
  try {
    const xml = extractZipEntry(Buffer.from(bytes), 'word/document.xml').toString('utf8');
    return normalizeDocumentXml(xml);
  } catch {
    return '';
  }
}

export async function extractDocTextFromPath(filePath: string): Promise<string> {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('textutil', ['-convert', 'txt', '-stdout', filePath], { timeout: 30_000, maxBuffer: 12 * 1024 * 1024 });
      if (isMeaningfulText(stdout)) return normalizeExtractedText(stdout);
    } catch { /* continue */ }
  }
  try {
    const { stdout } = await execFileAsync('antiword', [filePath], { timeout: 30_000, maxBuffer: 12 * 1024 * 1024 });
    if (isMeaningfulText(stdout)) return normalizeExtractedText(stdout);
  } catch { /* unsupported */ }
  return '';
}

export function isMeaningfulText(text: string): boolean {
  const value = normalizeExtractedText(text || '');
  if (!value) return false;
  const sample = value.slice(0, 20_000);
  let printable = 0;
  let letters = 0;
  let suspicious = 0;
  for (const ch of sample) {
    const code = ch.charCodeAt(0);
    if (ch === '\n' || ch === '\r' || ch === '\t' || code >= 32) printable++;
    if (/\p{L}|\p{N}/u.test(ch)) letters++;
    if (ch === '\ufffd' || (code >= 0x80 && code <= 0x9f)) suspicious++;
  }
  const length = Math.max(1, sample.length);
  return printable / length > 0.96 && letters / length > 0.08 && suspicious / length < 0.02;
}

function extractPdfTextFallback(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes).toString('latin1');
  const chunks: string[] = [];
  collectTextOperators(latin, chunks);
  const streamRegex = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(latin))) {
    const dictionary = match[1];
    const raw = Buffer.from(match[2], 'latin1');
    if (!/\/FlateDecode\b/.test(dictionary)) {
      collectTextOperators(match[2], chunks);
      continue;
    }
    try { collectTextOperators(inflateSync(raw).toString('latin1'), chunks); } catch { /* ignore unsupported streams */ }
  }
  const normalized = normalizeExtractedText(chunks.join('\n'));
  return isMeaningfulText(normalized) ? normalized : '';
}

async function tryPdfToText(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', filePath, '-'], { maxBuffer: 20 * 1024 * 1024, timeout: 45_000 });
    return stdout || '';
  } catch { return ''; }
}

function collectTextOperators(source: string, output: string[]): void {
  const literal = /\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g;
  let m: RegExpExecArray | null;
  while ((m = literal.exec(source))) output.push(decodePdfLiteral(m[1]));
  const arrays = /\[((?:.|\n|\r)*?)\]\s*TJ/g;
  while ((m = arrays.exec(source))) {
    const inner: string[] = [];
    const part = /\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g;
    let p: RegExpExecArray | null;
    while ((p = part.exec(m[1]))) inner.push(p[1] !== undefined ? decodePdfLiteral(p[1]) : decodePdfHex(p[2] || ''));
    if (inner.length) output.push(inner.join(''));
  }
  const hex = /<([0-9A-Fa-f\s]{4,})>\s*Tj/g;
  while ((m = hex.exec(source))) output.push(decodePdfHex(m[1]));
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\([nrtbf()\\])/g, (_m, c: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] ?? c))
    .replace(/\\([0-7]{1,3})/g, (_m, oct: string) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\\r?\n/g, '');
}

function decodePdfHex(value: string): string {
  const clean = value.replace(/\s+/g, '');
  if (!clean) return '';
  const bytes = Buffer.from(clean.length % 2 ? `${clean}0` : clean, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return text;
  }
  return bytes.toString('utf8');
}

function normalizeDocumentXml(xml: string): string {
  return normalizeExtractedText(xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
}

function normalizeExtractedText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

export async function withTempFile<T>(extension: string, bytes: Uint8Array, callback: (filePath: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vectra-'));
  const filePath = path.join(dir, `attachment${extension.startsWith('.') ? extension : `.${extension}`}`);
  try { await fs.writeFile(filePath, bytes); return await callback(filePath); }
  finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}

export interface RenderedPdfPage { name: string; mime: 'image/png'; base64: string; size: number }

export async function renderPdfPagesFromBuffer(bytes: Uint8Array, sourceName = 'document.pdf', maxPages = 6): Promise<RenderedPdfPage[]> {
  return withTempFile('.pdf', bytes, async (pdfPath) => {
    const dir = path.dirname(pdfPath); const prefix = path.join(dir, 'page');
    try {
      await execFileAsync('pdftoppm', ['-png', '-f', '1', '-l', String(maxPages), '-r', '120', pdfPath, prefix], { maxBuffer: 4 * 1024 * 1024, timeout: 90_000 });
      const names = (await fs.readdir(dir)).filter((name) => /^page-\d+\.png$/i.test(name)).sort((a,b)=>numericPage(a)-numericPage(b));
      const pages: RenderedPdfPage[] = [];
      for (const [index, name] of names.slice(0, maxPages).entries()) {
        const data = await fs.readFile(path.join(dir, name));
        pages.push({ name: `${sourceName} · page ${index + 1}`, mime: 'image/png', base64: data.toString('base64'), size: data.length });
      }
      if (pages.length) return pages;
    } catch { /* continue */ }
    if (process.platform === 'darwin') {
      try {
        const out = path.join(dir, 'page-1.png');
        await execFileAsync('sips', ['-s', 'format', 'png', pdfPath, '--out', out], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
        const data = await fs.readFile(out);
        return [{ name: `${sourceName} · page 1`, mime: 'image/png', base64: data.toString('base64'), size: data.length }];
      } catch { return []; }
    }
    return [];
  });
}

function numericPage(name:string):number { return Number(name.match(/(\d+)/)?.[1] || 0); }

function extractZipEntry(zip: Buffer, wanted: string): Buffer {
  const eocd = findSignatureBackwards(zip, 0x06054b50);
  if (eocd < 0) throw new Error('Invalid ZIP archive.');
  const total = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP central directory.');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    if (name === wanted) {
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP local header.');
      const localNameLen = zip.readUInt16LE(localOffset + 26);
      const localExtraLen = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const data = zip.subarray(start, start + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`Unsupported ZIP compression method ${method}.`);
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`ZIP entry not found: ${wanted}`);
}

function findSignatureBackwards(buffer: Buffer, signature: number): number {
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 70_000); i--) if (buffer.readUInt32LE(i) === signature) return i;
  return -1;
}

export async function extractPptxTextFromBuffer(bytes: Uint8Array): Promise<string> {
  try {
    const entries = extractZipEntriesMatching(Buffer.from(bytes), /^ppt\/slides\/slide\d+\.xml$/i).sort((a,b)=>a.name.localeCompare(b.name, undefined, { numeric: true }));
    const chunks: string[] = [];
    for (const entry of entries) {
      const texts = [...entry.data.toString('utf8').matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(m => decodeXmlEntities(m[1]));
      if (texts.length) chunks.push(`[${path.basename(entry.name)}]\n${texts.join(' ')}`);
    }
    return normalizeExtractedText(chunks.join('\n\n'));
  } catch { return ''; }
}

export async function extractXlsxTextFromBuffer(bytes: Uint8Array): Promise<string> {
  try {
    const zip = Buffer.from(bytes); let shared: string[] = [];
    try { shared = [...extractZipEntry(zip, 'xl/sharedStrings.xml').toString('utf8').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => decodeXmlEntities(m[1])); } catch { /* optional */ }
    const sheets = extractZipEntriesMatching(zip, /^xl\/worksheets\/sheet\d+\.xml$/i).sort((a,b)=>a.name.localeCompare(b.name, undefined, { numeric: true }));
    const out: string[] = [];
    for (const sheet of sheets) {
      const rows: string[] = []; const xml = sheet.data.toString('utf8');
      for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const vals: string[] = [];
        for (const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
          const attrs = cm[1], body = cm[2]; let value = '';
          const inline = body.match(/<t[^>]*>([\s\S]*?)<\/t>/); const v = body.match(/<v[^>]*>([\s\S]*?)<\/v>/);
          if (inline) value = decodeXmlEntities(inline[1]);
          else if (v) { value = decodeXmlEntities(v[1]); if (/\bt=["']s["']/.test(attrs)) value = shared[Number(value)] ?? value; }
          vals.push(value);
        }
        if (vals.some(Boolean)) rows.push(vals.join('\t'));
      }
      if (rows.length) out.push(`[${path.basename(sheet.name)}]\n${rows.join('\n')}`);
    }
    return normalizeExtractedText(out.join('\n\n'));
  } catch { return ''; }
}

export async function extractRtfTextFromBuffer(bytes: Uint8Array): Promise<string> {
  return normalizeExtractedText(Buffer.from(bytes).toString('utf8')
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\'[0-9a-fA-F]{2}/g, m => String.fromCharCode(parseInt(m.slice(2), 16)))
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, ''));
}

function extractZipEntriesMatching(zip: Buffer, pattern: RegExp): Array<{name:string;data:Buffer}> {
  const eocd = findSignatureBackwards(zip, 0x06054b50); if (eocd < 0) throw new Error('Invalid ZIP archive.');
  const total = zip.readUInt16LE(eocd + 10); let offset = zip.readUInt32LE(eocd + 16); const out: Array<{name:string;data:Buffer}> = [];
  for (let i=0;i<total;i++) {
    if (zip.readUInt32LE(offset)!==0x02014b50) throw new Error('Invalid ZIP central directory.');
    const method=zip.readUInt16LE(offset+10), compressedSize=zip.readUInt32LE(offset+20), nameLen=zip.readUInt16LE(offset+28), extraLen=zip.readUInt16LE(offset+30), commentLen=zip.readUInt16LE(offset+32), localOffset=zip.readUInt32LE(offset+42);
    const name=zip.subarray(offset+46,offset+46+nameLen).toString('utf8');
    if (pattern.test(name)) {
      const localNameLen=zip.readUInt16LE(localOffset+26), localExtraLen=zip.readUInt16LE(localOffset+28), start=localOffset+30+localNameLen+localExtraLen, raw=zip.subarray(start,start+compressedSize);
      out.push({name,data:method===0?Buffer.from(raw):method===8?inflateRawSync(raw):Buffer.alloc(0)});
    }
    offset+=46+nameLen+extraLen+commentLen;
  }
  return out;
}
function decodeXmlEntities(value:string):string { return value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'"); }
