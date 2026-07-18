// =============================================================================
// polar.js — polar-alignment planning, the synergy showcase (Noah's ask).
//
// Free tools already nail the polar-scope *reticle* (Polar Scope Align, PS Align
// Pro). Our novel angle is that the reticle here is **horizon-aware**: it uses
// the site's measured horizon mask to warn when the celestial pole is behind the
// north (or south) treeline — i.e. whether you can even see the pole from THIS
// site — and unifies that with everything else the planner knows.
//
// This is the pure-math core (100% headless-testable): where the pole is, where
// the pole star sits, its live reticle clock position, pole/star visibility
// against the measured horizon, and the aim-error math behind the live
// "point to the pole" aid (ui/polaraim.js).
//
// Reticle convention: a **correct-image, naked-eye** view looking at the pole,
// 12 o'clock = straight up (toward the zenith). At the pole star's upper transit
// it sits directly above the pole (12 o'clock); the sky then carries it around
// the pole — counter-clockwise in the north, clockwise in the south. Most polar
// scopes invert and/or mirror the image, so the UI states this plainly and the
// user rotates to match their own reticle.
// =============================================================================
import { makeObserver, altAz, starHourAngle } from './astro.js';
import { makeHorizon, sampleAt } from './horizon.js';

// Pole-star positions (J2000 / EQJ; astro.js precesses to date). RA in hours.
// Polaris (α UMi) and Sigma Octantis (the faint southern pole star).
export const POLARIS = { name: 'Polaris', designation: 'α UMi', ra: 2.5303055, dec: 89.2640833 };
export const SIGMA_OCTANTIS = { name: 'σ Octantis', designation: 'σ Oct', ra: 21.146353, dec: -88.956499 };

const clampLat = (x) => Math.max(-90, Math.min(90, Number(x)));

/** The pole star to align on for a given latitude (Polaris north, σ Oct south). */
export function poleStarFor(lat) { return lat >= 0 ? POLARIS : SIGMA_OCTANTIS; }

/**
 * Where to aim the mount's polar/tilt axis: the visible celestial pole.
 * Altitude of the pole equals |latitude|; azimuth is due north (0°) above the
 * equator, due south (180°) below it. At the equator the pole sits on the
 * horizon and neither pole is practically usable.
 * @returns { altitude, azimuth, hemisphere }
 */
export function poleAimFor(lat) {
  const l = clampLat(lat);
  const north = l >= 0;
  return { altitude: Math.abs(l), azimuth: north ? 0 : 180, hemisphere: north ? 'north' : 'south' };
}

// Reticle clock from the pole star's hour angle. Returns the angle clockwise
// from 12 o'clock (top) where the star sits, plus a 1–12 clock hour. At upper
// transit (HA 0) the star is above the pole → top (0° / 12 o'clock). The sky
// then rotates it CCW in the north (clock angle decreases) and CW in the south.
function reticleFromHourAngle(hourAngle, north) {
  const ha_deg = (hourAngle / 24) * 360;
  // North: CCW motion → clockwise-from-top angle = 360 − HA°. South: CW → HA°.
  let clockAngleDeg = north ? (360 - ha_deg) % 360 : ha_deg % 360;
  if (clockAngleDeg < 0) clockAngleDeg += 360;
  // 12-hour clock face: top = 12, 30° per hour, clockwise.
  let clockHour = Math.round(clockAngleDeg / 30) % 12;
  if (clockHour === 0) clockHour = 12;
  return { clockAngleDeg, clockHour, clockLabel: `${clockHour} o’clock` };
}

/**
 * The full polar-alignment picture for a site at an instant.
 *
 * @param site  { lat, lon, elevation_m?, horizon? } — horizon in any stored
 *              shape (v2 pairs or legacy array; absent → flat 0°).
 * @param date  Date | ms | AstroTime.
 * @returns {
 *   hemisphere, star, pole: { altitude, azimuth },
 *   poleAboveHorizon, horizonAltitudeAtPole, poleClearance,   // horizon-aware
 *   star: { ..., altitude, azimuth, aboveHorizon },
 *   hourAngle, separationDeg, separationArcmin,
 *   reticle: { clockAngleDeg, clockHour, clockLabel },
 *   usable                                                     // pole clears horizon & is up
 * }
 */
// --- live "point to the pole" aim math (ui/polaraim.js) ----------------------
// Hysteresis pair for the on-target state: acquire inside ENTER, hold until the
// error exceeds EXIT — the announcement can't chatter at the boundary.
export const AIM_ENTER_DEG = 2.0;
export const AIM_EXIT_DEG = 3.0;

