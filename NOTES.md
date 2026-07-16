# S50 Horizon Planner — NOTES (source of truth)

Read this before doing anything. It carries the product thesis, the build order,
the reuse map from Noah's existing repos, settled decisions, and the roadmap.
Structure mirrors the two sibling apps (Bird-location-scouting, Jefferson-
Photography-Studio): free, on-device, offline-first PWA on Cloudflare Pages.

## Product thesis — synergy + one new capability
Every individual feature already exists free (Telescopius = catalog/curves/
thumbnails; Astrospheric/Clear Outside = weather/seeing; Polar Scope Align =
polar reticle; the Seestar app = rise/set). This app's value is **synergy** —
one tool tying site + horizon + targets + alignment together — **plus the one
thing no free tool does well: a custom, per-site, physically-measured horizon
profile** (the real trees/obstructions from the actual yard). Every visibility
answer reflects what you can really see, not a 0° horizon.

Two novel capabilities anchor everything:
1. **Measured horizon mask** — walk into the yard, capture the treeline, get a
   real azimuth→altitude profile.
2. **"Above MY horizon" visibility** — a target (or the celestial pole) counts as
   usable only where its altitude clears the measured profile at its azimuth.

Settled decisions: **Balanced core** v1 scope · **no-build vanilla ES modules**
(mirror the bird app, not the Vite/TS photo studio) · Cloudflare Pages with a
`staging` on-device gate before `main`.

**Future direction — instrument-agnostic.** The horizon capability has nothing to
do with the S50 specifically; it applies to any telescope. This app will grow from
the S50 default to the **S30, other smart telescopes (Dwarf, Vaonis Vespera, etc.),
and fully custom sensor/focal-length profiles for planning ANY telescope**. So the
field-of-view is modeled as a **first-class per-instrument profile from day one**
(v1 ships the S50 as the default), NOT a hardcoded constant — every "does it fit /
how many mosaic panels / framing overlay" answer reads from the active instrument.
(Consider a scope-neutral repo name — e.g. `horizon-planner` — since it outgrows
"s50"; the localStorage `s50.*` prefix can stay to avoid churn, or start neutral.)

## Reuse map — copy from `Bird-location-scouting/frame/`
The bird app is the structural template. Reuse near-verbatim:
- **`src/ui/dom.js`** — `el()` (null-safe hyperscript), `clear()`, `toast()` (Undo
  action), `sparkline()`. Copy wholesale. GOTCHA: native
  `replaceChildren/append/prepend` are NOT null-safe — only pass `.filter(Boolean)`
  arrays to them (`el()` itself is null-safe).
- **`src/ui/panzoom.js`** — domain-agnostic pinch/pan over an SVG+viewBox (Pointer
  Events, rAF-batched viewBox writes, `elementFromPoint`-in-`pointerup` tap
  resolution because SVG pointer-capture eats native clicks). Reuse for the **night
  graph** scrub and the **horizon editor**. Drop `controls()` if unwanted.
- **`sw.js`** — hand-written SW: versioned cache (`s50-vN`), per-asset precache via
  `Promise.allSettled` (never `addAll` — one flaky asset breaks offline), `activate`
  that **carries forward** runtime-cached data across version bumps,
  stale-while-revalidate + network-first navigations. Change `CACHE` + `ASSETS`.
  Cache 200s only; `clone()` before `respondWith`.
- **`index.html`** boot shape — pre-paint theme IIFE reading `s50.theme` before
  first paint, apple PWA metas, `viewport-fit=cover`, single `<script type=module>`
  entry, hash routing.
- **`.github/workflows/deploy.yml`** — Cloudflare Pages via `wrangler-action@v3`;
  `--branch=main` = production, any other branch = a preview URL. That's the whole
  `staging` gate. Change `--project-name`. **No `functions/` proxy needed** —
  Open-Meteo + astronomy-engine are keyless and CORS-friendly (unlike eBird).
- **`scripts/build-counties.mjs`** + **`gen-basemap.mjs`** — the curation pattern
  for the OpenNGC catalog builder: `#!/usr/bin/env node` ESM, subcommand dispatch,
  polite fetch, filter/round, write a committed generated file with an
  "AUTO-GENERATED" header + `builtAt` stamp, incremental `--force`, `validate` CI
  gate.
- Conventions: `s50.*` localStorage keys with inline `try/catch`; `#/import?...`
  share-links for export/import; `:root` CSS tokens + `[data-theme="dark"]` (never
  hex-in-place); IBM Plex, mono for every number; release = SW cache version bumped
  with the changelog; work on a `claude/*` branch → `staging` → on-device go → PR to
  `main`.

The **night graph** follows the photo studio's one hand-rolled viz routine,
`Jefferson-Photography-Studio/src/histogram.ts` (Canvas 2D, closure-based `x()/y()`
scales, filled areas + stroked outline, cheap repaint). No chart library anywhere
in Noah's work — hand-roll on canvas.

