import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');
const coreRoot = resolve(extensionRoot, '..', 'vectra-agent-core');
const source = resolve(coreRoot, 'dist');
const target = resolve(extensionRoot, 'generated', 'agent-core');
const staging = `${target}-${process.pid}.tmp`;

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(source, resolve(staging, 'dist'), { recursive: true });
await cp(resolve(coreRoot, 'node_modules'), resolve(staging, 'node_modules'), { recursive: true });
await cp(resolve(coreRoot, 'package.json'), resolve(staging, 'package.json'));
await rm(target, { recursive: true, force: true });
await rename(staging, target);
console.log(`Vectra agent core synced to ${target}`);
