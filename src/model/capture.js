// =============================================================================
// capture.js — the headless math under sensor-trace horizon capture: pointing
// from device orientation, compass-truth calibration, and sweep → profile.
//
// POINTING. The sighting axis is the phone's TOP EDGE (portrait, screen
// vertical, like a gunsight). Under the W3C Z-X′-Y″ Euler convention the
// device Y-axis in the earth frame is (−sinα·cosβ, cosα·cosβ, sinβ) — it is
// INVARIANT under γ (roll about that very axis) — so for the top edge,
// heading = (360 − α) % 360 and altitude = β hold EXACTLY, not just for a
// level phone. iOS supplies `webkitCompassHeading` directly (tilt-compensated,
// magnetic); Android's absolute α goes through headingFromAlpha().
//
// CALIBRATION. Every device heading is MAGNETIC. The magnetic-to-true offset
// (declination) is a KNOWN, published quantity — model/geomag.js computes it
// from the site's coordinates via the World Magnetic Model — so applyOffset()
// corrects a heading to true north automatically, no Sun sighting. A manual
// offset stays available for local iron/interference.
//
// SWEEP. Samples accumulate into 1° azimuth bins; each bin's altitude is the
// MEDIAN of its samples (robust to hand jitter and single-sample outliers).
// The finished profile has one point per covered bin — sampleAt() already
// interpolates linearly across uncovered gaps, so no fill pass is needed.
// =============================================================================
import { ALT_MIN, ALT_MAX, makeHorizon } from './horizon.js';

const norm360 = (az) => ((az % 360) + 360) % 360;

/** Wrap a degree difference into (−180, 180]. */
export function wrapOffset(deg) {
  const d = norm360(deg);
  return d > 180 ? d - 360 : d;
}

/** Android path: compass heading from an ABSOLUTE alpha. */
export function headingFromAlpha(alpha) { return norm360(360 - alpha); }

/**
 * Where the BACK CAMERA points, from device Euler angles. You hold the phone
 * upright (portrait) and aim the camera at the obstruction, the way you'd take
 * a photo of it — NOT sighting along the top edge (that was the v1.2 model; it
 * read the horizon as 90° and couldn't reach obstructions above eye level).
 *
 * The camera looks along the device −Z axis. With the phone vertical, iOS/
 * Android `beta` ≈ 90°, so camera-elevation = beta − 90: upright → 0° (level
 * with the horizon), tilt the top back → positive (a tall tree above you),
 * tip it forward → negative (a treeline downhill). Range clamps to [−90, 90].
 * @returns { heading (° cw from north, magnetic), altitude (°, [−90, 90]) }
 */
export function cameraPointing(alpha, beta) {
  return {
    heading: headingFromAlpha(alpha),
    altitude: Math.max(-90, Math.min(90, beta - 90)),
  };
}

const RAD = Math.PI / 180;

/**
 * Where the BACK CAMERA points, from the FULL device orientation (α, β, γ) — the
 * robust pointing the AR sky view needs when you tilt the phone up to the sky.
 *
 * The naive model (heading = compass, altitude = β − 90) ignores the coupling
 * between tilt and heading: iOS `webkitCompassHeading` destabilises and flips
 * ~180° once the phone is pitched past ~45°. Here we instead rotate the camera
 * axis (device −Z) into the world by the W3C Z-X′-Y″ matrix and read azimuth +
 * altitude straight off the world vector — which is invariant under pitch (a
 * level phone and one tilted 45° up return the SAME azimuth at zero roll), so
 * there is no flip. Degenerate only at the exact zenith, where azimuth is
 * genuinely undefined.
 *
 * The azimuth is in the α reference frame (cw from that frame's north): on
 * Android's ABSOLUTE α it is already magnetic-north-referenced; on iOS α is
 * relative, so the caller anchors it to true north with `webkitCompassHeading`
 * sampled while the phone is near level (where the compass is trustworthy).
 * @returns { azimuth (° cw from the α-frame north, [0,360)), altitude (°, [−90,90]) }
 */
export function backCameraAzAlt(alpha, beta, gamma) {
  const a = alpha * RAD, b = beta * RAD, g = gamma * RAD;
  // Back camera = device −Z expressed in the world frame (x east, y north, z up).
  const east = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g));
  const north = -(Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.sin(b) * Math.cos(g));
  const up = -(Math.cos(b) * Math.cos(g));
  return {
    azimuth: norm360(Math.atan2(east, north) / RAD),
    altitude: Math.max(-90, Math.min(90, Math.asin(Math.max(-1, Math.min(1, up))) / RAD)),
  };
}

/** The calibration offset that maps a measured heading onto a true azimuth. */
export function calibrationOffset(trueAzimuth, measuredHeading) {
  return wrapOffset(trueAzimuth - measuredHeading);
}

/** True azimuth from a measured heading and a calibration offset. */
export function applyOffset(heading, offset) { return norm360(heading + offset); }

// --- sweep session -----------------------------------------------------------

/** A capture session: azimuth bins accumulating altitude samples. */
export function makeSession(binDeg = 1) {
  return { binDeg, bins: new Map() }; // bin index → number[]
}

