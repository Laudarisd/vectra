import { fetchJson } from '../utils/http';
import { safeJson, truncateMiddle } from '../utils/text';

const FETCH_TIMEOUT_MS = 25_000;
const MAX_OUTPUT = 18_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Vectra/1.0; +https://github.com/Laudarisd/vectra)';

/**
 * Keyless web research: a DuckDuckGo HTML-results scrape for search, and a
 * plain-text extraction fetch for a specific URL. No API key, no dependency —
 * matches the rest of Vectra's zero-dependency, house-rolled HTTP style.
 * This is the first tool that reaches outside the workspace/local-machine
 * trust boundary, so every URL is checked against an SSRF guard before Vectra
 * dials out, and fetched/searched content must be treated as untrusted data.
 */
export class WebTools {
  async search(query: string, maxResults: number | undefined, signal?: AbortSignal): Promise<string> {
    const q = String(query ?? '').trim();
    if (!q) throw new Error('web_search requires a non-empty query.');
    const capped = clampInt(maxResults, 1, 10, 5);

    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const raw = await fetchJson<string>(
      url,
      { signal, headers: { 'User-Agent': USER_AGENT } },
      FETCH_TIMEOUT_MS
    );
    const html = typeof raw === 'string' ? raw : '';

    const titles: string[] = [];
    const hrefs: string[] = [];
    const resultRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = resultRe.exec(html)) && hrefs.length < capped) {
      hrefs.push(decodeDuckDuckGoUrl(match[1]));
      titles.push(htmlToText(match[2]));
    }
    const snippets: string[] = [];
    const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = snippetRe.exec(html)) && snippets.length < capped) {
      snippets.push(htmlToText(match[1]));
    }

    if (!hrefs.length) return `No results found for "${q}".`;
    return hrefs
      .map((href, index) => {
        const title = titles[index] || href;
        const snippet = snippets[index] ? `\n${snippets[index]}` : '';
        return `${index + 1}. ${title}\n${href}${snippet}`;
      })
      .join('\n\n');
  }

  async fetch(rawUrl: string, signal?: AbortSignal): Promise<string> {
    const url = assertPublicHttpUrl(rawUrl);
    const raw = await fetchJson<unknown>(
      url.toString(),
      { signal, headers: { 'User-Agent': USER_AGENT } },
      FETCH_TIMEOUT_MS
    );
    const content = typeof raw === 'string' ? htmlToText(raw) : safeJson(raw);
    return content.trim() ? truncateMiddle(content, MAX_OUTPUT) : 'No readable text content was found at this URL.';
  }
}

/** Only public http(s) hosts are reachable — no loopback, link-local, or RFC1918 targets. */
function assertPublicHttpUrl(rawUrl: string): URL {
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
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  const number = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.min(max, Math.max(min, number));
}
