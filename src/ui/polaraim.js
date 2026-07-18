// =============================================================================
// polaraim.js (UI) — the live "point to the pole" aid (#/polar/aim). Hold the
// phone along the mount's polar/tilt axis (S50 EQ mode: the tripod tilt axis)
// and the camera shows where the celestial pole sits: a circled crosshair at
// the pole, Polaris (or σ Oct) on its dashed daily circle, the measured-horizon
// treeline for context, and live "34° left · 12° up" guidance until the axis
// locks ON TARGET (with hysteresis so the lock doesn't chatter).
//
// Forked from ui/sky.js — same getUserMedia + iOS motion-permission +
// orientation→(az,alt) + rAF pipeline (including the v2.0.1 iOS near-level
// compass anchor). Where sky.js draws a whole scrubbed scene, this aims at ONE
// fixed world point, so there's no scrubber or scene list here.
//
// FALLBACK. No camera (desktop, denied, insecure origin) → a static aim panel:
// the same pole numbers (altitude = your latitude, azimuth true north/south),
// the pole star's position, and the horizon-aware verdict. This is what the
// headless a11y/smoke gates render.
//
// ACCESSIBILITY. The overlay canvas is decorative (aria-hidden); the 60 Hz
// guidance readout is SILENT text by design. Discrete transitions only —
// camera on, compass on, target acquired/lost, camera failure — announce via
// one role=status node. On-target is never colour-alone: ring weight + ✓ glyph
// + "ON TARGET" text + the announcement.
// =============================================================================
import { el, clear, toast } from './dom.js';
import { activeSite } from '../model/sites.js';
import { makeHorizon, sampleAt, isFlat } from '../model/horizon.js';
import { declination } from '../model/geomag.js';
import { backCameraAzAlt, applyOffset, wrapOffset } from '../model/capture.js';
import { DEFAULT_FOV, projectPoint, horizonPolyline } from '../model/arproject.js';
import { polarAlignment, aimError, aimGuidance, poleCirclePoints } from '../model/polar.js';

// iOS webkitCompassHeading is only trustworthy while the phone isn't steeply
// pitched; re-anchor true north to it only within this band, then hold. Same
// constant + reasoning as ui/sky.js (the v2.0.1 flip fix).
const COMPASS_RELIABLE_ALT = 35;
const REFRESH_MS = 30000;   // the pole is fixed; the pole star creeps — re-read every 30 s

let pv = null;
let root = null;
const mounted = () => root && root.isConnected;

function freshState() {
  return {
    stream: null, source: null, cam: null, oriAttached: false,
    iosNorthOffset: null, declination: 0, fov: { ...DEFAULT_FOV }, raf: 0,
    site: null, profile: null, p: null, pAt: 0, circle: [],
    onTarget: false, canvas: null,
  };
}

export function renderPolarAim(app, state, nav) {
  clear(app);
  stopPolarAim();
  const site = activeSite();
  if (!site) {
    app.append(
      el('h1', {}, 'Point to the pole'),
      el('div.dead-end', {}, [
        el('h2', {}, 'No site yet'),
        el('p', {}, 'The aid aims at your site’s celestial pole — its latitude sets the pole’s altitude. Add a site first.'),
        el('div.card-actions', {}, [el('button.btn.primary', { onclick: () => nav.go('#/sites') }, 'Go to Sites')]),
      ]));
    return;
  }

  pv = freshState();
  pv.site = site;
  pv.profile = makeHorizon(site.horizon);
  pv.declination = declination(site.lat, site.lon);
  refreshAlignment();

  buildShell(app, site, nav);
  window.addEventListener('hashchange', onHashLeave);
  window.addEventListener('resize', onResize, { passive: true });
}

function refreshAlignment() {
  pv.p = polarAlignment(pv.site, new Date());
  pv.pAt = Date.now();
  pv.circle = poleCirclePoints(pv.p.pole, pv.p.separationDeg, 48);
}

