// Beginner guide: Handles o cr o rc he st ra to r responsibilities for Vectra.
import { createHash } from 'node:crypto';
import { OCR_CONCURRENCY } from './config.mjs';
import { attachmentRootName, visualOcrEvidenceName } from './evidence.mjs';

const OCR_CACHE_LIMIT=256;
const ocrCache=new Map();

// OCR each required whole image once, concurrently, while preserving source order.
export async function prepareVisualOcrEvidence({attachments,readImage,onProgress=()=>{},cacheNamespace=''}){
  const sources=attachments.filter(file=>file.ocrRequired&&file.mime?.startsWith('image/')&&file.base64);
  if(!sources.length)return{attachments,processed:false};

  onProgress('Parsing... spectacles on, facts only!');
  const results=new Array(sources.length);
  let next=0;
  const worker=async()=>{
    while(true){
      const index=next++;
      if(index>=sources.length)return;
      const source=sources[index];
      const key=ocrCacheKey(source,cacheNamespace);
      let text=ocrCache.get(key);
      if(text===undefined){
        text=String(await readImage({attachment:source,instruction:ocrInstruction(source)}));
        if(!/^\[OCR FAILED/i.test(text.trim()))rememberOcr(key,text);
      }
      results[index]={source,text};
    }
  };
  await Promise.all(Array.from({length:Math.min(OCR_CONCURRENCY,sources.length)},worker));

  const grouped=new Map();
  for(const result of results){
    const root=attachmentRootName(result.source.name);
    const items=grouped.get(root)||[];
    items.push(result);
    grouped.set(root,items);
  }

  // Release visual bytes after transcription so the reasoning call does not encode them again.
  const output=attachments.map(file=>file.ocrRequired?{...file,ocrRequired:false,base64:''}:file);
  for(const[root,items]of grouped){
    const text=items.map(({source,text})=>[
      `[VISUAL SOURCE: ${source.name}]`,
      source.pageClassification?`[CLASSIFICATION: ${source.pageClassification}]`:'',
      text
    ].filter(Boolean).join('\n')).join('\n\n');
    const name=visualOcrEvidenceName(root);
    const oldIndex=output.findIndex(file=>file.name===name);
    const evidence={name,kind:'document',mime:'text/plain',size:Buffer.byteLength(text),text,base64:''};
    if(oldIndex>=0)output[oldIndex]=evidence;
    else output.push(evidence);
  }
  return{attachments:output,processed:true};
}

function ocrInstruction(source){
  return[
    'Transcribe this complete document image literally in natural reading order.',
    'Preserve headings, paragraphs, table rows and columns, line breaks, punctuation, identifiers, units, dimensions, quantities, revisions, and original spelling.',
    'Do not summarize, explain, correct, infer, or fill missing values. Use [UNCLEAR] for unreadable spans.',
    `Source: ${source.name}${source.pageNumber?`, page ${source.pageNumber}`:''}. Return transcription only.`
  ].join('\n');
}

function ocrCacheKey(source,namespace){
  return createHash('sha256').update(String(namespace)).update('\0').update(source.mime||'').update('\0').update(source.base64).digest('hex');
}

function rememberOcr(key,value){
  ocrCache.delete(key);
  ocrCache.set(key,value);
  while(ocrCache.size>OCR_CACHE_LIMIT)ocrCache.delete(ocrCache.keys().next().value);
}
