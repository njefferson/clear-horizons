// Headless unit tests for model/capture.js — the math under sensor capture.
// Pointing identities, Sun calibration (the compass-truth fix), and the
// sweep → median-binned profile pipeline, all synthetic.
// (Seeded-capture tests live at the bottom: profileFromSession with a base.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapOffset, headingFromAlpha, cameraPointing, backCameraAzAlt, calibrationOffset,
  applyOffset, makeSession, addSample, sampleCount,
  coverage, largestGap, profileFromSession,
} from '../src/model/capture.js';
import { sampleAt, makeHorizon } from '../src/model/horizon.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('camera pointing: heading = (360 − α) % 360, altitude = β − 90 clamped', () => {
  assert.equal(cameraPointing(0, 90).heading, 0, 'α 0 → north');
  assert.equal(cameraPointing(90, 90).heading, 270, 'α 90 (device CCW) → west');
  assert.equal(cameraPointing(-30, 90).heading, 30);
  // Phone upright (β 90) → camera level with the horizon → 0°, NOT 90°.
  assert.equal(cameraPointing(0, 90).altitude, 0, 'upright reads the horizon as 0°');
  assert.equal(cameraPointing(0, 120).altitude, 30, 'tilt back → obstruction above eye level');
  assert.equal(cameraPointing(0, 60).altitude, -30, 'tip forward → downhill horizon');
  assert.equal(cameraPointing(0, 190).altitude, 90, 'past-zenith clamps');
  assert.equal(headingFromAlpha(360), 0);
});

test('backCameraAzAlt: level identities (az = 360 − α, alt = 0)', () => {
  for (const a of [0, 30, 90, 180, 275]) {
    const p = backCameraAzAlt(a, 90, 0);
    near(p.azimuth, ((360 - a) % 360 + 360) % 360, 1e-6, `az at α=${a}`);
    near(p.altitude, 0, 1e-6, `alt at α=${a}`);
  }
});

test('backCameraAzAlt: pitch maps to altitude (β − 90 at zero roll)', () => {
  near(backCameraAzAlt(0, 135, 0).altitude, 45, 1e-6, 'tilt up 45°');
  near(backCameraAzAlt(0, 45, 0).altitude, -45, 1e-6, 'tilt down 45°');
  near(backCameraAzAlt(0, 180, 0).altitude, 90, 1e-6, 'straight up = zenith');
});

test('backCameraAzAlt: NO azimuth flip when pitched past 45° (the v2.0.0 bug)', () => {
  // The whole point: at zero roll, azimuth is invariant under pitch — a level
  // phone and one tilted steeply up must report the SAME azimuth. The old model
  // (compass-as-azimuth) flipped ~180° here.
  for (const a of [0, 60, 150, 243]) {
    const level = backCameraAzAlt(a, 90, 0).azimuth;
    for (const beta of [110, 135, 160]) {
      near(backCameraAzAlt(a, beta, 0).azimuth, level, 1e-6, `az stable α=${a} β=${beta}`);
    }
  }
});

test('backCameraAzAlt: roll about the top edge spins azimuth about vertical', () => {
  // At β=90 the top edge points at the zenith, so γ rotates the phone about the
  // world vertical → azimuth shifts by γ, altitude stays level.
  const p = backCameraAzAlt(0, 90, 30);
  near(p.azimuth, 330, 1e-6, 'γ=30 shifts az by 30');
  near(p.altitude, 0, 1e-6, 'still level');
});

test('calibration offsets wrap the short way and invert cleanly', () => {
  assert.equal(wrapOffset(190), -170);
  assert.equal(wrapOffset(-190), 170);
  assert.equal(calibrationOffset(10, 350), 20, 'true 10 vs measured 350 → +20');
  assert.equal(calibrationOffset(350, 10), -20);
  assert.equal(applyOffset(350, 20), 10);
  assert.equal(applyOffset(10, -20), 350);
});

test('sweep bins by azimuth and medians shrug off outliers', () => {
  const s = makeSession(1);
  addSample(s, 90.2, 10.1);
  addSample(s, 90.7, 9.9);
  addSample(s, 90.4, 10.0);
  addSample(s, 90.5, 55);        // a wild swing of the arm
  addSample(s, NaN, 5);          // ignored
  addSample(s, 45, Infinity);    // ignored
  assert.equal(sampleCount(s), 4);
  const p = profileFromSession(s);
  assert.equal(p.points.length, 1);
  assert.equal(p.points[0].az, 90.5, 'bin centre');
  near(p.points[0].alt, 10.05, 1e-9, 'median of 9.9/10/10.1/55');
});

test('coverage reports filled bins and the widest wrap-aware gap', () => {
  const s = makeSession(1);
  assert.deepEqual(coverage(s), { binsWithData: 0, totalBins: 360, pct: 0, maxGapDeg: 360 });
  for (let az = 0; az < 180; az++) addSample(s, az + 0.5, 5);
  const c = coverage(s);
  assert.equal(c.binsWithData, 180);
  assert.equal(c.pct, 50);
  assert.equal(c.maxGapDeg, 180, 'the empty southern-to-north half');
  // A gap spanning the seam: fill 350–359 and 10–19 → the 350↔10 side has no gap > 10.
  const w = makeSession(1);
  for (let az = 350; az < 360; az++) addSample(w, az + 0.5, 5);
  for (let az = 10; az < 20; az++) addSample(w, az + 0.5, 5);
  assert.equal(coverage(w).maxGapDeg, 330, 'the long way around, not the seam');
});

