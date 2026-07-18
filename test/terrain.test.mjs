// Headless unit tests for model/terrain.js — the map-pin terrain horizon math.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();

const {
  bearingDistance, destPoint, pinAltitudeDeg, makePin, applyPinsToProfile,
  fetchElevations, EARTH_R, REFRACTION_K, EYE_M,
} = await import('../src/model/terrain.js');
const { makeHorizon, sampleAt } = await import('../src/model/horizon.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('bearingDistance: textbook pairs', () => {
  // One degree of longitude on the equator ≈ 111.19 km, due east.
  const e = bearingDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  near(e.dist_m, 111195, 50, 'equator 1° lon');
  near(e.az, 90, 0.01, 'due east');
  // Due north: 1° of latitude anywhere ≈ the same 111.19 km.
  const n = bearingDistance({ lat: 37.5, lon: -122 }, { lat: 38.5, lon: -122 });
  near(n.dist_m, 111195, 50, '1° lat');
  near(n.az, 0, 0.01, 'due north');
  // Southwest quadrant bearing.
  const sw = bearingDistance({ lat: 37.5, lon: -122 }, { lat: 37.4, lon: -122.1 });
  assert.ok(sw.az > 180 && sw.az < 270, `SW bearing ${sw.az}`);
});

test('destPoint inverts bearingDistance', () => {
  const site = { lat: 37.5, lon: -122 };
  for (const [brg, dist] of [[0, 5000], [90, 12000], [217, 30000], [355, 800]]) {
    const p = destPoint(site, brg, dist);
    const back = bearingDistance(site, p);
    near(back.dist_m, dist, 1, `round-trip distance @${brg}°`);
    near(back.az, brg, 0.01, `round-trip bearing @${brg}°`);
  }
});

test('pinAltitudeDeg: curvature + refraction dip', () => {
  // A ridge 1000 m above a site, 10 km away: the effective-radius drop is
  // d²/(2·R/(1−k)) = 1e8 / 14.65e6 ≈ 6.8 m, eye height 2 m →
  // atan((1000 − 2 − 6.8)/10000) ≈ 5.66°.
  const rEff = EARTH_R / (1 - REFRACTION_K);
  const drop10k = 1e8 / (2 * rEff);
  const expect = Math.atan2(1000 - EYE_M - drop10k, 10000) * 180 / Math.PI;
  near(pinAltitudeDeg(100, 1100, 10000), expect, 1e-9, 'ridge Δh 1000 m @ 10 km');
  assert.ok(expect > 5.6 && expect < 5.7, `sanity: ${expect}`);
  // Level terrain far away sits BELOW level — the curvature dip.
  // drop@50 km ≈ 170.7 m (+2 m eye) → atan(−172.7/50000) ≈ −0.20°.
  assert.ok(pinAltitudeDeg(100, 100, 50000) < -0.15, 'level ground @ 50 km dips below 0°');
  // Downhill ridge → negative altitude (depressed horizon).
  assert.ok(pinAltitudeDeg(500, 300, 5000) < 0, 'lower terrain → negative');
  assert.equal(pinAltitudeDeg(100, 900, 0), 0, 'zero distance guarded');
});

test('makePin composes bearing, distance, and altitude', () => {
  const site = { lat: 37.5, lon: -122 };
  const ridge = destPoint(site, 183, 8000);
  const pin = makePin(site, 30, ridge, 530);
  near(pin.az, 183, 0.01, 'pin azimuth');
  near(pin.dist_m, 8000, 1, 'pin distance');
  assert.ok(pin.alt > 3.4 && pin.alt < 3.6, `pin altitude ${pin.alt}`); // atan(~496/8000) ≈ 3.55°
});

test('applyPinsToProfile: each pin claims its 10° wedge, like a hand drag', () => {
  const profile = makeHorizon(); // flat
  const pins = [{ az: 183, alt: 12.4 }, { az: 92, alt: 4.2 }, { az: 271, alt: -3 }];
  applyPinsToProfile(profile, pins);
  near(sampleAt(profile, 180), 12.4, 0.01, 'pin near 183° lands on the 180° bin');
  near(sampleAt(profile, 90), 4.2, 0.01, '92° → 90° bin');
  near(sampleAt(profile, 270), -3, 0.01, 'below-level terrain records negative (hilltop sees extra sky)');
  near(sampleAt(profile, 0), 0, 0.01, 'unpinned directions untouched');
});

test('fetchElevations: batch URL + parsed metres, fails closed', async () => {
  let seen;
  const okFetch = async (url) => { seen = url; return { ok: true, json: async () => ({ elevation: [12.5, 480] }) }; };
  const out = await fetchElevations([{ lat: 37.5, lon: -122 }, { lat: 37.6, lon: -122.1 }], okFetch);
  assert.deepEqual(out, [12.5, 480]);
  assert.ok(seen.startsWith('https://api.open-meteo.com/v1/elevation?'), seen);
  assert.ok(seen.includes('latitude=37.50000,37.60000') && seen.includes('longitude=-122.00000,-122.10000'), seen);
  await assert.rejects(() => fetchElevations([{ lat: 0, lon: 0 }], async () => ({ ok: false, status: 500 })), /elevation API 500/);
  await assert.rejects(() => fetchElevations([{ lat: 0, lon: 0 }], async () => ({ ok: true, json: async () => ({}) })), /unexpected shape/);
  assert.deepEqual(await fetchElevations([], okFetch), []);
});
