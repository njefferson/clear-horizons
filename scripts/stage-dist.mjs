#!/usr/bin/env node
// =============================================================================
// stage-dist.mjs — assemble the publishable site into dist/ from an explicit
// allow-list, so deploy stops shipping repo-internal files (NOTES.md, the
// review docs, test/, scripts/, package.json) to production. Deploy publishes
// dist/, not the repo root. check-dist.mjs then asserts the service worker's
// precache list all resolves inside dist/.
// =============================================================================
import { rm, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

// Everything the running app needs — and nothing else.
const PUBLIC = [
  'index.html', 'sw.js', 'manifest.webmanifest', '_headers',
  'icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'og-image.png',
  'src', 'screenshots',
];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
for (const p of PUBLIC) {
  const from = join(ROOT, p);
  if (!existsSync(from)) { console.error(`stage-dist: missing ${p}`); process.exit(1); }
  await cp(from, join(DIST, p), { recursive: true });
}
console.log(`staged dist/ (${PUBLIC.length} entries).`);
