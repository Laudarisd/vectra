// Beginner guide: Web-only image tools for the split viewer panel.
// show_image re-displays an uploaded image or one page of an uploaded PDF,
// optionally highlighting regions the model found (bounding boxes);
// fetch_image downloads a public web image and shows it the same way;
// draw_image lets the model generate a brand-new SVG figure - a plot, chart,
// diagram, or sketch - and show it the same way.
import { z } from 'zod';
import { VectraDeepTool, VectraToolDefinition } from '../contracts';
import { VectraAttachmentRecord } from '../attachments';
import { fetchWebImage } from './liveWeb';

// One highlight rectangle in fractions of the image size (0..1), so it fits any resolution.
export interface VectraImageBox { x: number; y: number; w: number; h: number; label?: string; type?: string; confidence?: number }

// A normal downloadable artifact plus display hints the browser viewer understands.
export interface VectraViewableArtifact { name: string; mime: string; base64: string; view?: 'image'; title?: string; boxes?: VectraImageBox[] }

/** Host hooks for image capabilities the portable tools cannot provide alone. */
export interface VectraImageToolOptions {
  /** Rasterize one page (1-based) of an uploaded PDF on demand. Receives the record the model named
   * (the PDF itself or a derived "· page N" image whose bytes were released) and must locate the source bytes. */
  renderPdfPage?: (attachment: VectraAttachmentRecord, pageNumber: number) => Promise<{ mime: string; base64: string; width?: number; height?: number } | null>;
  inspectVisual?: (attachment: VectraAttachmentRecord, page: number | undefined, task: string) => Promise<{
    name: string; mime: string; base64: string; text: string; boxes: VectraImageBox[];
  }>;
}

export const IMAGE_TOOL_DEFINITIONS: readonly VectraToolDefinition[] = [
  { name: 'inspect_visual', displayName: 'Inspect Visual', description: 'Ground text or objects on any renderable uploaded file and display the measured regions.', risk: 'read', surface: 'web' },
  { name: 'show_image', displayName: 'Show Image', description: 'Display an uploaded image or one page of an uploaded PDF in the split viewer panel, optionally highlighting regions with labeled bounding boxes.', risk: 'read', surface: 'web' },
  { name: 'fetch_image', displayName: 'Fetch Web Image', description: 'Download an image from a public web URL and display it in the split viewer panel; an HTML page returns its referenced image URLs instead.', risk: 'network', surface: 'web' },
  { name: 'draw_image', displayName: 'Draw Image', description: 'Generate a new SVG figure (plot, chart, diagram, sketch) and display it in the split viewer panel.', risk: 'read', surface: 'web' }
];

const boxSchema = z.object({
  x: z.number().min(0).max(1).describe('Left edge as a fraction of image width, from the left.'),
  y: z.number().min(0).max(1).describe('Top edge as a fraction of image height, from the top.'),
  w: z.number().min(0).max(1).describe('Box width as a fraction of image width.'),
  h: z.number().min(0).max(1).describe('Box height as a fraction of image height.'),
  label: z.string().max(80).optional().describe('Short caption drawn on the box.')
});

