import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');
const coreRoot = resolve(extensionRoot, '..', 'vectra-agent-core');
const source = resolve(coreRoot, 'dist');
const target = resolve(extensionRoot, 'generated', 'agent-core');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, resolve(target, 'dist'), { recursive: true });
await cp(resolve(coreRoot, 'node_modules'), resolve(target, 'node_modules'), { recursive: true });
await cp(resolve(coreRoot, 'package.json'), resolve(target, 'package.json'));
console.log(`Vectra agent core synced to ${target}`);
