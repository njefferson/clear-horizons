#!/usr/bin/env node
// =============================================================================
// gen-assets.mjs — one-shot generator for the committed image assets that a
// no-build static site can't produce at request time: the maskable PWA icons
// (192/512) and the 1200×630 social-card image. All drawn from icon.svg's own
// motif (night sky · gold target star · measured treeline) so they read as one
// identity. Re-run only when the brand art changes; the outputs are committed.
//
//   node scripts/gen-assets.mjs        (needs playwright-core + container Chromium)
// =============================================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('need: npm i --no-save playwright-core'); process.exit(1); }

const iconSvg = readFileSync(join(ROOT, 'icon.svg'), 'utf8');
const browser = await chromium.launch({ executablePath: CHROMIUM });

// --- maskable app icons: rasterise icon.svg at N×N on the brand navy ---------
async function icon(size, out) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#12131c">
    <div style="width:${size}px;height:${size}px">${iconSvg.replace('<svg', `<svg width="${size}" height="${size}"`)}</div>
  </body></html>`);
  await page.screenshot({ path: join(ROOT, out), clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log('wrote', out);
}

// --- 1200×630 social card ----------------------------------------------------
async function ogImage() {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  // The treeline path from icon.svg, scaled across the full 1200px width.
  await page.setContent(`<!doctype html><html><body style="margin:0">
    <div style="position:relative;width:1200px;height:630px;overflow:hidden;
      background:linear-gradient(180deg,#1b1e34 0%,#232a4a 55%,#3a3a5c 100%);
      font-family:Georgia,'Times New Roman',serif;color:#e9ecff">
      <svg width="1200" height="630" viewBox="0 0 1200 630" style="position:absolute;inset:0" preserveAspectRatio="none">
        <g fill="#e9ecff" opacity="0.9">
          <circle cx="180" cy="120" r="3"/><circle cx="920" cy="90" r="2.5"/><circle cx="1050" cy="210" r="3"/>
          <circle cx="120" cy="250" r="2.5"/><circle cx="720" cy="150" r="2"/><circle cx="420" cy="80" r="2"/>
          <circle cx="1120" cy="120" r="2"/><circle cx="300" cy="200" r="2"/>
        </g>
        <circle cx="880" cy="250" r="150" fill="#ffd88a" opacity="0.18"/>
        <path fill="#ffcf6b" d="M880 170l24 66 70 6-53 46 16 68-57-37-57 37 16-68-53-46 70-6z"/>
        <path fill="#0e1020" d="M0 630V430l70-40 40 34 55-70 60 46 50-86 64 66 60-46 54 60 70-104 60 78 64-48 54 66 64-86 60 60 70-36 60 70 64-60 60 52 64-78 70 66 40-40 60 60V630z"/>
      </svg>
      <div style="position:absolute;left:70px;top:150px;max-width:640px">
        <div style="font-size:76px;font-weight:600;line-height:1.05;letter-spacing:-0.5px">Horizon Planner</div>
        <div style="font-family:system-ui,sans-serif;font-size:30px;line-height:1.35;margin-top:22px;color:#c9cbe6">
          Plan your night against your <b style="color:#ffcf6b">real</b> horizon — the actual treeline, measured, not a flat&nbsp;0°.
        </div>
        <div style="font-family:ui-monospace,monospace;font-size:19px;margin-top:26px;color:#9aa0bd">
          offline · instrument-agnostic · free
        </div>
      </div>
    </div>
  </body></html>`);
  await page.screenshot({ path: join(ROOT, 'og-image.png'), clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await page.close();
  console.log('wrote og-image.png');
}

await icon(192, 'icon-192.png');
await icon(512, 'icon-512.png');
await ogImage();
await browser.close();
