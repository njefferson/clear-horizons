// =============================================================================
// horizon.js — the measured horizon profile: the app's novel capability. v2:
// a profile is an ARBITRARY-RESOLUTION list of (azimuth, altitude) points —
// { points: [{ az, alt }, …] }, sorted by azimuth, wrap-aware — because sensor
// capture bins at 1° and Stellarium files carry their own density; a fixed
// 36-bin array threw that detail away. The 36-row grid lives on as the MANUAL
// EDITOR's view (STEP/N/azForIndex below): handles read sampleAt(az), and a
// drag replaces the stored points within ±STEP/2 of that azimuth — correcting
// a captured wedge by hand coarsens just that wedge.
//
// Altitudes may go below 0° (hilltop/balcony sites; floor ALT_MIN) — capture
// and import produce negatives; manual edits stay clamped to [0, 90].
// sampleAt() interpolates at any azimuth (wrapping cleanly past north), and
// isAbove() is the "above MY horizon" primitive every visibility answer
// stands on. 100% headless-testable. Sites persist profiles as [[az, alt], …]
// pairs (serializeHorizon); legacy 36-arrays convert on load (makeHorizon).
// =============================================================================

export const STEP = 10;          // manual-editor grid: degrees per handle
export const N = 360 / STEP;     // 36 handles
export const ALT_MIN = -60;      // depressed horizons (hilltops, downhill, low
                                 // obstructions) go steep; floor short of straight-down
export const ALT_MAX = 90;

const clampAlt = (a) => Math.max(ALT_MIN, Math.min(ALT_MAX, a));
const norm360 = (az) => ((az % 360) + 360) % 360;
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Build a profile from any shape this app has ever stored:
 *   makeHorizon()                     → flat 0° horizon
 *   makeHorizon([0, 5, 12, …])        → legacy fixed grid (36 rows at 10°)
 *   makeHorizon([[az, alt], …])       → serialized pairs (sites/backups v2)
 *   makeHorizon({ points: [...] })    → a live profile (cloned)
 *   makeHorizon({ altitudes: [...] }) → legacy persisted shape
 * @returns { points: [{ az, alt }, …] } sorted, ≥ 1 point.
 */
export function makeHorizon(input) {
  if (input && Array.isArray(input.points)) {
    return fromPoints(input.points.map((p) => ({ az: p.az, alt: p.alt })));
  }
  if (input && Array.isArray(input.altitudes)) return fromGrid(input.altitudes);
  if (Array.isArray(input) && input.length) {
    if (Array.isArray(input[0])) return fromPoints(input.map(([az, alt]) => ({ az, alt })));
    return fromGrid(input);
  }
  return { points: [{ az: 0, alt: 0 }] };
}

// Legacy fixed grid: element i sits at azimuth i·(360/length).
function fromGrid(arr) {
  const step = 360 / arr.length;
  return fromPoints(arr.map((a, i) => ({ az: i * step, alt: Number.isFinite(Number(a)) ? Number(a) : 0 })));
}

// Normalize, dedupe (last entry at an azimuth wins), sort. Both coordinates
// are stored at 2 dp so profiles survive serialize→load byte-identically.
function fromPoints(list) {
  const byAz = new Map();
  for (const p of list) {
    const az = norm360(Number(p.az)), alt = Number(p.alt);
    if (Number.isFinite(az) && Number.isFinite(alt)) byAz.set(round2(az), round2(clampAlt(alt)));
  }
  if (!byAz.size) return { points: [{ az: 0, alt: 0 }] };
  const points = [...byAz.entries()].map(([az, alt]) => ({ az, alt })).sort((a, b) => a.az - b.az);
  return { points };
}

/** The serialized form sites and backups store: [[az, alt], …] (2 dp). */
export function serializeHorizon(profile) {
  return profile.points.map((p) => [round2(p.az), round2(p.alt)]);
}

/** The azimuth (degrees) of manual-editor row `i`. */
export function azForIndex(i) { return ((i % N) + N) % N * STEP; }

/** Nearest manual-editor row index to an azimuth. */
export function indexForAz(az) { return Math.round(norm360(az) / STEP) % N; }

/**
 * Manual edit at grid row `i` (mutates; returns the profile): drop every
 * stored point within ±STEP/2 of that azimuth (wrap-aware) and pin the row's
 * azimuth to `altitude`, clamped to the editor's [0, 90] range.
 */
export function setAltitudeAt(profile, i, altitude) {
  const az = azForIndex(i);
  const half = STEP / 2;
  const dist = (p) => { const d = Math.abs(p.az - az); return Math.min(d, 360 - d); };
  const kept = profile.points.filter((p) => dist(p) > half);
  kept.push({ az, alt: clampAlt(altitude) }); // manual edits may go below 0° (downhill/depressed horizons)
  kept.sort((a, b) => a.az - b.az);
  profile.points = kept;
  return profile;
}

/**
 * Interpolated obstruction altitude at any azimuth: linear between the two
 * bracketing points, wrapping across the north seam so 359°→0° is continuous.
 */
export function sampleAt(profile, az) {
  const pts = profile.points;
  if (pts.length === 1) return pts[0].alt;
  const x = norm360(az);
  const i = pts.findIndex((p) => p.az > x);
  let a, b, span, into;
  if (i <= 0) { // before the first point or after the last → the seam segment
    a = pts[pts.length - 1]; b = pts[0];
    span = b.az + 360 - a.az;
    into = i === 0 ? x + 360 - a.az : x - a.az;
  } else {
    a = pts[i - 1]; b = pts[i];
    span = b.az - a.az;
    into = x - a.az;
  }
  if (span <= 0) return a.alt;
  return a.alt + (into / span) * (b.alt - a.alt);
}

/**
 * Is a point at (azimuth, altitude) above the measured horizon? The core
 * "above MY horizon" test. Optionally require clearing the treeline by a margin.
 */
export function isAbove(profile, az, altitude, margin = 0) {
  return altitude > sampleAt(profile, az) + margin;
}

/** Highest obstruction anywhere (degrees). */
export function maxAltitude(profile) { return Math.max(...profile.points.map((p) => p.alt)); }

/** True if nothing is obstructed (flat 0° horizon). */
export function isFlat(profile) { return profile.points.every((p) => p.alt === 0); }

// --- Stellarium import / export ---------------------------------------------
// Stellarium's polygonal-landscape horizon list is plain text: one
// "azimuth altitude" pair per line (degrees; azimuth 0=N clockwise), blanks and
// #-comments ignored. Export writes every stored point plus a closing 360°
// entry so the polygon is explicitly closed; import keeps THE FILE'S OWN
// density (v1 resampled onto 36 rows and threw detail away).

/** Serialize a profile to a Stellarium horizon list. */
export function toStellarium(profile) {
  const lines = ['# Horizon profile — azimuth altitude (deg), 0=N clockwise',
    '# Generated by Horizon Planner'];
  for (const p of profile.points) lines.push(`${round2(p.az)} ${round2(p.alt)}`);
  lines.push(`360 ${round2(profile.points[0].alt)}`); // close the loop
  return lines.join('\n') + '\n';
}

/**
 * Parse a Stellarium horizon list into a profile, keeping every point.
 * Throws if no usable "az alt" pairs are found.
 */
export function fromStellarium(text) {
  const pts = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const m = line.split(/[\s,]+/).map(Number);
    if (m.length >= 2 && Number.isFinite(m[0]) && Number.isFinite(m[1])) {
      pts.push({ az: m[0], alt: m[1] });
    }
  }
  if (!pts.length) throw new Error('no azimuth/altitude pairs found');
  return makeHorizon({ points: pts });
}
