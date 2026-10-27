// Verifies secure API-key storage and safe migration from older Marketplace versions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LocalCredentialStore } = require('../build/core/providers/LocalCredentialStore.js');

class MemorySecretStorage {
  values = new Map();
  async get(key) { return this.values.get(key); }
  async store(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
}

test('API keys are stored in SecretStorage instead of a plaintext file', async () => {
  const secrets = new MemorySecretStorage();
  const missingLegacyFile = path.join(os.tmpdir(), `vectra-missing-${Date.now()}.json`);
  const credentials = new LocalCredentialStore(secrets, missingLegacyFile);

  await credentials.set('openai', '  secret-value  ');
  assert.equal(await credentials.get('openai'), 'secret-value');
  assert.equal(fs.existsSync(missingLegacyFile), false);

  await credentials.delete('openai');
  assert.equal(await credentials.has('openai'), false);
});

test('legacy plaintext keys migrate once and the old file is removed afterward', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vectra-credentials-'));
  const legacyFile = path.join(directory, 'credentials.json');
  fs.writeFileSync(legacyFile, JSON.stringify({
    version: 1,
    keys: { openai: 'old-openai-key', openaiCompatible: 'optional-host-key' }
  }));

  try {
    const secrets = new MemorySecretStorage();
    const credentials = new LocalCredentialStore(secrets, legacyFile);

    assert.equal(await credentials.get('openai'), 'old-openai-key');
    assert.equal(await credentials.get('openaiCompatible'), 'optional-host-key');
    assert.equal(fs.existsSync(legacyFile), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('migration never overwrites a newer key already stored securely', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vectra-credentials-'));
  const legacyFile = path.join(directory, 'credentials.json');
  fs.writeFileSync(legacyFile, JSON.stringify({ version: 1, keys: { anthropic: 'old-key' } }));

  try {
    const secrets = new MemorySecretStorage();
    await secrets.store('vectra.apiKey.anthropic', 'new-key');
    const credentials = new LocalCredentialStore(secrets, legacyFile);

    assert.equal(await credentials.get('anthropic'), 'new-key');
    assert.equal(fs.existsSync(legacyFile), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
