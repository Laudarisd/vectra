// Beginner guide: Checks that w eb t oo ls.t es t behavior stays correct as the project changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { WebTools } = require('../build/tools/WebTools.js');

// These only exercise the synchronous URL-validation guard, which runs and
// throws before any network call — no real network access is required or
// performed by this file.

test('web_fetch refuses loopback and private-network addresses', async () => {
  const web = new WebTools();
  await assert.rejects(web.fetch('http://127.0.0.1/secret'), /local\/private/i);
  await assert.rejects(web.fetch('http://localhost:8080/'), /local\/private/i);
  await assert.rejects(web.fetch('http://0.0.0.0/'), /local\/private/i);
  await assert.rejects(web.fetch('http://10.0.0.5/internal'), /local\/private/i);
  await assert.rejects(web.fetch('http://172.16.0.1/'), /local\/private/i);
  await assert.rejects(web.fetch('http://192.168.1.1/'), /local\/private/i);
  await assert.rejects(web.fetch('http://169.254.169.254/latest/meta-data/'), /local\/private/i);
  await assert.rejects(web.fetch('http://[::1]/'), /local\/private/i);
});

test('web_fetch allows a public-looking hostname past the guard (172.32 is outside the 172.16-31 private range)', async () => {
  const web = new WebTools();
  await assert.doesNotReject(
    (async () => {
      try {
        await web.fetch('http://172.32.0.1/');
      } catch (error) {
        // The guard must not be why this failed — any failure here should be
        // a real network error (unreachable host), not "local/private".
        assert.doesNotMatch(String(error.message), /local\/private/i);
      }
    })()
  );
});

test('web_fetch rejects non-http(s) schemes', async () => {
  const web = new WebTools();
  await assert.rejects(web.fetch('ftp://example.com/file'), /http:\/\/ and https:\/\//i);
  await assert.rejects(web.fetch('file:///etc/passwd'), /http:\/\/ and https:\/\//i);
});

test('web_fetch rejects a malformed URL', async () => {
  const web = new WebTools();
  await assert.rejects(web.fetch('not a url'), /invalid url/i);
});

test('web_search requires a non-empty query', async () => {
  const web = new WebTools();
  await assert.rejects(web.search('   ', 5), /non-empty query/i);
});

test('web_search falls back when the primary provider times out', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    if (calls.length === 2) return new Response('<html>No result links here</html>', { status: 200 });
    return new Response('<?xml version="1.0"?><rss><channel><item><title>Kathmandu Weather</title><link>https://example.com/weather</link><description>Current conditions in Kathmandu</description></item></channel></rss>', { status: 200 });
  };
  try {
    const result = await new WebTools().search('weather Kathmandu', 5);
    assert.equal(calls.length, 3);
    assert.match(result, /Kathmandu Weather/);
    assert.match(result, /Current conditions in Kathmandu/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('network timeouts are recoverable tool results instead of fatal agent errors', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); };
  try {
    const web = new WebTools();
    assert.match(await web.search('weather Kathmandu', 5), /temporarily unavailable/i);
    assert.match(await web.fetch('https://example.com/weather'), /timed out.*web_search snippets/i);
  } finally {
    global.fetch = originalFetch;
  }
});
