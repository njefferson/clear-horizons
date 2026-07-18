// =============================================================================
// weather.js — hourly cloud cover for the night, from Open-Meteo (keyless,
// CORS-friendly; the same provider as geocode.js). The Tonight view shades
// these under the night graph on the SAME hour axis, so "will it be clear?"
// reads in one glance with "is it up?".
//
// Fails closed like geocode.js: offline / bad JSON → cached data if we have it,
// else null — the graph renders unchanged without a forecast (offline-first:
// no nagging). Cache is one slot per (site, night) in localStorage under
// horizon.weather; a fresh fetch replaces it, staleness re-fetches after
// MAX_AGE while online. Storage and fetch are injected for headless tests.
// =============================================================================

const KEY = 'horizon.weather';
export const MAX_AGE_MS = 3 * 3600000; // refetch a forecast older than 3 h

/** The Open-Meteo forecast request for a site: hourly cloud bands, unix times. */
export function forecastUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high',
    timeformat: 'unixtime',
    timezone: 'UTC',
    forecast_days: '3',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

/** Open-Meteo JSON → [{ ms, total, low, mid, high }] (invalid rows dropped). */
export function parseForecast(json) {
  const h = json && json.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  const out = [];
  for (let i = 0; i < h.time.length; i++) {
    const s = {
      ms: h.time[i] * 1000,
      total: h.cloud_cover?.[i],
      low: h.cloud_cover_low?.[i],
      mid: h.cloud_cover_mid?.[i],
      high: h.cloud_cover_high?.[i],
    };
    if ([s.ms, s.total, s.low, s.mid, s.high].every(Number.isFinite)) out.push(s);
  }
  return out;
}

/** Trim samples to the plotted night (±30 min so edge cells reach the axis ends). */
export function nightSlice(samples, win) {
  const pad = 30 * 60000;
  const a = win.start.getTime() - pad, b = win.end.getTime() + pad;
  return samples.filter((s) => s.ms >= a && s.ms <= b);
}

/** Cache identity: one night at one site. */
export function cacheKey(siteId, win) {
  const d = win.start;
  return `${siteId}:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readCache(storage) {
  try { return JSON.parse(storage.getItem(KEY) || 'null'); } catch { return null; }
}
function writeCache(storage, entry) {
  try { storage.setItem(KEY, JSON.stringify(entry)); } catch { /* private mode */ }
}

/**
 * The night's cloud forecast for a site — cache-first, network-refresh.
 * @param opts { site: {id,lat,lon}, win: {start,end}, fetchImpl, storage, now }
 * @returns [{ ms, total, low, mid, high }] or null when nothing is available.
 */
export async function getNightClouds({ site, win, fetchImpl, storage, now = Date.now() } = {}) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const key = cacheKey(site.id, win);
  const cached = store ? readCache(store) : null;
  const hit = cached && cached.key === key && Array.isArray(cached.samples) ? cached : null;
  if (hit && now - hit.fetchedAt <= MAX_AGE_MS) return hit.samples;

  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (f) {
    try {
      const res = await f(forecastUrl(site.lat, site.lon), { headers: { accept: 'application/json' } });
      if (res.ok) {
        const samples = nightSlice(parseForecast(await res.json()), win);
        if (samples.length) {
          if (store) writeCache(store, { key, fetchedAt: now, samples });
          return samples;
        }
      }
    } catch { /* offline / aborted — fall through to stale cache */ }
  }
  return hit ? hit.samples : null; // stale beats nothing; null beats guessing
}
