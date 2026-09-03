import { extractPdfText, extractDocumentText, extractEmbeddedDocumentImages } from '../services/documents.mjs';
import { renderPdfForVision } from '../services/pdf-renderer.mjs';
import { MAX_DOCUMENT_TEXT_CHARS, PDF_RENDER_DPI, pdfVisualPageLimit } from './config.mjs';

const VISUAL_PDF_PROVIDERS=new Set(['llamaCpp','openAICompatible','openaiCompatible','localAuto']);
const OFFICE_FILE_PATTERN=/\.(doc|docx|pptx|xlsx|rtf)$/i;

// Parse a small batch concurrently while preserving the user's upload order.
export async function preprocessAttachments(files,provider,{includeVisualAssets=true}={}){
  const results=new Array(files.length);
  let next=0;
  const worker=async()=>{
    while(true){
      const index=next++;
      if(index>=files.length)return;
      results[index]=await preprocessOneAttachment(files[index],provider,includeVisualAssets);
    }
  };
  await Promise.all(Array.from({length:Math.min(2,files.length)},worker));
  return results.flat();
}

async function preprocessOneAttachment(file,provider,includeVisualAssets){
  const lower=file.name.toLowerCase();

  // PDFs use native text first; only pages that fail inspection become VLM images.
  if(file.mime==='application/pdf'&&file.base64){
    const bytes=Buffer.from(file.base64,'base64');
    if(!file.text)file.text=(await extractPdfText(bytes)).slice(0,MAX_DOCUMENT_TEXT_CHARS);
    file.kind='pdf';
    const output=[file];
    const pageImages=await renderPdfPages(file,{renderImages:includeVisualAssets&&VISUAL_PDF_PROVIDERS.has(provider)}).catch(()=>[]);
    if(includeVisualAssets)output.push(...pageImages);
    return output;
  }

  // Office files retain extracted text/tables and expose every embedded image.
  if(OFFICE_FILE_PATTERN.test(lower)&&file.base64){
    const bytes=Buffer.from(file.base64,'base64');
    file.kind='document';
    if(!file.text)file.text=(await extractDocumentText(file.name,bytes)).slice(0,MAX_DOCUMENT_TEXT_CHARS);
    const images=extractEmbeddedDocumentImages(file.name,bytes).map(image=>({...image,ocrRequired:true}));
    if(images.length){
      const inventory=images.map(image=>`${image.name}: ${image.width||'?'} x ${image.height||'?'} px, ${image.size} bytes`).join('\n');
      file.text=`${file.text}\n\n[EMBEDDED IMAGES]\n${inventory}`.trim();
    }
    return[file,...images];
  }

  return[file];
}

async function renderPdfPages(file,{renderImages=true}={}){
  const rendered=await renderPdfForVision(Buffer.from(file.base64,'base64'),{
    dpi:PDF_RENDER_DPI,
    maxPages:pdfVisualPageLimit(),
    renderImages
  });
  if(!file.text&&rendered.nativeText)file.text=rendered.nativeText.slice(0,MAX_DOCUMENT_TEXT_CHARS);
  const pageSummary=rendered.pageAnalysis.map(page=>`Page ${page.pageNumber}: ${page.classification}; native characters=${page.nativeCharacters}; raster images=${page.rasterImages}; vector operations=${page.vectorOperations}; vision OCR=${page.needsVlm?'required':'skipped'}`).join('\n');
  const metadata=[
    ...Object.entries(rendered.metadata).map(([key,value])=>`${key}: ${value}`),
    `Pages: ${rendered.totalPages}`,
    `Inspected pages: ${rendered.processedPages}/${rendered.totalPages}`,
    `Pages requiring vision OCR: ${rendered.visualPages}`,
    ...(rendered.truncated?[`Warning: inspection limited to the first ${rendered.processedPages} pages.`]:[])
  ];
  const nativeBody=String(file.text||'').replace(/^\[PDF DOCUMENT METADATA\]\n[\s\S]*?\n\n\[PAGE ANALYSIS\]\n[\s\S]*?\n\n/,'');
  file.text=`[PDF DOCUMENT METADATA]\n${metadata.join('\n')}\n\n[PAGE ANALYSIS]\n${pageSummary}\n\n${nativeBody}`.trim();
  file.visualPages=rendered.visualPages;
  return rendered.pages.map(page=>({
    name:`${file.name} · page ${page.pageNumber}`,
    mime:page.mime,
    size:page.size,
    kind:'image',
    text:`Page classification: ${page.pageClassification}. Page dimensions: ${page.widthPoints.toFixed(2)} x ${page.heightPoints.toFixed(2)} points; normalized whole-page image: ${page.width} x ${page.height} px.`,
    base64:page.base64,
    width:page.width,
    height:page.height,
    pageNumber:page.pageNumber,
    pageClassification:page.pageClassification,
    ocrRequired:true
  }));
}
