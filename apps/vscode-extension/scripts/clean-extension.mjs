// Removes stale generated output so moved or deleted source files cannot mask failures.
import { rm } from 'node:fs/promises';

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await rm(new URL('../build/', import.meta.url), { recursive: true, force: true });
