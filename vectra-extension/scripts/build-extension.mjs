import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: [fileURLToPath(new URL('../src/extension.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/extension.js', import.meta.url)),
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  minify: false,
  sourcemap: false
});
console.log('Vectra Extension bundled: dist/extension.js');
