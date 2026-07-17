// Headless unit tests for model/arproject.js — the projection under the live-
// camera AR overlay. Centre identity, sign conventions, round-trip inversion
// (the reticle depends on it), frame culling, and the horizon polyline. All
// synthetic; no camera, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapDeg, DEFAULT_FOV, projectPoint, azimuthAtScreenX, altitudeAtScreenY,
  visibleAzRange, horizonPolyline,
} from '../src/model/arproject.js';
import { makeHorizon, sampleAt } from '../src/model/horizon.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('the camera axis lands dead centre', () => {
  const p = projectPoint({ az: 90, alt: 10 }, { az: 90, alt: 10 });
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
  assert.ok(p.onScreen);
});

test('signs: right of axis → +x, above axis → −y (up)', () => {
  const fov = { hfov: 60, vfov: 78 };
  const right = projectPoint({ az: 100, alt: 0 }, { az: 90, alt: 0 }, fov);
  near(right.x, 10 / 60, 1e-12, 'az +10° → right');
  assert.ok(right.y === 0);
  const up = projectPoint({ az: 90, alt: 20 }, { az: 90, alt: 0 }, fov);
  near(up.y, -20 / 78, 1e-12, 'alt above axis is negative (upward) y');
  const down = projectPoint({ az: 90, alt: -20 }, { az: 90, alt: 0 }, fov);
  near(down.y, 20 / 78, 1e-12, 'a depressed horizon is below centre');
});

test('the azimuth delta wraps the short way across north', () => {
  const p = projectPoint({ az: 2, alt: 0 }, { az: 358, alt: 0 }, { hfov: 60, vfov: 78 });
  near(p.x, 4 / 60, 1e-12, '358→2 is +4°, not −356°');
  assert.equal(wrapDeg(190), -170);
});

test('screen ↔ world inverts exactly — the reticle round-trips', () => {
  const cam = { az: 123.4, alt: 7.5 };
  const fov = DEFAULT_FOV;
  for (const [x, y] of [[0, 0], [0.5, -0.5], [-0.3, 0.25], [0.42, 0.1]]) {
    const az = azimuthAtScreenX(x, cam.az, fov.hfov);
    const alt = altitudeAtScreenY(y, cam.alt, fov.vfov);
    const back = projectPoint({ az, alt }, cam, fov);
    near(back.x, x, 1e-9, `x round-trip @${x}`);
    near(back.y, y, 1e-9, `y round-trip @${y}`);
  }
});

test('altitudeAtScreenY: dragging the reticle up reads a higher obstruction', () => {
  // Camera level (alt 0), FOV vfov 78 → the top edge (y −0.5) is +39°.
  near(altitudeAtScreenY(-0.5, 0, 78), 39, 1e-12, 'top edge = +half-vfov');
  near(altitudeAtScreenY(0.5, 0, 78), -39, 1e-12, 'bottom edge = −half-vfov');
  near(altitudeAtScreenY(0, 12, 78), 12, 1e-12, 'centre reads the camera altitude');
});

test('points outside the frame are flagged off-screen (culling)', () => {
  const cam = { az: 90, alt: 0 };
  assert.equal(projectPoint({ az: 90 + 40, alt: 0 }, cam).onScreen, false, 'beyond half the hfov');
  assert.equal(projectPoint({ az: 90, alt: 60 }, cam).onScreen, false, 'beyond half the vfov');
  assert.equal(projectPoint({ az: 100, alt: 5 }, cam).onScreen, true, 'well inside');
});

test('visibleAzRange spans one hfov centred on the axis, seam-free', () => {
  const r = visibleAzRange({ az: 5 }, 60);
  near(r.left, -25, 1e-12, 'may go below 0 so the arc has no seam');
  near(r.right, 35, 1e-12);
});

test('horizonPolyline traces the profile across the frame in screen space', () => {
  // An 18° wall from az 80–100, open 5° elsewhere.
  const profile = makeHorizon({ points: [
    { az: 0, alt: 5 }, { az: 80, alt: 18 }, { az: 100, alt: 18 }, { az: 180, alt: 5 },
  ] });
  const cam = { az: 90, alt: 9 }; // looking at the wall, axis mid-height
  const line = horizonPolyline(profile, sampleAt, cam, DEFAULT_FOV, 2);
  // Endpoints sit at the frame edges; the centre samples the 18° wall.
  near(line[0].x, -0.5, 1e-9, 'left edge');
  near(line[line.length - 1].x, 0.5, 1e-9, 'right edge');
  const mid = line.find((p) => Math.abs(p.az - 90) < 1.01);
  near(mid.alt, 18, 1e-9, 'wall altitude sampled at centre');
  near(mid.y, (9 - 18) / DEFAULT_FOV.vfov, 1e-9, 'wall projects above the axis');
});
