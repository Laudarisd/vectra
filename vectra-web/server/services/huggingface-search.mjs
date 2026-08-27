const SEARCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Vectra/1.0; +https://github.com/Laudarisd/vectra)';

async function fetchJsonWithTimeout(url, init = {}, timeoutMs = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : {};
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(data).slice(0, 2000)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keyless search against the public Hugging Face Hub models-list API. The
 * list endpoint only returns repo-level metadata, so resolving an actual
 * downloadable .gguf file requires a second, per-repo call — see
 * resolveDownloadableFile(), only invoked once the user picks a search result.
 */
export async function searchHuggingFace(query) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('Search query must not be empty.');
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&filter=gguf&sort=downloads&limit=20`;
  const results = await fetchJsonWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!Array.isArray(results)) return [];
  return results
    .map((entry) => ({ id: entry.id || entry.modelId || '', downloads: entry.downloads ?? 0 }))
    .filter((entry) => entry.id)
    .map((entry) => ({ id: entry.id, label: entry.id, downloads: entry.downloads }));
}

/**
 * Picks the most likely single-file GGUF to download from a repo: prefers a
 * medium quantization (Q4_K_M, else Q4_0/Q4, else the first .gguf found) and
 * skips multi-part/mmproj files. Returns undefined when the repo has no
 * unambiguous single .gguf file to offer.
 */
export async function resolveDownloadableFile(repoId) {
  const detail = await fetchJsonWithTimeout(
    `https://huggingface.co/api/models/${repoId}`,
    { headers: { 'User-Agent': USER_AGENT } }
  );
  const siblings = (detail.siblings ?? []).filter(
    (sibling) =>
      typeof sibling.rfilename === 'string' &&
      sibling.rfilename.toLowerCase().endsWith('.gguf') &&
      !/^mmproj/i.test(sibling.rfilename) &&
      !/-\d{5}-of-\d{5}\.gguf$/i.test(sibling.rfilename)
  );
  if (!siblings.length) return undefined;

  const preferred =
    siblings.find((sibling) => /q4_k_m/i.test(sibling.rfilename)) ??
    siblings.find((sibling) => /q4_0|q4[^0-9]/i.test(sibling.rfilename)) ??
    siblings[0];

  return {
    downloadUrl: `https://huggingface.co/${repoId}/resolve/main/${preferred.rfilename}`,
    filename: preferred.rfilename,
    sizeBytes: preferred.size
  };
}
