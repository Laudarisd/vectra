// Central limits for document ingestion. Environment overrides remain server-only.
export const MAX_DOCUMENT_TEXT_CHARS=8_000_000;
export const DEFAULT_PDF_VISUAL_PAGES=60;
export const MAX_PDF_VISUAL_PAGES=200;
export const PDF_RENDER_DPI=200;
export const OCR_RETRY_COUNT=3;
export const OCR_CONCURRENCY=2;
export const MAX_VISION_IMAGE_EDGE=3072;
export const MAX_VISION_IMAGE_PIXELS=8_000_000;

export function pdfVisualPageLimit(value=process.env.VECTRA_MAX_PDF_VISUAL_PAGES){
  const parsed=Math.floor(Number(value));
  return Number.isFinite(parsed)&&parsed>0?Math.min(parsed,MAX_PDF_VISUAL_PAGES):DEFAULT_PDF_VISUAL_PAGES;
}