// --- shell -------------------------------------------------------------------
function buildShell(app, site, nav) {
  root = el('div.lc-root');
  const p = pv.p;
  const label = site.name || `${site.lat.toFixed(2)}, ${site.lon.toFixed(2)}`;

  const head = el('div.pa-head', {}, [
    el('h1', {}, 'Point to the pole'),
    el('div.row-actions', {}, [
      el('button.chip.ng-site', { onclick: () => { stopPolarAim(); nav.go('#/sites'); }, 'aria-label': `Site: ${label} — change` },
        [el('span', { 'aria-hidden': 'true' }, `📍 ${label}`)]),
      el('button.btn.small', { onclick: () => { stopPolarAim(); nav.go('#/polar'); } }, '← Polar Align'),
    ]),
  ]);

  // The horizon-aware headline, above the viewfinder so it's never hidden
  // under it: can you even SEE the pole from this site?
  const notices = el('div.sky-notices', {}, [
    !p.poleAboveHorizon
      ? el('div.sky-notice', {}, [
          el('span', {}, `🌲 Your ${p.hemisphere} pole is behind the treeline — blocked by ${Math.abs(p.poleClearance).toFixed(1)}°. You can still aim the axis at it, but you can’t sight ${p.star.name} from here. `),
          el('button.linklike', { onclick: () => { stopPolarAim(); nav.go('#/horizon'); } }, 'Edit horizon'),
        ])
      : null,
    isFlat(pv.profile) && p.poleAboveHorizon
      ? el('div.sky-notice', {}, [
          el('span', {}, '📐 Flat horizon — measure your treeline so this can warn you if the pole is blocked. '),
          el('button.linklike', { onclick: () => { stopPolarAim(); nav.go('#/capture/live'); } }, 'Measure your horizon'),
        ])
      : null,
  ]);

  const stage = el('div.lc-stage', { id: 'aim-stage' });

  const controls = el('div.lc-controls', {}, [
    el('p.dim.small', {}, `Hold the phone along the mount’s polar axis (S50 EQ mode: the tripod tilt axis) and move until the ${p.hemisphere === 'north' ? 'NCP' : 'SCP'} marker locks on target — altitude equals your latitude (${p.pole.altitude.toFixed(1)}°), azimuth true ${p.pole.azimuth === 0 ? 'north' : 'south'}. Then fine-tune with the reticle clock on the Polar tab.`),
  ]);

  root.append(head, notices, stage, controls);
  app.append(root);
  startAR(stage);
}

// --- camera / AR mode --------------------------------------------------------
function startAR(stage) {
  const video = el('video.lc-video', { autoplay: true, playsinline: true, muted: true, 'aria-hidden': 'true' });
  video.muted = true;
  const canvas = el('canvas.lc-canvas', { 'aria-hidden': 'true' });
  const cta = el('div.sky-cta', { id: 'aim-cta' }, [
    el('span.sky-cta-icon', { 'aria-hidden': 'true' }, '🧭'),
    el('p.sky-cta-msg', {}, 'Turn on the compass so the pole marker lines up with your camera.'),
    el('button.btn.primary', { id: 'aim-cta-btn', onclick: enableMotion, 'aria-label': 'Turn on compass and tilt sensors' }, '🧭 Turn on compass'),
  ]);
  stage.append(
    video, canvas, cta,
    el('div.lc-readout.mono', { id: 'aim-readout' }, 'enabling camera…'),
    el('p.lc-hint.small', { id: 'aim-hint', role: 'status', 'aria-live': 'polite' }, ''),
  );
  pv.canvas = canvas;
  startCamera(video, canvas);
  if (!motionIsGated()) attachOrientation();
  toggleCta(!pv.cam);
}

async function startCamera(video, canvas) {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) { cameraFailed('This device has no camera API.'); return; }
  try {
    const stream = await md.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (!mounted()) { stopTracks(stream); return; }
    pv.stream = stream;
    video.srcObject = stream;
    video.play().catch(() => {});
    sizeCanvasRaw(canvas);
    say('Camera on. Aim the phone where the pole marker sits.');
    tickDraw(canvas);
  } catch (err) {
    const why = err && err.name === 'NotAllowedError' ? 'Camera permission was denied.'
      : err && err.name === 'NotFoundError' ? 'No camera was found.'
      : 'The camera could not start here (needs a secure https origin).';
    cameraFailed(why);
  }
}

// No camera → the same aim, as numbers. Rendered synchronously so the headless
// gates (no mediaDevices) always audit this complete panel.
function cameraFailed(why) {
  if (!mounted() || !pv) return;
  detachOrientation();
  stopTracks(pv.stream); pv.stream = null;
  if (pv.raf) { cancelAnimationFrame(pv.raf); pv.raf = 0; }
  const stage = root.querySelector('#aim-stage');
  if (!stage) return;
  clear(stage);
  stage.classList.add('lc-nocam');
  const p = pv.p;
  const compass = p.pole.azimuth === 0 ? 'true north' : 'true south';
  stage.append(
    el('div.pa-card', {}, [
      el('h2', {}, 'Aim by the numbers'),
      el('div.pa-specs', {}, [
        aimSpec('Altitude', `${p.pole.altitude.toFixed(1)}°`, 'tilt the polar axis up this much'),
        aimSpec('Azimuth', `${p.pole.azimuth}° · ${compass}`, 'swing it to this bearing'),
        aimSpec(p.star.name, `az ${p.star.azimuth.toFixed(1)}° · alt ${p.star.altitude.toFixed(1)}°`,
          p.star.aboveHorizon ? 'visible now' : 'below your horizon now'),
      ]),
      el('p.dim.small', {}, `${why} These numbers are the same aim — set the axis with a level and a compass, or open this on your phone at the mount.`),
      el('div.card-actions', {}, [
        el('button.btn.small', { onclick: () => pv && pvNav('#/polar') }, 'Polar Align'),
        el('button.btn.small', { onclick: () => pv && pvNav('#/horizon') }, 'Horizon'),
      ]),
    ]),
  );
  say(`No live camera — showing the aim as numbers instead. ${why}`);
}
function aimSpec(k, v, hint) {
  return el('div.pa-spec', {}, [
    el('span.pa-spec-k', {}, k),
    el('span.pa-spec-v', {}, v),
    hint ? el('span.pa-spec-hint', {}, hint) : null,
  ]);
}
function pvNav(hash) { stopPolarAim(); location.hash = hash; }

