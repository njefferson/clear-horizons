// Headless unit tests for model/weather.js — the night's cloud forecast:
// URL shape, response parsing, night-window trimming, and the one-slot
// per-(site,night) cache with staleness. All synthetic; fetch and storage
// are injected fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  forecastUrl, parseForecast, nightSlice, cacheKey, getNightClouds, MAX_AGE_MS,
} from '../src/model/weather.js';

const H = 3600000;
const T0 = Date.parse('2026-07-18T03:00:00Z'); // "tonight" anchor for synthetic data

// A fake Open-Meteo response: hourly samples every hour from T0-2h to T0+10h.
function apiJson() {
  const time = [], cc = [], lo = [], mi = [], hi = [];
  for (let k = -2; k <= 10; k++) {
    time.push((T0 + k * H) / 1000);
    cc.push(10 * Math.abs(k)); lo.push(5); mi.push(3); hi.push(2);
  }
  return { hourly: { time, cloud_cover: cc, cloud_cover_low: lo, cloud_cover_mid: mi, cloud_cover_high: hi } };
}
const win = { start: new Date(T0), end: new Date(T0 + 8 * H) };
const site = { id: 'site-x', lat: 37.5, lon: -122 };

function fakeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), dump: () => m };
}
const okFetch = (json) => async () => ({ ok: true, json: async () => json });

test('forecastUrl asks Open-Meteo for the four cloud bands in unixtime', () => {
  const u = new URL(forecastUrl(37.5, -122));
  assert.equal(u.hostname, 'api.open-meteo.com');
  assert.equal(u.searchParams.get('latitude'), '37.5000');
  assert.equal(u.searchParams.get('longitude'), '-122.0000');
  assert.equal(u.searchParams.get('hourly'), 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high');
  assert.equal(u.searchParams.get('timeformat'), 'unixtime');
});

test('parseForecast maps rows and drops invalid ones', () => {
  const j = apiJson();
  j.hourly.cloud_cover[3] = null; // one broken row
  const rows = parseForecast(j);
  assert.equal(rows.length, 12, '13 hours minus the broken row');
  assert.equal(rows[0].ms, T0 - 2 * H);
  assert.deepEqual(
    Object.keys(rows[0]).sort(), ['high', 'low', 'mid', 'ms', 'total'].sort());
  assert.deepEqual(parseForecast({}), []);
  assert.deepEqual(parseForecast(null), []);
});

test('nightSlice keeps the plotted night ±30 min', () => {
  const rows = parseForecast(apiJson()); // T0-2h … T0+10h
  const sliced = nightSlice(rows, win);  // win: T0 … T0+8h
  assert.equal(sliced[0].ms, T0, 'first kept sample is the window start (−2h/−1h fall outside the pad)');
  assert.equal(sliced[sliced.length - 1].ms, T0 + 8 * H);
});

test('getNightClouds: fetches, trims, caches under the (site,night) key', async () => {
  const storage = fakeStorage();
  const got = await getNightClouds({ site, win, fetchImpl: okFetch(apiJson()), storage, now: T0 });
  assert.equal(got.length, 9, 'window hours only');
  const cached = JSON.parse(storage.dump().get('horizon.weather'));
  assert.equal(cached.key, cacheKey(site.id, win));
  assert.equal(cached.samples.length, 9);
});

test('getNightClouds: fresh cache short-circuits the network', async () => {
  const entry = { key: cacheKey(site.id, win), fetchedAt: T0, samples: [{ ms: T0, total: 1, low: 1, mid: 0, high: 0 }] };
  const storage = fakeStorage({ 'horizon.weather': JSON.stringify(entry) });
  let called = 0;
  const got = await getNightClouds({ site, win, fetchImpl: async () => { called++; throw new Error('no'); }, storage, now: T0 + H });
  assert.equal(called, 0, 'no fetch within MAX_AGE');
  assert.equal(got.length, 1);
});

test('getNightClouds: stale cache refetches, and survives a failed refetch', async () => {
  const stale = { key: cacheKey(site.id, win), fetchedAt: T0 - MAX_AGE_MS - 1, samples: [{ ms: T0, total: 9, low: 9, mid: 0, high: 0 }] };
  const storage = fakeStorage({ 'horizon.weather': JSON.stringify(stale) });
  // Failing network → the stale samples still come back (stale beats nothing).
  const kept = await getNightClouds({ site, win, fetchImpl: async () => { throw new Error('offline'); }, storage, now: T0 });
  assert.equal(kept[0].total, 9);
  // Working network → refreshed data replaces the slot.
  const fresh = await getNightClouds({ site, win, fetchImpl: okFetch(apiJson()), storage, now: T0 });
  assert.equal(fresh.length, 9);
});

test('getNightClouds: a different night misses the one-slot cache', async () => {
  const entry = { key: cacheKey(site.id, win), fetchedAt: T0, samples: [{ ms: T0, total: 1, low: 0, mid: 0, high: 0 }] };
  const storage = fakeStorage({ 'horizon.weather': JSON.stringify(entry) });
  const nextNight = { start: new Date(T0 + 24 * H), end: new Date(T0 + 32 * H) };
  const got = await getNightClouds({ site, win: nextNight, fetchImpl: async () => { throw new Error('offline'); }, storage, now: T0 + 24 * H });
  assert.equal(got, null, 'no fetch + wrong-night cache → null, never another night\'s clouds');
});
