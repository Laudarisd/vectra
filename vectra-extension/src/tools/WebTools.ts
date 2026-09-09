// Beginner guide: The extension's web tools are a thin wrapper around the
// shared implementation in src/core/tools/web/liveWeb.ts, so the VS Code
// extension and Vectra Web fetch the internet in exactly the same way
// (same DuckDuckGo search, same page-to-text cleanup, same SSRF guard).
import { searchWeb, fetchWebPage } from '../core/tools/web/liveWeb';

export class WebTools {
  /** web_search: find pages for a query - used for docs, news, weather, prices, anything live. */
  search(query: string, maxResults: number | undefined, signal?: AbortSignal): Promise<string> {
    return searchWeb(query, maxResults, signal);
  }

  /** web_fetch: read one public page as plain text (like curl + cleanup). */
  fetch(rawUrl: string, signal?: AbortSignal): Promise<string> {
    return fetchWebPage(rawUrl, signal);
  }
}
