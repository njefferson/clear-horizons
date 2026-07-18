// =============================================================================
// settings.js — the Settings view: pick the active instrument (its FOV drives
// every fit/mosaic/framing answer app-wide), add/remove custom telescopes
// (focal length + sensor specs → computed FOV, on the model registry that has
// shipped since v1), and toggle the theme. Custom scopes ride the Sites
// backup bundle, so they aren't trapped in one browser.
// =============================================================================
import { el, clear, toast } from './dom.js';
import {
  allInstruments, activeInstrument, setActiveInstrument, fovOf, pixelScale,
  addCustomInstrument, removeCustomInstrument, makeCustomInstrument,
} from '../model/instruments.js';
import { isDark, setTheme } from './theme.js';

export function renderSettings(app, state, nav) {
  clear(app);
  app.append(
    el('h1', {}, 'Settings'),
    instrumentSection(nav),
    themeSection(),
    el('p.settings-foot', {}, 'Custom scopes are included in backups — export from the Sites tab.'),
  );
}

function instrumentSection(nav) {
  const active = activeInstrument();
  return el('section.settings-block', {}, [
    el('h2', {}, 'Instrument'),
    el('p.dim.small', {}, 'The active instrument’s field of view drives every fit / mosaic / framing answer across the app.'),
    el('div.inst-grid', {}, allInstruments().map((inst) => instCard(inst, inst.id === active.id, nav))),
    el('div.row-actions', {}, [
      el('button.btn', { onclick: () => openScopeForm(nav) }, '+ Add custom telescope'),
    ]),
  ]);
}

// One picker card. Customs also get a Remove action; nested interactive
// elements are invalid inside a <button>, so the card is a wrapper div holding
// the pick button (and, for customs, an action row).
function instCard(inst, on, nav) {
  const fov = fovOf(inst);
  const ps = pixelScale(inst);
  const pick = el('button.inst-pick', {
    'aria-pressed': on ? 'true' : 'false',
    onclick: () => { if (setActiveInstrument(inst.id)) nav.rerender(); },
  }, [
    el('div.inst-card-head', {}, [
      el('span.inst-name', {}, inst.name),
      on ? el('span.inst-active', {}, 'active') : null,
    ]),
    el('div.inst-specs', {}, [
      spec('FOV', `${fov.w_deg.toFixed(2)}° × ${fov.h_deg.toFixed(2)}°`),
      spec('Focal', `${inst.focalLength_mm} mm`),
      inst.aperture_mm ? spec('Aperture', `${inst.aperture_mm} mm`) : null,
      ps ? spec('Scale', `${ps.toFixed(2)}″/px`) : null,
      spec('Zenith dead-zone', inst.mount?.zenithDeadZone_deg ? `≥ ${inst.mount.zenithDeadZone_deg}°` : 'none'),
    ]),
  ]);
  return el('div.inst-card', { class: on ? 'active' : '' }, [
    pick,
    inst.custom ? el('div.inst-card-actions', {}, [
      el('button.btn.small.danger', { onclick: () => {
        if (!confirm(`Remove “${inst.name}”?`)) return;
        removeCustomInstrument(inst.id); // falls back to the default if active
        toast('Custom scope removed.');
        nav.rerender();
      } }, 'Remove'),
    ]) : null,
  ]);
}

function spec(label, value) {
  return el('div.spec', {}, [el('span.spec-k', {}, label), el('span.spec-v', {}, value)]);
}