test('largestGap locates the widest hole so the UI can point you at it', () => {
  assert.deepEqual(largestGap(makeSession(1)), { gapDeg: 360, centerAz: 0 }, 'empty → whole circle');
  const s = makeSession(1);
  // Fill everything except a block 180–219 (a 40° hole centred on 200°).
  for (let az = 0; az < 360; az++) if (az < 180 || az >= 220) addSample(s, az + 0.5, 5);
  const g = largestGap(s);
  assert.equal(g.gapDeg, 40, 'the untouched 40° block');
  assert.ok(Math.abs(g.centerAz - 200) <= 1, `gap centre near 200°, got ${g.centerAz}`);
  // A near-complete sweep with only 1° pinholes → widest gap is tiny (done-ish).
  const w = makeSession(1);
  for (let az = 0; az < 360; az += 2) addSample(w, az + 0.5, 5); // every other degree
  assert.ok(largestGap(w).gapDeg <= 1, 'alternating fills leave only 1° gaps');
});

test('a synthetic treeline sweep reconstructs the profile; gaps interpolate', () => {
  const truth = (az) => (az >= 80 && az <= 100 ? 20 : 5);
  const s = makeSession(1);
  let k = 0;
  for (let az = 0; az < 360; az += 0.25) {
    addSample(s, az, truth(az) + (((k++ % 5) - 2) * 0.4)); // ±0.8° hand jitter
  }
  const p = profileFromSession(s);
  near(sampleAt(p, 90), 20, 1, 'treeline recovered');
  near(sampleAt(p, 270), 5, 1, 'open sky recovered');
  // Sparse session: two sightings only → linear interpolation between them.
  const sparse = makeSession(1);
  addSample(sparse, 0.5, 0);
  addSample(sparse, 180.5, 10);
  const q = profileFromSession(sparse);
  near(sampleAt(q, 90.5), 5, 0.1, 'halfway between the two sightings');
  assert.throws(() => profileFromSession(makeSession(1)), /no samples/);
});

// --- seeded capture (v2.11.0): a base profile survives in unswept gaps -------
test('seeded: swept wedges replace, wide unswept gaps keep the base', () => {
  // Base: a terrain trace — 5° everywhere on the 10° grid.
  const base = makeHorizon(Array.from({ length: 36 }, () => 5));
  // Sweep ONLY the northern semicircle (270°→90° through north) at 20°.
  const s = makeSession(1);
  for (let az = 270; az < 360; az++) addSample(s, az + 0.2, 20);
  for (let az = 0; az < 90; az++) addSample(s, az + 0.2, 20);
  const p = profileFromSession(s, base);
  near(sampleAt(p, 0), 20, 0.5, 'swept north = captured');
  near(sampleAt(p, 45), 20, 0.5, 'swept NE = captured');
  near(sampleAt(p, 180), 5, 0.5, 'unswept south keeps the terrain base');
  near(sampleAt(p, 135), 5, 0.5, 'unswept SE keeps the terrain base');
});

test('seeded: small jitter gaps still smooth over — the base does not leak in', () => {
  const base = makeHorizon(Array.from({ length: 36 }, () => 40)); // a tall base would be obvious
  const s = makeSession(1);
  // Full circle at 10°, except a 8° jitter hole around az 100 (≤ SEED_GAP_DEG).
  for (let az = 0; az < 360; az++) { if (az < 96 || az > 104) addSample(s, az + 0.2, 10); }
  const p = profileFromSession(s, base);
  near(sampleAt(p, 100), 10, 0.5, 'jitter hole interpolates from captured neighbours, not the 40° base');
});

test('seeded: a single Marked point refines one spot, base everywhere else', () => {
  const base = makeHorizon(Array.from({ length: 36 }, (_, i) => (i === 18 ? 7 : 3))); // trace: 7° due south
  const s = makeSession(1);
  addSample(s, 90.5, 25); // one treetop marked due east
  const p = profileFromSession(s, base);
  near(sampleAt(p, 90.5), 25, 0.5, 'the mark wins at its azimuth');
  near(sampleAt(p, 180), 7, 0.5, 'the traced south ridge survives');
  near(sampleAt(p, 270), 3, 0.5, 'the rest of the base survives');
});

test('seeded: no base → original replace-everything behaviour unchanged', () => {
  const s = makeSession(1);
  addSample(s, 0.5, 12); addSample(s, 180.5, 4);
  const withNull = profileFromSession(s, null);
  const bare = profileFromSession(s);
  assert.deepEqual(withNull.points, bare.points);
  near(sampleAt(bare, 90.5), 8, 0.5, 'gap interpolates between captured points');
});
