"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWritableDocumentFormat = isWritableDocumentFormat;
exports.documentFormatForPath = documentFormatForPath;
exports.extractDocumentText = extractDocumentText;
exports.createDocumentBytes = createDocumentBytes;
exports.buildDocx = buildDocx;
exports.buildPdf = buildPdf;
const path = __importStar(require("node:path"));
const node_zlib_1 = require("node:zlib");
const DocumentExtractor_1 = require("./DocumentExtractor");
function isWritableDocumentFormat(format) {
    return format === 'pdf' || format === 'docx';
}
function documentFormatForPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf')
        return 'pdf';
    if (ext === '.docx')
        return 'docx';
    if (ext === '.pptx')
        return 'pptx';
    if (ext === '.xlsx')
        return 'xlsx';
    if (ext === '.rtf')
        return 'rtf';
    return undefined;
}
async function extractDocumentText(filePath, bytes) {
    const format = documentFormatForPath(filePath);
    if (format === 'pdf')
        return (0, DocumentExtractor_1.extractPdfTextFromBuffer)(bytes);
    if (format === 'docx')
        return (0, DocumentExtractor_1.extractDocxTextFromBuffer)(bytes);
    if (format === 'pptx')
        return (0, DocumentExtractor_1.extractPptxTextFromBuffer)(bytes);
    if (format === 'xlsx')
        return (0, DocumentExtractor_1.extractXlsxTextFromBuffer)(bytes);
    if (format === 'rtf')
        return (0, DocumentExtractor_1.extractRtfTextFromBuffer)(bytes);
    return '';
}
function createDocumentBytes(filePath, content, title) {
    const format = documentFormatForPath(filePath);
    if (format === 'docx')
        return buildDocx(content, title || path.basename(filePath, '.docx'));
    if (format === 'pdf')
        return buildPdf(content, title || path.basename(filePath, '.pdf'));
    throw new Error('Document creation/editing supports .docx and .pdf. PPTX/XLSX/RTF are currently read/parse only.');
}
function buildDocx(content, title = 'Vectra Document') {
    const now = new Date().toISOString();
    const files = [
        ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`],
        ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`],
        ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
        ['word/styles.xml', stylesXml()],
        ['word/document.xml', documentXml(content, title)],
        ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>Vectra</dc:creator><cp:lastModifiedBy>Vectra</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`],
        ['docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Vectra</Application></Properties>`]
    ];
    return buildZip(files.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })));
}
function buildPdf(content, title = 'Vectra Document') {
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = wrapLines(normalized.split('\n'), 92);
    const pages = [];
    for (let i = 0; i < lines.length; i += 52)
        pages.push(lines.slice(i, i + 52));
    if (!pages.length)
        pages.push(['']);
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };
    const catalog = add('');
    const pagesObj = add('');
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageIds = [];
    for (const pageLines of pages) {
        const stream = ['BT', '/F1 10 Tf', '48 790 Td', '12 TL', ...pageLines.flatMap((line, index) => index === 0 ? [`(${pdfText(line)}) Tj`] : ['T*', `(${pdfText(line)}) Tj`]), 'ET'].join('\n');
        const contentObj = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
        const pageObj = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentObj} 0 R >>`);
        pageIds.push(pageObj);
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const info = add(`<< /Title (${pdfText(title)}) /Creator (Vectra) >>`);
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [0];
    objects.forEach((body, index) => { offsets[index + 1] = Buffer.byteLength(out, 'latin1'); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++)
        out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}
function documentXml(content, title) {
    const body = [];
    if (title.trim())
        body.push(paragraph(title, 'Title'));
    for (const raw of content.replace(/\r\n/g, '\n').split('\n')) {
        if (raw.startsWith('## '))
            body.push(paragraph(raw.slice(3), 'Heading2'));
        else if (raw.startsWith('# '))
            body.push(paragraph(raw.slice(2), 'Heading1'));
        else
            body.push(paragraph(raw));
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
}
function paragraph(text, style) { return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`; }
function stylesXml() { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`; }
function xml(value) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function pdfText(value) { return value.normalize('NFKD').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function wrapLines(lines, width) { const out = []; for (const line of lines) {
    if (!line) {
        out.push('');
        continue;
    }
    let rest = line;
    while (rest.length > width) {
        let cut = rest.lastIndexOf(' ', width);
        if (cut < Math.floor(width * .55))
            cut = width;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
} return out; }
function buildZip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const file of files) {
        const name = Buffer.from(file.name, 'utf8');
        const compressed = (0, node_zlib_1.deflateRawSync)(file.data);
        const crc = crc32(file.data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(file.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        locals.push(local, name, compressed);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(file.data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);
        offset += local.length + name.length + compressed.length;
    }
    const centralOffset = offset;
    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    return Buffer.concat([...locals, ...centrals, end]);
}
const CRC_TABLE = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++)
        c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
} return table; })();
function crc32(buffer) { let c = 0xffffffff; for (const byte of buffer)
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
//# sourceMappingURL=DocumentCodec.js.map