/** Record one calibrated sample. Non-finite input is ignored. */
export function addSample(session, azTrue, alt) {
  if (!Number.isFinite(azTrue) || !Number.isFinite(alt)) return session;
  const i = Math.floor(norm360(azTrue) / session.binDeg);
  const clamped = Math.max(ALT_MIN, Math.min(ALT_MAX, alt));
  const bin = session.bins.get(i);
  if (bin) bin.push(clamped); else session.bins.set(i, [clamped]);
  return session;
}

/** Total recorded samples. */
export function sampleCount(session) {
  let n = 0;
  for (const b of session.bins.values()) n += b.length;
  return n;
}

/**
 * How much of the circle the sweep has touched.
 * @returns { binsWithData, totalBins, pct, maxGapDeg } — maxGap wraps north.
 */
export function coverage(session) {
  const total = Math.round(360 / session.binDeg);
  const filled = [...session.bins.keys()].sort((a, b) => a - b);
  if (!filled.length) return { binsWithData: 0, totalBins: total, pct: 0, maxGapDeg: 360 };
  // Largest run of empty bins between consecutive filled ones, wrapping north.
  let maxGap = 0;
  for (let k = 0; k < filled.length; k++) {
    const next = k + 1 < filled.length ? filled[k + 1] : filled[0] + total;
    maxGap = Math.max(maxGap, next - filled[k] - 1);
  }
  return {
    binsWithData: filled.length,
    totalBins: total,
    pct: Math.round((filled.length / total) * 100),
    maxGapDeg: maxGap * session.binDeg,
  };
}

/**
 * The widest unswept gap AND where it is — so the UI can say "keep panning; the
 * biggest hole is to the SW" instead of a bare percentage. A full hand-sweep
 * never touches every 1° bin, but the profile interpolates across small gaps, so
 * "done" means the widest gap is small, not that every bin is filled.
 * @returns { gapDeg, centerAz } — centerAz is the azimuth of the gap's middle.
 */
export function largestGap(session) {
  const total = Math.round(360 / session.binDeg);
  const filled = [...session.bins.keys()].sort((a, b) => a - b);
  if (!filled.length) return { gapDeg: 360, centerAz: 0 };
  let best = { len: -1, startBin: 0 };
  for (let k = 0; k < filled.length; k++) {
    const cur = filled[k];
    const next = k + 1 < filled.length ? filled[k + 1] : filled[0] + total;
    const len = next - cur - 1; // empty bins between this filled one and the next
    if (len > best.len) best = { len, startBin: cur + 1 };
  }
  const centerBin = best.startBin + (best.len - 1) / 2;
  const centerAz = ((centerBin * session.binDeg) % 360 + 360) % 360;
  return { gapDeg: best.len * session.binDeg, centerAz };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Gaps at or under this width are hand jitter — interpolate across them from
// the captured neighbours, as always. WIDER gaps are deliberately-unswept sky:
// with a base profile those keep the base (the SEEDED capture of Noah's
// trace → scan → export workflow, 2026-07-18).
export const SEED_GAP_DEG = 15;

/**
 * The captured horizon: one point per covered bin (bin-centre azimuth, median
 * altitude). With no `base`, gaps interpolate naturally via sampleAt() — the
 * original replace-everything behaviour. WITH a `base` profile (the site's
 * current horizon — e.g. a terrain trace), captured bins still win, but any
 * unswept gap wider than SEED_GAP_DEG keeps the base's points: sweep the
 * treeline you care about and the terrain baseline survives everywhere else.
 * A single Marked point refines just its spot. Throws when the session is empty.
 */
export function profileFromSession(session, base = null) {
  if (!session.bins.size) throw new Error('no samples recorded');
  const points = [...session.bins.entries()].map(([i, alts]) => ({
    az: (i + 0.5) * session.binDeg,
    alt: median(alts),
  }));
  if (base && Array.isArray(base.points)) {
    const total = Math.round(360 / session.binDeg);
    const filled = [...session.bins.keys()].sort((a, b) => a - b);
    for (let k = 0; k < filled.length; k++) {
      const cur = filled[k];
      const next = k + 1 < filled.length ? filled[k + 1] : filled[0] + total; // wrap north
      const gapDeg = (next - cur - 1) * session.binDeg;
      if (gapDeg <= SEED_GAP_DEG) continue;
      // Keep every base point in the gap, edge-inclusive at the start and
      // exclusive at the end (a base point AT the first unswept degree is
      // exactly the data being preserved — an abrupt step against the last
      // swept bin is the truth, not an artifact). End-exclusive keeps the
      // wrap seam from resurrecting a base point inside swept territory.
      const startAz = (cur + 1) * session.binDeg;
      const endAz = next * session.binDeg; // may exceed 360 on the wrap gap
      for (const p of base.points) {
        const azU = p.az < startAz ? p.az + 360 : p.az;
        if (azU >= startAz && azU < endAz) points.push({ az: p.az, alt: p.alt });
      }
    }
  }
  return makeHorizon({ points });
}
