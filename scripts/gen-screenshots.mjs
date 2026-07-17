#!/usr/bin/env node
// =============================================================================
// gen-screenshots.mjs — capture the committed phone screenshots used by the
// manifest (PWA install cards) and the README. Boots the real app with a
// seeded site + favourites at iPhone size and shoots a few views. Re-run when
// the UI changes materially; outputs are committed under screenshots/.
//
//   node scripts/gen-screenshots.mjs      (needs playwright-core + Chromium)
// =============================================================================
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('need: npm i --no-save playwright-core'); process.exit(1); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const SEED = {
  'horizon.sites': JSON.stringify([{
    id: 'site-shot', name: 'Backyard', lat: 37.5, lon: -122, elevation_m: 0,
    horizon: Array.from({ length: 36 }, (_, i) => [i * 10, [12, 18, 22, 16, 8, 6][i % 6]]),
  }]),
  'horizon.activeSite': 'site-shot',
  'horizon.favorites': JSON.stringify(['NGC0224', 'NGC1976', 'NGC6720', 'NGC5194']),
};

await mkdir(join(ROOT, 'screenshots'), { recursive: true });
const browser = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await ctx.addInitScript((seed) => { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); }, SEED);
await ctx.route(/fonts\.g(oogleapis|static)\.com/, (r) => r.abort());
const page = await ctx.newPage();
page.setDefaultTimeout(10000);

async function shoot(hash, name, waitSel) {
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(waitSel);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(ROOT, 'screenshots', name) });
  console.log('wrote screenshots/' + name);
}

await shoot('#/', 'tonight.png', '.vis-row');
await shoot('#/capture', 'measure.png', '.cap-live');
await shoot('#/targets', 'targets.png', '.target-row');

await browser.close();
server.close();
