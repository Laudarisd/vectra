// Beginner guide: Builds the browser-ready Vectra Web files from the maintained source assets.
import { cp, mkdir, rm, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));const webRoot=resolve(here,'..');const source=resolve(webRoot,'public');const target=resolve(webRoot,'dist');const pkg=JSON.parse(await readFile(resolve(webRoot,'package.json'),'utf8'));
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});await cp(source,target,{recursive:true});await writeFile(resolve(target,'build.json'),JSON.stringify({product:'Vectra Web',version:pkg.version,builtAt:new Date().toISOString()},null,2));console.log(`Vectra Web built: ${target}`);

const maxBuildBytes = 1024 * 1024;
const buildBytes = await directorySize(target);
if (buildBytes > maxBuildBytes) {
  throw new Error(`Vectra Web browser build is ${mib(buildBytes)} MiB; the release budget is ${mib(maxBuildBytes)} MiB. Inspect new files in dist before raising this limit.`);
}
console.log(`Vectra Web browser build is ${mib(buildBytes)} MiB (budget: ${mib(maxBuildBytes)} MiB).`);

async function directorySize(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    bytes += entry.isDirectory() ? await directorySize(path) : (await stat(path)).size;
  }
  return bytes;
}

function mib(bytes) { return (bytes / 1024 / 1024).toFixed(2); }
