// =============================================================================
// Horizon Planner — app bootstrap, state, hash routing.
//
// v1 scaffold: proves the shell (routing + tabs + theme + SW) with placeholder
// views. Each tab's real content arrives in the build-order steps that follow
// (astro model, catalog/instruments, horizon editor, night graph, visibility,
// sites).
// =============================================================================
import { el } from './ui/dom.js';
import { mountAbout } from './ui/about.js';
import { mountThemeToggle } from './ui/theme.js';

const state = {
  // default = tonight; the night graph will hang off this once it lands.
  night: startOfTonight(),
};

// Local date at ~noon today → the app treats "tonight" as the night that
// begins this evening. Kept trivial for the scaffold; astro.js refines it.
function startOfTonight() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

const app = document.getElementById('app');
const tabsRoot = document.getElementById('tabs');

const nav = {
  go(hash) { if (location.hash === hash) render(); else location.hash = hash; },
  rerender() { render(); },
};

// 22px line icons, stroke=currentColor so the tab's colour (--tab-ink / active
// --tab-ink-active) drives them. Tonight = altitude curve, Targets = star,
// Horizon = ridgeline, Sites = pin, Settings = two sliders.
const svgIcon = (paths) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const TABS = [
  { hash: '#/', label: 'Tonight', icon: svgIcon('<path d="M3 17c3-8 5-11 6-11s2 3 3 6 2 5 3 5 2-2 3-5"/><line x1="3" y1="20" x2="21" y2="20"/>') },
  { hash: '#/targets', label: 'Targets', icon: svgIcon('<path d="M12 3l2.5 5.9 6.5.5-4.9 4.2 1.5 6.4L12 16.9 6.9 20l1.5-6.4L3.5 9.4l6.5-.5z"/>') },
  { hash: '#/horizon', label: 'Horizon', icon: svgIcon('<path d="M3 18l4-6 3 3 4-7 3 5 4-3"/><line x1="3" y1="21" x2="21" y2="21"/>') },
  { hash: '#/sites', label: 'Sites', icon: svgIcon('<path d="M12 21s-6-5.686-6-10a6 6 0 0 1 12 0c0 4.314-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>') },
  { hash: '#/settings', label: 'Settings', icon: svgIcon('<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.5"/><circle cx="15" cy="16" r="2.5"/>') },
];

function renderTabs() {
  const h = location.hash || '#/';
  tabsRoot.replaceChildren(...TABS.map((t) =>
    el('button.tab', {
      class: h === t.hash ? 'active' : '',
      onclick: () => nav.go(t.hash),
    }, [el('span.tab-icon', { html: t.icon }), el('span.tab-label', {}, t.label)])));
}

// Placeholder view — each tab shows what will live here, so the empty shell is
// honest about being a scaffold rather than a blank screen.
function placeholder(title, blurb) {
  return el('div.placeholder', {}, [
    el('h1', {}, title),
    el('p.dim', {}, blurb),
    el('p.scaffold-note', {}, 'Coming soon — this screen is part of the v1 build order.'),
  ]);
}

const VIEWS = {
  '#/': () => placeholder('Tonight',
    'The night graph: altitude-vs-time curves for your selected targets, cut by YOUR measured horizon, with twilight bands and sun/moon markers.'),
  '#/targets': () => placeholder('Targets',
    'The bundled deep-sky catalog with type, magnitude and size filters — plus a fits-the-active-instrument / mosaic tier and your favourites.'),
  '#/horizon': () => placeholder('Horizon',
    'Your custom horizon profile: a 36-row (10° azimuth) altitude table you drag to match the real treeline, with Stellarium import/export.'),
  '#/sites': () => placeholder('Sites',
    'Your named observing sites — each with its own coordinates and horizon profile — plus a switcher and JSON export/import.'),
  '#/settings': () => placeholder('Settings',
    'Active instrument (S50 default, S30 bundled, custom scopes), theme, and app preferences.'),
};

function render() {
  const h = location.hash || '#/';
  renderTabs();
  window.scrollTo(0, 0);
  const view = VIEWS[h] || VIEWS['#/'];
  app.replaceChildren(view());
}

window.addEventListener('hashchange', render);

// Boot.
(function boot() {
  mountAbout();        // floating "about" button, available everywhere
  mountThemeToggle();  // floating moon/sun Night Mode toggle, everywhere
  render();
})();

// Register the service worker for offline / installable PWA.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
