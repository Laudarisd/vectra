// Keep accidental dependency growth from silently bloating the shipped extension.
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const bundle = resolve(import.meta.dirname, '../dist/extension.js');
const maxBytes = 2.5 * 1024 * 1024;
const { size } = await stat(bundle);
const mib = (bytes) => (bytes / 1024 / 1024).toFixed(2);

if (size > maxBytes) {
  throw new Error(
    `Extension bundle is ${mib(size)} MiB; the release budget is ${mib(maxBytes)} MiB. ` +
    'Inspect newly bundled dependencies before intentionally raising this limit.'
  );
}

console.log(`Extension bundle size is ${mib(size)} MiB (budget: ${mib(maxBytes)} MiB).`);
