// =============================================================================
// terrainmap.js (UI) — the map-pin TERRAIN horizon (#/horizon/map), entered
// from the Horizon editor. Drop pins on distant ridges on a keyless satellite
// map (vendored Leaflet + free Esri World Imagery — no API key, no billing);
// each pin's (azimuth, altitude) from the active site is computed from
// geodesy + the Open-Meteo elevation model (model/terrain.js), listed in
// text, and applied to the SAME horizon profile as a hand-dragged handle.
//
// HONESTY (per NOTES, stated in the UI): elevation data has NO TREES — pins
// model distant ridgelines only; a tree-ringed yard needs the camera capture.
//
// ACCESSIBILITY. The map is pointer-first, so it is never the only way in:
// the "add by bearing + distance" form is the full keyboard path to the same
// pin math, every pin is a text row with a Remove button, and add/remove/
// apply announce via one role=status node. The map container itself is
// role=application with a label pointing at the form alternative.
//
// OFFLINE. Tiles and elevations are network features: tile failures leave a
// grey map, elevation failures announce plainly and add nothing. The saved
// horizon is only touched by an explicit Apply. Leaflet (vendored ESM +
// stylesheet) is dynamic-imported on first open so app boot stays light;
// both files are SW-precached, so the view itself loads offline.
// =============================================================================
import { el, clear, toast } from './dom.js';
import { activeSite, saveSiteHorizon } from '../model/sites.js';
import { makeHorizon, serializeHorizon } from '../model/horizon.js';
import { makePin, destPoint, applyPinsToProfile, fetchElevations } from '../model/terrain.js';

// services.arcgisonline.com is the CURRENT host for the classic keyless
// imagery; the old server.arcgisonline.com REDIRECTS there, and CSP validates
// every hop of a redirect — pointing at the final host avoids the hop (both
// hosts stay allow-listed in _headers in case Esri flips the direction).
const TILES = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ATTRIB = 'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community';

let tm = null; // view state: { site, siteElev, pins:[], map, L, markers:Map }
let root = null;
const mounted = () => root && root.isConnected;

export async function renderTerrainMap(app, state, nav) {
  clear(app);
  stopTerrainMap();
  const site = activeSite();
  if (!site) {
    app.append(
      el('h1', {}, 'Terrain horizon'),
      el('div.dead-end', {}, [
        el('h2', {}, 'No site yet'),
        el('p', {}, 'Terrain pins are measured from a site’s coordinates. Add one first.'),
        el('div.card-actions', {}, [el('button.btn.primary', { onclick: () => nav.go('#/sites') }, 'Go to Sites')]),
      ]));
    return;
  }

  tm = { site, siteElev: null, pins: [], map: null, L: null, markers: new Map() };
  buildShell(app, site, nav);
  window.addEventListener('hashchange', onHashLeave);
  await initMap(site);
  await initSiteElevation(site);
}

// --- shell -------------------------------------------------------------------
function buildShell(app, site, nav) {
  root = el('div.tm-root');

  const head = el('div.pa-head', {}, [
    el('h1', {}, 'Terrain horizon'),
    el('div.row-actions', {}, [
      el('button.chip.ng-site', { onclick: () => { stopTerrainMap(); nav.go('#/sites'); }, 'aria-label': `Site: ${site.name} — change` },
        [el('span', { 'aria-hidden': 'true' }, `📍 ${site.name}`)]),
      el('button.btn.small', { onclick: () => { stopTerrainMap(); nav.go('#/horizon'); } }, '← Horizon'),
    ]),
  ]);

  // The baked-in caveat — always visible, never fine print.
  const caveat = el('div.sky-notice', {}, [
    el('span', {}, '🌲 Elevation data has no trees — pins estimate distant ridgelines only. For a tree-ringed yard, '),
    el('button.linklike', { onclick: () => { stopTerrainMap(); nav.go('#/capture/live'); } }, 'measure with the camera'),
    el('span', {}, ' instead.'),
  ]);

  const mapBox = el('div.tm-map', {
    id: 'tm-map', role: 'application',
    'aria-label': 'Satellite map. Tap a distant ridge to drop a terrain pin. Keyboard users: the bearing and distance form below adds the same pins without the map.',
  });

  // The keyboard path — the same pin math with no pointer.
  const brg = el('input.loc-in', { type: 'number', min: '0', max: '359.9', step: '0.1', placeholder: '183' });
  const dist = el('input.loc-in', { type: 'number', min: '0.05', max: '80', step: '0.05', placeholder: '8.0' });
  const form = el('form.tm-form', {
    onsubmit: (e) => {
      e.preventDefault();
      const b = parseFloat(brg.value), d = parseFloat(dist.value);
      if (!(b >= 0 && b < 360) || !(d > 0)) { say('Enter a bearing 0–359° and a distance in km.'); return; }
      addPinAt(destPoint(tm.site, b, d * 1000));
    },
  }, [
    el('span.dim.small', {}, 'Add without the map:'),
    labeled('Bearing (° true)', brg),
    labeled('Distance (km)', dist),
    el('button.btn.small', { type: 'submit' }, '+ Add pin'),
  ]);

  const list = el('ul.tm-pins', { id: 'tm-pins' });
  const statusNode = el('p.dim.small', { id: 'tm-status', role: 'status', 'aria-live': 'polite' }, '');

  const apply = el('button.btn.primary', {
    id: 'tm-apply', disabled: true,
    onclick: () => {
      if (!tm.pins.length) return;
      const profile = makeHorizon(tm.site.horizon);
      applyPinsToProfile(profile, tm.pins);
      saveSiteHorizon(tm.site.id, serializeHorizon(profile));
      toast(`${tm.pins.length} terrain pin${tm.pins.length === 1 ? '' : 's'} applied to ${tm.site.name}.`);
      stopTerrainMap();
      nav.go('#/horizon'); // land on the editor so the new wedges are visible
    },
  }, 'Apply pins to horizon');

  root.append(
    head, caveat, mapBox, form,
    el('section.tm-listwrap', {}, [el('h2.tm-listhead', {}, 'Pins'), list, statusNode]),
    el('div.card-actions', {}, [apply]),
    el('p.settings-foot', {}, 'Each pin sets its 10° wedge of the horizon — the same as dragging that editor handle. Altitudes include earth curvature and standard refraction. Nothing is saved until you Apply.'),
  );
  app.append(root);
  renderPins();
}

