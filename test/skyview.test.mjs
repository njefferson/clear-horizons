// Headless unit tests for model/skyview.js — the AR sky view's assembly layer.
// These lean on independent facts: an arc split by a horizon must only keep the
// runs that clear it; a target that transits far above a low treeline is above
// the horizon at culmination; the Moon entry always appears and carries a phase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeObserver, altAz } from '../src/model/astro.js';
import { makeHorizon, isAbove, sampleAt } from '../src/model/horizon.js';
import { nightWindow } from '../src/model/night.js';
import { aboveHorizonSegments, positionAt, buildSkyScene } from '../src/model/skyview.js';

const SITE = { lat: 37.5, lon: -122.0 };
const obs = makeObserver(SITE.lat, SITE.lon, 0);
const VEGA = { id: 'vega', ra: 18.6156, dec: 38.7837, common: 'Vega', name: 'Vega' };
const DATE = new Date('2026-07-18T12:00:00');

test('aboveHorizonSegments keeps only the runs that clear the profile', () => {
  const profile = makeHorizon([[0, 20]]); // flat 20° treeline all around
  // Synthetic arc: below, below, above, above, below, above — az irrelevant here.
  const curve = [
    { time: new Date(0), altitude: 5, azimuth: 100 },
    { time: new Date(1), altitude: 10, azimuth: 100 },
    { time: new Date(2), altitude: 30, azimuth: 100 },
    { time: new Date(3), altitude: 40, azimuth: 100 },
    { time: new Date(4), altitude: 15, azimuth: 100 },
    { time: new Date(5), altitude: 25, azimuth: 100 },
  ];
  const segs = aboveHorizonSegments(curve, profile);
  assert.equal(segs.length, 2, 'two separate above-horizon runs');
  assert.deepEqual(segs[0].map((p) => p.altitude), [30, 40]);
  assert.deepEqual(segs[1].map((p) => p.altitude), [25]);
  // Every kept point genuinely clears the horizon.
  for (const seg of segs) for (const p of seg) assert.ok(isAbove(profile, p.azimuth, p.altitude));
});

test('aboveHorizonSegments returns nothing when the arc never clears the treeline', () => {
  const profile = makeHorizon([[0, 60]]); // very tall wall
  const curve = [10, 20, 30, 40].map((alt, i) => ({ time: new Date(i), altitude: alt, azimuth: 200 }));
  assert.deepEqual(aboveHorizonSegments(curve, profile), []);
});

test('positionAt matches altAz and reports the horizon verdict', () => {
  const profile = makeHorizon([[0, 5]]); // low horizon
  const entry = { isMoon: false, target: VEGA };
  const at = new Date('2026-07-19T06:00:00Z');
  const got = positionAt(entry, obs, profile, at);
  const direct = altAz(VEGA, obs, at);
  assert.ok(Math.abs(got.azimuth - direct.azimuth) < 1e-9);
  assert.ok(Math.abs(got.altitude - direct.altitude) < 1e-9);
  assert.equal(got.aboveHorizon, isAbove(profile, direct.azimuth, direct.altitude));
});

test('buildSkyScene: targets first, Moon last with a phase; arcs are horizon-cut', () => {
  const profile = makeHorizon([[0, 10], [90, 15], [180, 8], [270, 12]]);
  const win = nightWindow(obs, DATE);
  const at = new Date((win.start.getTime() + win.end.getTime()) / 2);
  const scene = buildSkyScene([VEGA], obs, profile, win, at, 10);

  assert.equal(scene.length, 2, 'one target + the Moon');
  assert.equal(scene[0].isMoon, false);
  assert.equal(scene[0].name, 'Vega');
  const moon = scene[scene.length - 1];
  assert.equal(moon.isMoon, true);
  assert.equal(moon.name, 'Moon');
  assert.ok(moon.phase && typeof moon.phase.illumination === 'number');
  assert.ok(moon.phase.illumination >= 0 && moon.phase.illumination <= 1);
  assert.equal(typeof moon.phase.phaseName, 'string');

  // Every point in every kept segment clears the measured profile.
  for (const e of scene) {
    assert.ok(Array.isArray(e.segments));
    for (const seg of e.segments) for (const p of seg) {
      assert.ok(isAbove(profile, p.azimuth, p.altitude), `${e.name} segment point clears horizon`);
      assert.ok(p.altitude >= sampleAt(profile, p.azimuth) - 1e-9);
    }
    assert.ok(e.now && typeof e.now.aboveHorizon === 'boolean');
  }
});

test('buildSkyScene still yields the Moon when there are no favourite targets', () => {
  const profile = makeHorizon([[0, 0]]);
  const win = nightWindow(obs, DATE);
  const scene = buildSkyScene([], obs, profile, win, win.start, 15);
  assert.equal(scene.length, 1);
  assert.equal(scene[0].isMoon, true);
});
