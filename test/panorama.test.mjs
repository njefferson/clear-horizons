// Headless unit tests for model/panorama.js — equirect strip placement,
// coverage, and the Stellarium landscape.ini builder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PANO_W, PANO_H, STRIP_HALF_DEG,
  colForAz, rowForAlt, stripPlacement, makeCoverage, markCovered, coverageStats,
  buildLandscapeIni,
} from '../src/model/panorama.js';

test('colForAz: north at x=0, east rightward, wraps', () => {
  assert.equal(colForAz(0), 0);
  assert.equal(colForAz(180, 2048), 1024);
  assert.equal(colForAz(360), 0);
  assert.equal(colForAz(-90, 2048), 1536, '−90 wraps to 270 → 3/4 across');
});

test('rowForAlt: +90 → top row 0, 0 → middle, −90 → bottom, clamps beyond', () => {
  assert.equal(rowForAlt(90), 0);
  assert.equal(rowForAlt(0, 1024), 512);
  assert.equal(rowForAlt(-90, 1024), 1024);
  assert.equal(rowForAlt(120, 1024), 0, 'clamps above the zenith');
  assert.equal(rowForAlt(-120, 1024), 1024, 'clamps below the nadir');
});

test('stripPlacement: one band mid-circle, yTop above yBottom', () => {
  const p = stripPlacement(180, 10, 78);
  assert.equal(p.bands.length, 1);
  assert.ok(p.yTop < p.yBottom, 'the video top row is the SMALLER pano row — no vertical flip');
  // vfov 78 centred on alt 10 → rows for alt 49 … alt −29.
  assert.equal(p.yTop, Math.round(((90 - 49) / 180) * PANO_H));
  assert.equal(p.yBottom, Math.round(((90 - (-29)) / 180) * PANO_H));
});

test('stripPlacement: the north seam splits into two bands', () => {
  const p = stripPlacement(0.2, 0, 78);
  assert.equal(p.bands.length, 2, 'az 0.2 ± 1° crosses x=0');
  assert.equal(p.bands[0].x1, PANO_W, 'first band runs to the right edge');
  assert.equal(p.bands[1].x0, 0, 'second band restarts at the left edge');
  const total = (p.bands[0].x1 - p.bands[0].x0) + (p.bands[1].x1 - p.bands[1].x0);
  assert.ok(Math.abs(total - (2 * STRIP_HALF_DEG / 360) * PANO_W) <= 2, 'split width ≈ whole width');
});

test('stripPlacement: near-zenith aim clamps the top at row 0', () => {
  const p = stripPlacement(90, 80, 78);
  assert.equal(p.yTop, 0, 'alt 80 + 39 clamps to the zenith row');
  assert.ok(p.yBottom > 0);
});

test('coverage: marks wrap, stats count and find the widest gap', () => {
  const cov = makeCoverage();
  assert.deepEqual(coverageStats(cov), { deg: 0, maxGapDeg: 360 });
  for (let az = 170; az <= 190; az++) markCovered(cov, az);
  const s = coverageStats(cov);
  assert.ok(s.deg >= 21 && s.deg <= 23, `a 20° sweep marks ~${s.deg}°`);
  assert.ok(s.maxGapDeg >= 336 && s.maxGapDeg < 360, `one big wrap-around gap (${s.maxGapDeg})`);
  markCovered(cov, 0); // touch north: the wrap gap must split correctly
  assert.ok(coverageStats(cov).maxGapDeg < 336);
  const full = makeCoverage().fill(1);
  assert.deepEqual(coverageStats(full), { deg: 360, maxGapDeg: 0 });
});

test('buildLandscapeIni: spherical + signed coords + the data/image pairing', () => {
  const ini = buildLandscapeIni({ name: 'Airport', lat: -33.9, lon: -70.51234, elevation_m: 433.4 });
  assert.ok(/type = spherical/.test(ini));
  assert.ok(/maptex = panorama\.png/.test(ini));
  assert.ok(/polygonal_horizon_list = horizon\.txt/.test(ini), 'the DATA rides with the image');
  assert.ok(/latitude = -33\.90000/.test(ini), 'signed decimal latitude');
  assert.ok(/longitude = -70\.51234/.test(ini));
  assert.ok(/altitude = 433/.test(ini));
  assert.ok(/name = Airport/.test(ini));
});
