// Beginner guide: Removes stale generated extension output before a clean bundle is created.
import { rm } from 'node:fs/promises';

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
