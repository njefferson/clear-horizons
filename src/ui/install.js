// =============================================================================
// install.js — prompt users to INSTALL the app and explain how (device-pass
// gap, 2026-07-18: the whole point of the PWA machinery is offline field use,
// and nothing ever said so). Platforms genuinely differ:
//   - Chromium (Android/desktop): `beforeinstallprompt` → a real Install
//     button that triggers the browser's install dialog.
//   - iOS/iPadOS Safari: NO install API — instructions only (Share → Add to
//     Home Screen). iPadOS masquerades as a Mac in the UA; touch points give
//     it away.
//   - Everything else: honest generic guidance (browser menu).
//   - Already installed (standalone display mode): show nothing.
// The Tonight nudge is dismissible once, forever (horizon.installNudge); the
// ⓘ About dialog carries the full per-platform instructions permanently.
// =============================================================================
import { el, toast } from './dom.js';

const DISMISS_KEY = 'horizon.installNudge';

let deferredPrompt = null; // the stashed beforeinstallprompt event

/** Boot hook: capture the install prompt and celebrate a completed install. */
export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we surface our own affordance instead of the mini-infobar
    deferredPrompt = e;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try { localStorage.setItem(DISMISS_KEY, 'dismissed'); } catch { /* private mode */ }
    toast('Installed — launch it from your home screen any time, even offline.');
  });
}

function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || navigator.standalone === true;
}
function isIOS() {
  const ua = navigator.userAgent || '';
  // iPhone/iPod/iPad — plus iPadOS pretending to be a Mac (touch gives it away).
  return /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** 'installed' | 'promptable' | 'ios' | 'generic' */
export function installState() {
  if (isStandalone()) return 'installed';
  if (deferredPrompt) return 'promptable';
  if (isIOS()) return 'ios';
  return 'generic';
}

function dismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === 'dismissed'; } catch { return false; }
}

/**
 * The dismissible Tonight nudge, or null when installed/dismissed. Static
 * content at render (no live region); reuses the notice tokens.
 */
export function installNudge(nav) {
  const state = installState();
  if (state === 'installed' || dismissed()) return null;
  const how = state === 'promptable'
    ? null // the button IS the how
    : state === 'ios'
      ? el('span.dim.small', {}, 'In Safari: tap Share (the square with the arrow) → Add to Home Screen.')
      : el('span.dim.small', {}, 'Look for “Install app” or “Add to Home Screen” in your browser menu.');
  return el('div.sky-notice.install-nudge', {}, [
    el('span', {}, '📲 Install this app — it works fully offline in the field. '),
    how,
    state === 'promptable'
      ? el('button.btn.small.primary', { onclick: async () => {
          const p = deferredPrompt;
          if (!p) return;
          deferredPrompt = null;
          try { p.prompt(); await p.userChoice; } catch { /* user closed it */ }
          nav.rerender();
        } }, 'Install')
      : null,
    el('button.btn.small', { onclick: () => {
      try { localStorage.setItem(DISMISS_KEY, 'dismissed'); } catch { /* private mode */ }
      nav.rerender();
    }, 'aria-label': 'Dismiss the install suggestion' }, 'Dismiss'),
  ]);
}

/** The permanent per-platform instructions for the ⓘ About dialog. */
export function installHelpHTML() {
  return `
  <h3>Install it (works offline)</h3>
  <p>Installed, the app launches from your home screen full-screen and works
  <strong>entirely offline in the field</strong> — catalog, horizon, planning
  and all. How, by platform:<br>
  <strong>iPhone / iPad</strong> — in Safari, tap Share (the square with the
  arrow) → <em>Add to Home Screen</em>.<br>
  <strong>Android</strong> — Chrome offers <em>Install app</em> in the ⋮ menu
  (or tap the install banner when it appears).<br>
  <strong>Desktop</strong> — Chrome/Edge show an install icon at the right end
  of the address bar.</p>`;
}
