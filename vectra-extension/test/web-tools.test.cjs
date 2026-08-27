const test = require('node:test');
const assert = require('node:assert/strict');
const { WebTools } = require('../dist/tools/WebTools.js');

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
