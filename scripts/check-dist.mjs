#!/usr/bin/env node
// =============================================================================
// check-dist.mjs — assert the deploy bundle is complete and clean:
//   1. every asset the service worker precaches (sw.js ASSETS) exists in dist/;
//   2. no repo-internal file (NOTES.md, test/, scripts/, package.json, …) leaked
//      into dist/.
// Run after stage-dist.mjs. A missing precache asset means an installed PWA
// would break offline; a leaked file means we're publishing internals.
// =============================================================================
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
if (!existsSync(DIST)) { console.error('check-dist: dist/ missing — run stage-dist.mjs first.'); process.exit(1); }

const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const assetsBlock = sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1];
const assets = [...assetsBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);

const errors = [];
for (const a of assets) {
  const rel = a === './' ? 'index.html' : a.replace(/^\.\//, '');
  if (!existsSync(join(DIST, rel))) errors.push(`precached asset not in dist/: ${a}`);
}

// Nothing internal should have leaked in.
const FORBIDDEN = /^(NOTES\.md|REVIEW.*\.md|README\.md|LICENSE\.md|package\.json|test|scripts|node_modules|\.git)/;
for (const entry of readdirSync(DIST)) {
  if (FORBIDDEN.test(entry)) errors.push(`repo-internal file leaked into dist/: ${entry}`);
}

// Spot-check the bundle actually has the shell + a source module.
for (const must of ['index.html', 'sw.js', 'src/main.js', 'src/data/catalog.json']) {
  if (!existsSync(join(DIST, must))) errors.push(`missing essential file: ${must}`);
}

if (errors.length) {
  console.error('check-dist: FAILED\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
const count = assets.length;
console.log(`check-dist: OK — all ${count} precached assets present, no internals leaked.`);
