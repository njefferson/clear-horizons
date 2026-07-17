// =============================================================================
// arproject.js — the headless math under the LIVE-CAMERA horizon capture: map
// between world (azimuth, altitude) and the camera image plane so the AR
// overlay can draw the horizon bar-graph and the reticle OVER the video, and
// so a tapped/dragged reticle maps back to a real (az, alt) to record.
//
// MODEL. The back camera looks along its axis at (camAz, camAlt) — supplied by
// model/capture.js:cameraPointing() from device orientation. Over the modest
// field of view of a phone lens a linear (equirectangular) mapping is accurate
// enough for a skyline guide and, unlike a gnomonic projection, is trivially
// invertible — which the reticle needs. Screen coordinates are NORMALISED and
// origin-centred: (0,0) = frame centre = the camera axis, x∈[−0.5,0.5] rightward,
// y∈[−0.5,0.5] DOWNWARD (canvas convention). Pixels are (0.5+x)·W, (0.5+y)·H.
//
//   x =  wrap(worldAz − camAz) / hfov          (right of axis → +x)
//   y =  (camAlt − worldAlt)   / vfov          (above axis → −y, i.e. up)
//
// and the exact inverses map a reticle back to the sky. FOV is per-device and
// approximate here (portrait phone main camera); it is a calibration knob, not
// a constant baked into any capture — a wrong FOV only skews the on-screen
// GUIDE, never the recorded (az, alt), which come straight from the sensors.
// =============================================================================

const norm360 = (az) => ((az % 360) + 360) % 360;

/** Wrap a degree difference into (−180, 180]. */
export function wrapDeg(deg) {
  const d = norm360(deg);
  return d > 180 ? d - 360 : d;
}

// A typical phone main camera held UPRIGHT (portrait) — approximate, per-device,
// and meant to be overridden once a calibration step exists. Horizontal is the
// narrow screen dimension, vertical the tall one, hence vfov > hfov.
export const DEFAULT_FOV = { hfov: 60, vfov: 78 };

/**
 * Project a world point onto the normalised, origin-centred image plane.
 * @returns { x, y, onScreen } — onScreen true iff inside the [−0.5,0.5] frame.
 */
export function projectPoint(world, cam, fov = DEFAULT_FOV) {
  const x = wrapDeg(world.az - cam.az) / fov.hfov;
  const y = (cam.alt - world.alt) / fov.vfov;
  return { x, y, onScreen: x >= -0.5 && x <= 0.5 && y >= -0.5 && y <= 0.5 };
}

/** Inverse of the x-map: the true azimuth under a normalised screen x. */
export function azimuthAtScreenX(x, camAz, hfov = DEFAULT_FOV.hfov) {
  return norm360(camAz + x * hfov);
}

/** Inverse of the y-map: the altitude under a normalised screen y. */
export function altitudeAtScreenY(y, camAlt, vfov = DEFAULT_FOV.vfov) {
  return camAlt - y * vfov;
}

/**
 * The visible azimuth span [left, right] the frame currently covers. `right`
 * may exceed 360 (or `left` go below 0) so a caller can iterate the arc without
 * a seam; feed values through the profile's own wrap-aware sampler.
 */
export function visibleAzRange(cam, hfov = DEFAULT_FOV.hfov) {
  return { left: cam.az - hfov / 2, right: cam.az + hfov / 2 };
}

/**
 * Sample a horizon profile across the visible span into a screen-space polyline
 * for the AR bar-graph. `sampleAt` is injected (from model/horizon.js) to keep
 * this module dependency-free and unit-testable with a stub.
 * @returns [{ x, y, az, alt }, …] left→right, one every `stepDeg` of azimuth.
 */
export function horizonPolyline(profile, sampleAt, cam, fov = DEFAULT_FOV, stepDeg = 2) {
  const { left, right } = visibleAzRange(cam, fov.hfov);
  const pts = [];
  for (let az = left; az <= right + 1e-9; az += stepDeg) {
    const alt = sampleAt(profile, norm360(az));
    const p = projectPoint({ az: norm360(az), alt }, cam, fov);
    pts.push({ x: p.x, y: p.y, az: norm360(az), alt });
  }
  return pts;
}
