// =============================================================================
// visibility.js — from the same alt/az computation the night graph draws, work
// out WHEN a target is usable tonight. Two answers, both honest:
//   • geometric  — plain rise/set (above the astronomical 0° horizon)
//   • effective  — above YOUR measured treeline AND below the mount's near-
//                  zenith dead-zone (an alt-az smart scope can't track through
//                  the zenith; EQ mode relaxes it). This is the emphasised one.
// Returns merged intervals (edges refined to the midpoint of the bracketing
// samples, so within ±step/2 of the true crossing), plus the transit
// altitude/time. Headless-testable; the table lives in the UI.
// =============================================================================
import { altAz } from './astro.js';
import { isAbove } from './horizon.js';
import { zenithDeadZone } from './instruments.js';

/**
 * @param target      { ra (hours), dec (deg) } J2000.
 * @param observer    an astro Observer.
 * @param horizon     a horizon profile (or null → flat 0°).
 * @param opts        { start, end, instrument, eqMode=false, stepMinutes=2,
 *                      mergeGapMinutes=6, minWindowMinutes=10 }
 * @returns {
 *   geometric: [{ start, end }],   // above 0° — raw, never consolidated
 *   effective: [{ start, end }],   // above treeline & below dead-zone,
 *                                  // consolidated into SHOOTABLE windows
 *   effectiveDropped,              // brief windows discarded by consolidation
 *   transit:   { time, altitude, azimuth } | null,  // highest within [start,end]
 *   maxAltitude,
 *   deadZone,                      // applied high-altitude cutoff (0 if none)
 *   clipsDeadZone: bool,           // target rises into the dead-zone
 * }
 *
 * Consolidation exists because a REAL measured horizon is jagged: a curve
 * skimming the treeline flickers in and out, yielding 2–6 minute "windows"
 * nobody can shoot (seen on-device, 2026-07-17). Effective windows separated
 * by gaps ≤ mergeGapMinutes are joined (a dip that brief is shot through),
 * then windows shorter than minWindowMinutes are dropped and counted.
 */
export function visibility(target, observer, horizon, opts) {
  const {
    start, end, instrument = null, eqMode = false, stepMinutes = 2,
    mergeGapMinutes = 6, minWindowMinutes = 10,
  } = opts;
  const deadZone = eqMode || !instrument ? 0 : zenithDeadZone(instrument);
  const step = stepMinutes * 60000;
  const t0 = start.getTime(), t1 = end.getTime();

  const samples = [];
  let transit = null, maxAltitude = -90;
  for (let ms = t0; ms <= t1 + 1; ms += step) {
    const d = new Date(ms);
    const { altitude, azimuth } = altAz(target, observer, d);
    const geo = altitude > 0;
    const aboveTrees = horizon ? isAbove(horizon, azimuth, altitude) : altitude > 0;
    const belowZenith = deadZone > 0 ? altitude < deadZone : true;
    samples.push({ ms, altitude, azimuth, geo, eff: aboveTrees && belowZenith });
    if (altitude > maxAltitude) { maxAltitude = altitude; transit = { time: d, altitude, azimuth }; }
  }

  const eff = consolidateIntervals(intervals(samples, 'eff'), { mergeGapMinutes, minWindowMinutes });
  return {
    geometric: intervals(samples, 'geo'),
    effective: eff.list,
    effectiveDropped: eff.dropped,
    transit: maxAltitude > -90 ? transit : null,
    maxAltitude,
    deadZone,
    clipsDeadZone: deadZone > 0 && maxAltitude >= deadZone,
  };
}

/**
 * Merge intervals separated by gaps ≤ mergeGapMinutes, then drop windows
 * shorter than minWindowMinutes. Returns { list, dropped }. Exported for
 * tests and any future "show brief peeks" toggle.
 */
export function consolidateIntervals(list, { mergeGapMinutes = 6, minWindowMinutes = 10 } = {}) {
  if (!list.length) return { list: [], dropped: 0 };
  const gap = mergeGapMinutes * 60000, min = minWindowMinutes * 60000;
  const merged = [{ start: list[0].start, end: list[0].end }];
  for (let i = 1; i < list.length; i++) {
    const last = merged[merged.length - 1];
    if (list[i].start - last.end <= gap) last.end = list[i].end;
    else merged.push({ start: list[i].start, end: list[i].end });
  }
  const kept = merged.filter((iv) => iv.end - iv.start >= min);
  return { list: kept, dropped: merged.length - kept.length };
}

// Merge contiguous true-runs of `key` into intervals. Each edge is refined to
// the MIDPOINT of the two bracketing samples — within ±step/2 (±1 min at the
// default cadence) of the true crossing, without a second solver pass — so the
// window boundaries read cleanly rather than snapping to the sample grid.
function intervals(samples, key) {
  const out = [];
  let open = null;
  for (let i = 0; i < samples.length; i++) {
    const on = samples[i][key];
    if (on && open === null) {
      open = i > 0 ? midpoint(samples[i - 1].ms, samples[i].ms) : samples[i].ms;
    } else if (!on && open !== null) {
      out.push({ start: new Date(open), end: new Date(midpoint(samples[i - 1].ms, samples[i].ms)) });
      open = null;
    }
  }
  if (open !== null) out.push({ start: new Date(open), end: new Date(samples[samples.length - 1].ms) });
  return out;
}
const midpoint = (a, b) => Math.round((a + b) / 2);

/** Total minutes across a set of intervals. */
export function totalMinutes(list) {
  return Math.round(list.reduce((m, iv) => m + (iv.end - iv.start), 0) / 60000);
}

/**
 * Which of `objects` actually clear the site's measured horizon (and stay
 * below the mount's zenith dead-zone) at SOME point during the given dark
 * window — the app's thesis applied to discovery: narrow the catalog to what's
 * genuinely observable tonight before any other filter runs.
 *
 * Sampled coarsely with an early exit (most visible objects pass within a few
 * samples); only never-visible ones walk the whole window. Callers should
 * cache the result per site+night+instrument — it's the same answer until one
 * of those changes.
 *
 * @param objects   catalog rows [{ id, ra, dec }, …]
 * @param window    { start, end } — a dark span (see night.darkWindow)
 * @returns Set<id>
 */
export function visibleTonight(objects, observer, horizon, { window, instrument = null, eqMode = false, stepMinutes = 12 } = {}) {
  const deadZone = eqMode || !instrument ? 0 : zenithDeadZone(instrument);
  const step = stepMinutes * 60000;
  const times = [];
  for (let ms = window.start.getTime(); ms <= window.end.getTime(); ms += step) times.push(new Date(ms));
  if (!times.length) times.push(window.start);
  const ids = new Set();
  for (const o of objects) {
    const target = { ra: o.ra, dec: o.dec };
    for (const d of times) {
      const { altitude, azimuth } = altAz(target, observer, d);
      if (altitude <= 0) continue;
      const aboveTrees = horizon ? isAbove(horizon, azimuth, altitude) : true;
      const belowZenith = deadZone > 0 ? altitude < deadZone : true;
      if (aboveTrees && belowZenith) { ids.add(o.id); break; } // early-exit: one pass is enough
    }
  }
  return ids;
}
