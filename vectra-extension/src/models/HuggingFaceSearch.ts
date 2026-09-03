// Beginner guide: Handles h ug gi ng fa ce se ar ch responsibilities for Vectra.
import { fetchJson } from '../utils/http';

const SEARCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Vectra/1.0; +https://github.com/Laudarisd/vectra)';

export interface HfSearchResult {
  /** Hugging Face repo id, e.g. "bartowski/Llama-3.2-3B-Instruct-GGUF". */
  id: string;
  label: string;
  downloads: number;
}

interface HfListEntry {
  id?: string;
  modelId?: string;
  downloads?: number;
}

interface HfSibling {
  rfilename?: string;
  size?: number;
}

interface HfModelDetail {
  id?: string;
  siblings?: HfSibling[];
}

/**
 * Keyless search against the public Hugging Face Hub models-list API — same
 * no-API-key house style as WebTools.ts's DuckDuckGo scrape. The list endpoint
 * only returns repo-level metadata (confirmed live: no per-file siblings data),
 * so resolving an actual downloadable .gguf file requires a second,
 * per-repo call — see resolveDownloadableFile(), only invoked once the user
 * actually picks a search result, keeping the search itself fast.
 */
export async function searchHuggingFace(query: string, signal?: AbortSignal): Promise<HfSearchResult[]> {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('Search query must not be empty.');
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&filter=gguf&sort=downloads&limit=20`;
  const results = await fetchJson<HfListEntry[]>(url, { signal, headers: { 'User-Agent': USER_AGENT } }, SEARCH_TIMEOUT_MS);
  if (!Array.isArray(results)) return [];
  return results
    .map((entry) => ({ id: entry.id || entry.modelId || '', downloads: entry.downloads ?? 0 }))
    .filter((entry) => entry.id)
    .map((entry) => ({ id: entry.id, label: entry.id, downloads: entry.downloads }));
}

export interface ResolvedHfFile {
  downloadUrl: string;
  filename: string;
  sizeBytes?: number;
}

/**
 * Picks the most likely single-file GGUF to download from a repo: prefers a
 * medium quantization (Q4_K_M, else Q4_0/Q4, else the first .gguf found) and
 * skips multi-part/mmproj files, since this feeds a plain one-click download
 * rather than the curated catalog's fully-specified entries. Returns
 * undefined when the repo has no unambiguous single .gguf file to offer —
 * callers should fall back to opening the repo page in a browser.
 */
export async function resolveDownloadableFile(repoId: string, signal?: AbortSignal): Promise<ResolvedHfFile | undefined> {
  // repoId is "<owner>/<name>" — the slash is a literal path separator here,
  // so it must NOT be percent-encoded (encodeURIComponent would turn it into
  // %2F and break the API path).
  const detail = await fetchJson<HfModelDetail>(
    `https://huggingface.co/api/models/${repoId}`,
    { signal, headers: { 'User-Agent': USER_AGENT } },
    SEARCH_TIMEOUT_MS
  );
  const siblings = (detail.siblings ?? []).filter(
    (sibling): sibling is Required<Pick<HfSibling, 'rfilename'>> & HfSibling =>
      typeof sibling.rfilename === 'string' &&
      sibling.rfilename.toLowerCase().endsWith('.gguf') &&
      !/^mmproj/i.test(sibling.rfilename) &&
      !/-\d{5}-of-\d{5}\.gguf$/i.test(sibling.rfilename)
  );
  if (!siblings.length) return undefined;

  const preferred =
    siblings.find((sibling) => /q4_k_m/i.test(sibling.rfilename!)) ??
    siblings.find((sibling) => /q4_0|q4[^0-9]/i.test(sibling.rfilename!)) ??
    siblings[0];

  return {
    downloadUrl: `https://huggingface.co/${repoId}/resolve/main/${preferred.rfilename}`,
    filename: preferred.rfilename!,
    sizeBytes: preferred.size
  };
}