// --- orientation (same pipeline as ui/sky.js) --------------------------------
function motionIsGated() {
  return typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';
}
function toggleCta(show) {
  const c = root && root.querySelector('#aim-cta');
  if (c) c.hidden = !show;
}
async function enableMotion() {
  try {
    if (motionIsGated()) {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') { toast('Compass permission was denied — the numbers on the Polar tab give the same aim.'); return; }
    }
  } catch { toast('Could not request compass access here.'); return; }
  attachOrientation();
  say('Compass on — move the phone until the pole marker locks on target.');
}
function attachOrientation() {
  if (!pv || pv.oriAttached) return;
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
  pv.oriAttached = true;
}
function detachOrientation() {
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  window.removeEventListener('deviceorientation', onOrientation);
  if (pv) pv.oriAttached = false;
}
function onOrientation(e) {
  if (!pv || e.alpha == null || e.beta == null) return;
  // Camera axis from the FULL orientation matrix — azimuth stays put under
  // pitch (the v2.0.1 fix); iOS compass anchors true north only near level.
  const { azimuth: azRel, altitude: alt } = backCameraAzAlt(e.alpha, e.beta, e.gamma == null ? 0 : e.gamma);
  let magAz;
  if (e.webkitCompassHeading != null) {
    pv.source = 'ios';
    if (pv.iosNorthOffset == null || Math.abs(alt) <= COMPASS_RELIABLE_ALT) {
      pv.iosNorthOffset = wrapOffset(e.webkitCompassHeading - azRel);
    }
    magAz = applyOffset(azRel, pv.iosNorthOffset);
  } else {
    pv.source = (e.absolute || e.type === 'deviceorientationabsolute') ? 'absolute' : 'relative';
    magAz = azRel;
  }
  pv.cam = { az: applyOffset(magAz, pv.declination), alt };
}

// --- draw loop ---------------------------------------------------------------
function tickDraw(canvas) {
  if (!mounted() || !pv) return;
  if (Date.now() - pv.pAt > REFRESH_MS) refreshAlignment();
  drawAim(canvas);
  updateReadout();
  toggleCta(!pv.cam);
  pv.raf = requestAnimationFrame(() => tickDraw(canvas));
}

function updateReadout() {
  const r = root && root.querySelector('#aim-readout');
  if (!r) return;
  if (!pv.cam) { r.textContent = 'waiting for compass…'; return; }
  const err = aimError(pv.cam, pv.p.pole);
  const g = aimGuidance(err, pv.onTarget);
  // Announce only the TRANSITION (role=status); the readout itself stays silent.
  if (g.onTarget !== pv.onTarget) {
    say(g.onTarget
      ? 'On target — the axis is aimed at the pole. Lock the mount down.'
      : 'Drifted off target.');
    pv.onTarget = g.onTarget;
  }
  const decl = `true N (${pv.declination >= 0 ? '+' : ''}${pv.declination.toFixed(1)}° decl)`;
  r.textContent = g.onTarget
    ? `ON TARGET ✓ · off by ${err.separationDeg.toFixed(1)}° · ${decl}`
    : `pole: ${g.text} · off by ${err.separationDeg < 10 ? err.separationDeg.toFixed(1) : Math.round(err.separationDeg)}° · ${decl}`;
}