export function createImageTools<TContext = unknown>(
  attachments: VectraAttachmentRecord[],
  artifacts: VectraViewableArtifact[],
  options?: VectraImageToolOptions
): VectraDeepTool<TContext>[] {
  return [
    {
      name: 'inspect_visual',
      description: 'Inspect an uploaded image or a renderable page of a document. Use for OCR visualization, object grounding, tables, dimensions, stamps, signatures, or diagrams. The tool measures and displays regions; never estimate boxes yourself.',
      schema: z.object({
        name: z.string().min(1).describe('Exact attachment name.'),
        page: z.number().int().min(1).optional().describe('1-based page or slide number when applicable.'),
        task: z.string().min(1).max(500).describe('What to detect, transcribe, or verify visually.')
      }),
      execute: async ({ name, page, task }) => {
        const file = findAttachment(attachments, String(name));
        if (!file) throw new Error(`No attachment found for "${String(name)}". Use vectra_list_attachments for exact names.`);
        if (!options?.inspectVisual) throw new Error('Visual inspection is unavailable in this host.');
        const result = await options.inspectVisual(file, typeof page === 'number' ? Math.floor(page) : undefined, String(task));
        const boxes = result.boxes.filter(validBox);
        upsert(artifacts, { name: result.name, mime: result.mime, base64: result.base64, view: 'image', title: `Visual inspection · ${result.name}`, ...(boxes.length ? { boxes } : {}) });
        return JSON.stringify({ source: result.name, text: result.text, regions: boxes }, null, 2);
      }
    },
    {
      name: 'show_image',
      description: 'Show an uploaded image, or one page of an uploaded PDF, in the viewer. This displays supplied regions but does not detect them; use inspect_visual for grounded OCR or object boxes.',
      schema: z.object({
        name: z.string().min(1).describe('Exact attachment name from vectra_list_attachments (an image, or a PDF combined with page).'),
        page: z.number().int().min(1).optional().describe('1-based page number when showing a page of an uploaded PDF.'),
        title: z.string().max(120).optional().describe('Short caption shown above the image.'),
        boxes: z.array(boxSchema).max(50).optional().describe('Optional already-known regions to display.')
      }),
      execute: async ({ name, page, title, boxes }) => {
        const requested = String(name);
        const wantedPage = typeof page === 'number' && page >= 1 ? Math.floor(page) : undefined;
        const exact = attachments.find((item) => item.name === requested)
          || attachments.find((item) => item.name.toLowerCase() === requested.toLowerCase());
        if (!exact) throw new Error(`No image bytes found for "${requested}". Use vectra_list_attachments for exact names.`);

        // A PDF name plus page can address an already-rendered "· page N" image directly.
        let file = exact;
        if (wantedPage && !String(exact.mime || '').startsWith('image/')) {
          const child = attachments.find((item) => item.name === `${exact.name} · page ${wantedPage}`);
          if (child) file = child;
        }
        let source = imageBytes(file);
        let shownName = file.name;
        if (!source && (isPdf(exact) || typeof file.pageNumber === 'number')) {
          // A page never rasterized (its native text sufficed) or whose bytes were
          // released after OCR: ask the host to render it from the original PDF.
          const pageNumber = wantedPage ?? file.pageNumber ?? 1;
          const rendered = options?.renderPdfPage ? await options.renderPdfPage(exact, pageNumber) : null;
          if (rendered) {
            source = { mime: rendered.mime, base64: rendered.base64 };
            shownName = isPdf(exact) ? `${exact.name} · page ${pageNumber}` : file.name;
          } else if (isPdf(exact)) {
            throw new Error(`No rendered image is available for "${exact.name}"${wantedPage ? ` page ${wantedPage}` : ''}. Check vectra_list_attachments for "· page N" image attachments.`);
          }
        }
        if (!source) throw new Error(`No image bytes found for "${requested}". Use vectra_list_attachments for exact names.`);
        const clean = (boxes as VectraImageBox[] | undefined)?.filter(validBox);
        upsert(artifacts, { name: shownName, mime: source.mime, base64: source.base64, view: 'image', title: String(title || shownName), ...(clean?.length ? { boxes: clean } : {}) });
        return `Showing ${shownName} in the viewer${clean?.length ? ` with ${clean.length} highlighted region(s)` : ''}.`;
      }
    },
    {
      name: 'fetch_image',
      description: 'Download one image from a public http(s) URL - e.g. found via web_search or web_fetch - and show it to the user in the viewer panel. Use whenever the user wants to actually see a web image, never just paste its link. If the URL is a web page rather than an image file, its referenced image URLs are returned so you can call fetch_image again with the right one. The fetched image also becomes an attachment usable with show_image.',
      schema: z.object({
        url: z.string().min(1).describe('Full public URL of the image file (or of the page containing it).'),
        title: z.string().max(120).optional().describe('Short caption shown above the image.')
      }),
      execute: async ({ url, title }) => {
        const result = await fetchWebImage(String(url));
        if ('imageUrls' in result) {
          if (!result.imageUrls.length) return `"${String(url)}" is a web page with no extractable image URLs. Find a direct image URL and call fetch_image again.`;
          return `"${String(url)}" is a web page, not an image file. Image URLs referenced on it:\n${result.imageUrls.map((item, index) => `${index + 1}. ${item}`).join('\n')}\nCall fetch_image again with the direct URL you want to show.`;
        }
        const name = imageNameFromUrl(String(url), result.mime, attachments);
        upsert(artifacts, { name, mime: result.mime, base64: result.base64, view: 'image', title: String(title || name) });
        // Register as an attachment so later show_image/highlight calls can reuse it.
        if (!attachments.some((item) => item.name === name)) attachments.push({ name, kind: 'image', mime: result.mime, text: '', base64: result.base64 });
        return `Fetched ${name} (${result.mime}, ${result.bytes} bytes) and opened it in the viewer.`;
      }
    },
    {
      name: 'draw_image',
      description: 'Draw a new figure for the user - a plot, chart, diagram, or sketch - as complete SVG markup, shown in the viewer panel. Use when asked to draw, plot, or visualize something. Give the <svg> tag a viewBox and explicit colors.',
      schema: z.object({
        title: z.string().min(1).max(120).describe('Short figure name, e.g. "Sales by month".'),
        svg: z.string().min(20).describe('Complete standalone <svg>...</svg> markup.')
      }),
      execute: ({ title, svg }) => {
        const source = String(svg).trim();
        if (!/^<svg[\s>]/i.test(source) || !/<\/svg>\s*$/i.test(source)) throw new Error('svg must be complete standalone <svg>...</svg> markup.');
        // The viewer renders via <img>, which never runs scripts; reject them anyway.
        if (/<script|\son\w+\s*=|javascript:/i.test(source)) throw new Error('SVG must not contain scripts or event handlers.');
        const name = `${String(title).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'figure'}.svg`;
        upsert(artifacts, { name, mime: 'image/svg+xml', base64: Buffer.from(source, 'utf8').toString('base64'), view: 'image', title: String(title) });
        return `Drew "${title}" and opened it in the viewer (${name}).`;
      }
    }
  ];
}

