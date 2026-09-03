// Beginner guide: Builds the browser-ready Vectra Web files from the maintained source assets.
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));const webRoot=resolve(here,'..');const source=resolve(webRoot,'public');const target=resolve(webRoot,'dist');const pkg=JSON.parse(await readFile(resolve(webRoot,'package.json'),'utf8'));
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});await cp(source,target,{recursive:true});await writeFile(resolve(target,'build.json'),JSON.stringify({product:'Vectra Web',version:pkg.version,builtAt:new Date().toISOString()},null,2));console.log(`Vectra Web built: ${target}`);