## Layout (`s50-horizon-planner/`)
```
index.html  sw.js  manifest.webmanifest  icon.svg  apple-touch-icon.png
src/
  main.js                     bootstrap, state, hash routing, SW register
  ui/  dom.js panzoom.js       (copied) + nightgraph.js horizoneditor.js
       sites.js targets.js settings.js theme.js about.js
  model/ astro.js             astronomy-engine wrappers: alt/az(t), sun/moon, twilight
         horizon.js           profile model + Stellarium import/export + sample-at-az
         visibility.js        curve ∩ horizon → effective windows (+ geometric)
         instruments.js       instrument profiles (FOV, mount traits); active = s50.instrument
         sites.js targets.js  localStorage state (s50.sites, s50.targets, s50.favorites)
         catalog.js           load bundled catalog, type/mag/size + fits-active-FOV filters
  data/  catalog.json         AUTO-GENERATED (OpenNGC → S50-worthy subset)
  vendor/ astronomy.js        astronomy-engine ESM, vendored (offline, no CDN)
scripts/ build-catalog.mjs    OpenNGC → filtered committed JSON + validate
.github/workflows/deploy.yml
```

## Astronomy & data
- **astronomy-engine** (MIT, ~100 KB, no network) — vendored as a local ESM in
  `src/vendor/`. Alt/az of any RA/Dec vs. time; Sun altitude → twilight bands; Moon
  altitude + phase; Polaris/NCP for the polar-align roadmap item.
- **Instrument profiles** (`model/instruments.js`, `data/instruments.js`): each is
  `{ name, focalLength_mm, sensor: {w_mm,h_mm} | {w_px,h_px,pixel_um}, fov: {w_deg,
  h_deg} (computed if absent), mount: { altAz: bool, eqCapable: bool,
  zenithDeadZone_deg } }`. v1 bundles the **S50** (fov ≈ 1.29° × 0.73°) as the
  default and the **S30** (wider — shorter focal length; compute from its specs, do
  NOT guess). Active instrument in `s50.instrument`; user-added customs in
  `s50.instruments`. **Every FOV/mosaic/framing decision reads the active profile —
  never a hardcoded constant.**
- **Catalog**: OpenNGC (CC-BY-SA) → `build-catalog.mjs` filters to a broad,
  instrument-neutral subset (Messier + Caldwell + NGC/IC brighter than ~mag 12).
  Store RA/Dec, type, mag, **raw** angular size, common name — do NOT bake a
  `mosaic` flag; **fit-vs-mosaic (and panel count) is computed at runtime against
  the active instrument's FOV**, so the same catalog serves the S50, S30, and any
  custom scope. Few hundred KB.
- **Deferred to roadmap (all keyless):** thumbnails via CDS hips2fits; weather via
  Open-Meteo hourly cloud cover (total/low/mid/high) + 7Timer ASTRO for
  seeing/transparency (7Timer is the only keyless seeing source and is flaky —
  degrade gracefully). Cache per site per night in the Cache API.

## Build order — Balanced core (v1)
1. **Scaffold**: copy `dom.js`, `panzoom.js`, `sw.js`, `index.html`, `deploy.yml`;
   wire hash routing + tabs + theme; vendor astronomy-engine. Deploy an empty shell
   to `staging` to prove the pipeline before features.
2. **`model/astro.js`**: alt/az(target, lat/lon, t); Sun-altitude twilight
   (civil/nautical/astro); Moon altitude + phase. Headless Node unit tests.
3. **Catalog + instruments**: `build-catalog.mjs` → `data/catalog.json`;
   `model/catalog.js` + `model/instruments.js` (S50 default, S30 bundled) + filter
   UI (type, magnitude, size, and a **fits-the-active-instrument / mosaic-N×M**
   tier; favorites in `s50.favorites`). Instrument switcher in Settings.
4. **Horizon model + manual editor FIRST** (`model/horizon.js`,
   `ui/horizoneditor.js`): 36-row (10° azimuth) table, direct-manipulation drag to
   set each altitude, Stellarium horizon-file import/export. 100% headless-testable —
   de-risks the whole data model before any device-sensor work.
5. **Night graph** (`ui/nightgraph.js`): hand-rolled canvas — altitude-vs-time
   curves for selected targets, **the site horizon applied as the cutoff**, twilight
   bands, sun/moon markers + phase. Scrub via `panzoom.js`.
6. **Visibility table** (`model/visibility.js`): from the same computation, show
   **both** geometric rise/set **and** effective "above MY horizon" windows
   (effective emphasized). Subtract the near-zenith dead-zone too (see S50 notes).
7. **Sites manager** (`model/sites.js`, `ui/sites.js`): multiple named sites
   (lat/lon + own horizon profile), switcher, JSON export/import.

## Roadmap (deferred — post-v1, rough order)
- **Sensor-trace horizon capture** — live camera preview + crosshair; log
  (azimuth, altitude) from DeviceOrientation while sweeping the treeline; iOS
  `DeviceOrientationEvent.requestPermission()` on a tap, `webkitCompassHeading` for
  true-north azimuth; optional calibration against the Sun's/a star's computed
  azimuth. **Device-only — not headless-testable; a NEEDS-HIS-HANDS feature.**
