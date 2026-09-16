import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWebPage, searchWeb } from '../core/dist/tools/web/liveWeb.js';

test('web search falls back when the primary provider times out', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    if (calls.length === 2) return new Response('<html>No result links here</html>', { status: 200 });
    return new Response('<?xml version="1.0"?><rss><channel><item><title>Kathmandu Weather</title><link>https://example.com/weather</link><description>Current conditions in Kathmandu</description></item></channel></rss>', { status: 200 });
  };
  try {
    const result = await searchWeb('weather Kathmandu', 5);
    assert.equal(calls.length, 3);
    assert.match(result, /Kathmandu Weather/);
    assert.match(result, /Current conditions in Kathmandu/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('web search returns an actionable observation after every provider fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    assert.match(await searchWeb('weather Kathmandu'), /internet, DNS, VPN, or firewall/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('web page timeout returns a recoverable observation', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); };
  try {
    assert.match(await fetchWebPage('https://example.com/weather'), /timed out.*web_search snippets/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('web page fetch uses the reader fallback for blocked dynamic sites', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) throw new TypeError('fetch failed');
    return new Response('Title: Market update\n\nReadable live market content.', { status: 200 });
  };
  try {
    assert.match(await fetchWebPage('https://example.com/market'), /Readable live market content/);
    assert.match(calls[1], /^https:\/\/r\.jina\.ai\/https:\/\/example\.com\/market$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('paper searches use structured OpenAlex metadata', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /api\.openalex\.org\/works/);
    return new Response(JSON.stringify({ results: [{ display_name: 'Reliable Agents', doi: 'https://doi.org/10.1/test', publication_year: 2026, cited_by_count: 12, authorships: [{ author: { display_name: 'Ada Researcher' } }], primary_location: { source: { display_name: 'AI Journal' } } }] }), { status: 200 });
  };
  try {
    const result = await searchWeb('research papers about reliable agents', 3);
    assert.match(result, /Reliable Agents/);
    assert.match(result, /Ada Researcher.*2026.*12 citations/);
  } finally {
    global.fetch = originalFetch;
  }
});
