// Headless unit tests for model/horizon.js (v2: arbitrary-resolution points).
// The wrap-around-north interpolation, the legacy-shape conversions and the
// density-preserving Stellarium round-trip are the bits most likely to bite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEP, N, ALT_MIN, makeHorizon, serializeHorizon, azForIndex, indexForAz,
  setAltitudeAt, sampleAt, isAbove, maxAltitude, isFlat, toStellarium, fromStellarium,
} from '../src/model/horizon.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('grid constants: 36 rows every 10°, index/azimuth round-trip', () => {
  assert.equal(STEP, 10);
  assert.equal(N, 36);
  assert.equal(azForIndex(9), 90);
  assert.equal(indexForAz(94), 9);   // nearest row
  assert.equal(indexForAz(356), 0);  // wraps to north
});

test('default profile is flat: one point, samples 0 everywhere', () => {
  const p = makeHorizon();
  assert.equal(p.points.length, 1);
  assert.ok(isFlat(p));
  for (const az of [0, 87.3, 180, 359.9]) assert.equal(sampleAt(p, az), 0);
});

test('legacy 36-array converts to points at 10° and samples identically', () => {
  const arr = new Array(36).fill(0); arr[9] = 30; arr[10] = 10; // 90°=30, 100°=10
  const p = makeHorizon(arr);
  assert.equal(p.points.length, 36);
  assert.equal(sampleAt(p, 90), 30);
  near(sampleAt(p, 95), 20, 1e-9, 'linear between rows');
});

test('pair-array input sorts, dedupes (last wins), normalizes 360→0', () => {
  const p = makeHorizon([[180, 5], [0, 1], [180, 7], [360, 2]]);
  assert.deepEqual(p.points.map((q) => q.az), [0, 180]);
  assert.equal(sampleAt(p, 180), 7);  // the later 180° entry won
  assert.equal(sampleAt(p, 0), 2);    // 360 normalized onto 0 and won
});

test('sampleAt interpolates across the 350°→0° north seam', () => {
  const p = makeHorizon([[350, 10], [0, 20], [90, 0]]);
  near(sampleAt(p, 355), 15, 1e-9, 'mid-seam');
  near(sampleAt(p, 358), 18, 1e-9, 'nearer 0° side');
  near(sampleAt(p, 345), 10 - 5 * (10 / 260), 1e-9, 'below the last point wraps from 90°');
});

test('negative altitudes survive (floored at ALT_MIN) and isAbove respects them', () => {
  const p = makeHorizon([[0, -45], [180, -5]]);
  assert.equal(sampleAt(p, 0), ALT_MIN);          // −45 floors at −30
  assert.equal(sampleAt(p, 180), -5);
  assert.ok(isAbove(p, 180, -2), 'a target at −2° clears a −5° horizon');
  assert.ok(!isAbove(p, 180, -8), 'but not below it');
});

test('setAltitudeAt replaces stored points within ±STEP/2 of the row (wrap-aware)', () => {
  // Dense captured detail around 90°, plus a far point that must survive.
  const p = makeHorizon([[85, 8], [88, 9], [90, 12], [93, 11], [96, 7], [200, 40]]);
  setAltitudeAt(p, 9, 25); // row 9 = 90° — claims [85, 95]
  assert.equal(sampleAt(p, 90), 25);
  assert.deepEqual(p.points.map((q) => q.az), [90, 96, 200], 'only 96° and 200° survive nearby');
  // Manual edits clamp to the editor range [0, 90] — no negative drags.
  setAltitudeAt(p, 0, -10);
  assert.equal(sampleAt(p, 0), 0);
  // Wrap-aware claim: a point at 357° belongs to row 0 (north).
  const q = makeHorizon([[357, 6]]);
  setAltitudeAt(q, 0, 3);
  assert.deepEqual(q.points.map((r) => r.az), [0]);
});

test('serializeHorizon round-trips through makeHorizon', () => {
  const p = makeHorizon([[12.345, 6.789], [270, -3]]);
  const pairs = serializeHorizon(p);
  assert.deepEqual(pairs, [[12.35, 6.79], [270, -3]]); // 2 dp
  const p2 = makeHorizon(pairs);
  assert.deepEqual(p2.points, p.points);
});

test('Stellarium import keeps the file\'s own density; round-trip is faithful', () => {
  const dense = Array.from({ length: 120 }, (_, k) => `${k * 3} ${(10 + 5 * Math.sin(k / 7)).toFixed(2)}`).join('\n');
  const p = fromStellarium(dense);
  assert.equal(p.points.length, 120, 'no resampling onto a 36-row grid');
  const p2 = fromStellarium(toStellarium(p));
  assert.deepEqual(p2.points, p.points);
});

test('fromStellarium ignores comments/blank lines and rejects garbage', () => {
  const p = fromStellarium('# comment\n\n0 12\n90 5, extra\n180 20\n270 8\n');
  assert.equal(p.points.length, 4);
  assert.equal(maxAltitude(p), 20);
  assert.throws(() => fromStellarium('no numbers here\n# nope'), /no azimuth/);
});

test('legacy persisted { altitudes } shape still loads', () => {
  const alts = new Array(36).fill(0); alts[0] = 15;
  const p = makeHorizon({ altitudes: alts });
  assert.equal(sampleAt(p, 0), 15);
  assert.equal(p.points.length, 36);
});