// --- custom-scope form --------------------------------------------------------
// Focal length + sensor → FOV is computed live, exactly as the model will see
// it. Two sensor entry paths: pixels × pixel pitch (how astro cameras are
// specced — also yields the ″/px scale), or plain sensor millimetres (how
// camera-lens spec sheets read). Whichever is filled in wins; px+µm first.
function openScopeForm(nav) {
  document.querySelector('.loc-dialog')?.remove();
  const name = el('input.loc-in', { type: 'text', placeholder: 'e.g. RedCat 51 + ASI533' });
  const focal = el('input.loc-in', { type: 'number', min: '1', step: '1', placeholder: '250' });
  const aperture = el('input.loc-in', { type: 'number', min: '1', step: '1', placeholder: 'optional' });
  const wpx = el('input.loc-in', { type: 'number', min: '1', step: '1', placeholder: '1920' });
  const hpx = el('input.loc-in', { type: 'number', min: '1', step: '1', placeholder: '1080' });
  const pum = el('input.loc-in', { type: 'number', min: '0.01', step: '0.01', placeholder: '2.9' });
  const wmm = el('input.loc-in', { type: 'number', min: '0.1', step: '0.1', placeholder: '23.5' });
  const hmm = el('input.loc-in', { type: 'number', min: '0.1', step: '0.1', placeholder: '15.6' });
  const altAz = el('input', { type: 'checkbox', checked: true });
  const eq = el('input', { type: 'checkbox' });
  const dz = el('input.loc-in', { type: 'number', min: '0', max: '90', step: '1', value: '85' });
  const preview = el('p.fov-preview.dim.small', {}, 'FOV — enter focal length and sensor.');

  // Whichever sensor spec is complete: pixels + pitch preferred (it also gives
  // the pixel scale), else millimetres.
  const readSensor = () => {
    const w = parseFloat(wpx.value), h = parseFloat(hpx.value), p = parseFloat(pum.value);
    if (w > 0 && h > 0 && p > 0) return { w_px: w, h_px: h, pixel_um: p };
    const wm = parseFloat(wmm.value), hm = parseFloat(hmm.value);
    if (wm > 0 && hm > 0) return { w_mm: wm, h_mm: hm };
    return null;
  };
  const readProfile = () => {
    const f = parseFloat(focal.value);
    const sensor = readSensor();
    if (!(f > 0) || !sensor) return null;
    const a = parseFloat(aperture.value);
    const zenith = altAz.checked ? Math.max(0, Math.min(90, parseFloat(dz.value) || 0)) : 0;
    return makeCustomInstrument({
      name: name.value.trim() || 'Custom scope',
      focalLength_mm: f,
      aperture_mm: a > 0 ? a : null,
      sensor,
      mount: { altAz: altAz.checked, eqCapable: eq.checked, zenithDeadZone_deg: zenith },
    });
  };
  const updatePreview = () => {
    const prof = readProfile();
    if (!prof) { preview.textContent = 'FOV — enter focal length and sensor.'; return; }
    const fov = fovOf(prof);
    const ps = pixelScale(prof); // null on the mm path — no pitch to scale from
    preview.textContent = `FOV ${fov.w_deg.toFixed(2)}° × ${fov.h_deg.toFixed(2)}°${ps ? ` · ${ps.toFixed(2)}″/px` : ''}`;
  };
  for (const inp of [focal, wpx, hpx, pum, wmm, hmm]) inp.addEventListener('input', updatePreview);

  const dlg = el('dialog.loc-dialog', { 'aria-labelledby': 'scope-form-title' }, [
    el('h2', { id: 'scope-form-title' }, 'Add custom telescope'),
    el('div.loc-grid', {}, [
      labeled('Name', name),
      el('div.sensor-row', {}, [labeled('Focal length (mm)', focal), labeled('Aperture (mm)', aperture)]),
      el('div.sensor-row', {}, [labeled('Sensor width (px)', wpx), labeled('Height (px)', hpx), labeled('Pixel (µm)', pum)]),
      el('p.dim.small.sensor-or', {}, 'or, if the spec sheet gives the sensor in millimetres:'),
      el('div.sensor-row', {}, [labeled('Sensor width (mm)', wmm), labeled('Height (mm)', hmm)]),
      preview,
      el('label.toggle-row.small-gap', {}, [altAz, el('span', {}, 'Alt-az mount (has a zenith dead-zone)')]),
      labeled('Zenith dead-zone starts at (° altitude)', dz),
      el('label.toggle-row.small-gap', {}, [eq, el('span', {}, 'EQ-capable (dead-zone relaxed in EQ mode)')]),
    ]),
    el('div.hz-dialog-foot', {}, [
      el('button.btn.ghost', { onclick: () => dlg.close() }, 'Cancel'),
      el('button.btn.primary', { onclick: () => {
        const prof = readProfile();
        if (!prof) { toast('Enter focal length plus a sensor: width / height / pixel size in px + µm, or width / height in mm.'); return; }
        addCustomInstrument(prof);        // replaces by id if the name recurs
        setActiveInstrument(prof.id);
        dlg.close(); nav.rerender();
        toast(`Added “${prof.name}” — now active.`);
      } }, 'Save'),
    ]),
  ]);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
}

function labeled(label, control) { return el('label.fld', {}, [el('span', {}, label), control]); }

function themeSection() {
  const cb = el('input.theme-checkbox', {
    // NB: `true`, not '' — el() assigns properties, and node.checked = '' is
    // falsy, which left this box unchecked when Settings opened in dark mode.
    type: 'checkbox', checked: isDark() || null,
    onchange: (e) => setTheme(e.target.checked),
  });
  return el('section.settings-block', {}, [
    el('h2', {}, 'Appearance'),
    el('label.toggle-row', {}, [cb, el('span', {}, 'Night Mode (dark)')]),
  ]);
}