function isPdf(file: VectraAttachmentRecord): boolean {
  return file.mime === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function findAttachment(attachments: VectraAttachmentRecord[], name: string): VectraAttachmentRecord | undefined {
  return attachments.find((item) => item.name === name)
    || attachments.find((item) => item.name.toLowerCase() === name.toLowerCase());
}

// Bytes usable for display: prompt bytes first, then display-only bytes kept after OCR release.
function imageBytes(file: VectraAttachmentRecord): { mime: string; base64: string } | undefined {
  if (!String(file.mime || '').startsWith('image/')) return undefined;
  const base64 = file.base64 || file.viewBase64;
  return base64 ? { mime: file.mime as string, base64 } : undefined;
}

// Derive a stable, collision-free attachment name from the image URL.
function imageNameFromUrl(rawUrl: string, mime: string, attachments: readonly VectraAttachmentRecord[]): string {
  let base = 'web-image';
  try { base = decodeURIComponent(new URL(rawUrl).pathname.split('/').filter(Boolean).pop() || 'web-image'); } catch { /* keep fallback */ }
  base = base.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'web-image';
  const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp', 'image/avif': '.avif', 'image/svg+xml': '.svg' } as Record<string, string>)[mime] || '.png';
  if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += extension;
  if (!attachments.some((item) => item.name === base)) return base;
  const dot = base.lastIndexOf('.');
  for (let counter = 2; ; counter++) {
    const candidate = `${base.slice(0, dot)}-${counter}${base.slice(dot)}`;
    if (!attachments.some((item) => item.name === candidate)) return candidate;
  }
}

// Replace an artifact with the same name instead of duplicating it.
function upsert(artifacts: VectraViewableArtifact[], artifact: VectraViewableArtifact): void {
  const index = artifacts.findIndex((item) => item.name === artifact.name);
  if (index >= 0) artifacts[index] = artifact;
  else artifacts.push(artifact);
}

function validBox(box: VectraImageBox): boolean {
  return box.w > 0 && box.h > 0 && box.x >= 0 && box.y >= 0
    && box.x + box.w <= 1 && box.y + box.h <= 1;
}