function labeled(label, control) { return el('label.fld', {}, [el('span', {}, label), control]); }

// --- map ---------------------------------------------------------------------
async function initMap(site) {
  // Stylesheet + library load lazily on first open (both SW-precached).
  if (!document.querySelector('link[href$="vendor/leaflet.css"]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: './src/vendor/leaflet.css' }));
  }
  let L;
  try { L = await import('../vendor/leaflet.js'); }
  catch { say('The map library could not load.'); return; }
  if (!mounted() || !tm) return;
  tm.L = L;
  const map = L.map('tm-map', { zoomControl: true }).setView([site.lat, site.lon], 12);
  const tiles = L.tileLayer(TILES, { maxZoom: 17, attribution: ATTRIB }).addTo(map);
  // A grey map must never be silent: say WHY once, instead of looking broken.
  let tileFailSaid = false;
  tiles.on('tileerror', () => {
    if (tileFailSaid) return;
    tileFailSaid = true;
    say('Satellite imagery isn’t loading — check the connection. Pins still work from bearing + distance if elevations load.');
  });
  tiles.on('load', () => { tileFailSaid = false; });
  L.circleMarker([site.lat, site.lon], {
    radius: 7, color: '#0b0e17', weight: 2, fillColor: '#ffd166', fillOpacity: 1,
  }).addTo(map).bindTooltip(site.name);
  map.on('click', (e) => addPinAt({ lat: e.latlng.lat, lon: e.latlng.lng }));
  tm.map = map;
}

// The site's ground elevation anchors every pin altitude. The elevation MODEL
// value (not site.elevation_m, which is often 0/unknown) keeps site and pins
// on the same reference surface.
async function initSiteElevation(site) {
  try {
    const [e] = await fetchElevations([{ lat: site.lat, lon: site.lon }]);
    if (!tm) return;
    tm.siteElev = e;
    say(`Site elevation ${Math.round(e)} m. Tap a ridge to add a pin.`);
  } catch {
    if (!tm) return;
    say('Elevation lookup needs a connection — pins can’t be computed offline.');
  }
}

// --- pins --------------------------------------------------------------------
async function addPinAt(point) {
  if (!tm) return;
  if (tm.siteElev == null) { await initSiteElevation(tm.site); if (tm.siteElev == null) return; }
  let elev;
  try { [elev] = await fetchElevations([point]); }
  catch { say('Elevation lookup failed — check the connection and try again.'); return; }
  if (!tm || !mounted()) return;
  const pin = makePin(tm.site, tm.siteElev, point, elev);
  tm.pins.push(pin);
  if (tm.map && tm.L) {
    const m = tm.L.circleMarker([pin.lat, pin.lon], {
      radius: 6, color: '#0b0e17', weight: 2, fillColor: '#fff', fillOpacity: 1,
    }).addTo(tm.map).bindTooltip(pinLabel(pin));
    tm.markers.set(pin, m);
  }
  renderPins();
  say(`Pin added: ${pinLabel(pin)}.`);
}

function removePin(pin) {
  if (!tm) return;
  tm.pins = tm.pins.filter((p) => p !== pin);
  const m = tm.markers.get(pin);
  if (m && tm.map) tm.map.removeLayer(m);
  tm.markers.delete(pin);
  renderPins();
  say('Pin removed.');
}

function pinLabel(p) {
  return `az ${p.az.toFixed(0)}° · alt ${p.alt.toFixed(1)}° · ${(p.dist_m / 1000).toFixed(1)} km · elev ${Math.round(p.elev_m)} m`;
}

function renderPins() {
  const ul = root && root.querySelector('#tm-pins');
  const apply = root && root.querySelector('#tm-apply');
  if (!ul) return;
  if (!tm.pins.length) {
    ul.replaceChildren(el('li.tm-pin.dim.small', {}, 'No pins yet — tap a distant ridge on the map, or use the bearing form.'));
  } else {
    ul.replaceChildren(...tm.pins.map((p) => el('li.tm-pin', {}, [
      el('span.mono', {}, pinLabel(p)),
      el('button.btn.small', { onclick: () => removePin(p), 'aria-label': `Remove pin at azimuth ${p.az.toFixed(0)} degrees` }, 'Remove'),
    ])));
  }
  if (apply) apply.disabled = !tm.pins.length;
}

function say(msg) { const n = root && root.querySelector('#tm-status'); if (n) n.textContent = msg; }

// --- teardown ----------------------------------------------------------------
function onHashLeave() { if (!location.hash.startsWith('#/horizon/map')) stopTerrainMap(); }
export function stopTerrainMap() {
  window.removeEventListener('hashchange', onHashLeave);
  if (tm && tm.map) { try { tm.map.remove(); } catch { /* already gone */ } }
  tm = null;
}