- **Polar-alignment tools** (Noah's ask; the synergy showcase):
  - Compute the **NCP** (alt ≈ latitude, az = true north) and **Polaris' live
    reticle clock position** via astronomy-engine.
  - **Horizon-aware** — the novel part vs. Polar Scope Align / PS Align Pro (which
    already nail the reticle for free): use the site horizon mask to warn when the
    pole is **behind the north treeline** from this site.
  - **"Point to the pole" live aid** reusing the sensor-trace DeviceOrientation +
    compass-calibration stack. Framed for **S50 EQ mode** (aim the tripod tilt axis
    at the NCP for longer exposures).
- **Multi-instrument + custom sensor** (the instrument model is built in v1; this is
  the fuller UX on top): a preset library (S30, Dwarf II/3, Vespera, …) plus a
  **custom-scope editor** (enter focal length + sensor mm or px + pixel size → FOV)
  so anyone can plan for any telescope. A **framing overlay** draws the active FOV
  rectangle (+ mosaic grid) over the object thumbnail. Presets ship in
  `data/instruments.js`; customs persist in `s50.instruments` and export/import with
  sites so they aren't trapped in one browser.
- **Weather overlay** — Open-Meteo cloud cover shaded behind the night graph on the
  same time axis, then 7Timer seeing/transparency. Cache per site/night.
- **Thumbnails** — hips2fits per object, on demand, Cache-API cached.
- **Map-pin terrain horizon** (Noah's "10° in 360°" scaling idea): drop pins on a
  **keyless** satellite map (Leaflet + free Esri imagery — NOT Google Maps, which
  needs an API key + billing) + a free elevation API to estimate a **terrain**
  horizon. Caveat to bake in: elevation data has **no trees**, so map-pins only
  model distant ridgelines; the physical sensor-trace stays the only accurate
  capture for a tree-ringed yard. Feeds the *same* 36-row model — clean to add.
- **Sky-segmentation capture (v2 stretch)** — daylight panned-video skyline
  threshold → alt/az. Hard parts: per-phone FOV calibration, compass drift.

## Instrument notes (bake in, don't rediscover)
- **Custom horizon is the whole point** — never silently fall back to 0° rise/set.
- **FOV is per-instrument, never a constant.** S50 ≈ 1.29° × 0.73°; the S30 is
  wider; customs come from focal length + sensor size. Fit-vs-mosaic and any framing
  overlay read the **active** instrument's FOV.
- **Near-zenith dead-zone** is a per-mount trait (`mount.zenithDeadZone_deg`): an
  alt-az smart scope suffers fast field rotation / tracking trouble near the zenith
  (S50 ~≥85°). Effective visibility subtracts this high-altitude exclusion as well
  as the low treeline — a *second* horizon competitors don't model. EQ-capable
  scopes (S50 EQ mode) can relax it.
- **Mosaics changed "too big"**: don't drop oversized objects — compute how many
  panels they need for the active instrument and label the tier.

## Honest novelty map (alert if re-cloning)
| Feature | Exists free | Our novel angle |
|---|---|---|
| Catalog + type/mag filters | Telescopius, Stellarium | substrate for the horizon mask; bundled/offline |
| Alt-vs-time curves | Telescopius | **cut by MY measured horizon**, not a flat minimum |
| Rise/set table | Seestar app | **effective** "above my treeline" windows |
| Weather/seeing | Astrospheric, Clear Outside | shaded on the *same* night-graph axis |
| Polar reticle | Polar Scope Align, PS Align Pro | **horizon-aware** ("can I see the pole?") + unified |
| **Custom measured horizon** | *(no good free tool)* | **the new capability** |

## Verification (owner culture: verify before claiming fixed)
- **Node headless unit tests** for `astro.js`, `horizon.js`, `visibility.js` (alt/az
  vs. known ephemeris; horizon sample-at-azimuth interpolation; window intersection
  incl. wrap-around midnight). Make each test **fail once** before trusting it.
- **Headless Chromium** (`npm i --no-save esbuild playwright-core`, browser at
  `/opt/pw-browsers/chromium`) for night-graph render, horizon-editor drag, filters,
  both themes — poll **synchronous DOM** (Playwright `waitForFunction` does NOT await
  Promise predicates; a Promise is truthy, so such a poll "passes" instantly).
- **NEEDS-HIS-HANDS (device-only, state plainly):** DeviceOrientation permission
  flow, compass accuracy/drift, camera preview + crosshair sweep, the polar-align
  "point to pole" aid, iPad pinch/scroll feel, PWA install + offline.
- Walk the full first-run journey (no sites yet) before any handoff; honest dead-end
  when no site/horizon exists.

## One-time setup (before the first build session)
1. Create empty GitHub repo `s50-horizon-planner` + a Cloudflare Pages project of
   the same name.
2. Set repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (same as the
   other two apps).
3. Start a fresh Claude session with this repo in the source picker; commit this
   file as `NOTES.md`. Build in the order above; ship each step to `staging` for the
   on-device pass before merging to `main`.
