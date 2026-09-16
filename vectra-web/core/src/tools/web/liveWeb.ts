// Beginner guide: This one small file gives Vectra live internet access.
// It has exactly two jobs:
//   searchWeb()    - find pages for a query (keyless DuckDuckGo HTML scrape)
//   fetchWebPage() - read one public page as plain text (like `curl` + cleanup)
// Both products (the VS Code extension and Vectra Web) share this file, so the
// agent can answer real-world questions - weather, time, news, prices, docs -
// by searching first and then fetching a result.
// Every URL passes an SSRF guard first: only the PUBLIC internet is reachable,
// never localhost or the private network. Anything fetched is untrusted data.

const FETCH_TIMEOUT_MS = 15_000;
const MAX_OUTPUT = 18_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Vectra/1.0; +https://github.com/Laudarisd/vectra)';

/** Search the public web and return up to `maxResults` numbered results (title, URL, snippet). */
export async function searchWeb(query: string, maxResults?: number, signal?: AbortSignal): Promise<string> {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('web_search requires a non-empty query.');
  const capped = clampInt(maxResults, 1, 10, 5);
  const encoded = encodeURIComponent(q);
  const providers = [
    { name: 'DuckDuckGo', url: `https://html.duckduckgo.com/html/?q=${encoded}`, parse: parseDuckDuckGoResults },
    { name: 'DuckDuckGo Lite', url: `https://lite.duckduckgo.com/lite/?q=${encoded}`, parse: parseDuckDuckGoResults },
    { name: 'Bing', url: `https://www.bing.com/search?format=rss&q=${encoded}`, parse: parseBingRssResults }
  ];
  if (/\b(?:paper|papers|research|study|studies|journal|doi|citation|academic|scholar|arxiv|preprint)\b/i.test(q)) {
    providers.unshift({ name: 'OpenAlex', url: `https://api.openalex.org/works?search=${encoded}&per-page=${capped}`, parse: parseOpenAlexResults });
  }
  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const body = await httpGetText(provider.url, signal);
      const results = provider.parse(body, capped);
      if (results.length) return formatSearchResults(results);
      failures.push(`${provider.name}: no results`);
    } catch (error) {
      if (signal?.aborted) throw new Error('Web search was cancelled.');
      failures.push(`${provider.name}: ${friendlyNetworkError(error)}`);
    }
  }
  // A network outage is a recoverable tool observation, not a reason to abort
  // the entire agent run. The model can explain it or continue from context.
  return `Web search is temporarily unavailable. Check the internet, DNS, VPN, or firewall, or try again. Provider details: ${failures.join('; ')}.`;
}

interface SearchResult { title: string; href: string; snippet: string }

function parseDuckDuckGoResults(html: string, capped: number): SearchResult[] {
  const titles: string[] = [];
  const hrefs: string[] = [];
  const resultRe = /<a[^>]+class=["'][^"']*(?:result-link|result__a)[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultRe.exec(html)) && hrefs.length < capped) {
    hrefs.push(decodeDuckDuckGoUrl(match[1]));
    titles.push(htmlToText(match[2]));
  }
  const snippets: string[] = [];
  const snippetRe = /<(?:a|td)[^>]+class=["'][^"']*(?:result__snippet|result-snippet)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|td)>/gi;
  while ((match = snippetRe.exec(html)) && snippets.length < capped) {
    snippets.push(htmlToText(match[1]));
  }

  return hrefs.map((href, index) => ({ href, title: titles[index] || href, snippet: snippets[index] || '' }));
}

function parseBingRssResults(xml: string, capped: number): SearchResult[] {
  const results: SearchResult[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) && results.length < capped) {
    const item = match[1];
    const title = xmlValue(item, 'title');
    const href = xmlValue(item, 'link');
    const snippet = xmlValue(item, 'description');
    if (href) results.push({ title: htmlToText(title) || href, href, snippet: htmlToText(snippet) });
  }
  return results;
}

function parseOpenAlexResults(json: string, capped: number): SearchResult[] {
  try {
    const works = JSON.parse(json)?.results;
    if (!Array.isArray(works)) return [];
    return works.slice(0, capped).map((work) => {
      const title = String(work?.display_name || work?.title || 'Untitled research work');
      const doi = String(work?.doi || '');
      const href = doi || String(work?.primary_location?.landing_page_url || work?.id || '');
      const authors = Array.isArray(work?.authorships) ? work.authorships.slice(0, 4).map((item: any) => item?.author?.display_name).filter(Boolean).join(', ') : '';
      const details = [authors, work?.publication_year, work?.primary_location?.source?.display_name, Number.isFinite(work?.cited_by_count) ? `${work.cited_by_count} citations` : ''].filter(Boolean).join(' · ');
      return { title, href, snippet: details };
    }).filter((result) => result.href);
  } catch { return []; }
}

function xmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return match?.[1]?.trim() || '';
}

function formatSearchResults(results: SearchResult[]): string {
  return results.map((result, index) => `${index + 1}. ${result.title}\n${result.href}${result.snippet ? `\n${result.snippet}` : ''}`).join('\n\n');
}