function drawAim(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  drawCentreReticle(ctx, W, H);
  if (!pv.cam) return;

  const cam = pv.cam, fov = pv.fov, p = pv.p;
  const toXY = (q) => [(0.5 + q.x) * W, (0.5 + q.y) * H];

  // Measured horizon (context) — thin white polyline, same as sky/live capture.
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = Math.max(1, W / 360);
  strokePolyPx(ctx, horizonPolyline(pv.profile, sampleAt, cam, fov, 2).map(toXY));

  const pole = { az: p.pole.azimuth, alt: p.pole.altitude };
  const q = projectPoint(pole, cam, fov);
  const fontPx = Math.max(12, Math.round(W / 34));

  // The pole star's dashed daily circle + the star itself.
  ctx.save();
  ctx.setLineDash([Math.max(3, W / 150), Math.max(3, W / 150)]);
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = Math.max(1, W / 400);
  strokePolyPx(ctx, [...pv.circle, pv.circle[0]].map((c) => toXY(projectPoint(c, cam, fov))));
  ctx.restore();
  if (p.star.aboveHorizon) {
    const s = projectPoint({ az: p.star.azimuth, alt: p.star.altitude }, cam, fov);
    if (s.onScreen) {
      const [sx, sy] = toXY(s);
      ctx.fillStyle = '#0b0e17';
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(3.5, W / 130), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(2.2, W / 200), 0, Math.PI * 2); ctx.fill();
      drawLabelPx(ctx, p.star.name, sx + Math.max(8, W / 48), sy, '#fff', Math.max(11, fontPx - 2));
    }
  }

  // The pole marker: circled crosshair. On target → heavier ring + ✓ (state is
  // also carried by the readout text + the status announcement, never colour).
  if (q.onScreen) {
    const [x, y] = toXY(q);
    const r = Math.max(14, W / 26);
    const wgt = pv.onTarget ? Math.max(4, W / 110) : Math.max(2, W / 220);
    ctx.strokeStyle = '#0b0e17'; ctx.lineWidth = wgt + 2;
    circledCross(ctx, x, y, r);
    ctx.strokeStyle = pv.onTarget ? '#ffd166' : '#fff'; ctx.lineWidth = wgt;
    circledCross(ctx, x, y, r);
    const name = p.hemisphere === 'north' ? 'NCP' : 'SCP';
    drawLabelPx(ctx, pv.onTarget ? `${name} ✓` : name, x + r + 6, y, pv.onTarget ? '#ffd166' : '#fff', fontPx);
  } else {
    // Edge arrow toward the pole, always paired with the text guidance.
    drawEdgeArrow(ctx, q, W, H);
  }
}

function circledCross(ctx, x, y, r) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 1.45, y); ctx.lineTo(x - r * 0.55, y);
  ctx.moveTo(x + r * 0.55, y); ctx.lineTo(x + r * 1.45, y);
  ctx.moveTo(x, y - r * 1.45); ctx.lineTo(x, y - r * 0.55);
  ctx.moveTo(x, y + r * 0.55); ctx.lineTo(x, y + r * 1.45);
  ctx.stroke();
}

function drawEdgeArrow(ctx, q, W, H) {
  // Clamp the (off-frame) projected point's direction to the frame border.
  const ang = Math.atan2(q.y, q.x);
  const k = 0.42 / Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)));
  const x = (0.5 + Math.cos(ang) * k) * W, y = (0.5 + Math.sin(ang) * k) * H;
  const r = Math.max(10, W / 40);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(-r * 0.5, -r * 0.6); ctx.lineTo(-r * 0.5, r * 0.6); ctx.closePath();
  ctx.fillStyle = '#0b0e17'; ctx.lineWidth = 3; ctx.strokeStyle = '#0b0e17'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();
}

function drawCentreReticle(ctx, W, H) {
  const cx = W / 2, cy = H / 2;
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = Math.max(1, W / 500);
  ctx.beginPath();
  ctx.moveTo(cx - W * 0.03, cy); ctx.lineTo(cx + W * 0.03, cy);
  ctx.moveTo(cx, cy - W * 0.03); ctx.lineTo(cx, cy + W * 0.03);
  ctx.stroke();
}
function strokePolyPx(ctx, pts) {
  if (!pts.length) return;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}
function drawLabelPx(ctx, text, x, y, color, fontPx) {
  ctx.font = `600 ${fontPx}px 'IBM Plex Sans', system-ui, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, fontPx / 4); ctx.strokeStyle = '#0b0e17'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

// --- sizing / helpers --------------------------------------------------------
function sizeCanvasRaw(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
}
function onResize() { if (mounted() && pv && pv.canvas) sizeCanvasRaw(pv.canvas); }
function say(msg) { const n = root && root.querySelector('#aim-hint'); if (n) n.textContent = msg; }

// --- teardown ----------------------------------------------------------------
function onHashLeave() { if (!location.hash.startsWith('#/polar/aim')) stopPolarAim(); }
function stopTracks(stream) { try { stream && stream.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ } }
export function stopPolarAim() {
  window.removeEventListener('hashchange', onHashLeave);
  window.removeEventListener('resize', onResize);
  detachOrientation();
  if (pv) {
    if (pv.raf) cancelAnimationFrame(pv.raf);
    stopTracks(pv.stream);
    pv.stream = null; pv.raf = 0;
  }
}
