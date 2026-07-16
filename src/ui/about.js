// =============================================================================
// About — an unobtrusive floating "ⓘ" button + modal explaining what the app
// does. Mounted once at boot, it sits in the top-right corner on every screen
// (small, low-opacity, never in the way) and opens a native <dialog> with
// Esc / backdrop-click to close.
// =============================================================================
import { el } from './dom.js';

const ABOUT_HTML = `
  <h2>Horizon Planner — why this app exists</h2>
  <p>Every piece of this already exists free — catalogs and altitude curves,
  weather and seeing, a polar reticle, rise/set times. The value here is
  <strong>synergy</strong>: one tool tying your site, your horizon, your targets
  and your alignment together — <strong>plus the one thing no free tool does
  well: a custom, per-site, physically-measured horizon profile</strong> of the
  real trees and obstructions in your actual yard.</p>

  <h3>The two novel ideas</h3>
  <p>1. A <strong>measured horizon mask</strong> — the real azimuth &rarr;
  altitude profile of what blocks your sky.<br>
  2. <strong>"Above MY horizon" visibility</strong> — a target counts as usable
  only where it clears that measured profile, not a flat 0&deg; horizon.</p>

  <h3>Instrument-agnostic from day one</h3>
  <p>The field-of-view is a first-class per-instrument profile. This build ships
  the Seestar S50 as the default and the S30 alongside it, and grows to any
  smart telescope or a fully custom focal-length + sensor profile. Every
  "does it fit / how many mosaic panels / framing overlay" answer reads the
  <em>active</em> instrument — never a hardcoded constant.</p>

  <p class="about-scaffold">This is an early scaffold: the pipeline and shell
  are in place, features arrive next.</p>
`;

export function mountAbout() {
  if (document.getElementById('about-btn')) return;
  const btn = el('button.about-btn', {
    id: 'about-btn',
    title: 'About this app',
    'aria-label': 'About this app',
    onclick: openAbout,
  }, 'ⓘ');
  document.body.append(btn);
}

function openAbout() {
  document.querySelector('.about-dialog')?.remove();
  const dlg = el('dialog.about-dialog', {}, [
    el('div.about-body', { html: ABOUT_HTML }),
    el('div.about-foot', {}, [
      el('button.btn.ghost', { onclick: () => dlg.close() }, 'Close'),
    ]),
  ]);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  // Backdrop click closes.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
}
