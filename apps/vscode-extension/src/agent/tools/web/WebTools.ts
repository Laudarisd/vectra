// Extension-facing adapter for guarded public-web research.
import { searchWeb, fetchWebPage } from './LiveWebClient';

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
