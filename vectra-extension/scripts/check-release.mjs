import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const json = async (path) => JSON.parse(await read(path));
const extension = await json('vectra-extension/package.json');
const web = await json('vectra-web/package.json');

// The two products ship on their own cadence, so each one is checked against its
// own version rather than being forced to move in lockstep.
const targets = [
  { path: 'README.md', version: extension.version, label: 'extension' },
  { path: 'vectra-extension/README.md', version: extension.version, label: 'extension' },
  { path: 'vectra-web/README.md', version: web.version, label: 'web' }
];
for (const { path, version, label } of targets) {
  if (!(await read(path)).includes(version)) throw new Error(`${path} does not mention the ${label} version ${version}`);
}
if (!new RegExp(`^# Changelog\\r?\\n\\r?\\n## ${extension.version}`).test(await read('vectra-extension/CHANGELOG.md'))) throw new Error(`Changelog does not start with ${extension.version}`);

console.log(`Release metadata is consistent: extension ${extension.version}, web ${web.version}`);
