// =============================================================================
// terrain.js — the map-pin TERRAIN horizon (Noah's "10° in 360°" idea): drop a
// pin on a distant ridge on the satellite map, and its (azimuth, altitude)
// from the active site is computed from geodesy + the Open-Meteo elevation
// model, then applied to the SAME horizon profile everything else reads —
// each pin claims its 10° manual-editor wedge via setAltitudeAt, exactly like
// a hand-dragged handle.
//
// HONESTY CAVEAT (bake in, per NOTES): elevation models carry NO TREES. Map
// pins estimate distant ridgelines only; a tree-ringed yard still needs the
// physical sensor/camera capture. The UI states this plainly.
//
// GEOMETRY. Spherical earth (R = 6371 km) is plenty at horizon-pin distances.
// The apparent altitude of a ridge Δh above the observer's eye at ground
// distance d dips by earth curvature, partly offset by terrestrial refraction
// (standard k ≈ 0.13 → effective radius R/(1−k)):
//     alt = atan( (Δh − d²/(2·R_eff)) / d )
// At 10 km that hides ~7 m of ridge; at 50 km, ~170 m — why far mountains sit
// lower than trigonometry alone suggests.
//
// 100% headless: the elevation fetch is dependency-injected (Open-Meteo
// /v1/elevation, keyless + CORS, batch ≤ 100 coords — the same host the
// weather already uses, so CSP needs nothing new).
// =============================================================================
import { setAltitudeAt, indexForAz } from './horizon.js';

export const EARTH_R = 6371000;        // metres
export const REFRACTION_K = 0.13;      // standard terrestrial refraction factor
export const EYE_M = 2;                // observer eye height above ground
const R_EFF = EARTH_R / (1 - REFRACTION_K);
const RAD = Math.PI / 180;

/** Great-circle distance (m) and initial bearing (° clockwise from N) A → B. */
export function bearingDistance(a, b) {
  const φ1 = a.lat * RAD, φ2 = b.lat * RAD, Δλ = (b.lon - a.lon) * RAD;
  const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1);
  const sinφ2 = Math.sin(φ2), cosφ2 = Math.cos(φ2);
  const h = Math.sin((φ2 - φ1) / 2) ** 2 + cosφ1 * cosφ2 * Math.sin(Δλ / 2) ** 2;
  const dist_m = 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(Δλ) * cosφ2;
  const x = cosφ1 * sinφ2 - sinφ1 * cosφ2 * Math.cos(Δλ);
  const az = ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
  return { az, dist_m };
}

/** The point `dist_m` from `a` along `bearingDeg` (spherical direct problem). */
export function destPoint(a, bearingDeg, dist_m) {
  const δ = dist_m / EARTH_R, θ = bearingDeg * RAD;
  const φ1 = a.lat * RAD, λ1 = a.lon * RAD;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * sinφ2);
  return { lat: φ2 / RAD, lon: ((λ2 / RAD + 540) % 360) - 180 };
}

/**
 * Apparent altitude (°) of a point `elev_m` (ground elevation) at `dist_m`
 * from an observer whose ground sits at `siteElev_m` (+ eye height), with
 * earth-curvature dip and standard refraction. Negative = below level.
 */
export function pinAltitudeDeg(siteElev_m, elev_m, dist_m) {
  if (!(dist_m > 0)) return 0;
  const dh = elev_m - (siteElev_m + EYE_M);
  const drop = (dist_m * dist_m) / (2 * R_EFF);
  return Math.atan2(dh - drop, dist_m) / RAD;
}

/**
 * Build a pin record from the site + a map point with a known elevation.
 * @returns { lat, lon, elev_m, az, dist_m, alt }
 */
export function makePin(site, siteElev_m, point, elev_m) {
  const { az, dist_m } = bearingDistance(site, point);
  return {
    lat: point.lat, lon: point.lon, elev_m,
    az, dist_m,
    alt: pinAltitudeDeg(siteElev_m, elev_m, dist_m),
  };
}

/**
 * Apply pins to a horizon profile (mutates + returns it): each pin sets its
 * 10° manual-editor wedge — same semantics as dragging that handle, so a
 * later hand-correction or camera capture coarsens/overwrites just the wedge.
 * Negative altitudes are kept — a ridge below a hilltop site IS the horizon
 * there (the same below-0° support capture and import already have).
 */
export function applyPinsToProfile(profile, pins) {
  for (const p of pins) setAltitudeAt(profile, indexForAz(p.az), p.alt);
  return profile;
}

/**
 * Ground elevations (m) for up to 100 points via Open-Meteo's keyless
 * elevation API. Fails closed (throws) — callers surface a plain message.
 * @param points [{ lat, lon }, …]
 */
export async function fetchElevations(points, fetchFn = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null) {
  if (!fetchFn) throw new Error('no fetch available');
  if (!points.length) return [];
  const lat = points.map((p) => p.lat.toFixed(5)).join(',');
  const lon = points.map((p) => p.lon.toFixed(5)).join(',');
  const res = await fetchFn(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
  if (!res.ok) throw new Error(`elevation API ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.elevation) || data.elevation.length !== points.length) {
    throw new Error('elevation API returned an unexpected shape');
  }
  return data.elevation.map(Number);
}
