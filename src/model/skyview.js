// =============================================================================
// skyview.js — the headless assembly behind the AR "arcs across the sky" view.
// Turns favourite targets + the Moon into, for each: its alt/az ARC over the
// night (split into the runs that clear the MEASURED horizon, so the sky view
// draws exactly what Tonight draws) and its position at a chosen instant (the
// scrubbed hour). No DOM, no projection, no colour — pure sky geometry, so it
// unit-tests headless; ui/sky.js owns the camera, projection and palette.
// =============================================================================
import { altAz, altitudeCurve, moonCurve, moonInfo } from './astro.js';
import { isAbove } from './horizon.js';

/**
 * Split an alt/az arc into the contiguous runs where it clears the measured
 * horizon — the same "only where isAbove" cut the night graph uses, so AR and
 * the flat graph agree. Points below the treeline break the polyline.
 * @param curve   [{ time, altitude, azimuth }] from altitudeCurve / moonCurve.
 * @param profile a measured horizon (model/horizon.js).
 * @returns [[{ time, altitude, azimuth }, …], …] — zero or more above-horizon runs.
 */
export function aboveHorizonSegments(curve, profile) {
  const segments = [];
  let run = null;
  for (const p of curve) {
    if (isAbove(profile, p.azimuth, p.altitude)) {
      if (!run) { run = []; segments.push(run); }
      run.push(p);
    } else {
      run = null;
    }
  }
  return segments;
}

/**
 * Where a scene entry sits at one instant, and whether it clears the horizon.
 * Cheap enough to call every scrub tick (no full-curve resample).
 * @returns { azimuth, altitude, aboveHorizon }
 */
export function positionAt(entry, observer, profile, at) {
  const p = entry.isMoon
    ? (() => { const m = moonInfo(observer, at); return { azimuth: m.azimuth, altitude: m.altitude }; })()
    : altAz({ ra: entry.target.ra, dec: entry.target.dec }, observer, at);
  return { azimuth: p.azimuth, altitude: p.altitude, aboveHorizon: isAbove(profile, p.azimuth, p.altitude) };
}

/**
 * Assemble the render set for the sky view: the favourite targets plus the Moon,
 * each with its horizon-cut arc over the night and its position at `at`.
 * @param targets      catalog objects ({ id, ra, dec, common, name, … }).
 * @param observer     from astro.makeObserver.
 * @param profile      measured horizon.
 * @param win          { start, end } — the night window to draw the arc across.
 * @param at           the instant (Date) for the current-position markers.
 * @param stepMinutes  arc sampling cadence.
 * @returns [{ target?, isMoon, name, segments, now:{azimuth,altitude,aboveHorizon}, phase? }]
 *          — targets first, the Moon last (drawn on top).
 */
export function buildSkyScene(targets, observer, profile, win, at, stepMinutes = 5) {
  const scene = targets.map((t) => {
    const curve = altitudeCurve({ ra: t.ra, dec: t.dec }, observer, win.start, win.end, stepMinutes);
    const entry = { target: t, isMoon: false, name: t.common ? t.common.split(',')[0].trim() : t.name, segments: aboveHorizonSegments(curve, profile) };
    entry.now = positionAt(entry, observer, profile, at);
    return entry;
  });

  const moonEntry = { isMoon: true, name: 'Moon', segments: aboveHorizonSegments(moonCurve(observer, win.start, win.end, stepMinutes), profile) };
  const mi = moonInfo(observer, at);
  moonEntry.now = { azimuth: mi.azimuth, altitude: mi.altitude, aboveHorizon: isAbove(profile, mi.azimuth, mi.altitude) };
  moonEntry.phase = { illumination: mi.illumination, phaseName: mi.phaseName, phaseAngle: mi.phaseAngle };
  scene.push(moonEntry);

  return scene;
}
