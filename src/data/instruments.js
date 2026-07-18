// =============================================================================
// Bundled instrument presets. Each profile is deliberately spec-driven — focal
// length + sensor — so the field-of-view is COMPUTED (model/instruments.js),
// never a hardcoded constant. The same catalog then serves every scope: the
// S50, the wider S30, and any custom profile a user enters.
//
// A profile:
//   { id, name, focalLength_mm, aperture_mm,
//     sensor: { w_px, h_px, pixel_um } | { w_mm, h_mm },
//     fov?: { w_deg, h_deg },              // optional override; else computed
//     mount: { altAz, eqCapable, zenithDeadZone_deg } }
//
// The Seestar S50 carries the Sony IMX462 and the S30 the Sony IMX662 —
// different chips with IDENTICAL 1920×1080 @ 2.9 µm geometry, so they share
// one geometry constant below; the focal length (250 mm vs 150 mm) is why the
// S30 frames wider. Do NOT bake FOV numbers here — let it compute.
// =============================================================================

const IMX462 = { w_px: 1920, h_px: 1080, pixel_um: 2.9 };
const IMX662 = { ...IMX462 }; // same geometry, different (newer) chip

// The preset library (v2.4.0) covers the smart-scope class the roadmap names.
// Every sensor is pixels × pitch from the maker's published specs (verified
// 2026-07-18 against dwarflab.com / vaonis.com + independent reviews) so the
// FOV computes; where a published FOV exists it agrees with the computation
// (e.g. Vespera Pro 1.6°×1.6°, Dwarf 3 ≈ 2.9°×1.7°). Marketing pages sometimes
// misquote a sibling model's FOV — the computation is the source of truth here.
// All are alt-az; the shared 85° dead-zone is the generic "last few degrees"
// alt-az default (same as the S50), not a per-model measurement — a custom
// profile can override it.
const ALT_AZ = { altAz: true, eqCapable: false, zenithDeadZone_deg: 85 };
const ALT_AZ_EQ = { ...ALT_AZ, eqCapable: true }; // firmware EQ mode relaxes it

export const PRESETS = [
  {
    id: 's50',
    name: 'Seestar S50',
    focalLength_mm: 250,
    aperture_mm: 50,
    sensor: { ...IMX462 },
    // Alt-az smart scope with a firmware EQ mode; field rotation makes the last
    // few degrees to the zenith unusable in alt-az, relaxable in EQ mode.
    mount: { ...ALT_AZ_EQ },
  },
  {
    id: 's30',
    name: 'Seestar S30',
    focalLength_mm: 150,
    aperture_mm: 30,
    sensor: { ...IMX662 },
    mount: { ...ALT_AZ_EQ },
  },
  {
    id: 'dwarf2',
    name: 'Dwarf II',
    focalLength_mm: 100,          // tele lens, f/4.2
    aperture_mm: 24,
    sensor: { w_px: 3840, h_px: 2160, pixel_um: 1.45 }, // Sony IMX415
    mount: { ...ALT_AZ },         // EQ mode arrived with the Dwarf 3
  },
  {
    id: 'dwarf3',
    name: 'Dwarf 3',
    focalLength_mm: 150,          // tele lens, f/4.3
    aperture_mm: 35,
    sensor: { w_px: 3840, h_px: 2160, pixel_um: 2.0 },  // Sony IMX678
    mount: { ...ALT_AZ_EQ },      // dedicated EQ mode
  },
  {
    id: 'vespera',
    name: 'Vaonis Vespera',
    focalLength_mm: 200,          // f/4 quadruplet
    aperture_mm: 50,
    sensor: { ...IMX462 },        // Sony IMX462 — same chip as the S50
    mount: { ...ALT_AZ },
  },
  {
    id: 'vespera2',
    name: 'Vaonis Vespera II',
    focalLength_mm: 250,          // f/5 quadruplet
    aperture_mm: 50,
    sensor: { w_px: 3840, h_px: 2160, pixel_um: 2.9 },  // Sony IMX585
    mount: { ...ALT_AZ },
  },
  {
    id: 'vespera-pro',
    name: 'Vaonis Vespera Pro',
    focalLength_mm: 250,          // f/5 quadruplet
    aperture_mm: 50,
    sensor: { w_px: 3536, h_px: 3536, pixel_um: 2.0 },  // Sony IMX676 (square)
    mount: { ...ALT_AZ },
  },
];

export const DEFAULT_INSTRUMENT_ID = 's50';