const wrap180 = (d) => { let x = ((d % 360) + 360) % 360; return x > 180 ? x - 360 : x; };

/**
 * How far the camera axis is from an aim point, and which way to move.
 * @param cam { az, alt } — where the camera points (true-north azimuth)
 * @param aim { azimuth, altitude } — the target (e.g. polarAlignment().pole)
 * @returns { dAz, dAlt, separationDeg }
 *   dAz  ∈ (−180,180]: + = the aim point is to the RIGHT of where you point
 *   dAlt: + = the aim point is ABOVE where you point
 *   separationDeg: small-angle great-circle distance (azimuth difference scaled
 *   by cos of the mid altitude — exact enough near alt≈lat where this is used)
 */
export function aimError(cam, aim) {
  const dAz = wrap180(aim.azimuth - cam.az);
  const dAlt = aim.altitude - cam.alt;
  const midAlt = ((aim.altitude + cam.alt) / 2) * (Math.PI / 180);
  const separationDeg = Math.hypot(dAz * Math.cos(midAlt), dAlt);
  return { dAz, dAlt, separationDeg };
}

/**
 * Human guidance from an aimError, with hysteresis. `wasOnTarget` is the
 * previous frame's onTarget so a lock is sticky (ENTER to acquire, EXIT to lose).
 * @returns { onTarget, text } — text like "34° right · 12° up" or "on target"
 */
export function aimGuidance(err, wasOnTarget = false) {
  const onTarget = err.separationDeg <= (wasOnTarget ? AIM_EXIT_DEG : AIM_ENTER_DEG);
  if (onTarget) return { onTarget, text: 'on target' };
  const part = (v, pos, neg) => `${Math.abs(v) < 10 ? Math.abs(v).toFixed(1) : Math.round(Math.abs(v))}° ${v >= 0 ? pos : neg}`;
  return { onTarget, text: `${part(err.dAz, 'right', 'left')} · ${part(err.dAlt, 'up', 'down')}` };
}

/**
 * The pole star's daily small circle around the pole, as az/alt points ready
 * for projection: angular radius `radiusDeg`, azimuth spread widened by
 * 1/cos(alt) so the circle projects round through the equirectangular map.
 */
export function poleCirclePoints(pole, radiusDeg, n = 36) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * 2 * Math.PI;
    const alt = pole.altitude + radiusDeg * Math.cos(th);
    const cosAlt = Math.max(0.05, Math.cos(alt * (Math.PI / 180)));
    const az = ((pole.azimuth + (radiusDeg * Math.sin(th)) / cosAlt) % 360 + 360) % 360;
    pts.push({ az, alt });
  }
  return pts;
}

export function polarAlignment(site, date) {
  const lat = clampLat(site.lat);
  const north = lat >= 0;
  const star = poleStarFor(lat);
  const pole = poleAimFor(lat);
  const observer = makeObserver(lat, site.lon, site.elevation_m || 0);

  // Horizon-aware pole visibility — the novel part. Sample the measured horizon
  // at the pole's azimuth (due N/S) and compare to the pole's altitude (=|lat|).
  // makeHorizon accepts every stored shape (v2 pairs, legacy arrays, nothing).
  const profile = makeHorizon(site.horizon);
  const horizonAltitudeAtPole = sampleAt(profile, pole.azimuth);
  const poleClearance = pole.altitude - horizonAltitudeAtPole;
  const poleAboveHorizon = poleClearance > 0;

  // Pole star: reticle clock from its hour angle; live alt/az for "where to look"
  // and its own horizon check (you must SEE the star to use the scope).
  const { hourAngle, dec } = starHourAngle(star, observer, date);
  const separationDeg = 90 - Math.abs(dec);         // angular distance from the pole
  const starPos = altAz(star, observer, date);
  const starHorizon = sampleAt(profile, starPos.azimuth);

  return {
    hemisphere: pole.hemisphere,
    pole: { altitude: pole.altitude, azimuth: pole.azimuth },
    poleAboveHorizon,
    horizonAltitudeAtPole,
    poleClearance,
    star: {
      name: star.name,
      designation: star.designation,
      altitude: starPos.altitude,
      azimuth: starPos.azimuth,
      aboveHorizon: starPos.altitude > starHorizon,
    },
    hourAngle,
    separationDeg,
    separationArcmin: separationDeg * 60,
    reticle: reticleFromHourAngle(hourAngle, north),
    usable: poleAboveHorizon && pole.altitude > 0,
  };
}
