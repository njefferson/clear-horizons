// =============================================================================
// location.js — the observing location for "tonight". A single working location
// for now (per-site locations arrive with the Sites manager in Step 7); stored
// in horizon.location as { lat, lon, label }.
// =============================================================================
const KEY = 'horizon.location';

/** The saved location, or null if none set yet. */
export function loadLocation() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon)) return v;
  } catch { /* fall through */ }
  return null;
}

export function saveLocation(loc) {
  const clean = { lat: clampLat(loc.lat), lon: wrapLon(loc.lon), label: (loc.label || '').trim() || null };
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* private mode */ }
  return clean;
}

export function clearLocation() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

const clampLat = (x) => Math.max(-90, Math.min(90, Number(x)));
const wrapLon = (x) => { let v = Number(x); v = ((v + 180) % 360 + 360) % 360 - 180; return v; };

/** Prompt the device for its position (opt-in). Resolves to a location or null. */
export function requestGeolocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(saveLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Current location' })),
      () => resolve(null),
      { maximumAge: 600000, timeout: 8000 },
    );
  });
}
