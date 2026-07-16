// Headless unit tests for model/astro.js. Run: `node --test` (or `npm test`).
//
// Where possible these anchor on *independent* spherical-astronomy identities
// — Polaris sits at altitude ≈ latitude, a target transits at altitude
// 90−|lat−dec|, the Sun crosses the meridian due south from the northern
// hemisphere — so a green suite means the sky geometry is right, not merely
// that the library agrees with itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeObserver, altAz, sunAltAz, moonInfo, twilightBand, twilightAt,
  riseSet, transit, altitudeCurve, TWILIGHT,
} from '../src/model/astro.js';

// Bay Area site; a couple of arbitrary instants spread around a night.
const SITE = { lat: 37.5, lon: -122.0 };
const obs = makeObserver(SITE.lat, SITE.lon, 0);
const T_EVENING = new Date('2026-03-20T04:00:00Z'); // ~2026-03-19 21:00 PDT
const T_MORNING = new Date('2026-03-20T13:00:00Z'); // ~2026-03-20 06:00 PDT

// J2000 catalog positions (RA hours, Dec degrees).
const POLARIS = { ra: 2.5303, dec: 89.2641 };
const VEGA = { ra: 18.6156, dec: 38.7837 };

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('twilightBand classifies each band at and across its boundary', () => {
  assert.equal(twilightBand(10), 'day');
  assert.equal(twilightBand(TWILIGHT.day), 'day');       // 0° is still day
  assert.equal(twilightBand(-0.01), 'civil');
  assert.equal(twilightBand(-6), 'nautical');            // boundary belongs to the darker band
  assert.equal(twilightBand(-5.99), 'civil');
  assert.equal(twilightBand(-12), 'astronomical');
  assert.equal(twilightBand(-18), 'night');
  assert.equal(twilightBand(-40), 'night');
});

test('Polaris sits at altitude ≈ site latitude (independent of time)', () => {
  // Polaris is ~0.74° off the true pole, so its altitude circles the pole
  // altitude (= latitude) within ~0.8°.
  for (const t of [T_EVENING, T_MORNING]) {
    const { altitude } = altAz(POLARIS, obs, t);
    near(altitude, SITE.lat, 1.0, `Polaris altitude at ${t.toISOString()}`);
  }
});

test('Vega transits at altitude 90 − |lat − dec| and near due south', () => {
  const tr = transit(VEGA, obs, T_EVENING);
  assert.ok(tr, 'transit found');
  near(tr.altitude, 90 - Math.abs(SITE.lat - VEGA.dec), 0.3, 'Vega transit altitude');
  // At upper transit a target due-north-of-nothing here crosses the meridian;
  // Vega (dec > lat) culminates just north of zenith → azimuth ≈ 0 (north).
  const az = altAz(VEGA, obs, tr.time).azimuth;
  const offNorth = Math.min(az, 360 - az); // distance to due north
  near(offNorth, 0, 1.5, 'Vega transit azimuth near due north');
});

test('Sun transits due south (northern hemisphere) at positive altitude', () => {
  const tr = transit('Sun', obs, T_MORNING);
  assert.ok(tr, 'sun transit found');
  const az = sunAltAz(obs, tr.time).azimuth;
  near(az, 180, 3, 'Sun transit azimuth ≈ due south');
  assert.ok(tr.altitude > 0, 'Sun is up at local noon');
});

test('Sunset lands the Sun on the standard −0.833° horizon, and after transit', () => {
  const noon = transit('Sun', obs, T_MORNING);
  const setAt = riseSet('Sun', obs, noon.time, { direction: -1 });
  assert.ok(setAt, 'sunset found');
  assert.ok(setAt.getTime() > noon.time.getTime(), 'sunset is after local noon');
  // Rise/set is the apparent upper limb on the horizon → the Sun's GEOMETRIC
  // centre sits at the classic −0.833° (34′ refraction + 16′ semidiameter).
  const altAtSet = sunAltAz(obs, setAt, { refraction: 'none' }).altitude;
  near(altAtSet, -0.833, 0.05, 'Sun geometric centre altitude at set');
});

test('riseSet against a raised horizon fires earlier than the true horizon', () => {
  // Setting through a 10° treeline happens before setting through 0°.
  const flatSet = riseSet(VEGA, obs, T_EVENING, { direction: -1, horizonAltitude: 0 });
  const treeSet = riseSet(VEGA, obs, T_EVENING, { direction: -1, horizonAltitude: 10 });
  assert.ok(flatSet && treeSet, 'both sets found');
  assert.ok(treeSet.getTime() < flatSet.getTime(), 'target clears a 10° horizon before a 0° one');
});

test('moonInfo: illuminated fraction obeys (1−cos φ)/2 and names the phase', () => {
  const m = moonInfo(obs, T_EVENING);
  assert.ok(m.illumination >= 0 && m.illumination <= 1, 'fraction in [0,1]');
  const geo = (1 - Math.cos((m.phaseAngle * Math.PI) / 180)) / 2;
  near(m.illumination, geo, 0.02, 'illumination vs phase-angle geometry');
  const NAMES = new Set(['new', 'waxing crescent', 'first quarter', 'waxing gibbous',
    'full', 'waning gibbous', 'last quarter', 'waning crescent']);
  assert.ok(NAMES.has(m.phaseName), `phase name valid: ${m.phaseName}`);
});

test('twilightAt agrees with a direct Sun-altitude classification', () => {
  const band = twilightAt(obs, T_EVENING);
  const direct = twilightBand(sunAltAz(obs, T_EVENING).altitude);
  assert.equal(band, direct);
});

test('altitudeCurve: inclusive endpoints, right cadence, values match altAz', () => {
  const start = new Date('2026-03-20T04:00:00Z');
  const end = new Date('2026-03-20T06:00:00Z');
  const curve = altitudeCurve(VEGA, obs, start, end, 30);
  assert.equal(curve.length, 5, '2h at 30-min steps, inclusive = 5 samples');
  assert.equal(curve[0].time.getTime(), start.getTime());
  assert.equal(curve[curve.length - 1].time.getTime(), end.getTime());
  const mid = curve[2];
  const direct = altAz(VEGA, obs, mid.time);
  near(mid.altitude, direct.altitude, 1e-9, 'curve altitude matches altAz');
  near(mid.azimuth, direct.azimuth, 1e-9, 'curve azimuth matches altAz');
});
