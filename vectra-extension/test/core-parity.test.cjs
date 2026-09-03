// Beginner guide: Checks that c or e p ar it y.t es t behavior stays correct as the project changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The extension and the web app each own a copy of the shared core by design
// (ARCHITECTURE.md), which means nothing stops the two from drifting apart
// silently -- and they already had: discovery.ts gained cancellation and batched
// reads on the extension side only. This test is the guard that was missing.
const EXTENSION_CORE = path.join(__dirname, '..', 'src', 'core');
const WEB_CORE = path.join(__dirname, '..', '..', 'vectra-web', 'core', 'src');

function sourceFiles(root) {
  const output = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.ts')) output.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return output.sort();
}

// The repo carries mixed CRLF/LF, so compare content rather than bytes.
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the extension and web copies of the shared core hold the same files', () => {
  assert.ok(fs.existsSync(WEB_CORE), `expected the web core at ${WEB_CORE}`);
  assert.deepEqual(sourceFiles(EXTENSION_CORE), sourceFiles(WEB_CORE));
});

test('every shared core file is identical across both products', () => {
  const drifted = sourceFiles(EXTENSION_CORE).filter(
    (file) => read(path.join(EXTENSION_CORE, file)) !== read(path.join(WEB_CORE, file))
  );
  assert.deepEqual(
    drifted,
    [],
    `these core files differ between vectra-extension and vectra-web: ${drifted.join(', ')}. ` +
      'Apply the change to both copies so the two products stay aligned.'
  );
});