/** Fetch one public http(s) URL and return its readable text (HTML is stripped, JSON is pretty-printed). */
export async function fetchWebPage(rawUrl: string, signal?: AbortSignal): Promise<string> {
  const url = assertPublicHttpUrl(rawUrl);
  let body: string;
  try {
    body = await httpGetText(url.toString(), signal);
  } catch (error) {
    if (signal?.aborted) throw new Error('Web fetch was cancelled.');
    // Many news, finance, and research sites block plain server fetches or need
    // JavaScript. Jina Reader provides a clean, LLM-oriented rendering fallback.
    try {
      body = await httpGetText(`https://r.jina.ai/${url.toString()}`, signal);
    } catch (readerError) {
      if (signal?.aborted) throw new Error('Web fetch was cancelled.');
      return `Could not fetch ${url.toString()} directly (${friendlyNetworkError(error)}) or through the reader fallback (${friendlyNetworkError(readerError)}). Use the web_search snippets or fetch another result.`;
    }
  }
  let content: string;
  try {
    content = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    content = htmlToText(body);
  }
  return content.trim() ? truncateMiddle(content, MAX_OUTPUT) : 'No readable text content was found at this URL.';
}

/** One shared GET helper: browser-style User-Agent, a hard timeout, and the caller's cancel signal. */
async function httpGetText(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status} for ${url}`);
  return response.text();
}

function friendlyNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout/i.test(message) || (error instanceof Error && error.name === 'TimeoutError')) return `timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s`;
  return message.replace(/^fetch failed(?::\s*)?/i, '') || 'network request failed';
}

const MAX_IMAGE_BYTES = 15_000_000;

export interface FetchedWebImage { mime: string; base64: string; bytes: number }
export interface WebImagePageResult { imageUrls: string[] }

/** Download one public image URL as bytes. If the URL turns out to be an HTML
 * page (a search result or article that merely references the image), return
 * the image URLs found on it instead so the caller can fetch the right one. */
export async function fetchWebImage(rawUrl: string, signal?: AbortSignal): Promise<FetchedWebImage | WebImagePageResult> {
  const url = assertPublicHttpUrl(rawUrl);
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,text/html;q=0.8,*/*;q=0.5' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status} for ${url}`);
  const declared = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (declared.includes('html')) return { imageUrls: extractImageUrls(await response.text(), response.url || url.toString()) };
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`Image is too large (${buffer.length} bytes; limit ${MAX_IMAGE_BYTES}).`);
  const sniffed = sniffImageMime(buffer);
  const mime = sniffed || (declared.startsWith('image/') ? declared : '');
  if (!mime) {
    // Some servers mislabel pages as octet-stream; if the body is HTML, still extract references.
    const head = buffer.subarray(0, 512).toString('utf8').toLowerCase();
    if (head.includes('<html') || head.includes('<!doctype')) return { imageUrls: extractImageUrls(buffer.toString('utf8'), response.url || url.toString()) };
    throw new Error(`"${rawUrl}" did not return a recognizable image (content-type ${declared || 'unknown'}).`);
  }
  return { mime, base64: buffer.toString('base64'), bytes: buffer.length };
}

/** Identify common raster/vector formats from magic bytes, ignoring the server's label. */
function sniffImageMime(buffer: Buffer): string {
  if (buffer.length < 12) return '';
  if (buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
  if (buffer.toString('ascii', 4, 12) === 'ftypavif') return 'image/avif';
  const head = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return '';
}

/** Pull likely image URLs out of an HTML page: og:image first, then <img> sources, absolute and deduplicated. */
function extractImageUrls(html: string, pageUrl: string, limit = 12): string[] {
  const found: string[] = [];
  const push = (raw: string) => {
    const candidate = String(raw || '').trim();
    if (!candidate || candidate.startsWith('data:')) return;
    try {
      const absolute = new URL(candidate, pageUrl).toString();
      if (/^https?:/i.test(absolute) && !found.includes(absolute)) found.push(absolute);
    } catch { /* skip malformed URLs */ }
  };
  let match: RegExpExecArray | null;
  const metaRe = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi;
  while ((match = metaRe.exec(html))) push(match[1]);
  const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((match = imgRe.exec(html)) && found.length < limit * 3) push(match[1]);
  return found.slice(0, limit);
}

/** Only public http(s) hosts are reachable - no loopback, link-local, or RFC1918 targets. */
export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are allowed.');
  }
  const rawHost = url.hostname.toLowerCase();
  // Node's URL keeps the brackets in .hostname for an IPv6 literal (e.g. "[::1]").
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') {
    throw new Error(`Refusing to fetch a local/private address: ${host}`);
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const isPrivate = a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
    if (isPrivate) throw new Error(`Refusing to fetch a local/private address: ${host}`);
  }
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('::ffff:127.')) {
    throw new Error(`Refusing to fetch a local/private address: ${host}`);
  }
  return url;
}

/** DuckDuckGo's HTML endpoint wraps outbound links in a redirect; the real target lives in ?uddg=. */
function decodeDuckDuckGoUrl(href: string): string {
  try {
    const url = new URL(href.startsWith('//') ? `https:${href}` : href);
    const target = url.searchParams.get('uddg');
    return target ? decodeURIComponent(target) : href;
  } catch {
    return href;
  }
}

/** Turn an HTML page into readable plain text: drop scripts/styles, keep line breaks, decode entities. */
function htmlToText(html: string): string {
  const withoutNonContent = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const withBreaks = withoutNonContent.replace(/<\/(p|div|li|h[1-6]|tr|br)\s*>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  const stripped = withBreaks.replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}

/** Keep the start and end of a long page, cutting the middle, so the model sees both context and footer. */
function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n...[truncated]...\n${text.slice(-half)}`;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  const number = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.min(max, Math.max(min, number));
}
