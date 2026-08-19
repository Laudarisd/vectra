import { cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The extension bundles its own copy of the Vectra Web product (`vectra/web`)
// so `vectra.package`/`vectra.web` don't depend on a sibling checkout at
// runtime. That copy previously drifted from the canonical `vectra-web/`
// package by hand-edits (missing chat history, GPU detection, and local
// runtime discovery entirely) and produced the same "bad request"/no-timeout
// bugs fixed there. This script makes the bundled copy a build artifact
// instead of a second source of truth: it always overwrites `web/` from
// `../vectra-web` before packaging or testing, so the two can no longer
// silently diverge.
const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');
const source = resolve(extensionRoot, '..', 'vectra-web');
const target = resolve(extensionRoot, 'web');

const ENTRIES = ['lib', 'public', 'scripts', 'test', 'server.mjs', 'README.md'];

async function main() {
  await mkdir(target, { recursive: true });
  for (const entry of ENTRIES) {
    await rm(resolve(target, entry), { recursive: true, force: true });
    await cp(resolve(source, entry), resolve(target, entry), { recursive: true });
  }

  // package.json is synced field-by-field rather than copied wholesale: the
  // bundled copy intentionally supports the older Node baseline VS Code's
  // extension host itself requires, not vectra-web's standalone minimum.
  const sourcePkg = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'));
  const targetPkgPath = resolve(target, 'package.json');
  const targetPkg = JSON.parse(await readFile(targetPkgPath, 'utf8'));
  targetPkg.version = sourcePkg.version;
  targetPkg.scripts = sourcePkg.scripts;
  await writeFile(targetPkgPath, `${JSON.stringify(targetPkg, null, 2)}\n`);

  console.log(`Vectra Web bundled copy synced from ${source} to ${target}`);
}

main().catch((error) => {
  console.error('sync-web failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
