import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const json = async (path) => JSON.parse(await read(path));
const extension = await json('vectra-extension/package.json');
const web = await json('vectra-web/package.json');
const webBuild = await json('vectra-web/dist/build.json');

if (extension.version !== web.version) throw new Error(`Version mismatch: extension ${extension.version}, web ${web.version}`);
if (web.version !== webBuild.version) throw new Error(`Stale web build: package ${web.version}, build ${webBuild.version}`);

for (const path of ['README.md', 'vectra-extension/README.md', 'vectra-web/README.md']) {
  if (!(await read(path)).includes(extension.version)) throw new Error(`${path} does not mention ${extension.version}`);
}
if (!new RegExp(`^# Changelog\\r?\\n\\r?\\n## ${extension.version}`).test(await read('vectra-extension/CHANGELOG.md'))) throw new Error(`Changelog does not start with ${extension.version}`);

console.log(`Release metadata is consistent at ${extension.version}`);
