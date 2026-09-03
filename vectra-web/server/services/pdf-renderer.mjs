import { createCanvas } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { MAX_VISION_IMAGE_EDGE, MAX_VISION_IMAGE_PIXELS } from '../document-pipeline/config.mjs';

// ---------------------------------------------------------------------------
// PDF inspection and selective rendering
// ---------------------------------------------------------------------------

/** Inspect every allowed page, but render only pages whose text cannot be read natively. */
export async function renderPdfForVision(bytes,{dpi=200,maxPages=60,renderImages=true}={}){
  const task=getDocument({data:new Uint8Array(bytes),disableWorker:true,useSystemFonts:true,verbosity:0});
  const document=await task.promise;
  try{
    const metadata=await readMetadata(document);
    const pageLimit=Math.min(document.numPages,Math.max(1,maxPages));
    const pages=[];
    const pageAnalysis=[];
    const nativePages=[];

    // Sequential page inspection keeps memory stable for long or drawing-heavy PDFs.
    for(let pageNumber=1;pageNumber<=pageLimit;pageNumber++){
      const page=await document.getPage(pageNumber);
      const analysis=await inspectPage(page,pageNumber);
      pageAnalysis.push(analysis);
      if(analysis.nativeText)nativePages.push(`[PAGE ${pageNumber}]\n${analysis.nativeText}`);

      // Native text is cheaper and more exact; vision is reserved for raster or outlined text.
      if(analysis.needsVlm&&renderImages){
        pages.push(await renderPage(page,analysis,dpi));
      }
      page.cleanup();
    }
    return{
      metadata,
      totalPages:document.numPages,
      processedPages:pageLimit,
      visualPages:pageAnalysis.filter(page=>page.needsVlm).length,
      truncated:pageLimit<document.numPages,
      nativeText:nativePages.join('\n\n'),
      pageAnalysis,
      pages
    };
  }finally{await task.destroy()}
}

// Determine whether a page contains usable PDF text, raster scans, or vector outlines.
async function inspectPage(page,pageNumber){
  const [textContent,operatorList]=await Promise.all([page.getTextContent(),page.getOperatorList()]);
  const nativeText=textContent.items.map(item=>typeof item.str==='string'?item.str:'').join(' ').replace(/[ \t]+/g,' ').trim();
  const nativeCharacters=(nativeText.match(/[\p{L}\p{N}]/gu)||[]).length;
  let rasterImages=0;
  let vectorOperations=0;
  for(const operation of operatorList.fnArray){
    if(RASTER_OPERATIONS.has(operation))rasterImages++;
    if(VECTOR_OPERATIONS.has(operation))vectorOperations++;
  }

  // A small text overlay on top of a scan is not enough to skip visual OCR.
  const usableNative=nativeCharacters>=24;
  const sparseOverlay=rasterImages>0&&nativeCharacters<120;
  const needsVlm=!usableNative||sparseOverlay;
  const classification=usableNative
    ? (rasterImages>0?(sparseOverlay?'mixed-needs-vision':'mixed-native'):'native-vector')
    : (rasterImages>0?'scanned-raster':vectorOperations>0?'vector-outlines':'unknown');
  return{pageNumber,classification,nativeCharacters,rasterImages,vectorOperations,needsVlm,nativeText};
}

// Render one complete page and cap both edge length and pixel area for predictable VLM cost.
async function renderPage(page,analysis,dpi){
  const base=page.getViewport({scale:dpi/72});
  const edgeScale=Math.min(1,MAX_VISION_IMAGE_EDGE/Math.max(base.width,base.height));
  const pixelScale=Math.min(1,Math.sqrt(MAX_VISION_IMAGE_PIXELS/(base.width*base.height)));
  const viewport=page.getViewport({scale:(dpi/72)*Math.min(edgeScale,pixelScale)});
  const width=Math.max(1,Math.ceil(viewport.width));
  const height=Math.max(1,Math.ceil(viewport.height));
  const canvas=createCanvas(width,height);
  const context=canvas.getContext('2d');
  context.fillStyle='#fff';
  context.fillRect(0,0,width,height);
  await page.render({canvasContext:context,viewport}).promise;
  const image=canvas.toBuffer('image/png');
  return{
    pageNumber:analysis.pageNumber,
    pageClassification:analysis.classification,
    width,
    height,
    widthPoints:page.view[2]-page.view[0],
    heightPoints:page.view[3]-page.view[1],
    mime:'image/png',
    size:image.length,
    base64:image.toString('base64')
  };
}

// ---------------------------------------------------------------------------
// Classification constants and metadata
// ---------------------------------------------------------------------------

const RASTER_OPERATIONS=new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintSolidColorImageMask
]);

const VECTOR_OPERATIONS=new Set([
  OPS.constructPath,
  OPS.stroke,
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.shadingFill
]);

async function readMetadata(document){
  try{
    const result=await document.getMetadata();
    const info=result?.info||{};
    return Object.fromEntries(['Title','Author','Subject','Keywords','Creator','Producer','CreationDate','ModDate'].flatMap(key=>info[key]!==undefined&&info[key]!==''?[[key,String(info[key])]]:[]));
  }catch{return{}}
}
