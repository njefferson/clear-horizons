// =============================================================================
// marks.js — the shared categorical identity system: a colour-blind-safe series
// palette AND a matching set of marker SHAPES, so identity is never carried by
// colour alone (accessibility standing order). Used by the Tonight night graph
// (ui/nightgraph.js) and the AR sky view (ui/sky.js) so the same target reads
// as the same colour+shape everywhere. `drawMark` paints the shape on a canvas;
// `markSvg` is its DOM twin for legends, tables and readouts — same geometry, so
// canvas and DOM identity match exactly.
// =============================================================================
import { el } from './dom.js';

// Colour-blind-safe categorical order (accessibility standing order). Validated
// against the graph surface #0d1018 with the dataviz CVD validator — PASS on
// all five checks, worst adjacent ΔE 8.4 protan (vs the FAILING previous set:
// 5.2 deutan, 14.9 normal). Re-run the validator before changing these:
//   node <dataviz-skill>/scripts/validate_palette.js "<hexes>" --mode dark --surface "#0d1018"
export const SERIES = ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9', '#e66767'];
// Identity is NEVER carried by colour alone — each series also gets a distinct
// marker shape, drawn on the curve and mirrored in the legend, table and scrub.
export const MARKS = ['circle', 'square', 'triangle', 'diamond', 'plus', 'cross', 'downtri', 'pentagon'];
export const CASE = '#0d1018';           // dark casing stroked under bright curve/marker runs

export const seriesColor = (i) => SERIES[i % SERIES.length];
export const seriesMark = (i) => MARKS[i % MARKS.length];

// Draw one marker shape centred at (x,y). Shapes are visually distinct at r≈4.
export function drawMark(ctx, shape, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath();
  switch (shape) {
    case 'square': ctx.rect(x - r, y - r, 2 * r, 2 * r); ctx.fill(); break;
    case 'triangle': ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); ctx.fill(); break;
    case 'downtri': ctx.moveTo(x, y + r); ctx.lineTo(x + r, y - r); ctx.lineTo(x - r, y - r); ctx.closePath(); ctx.fill(); break;
    case 'diamond': ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); break;
    case 'plus': ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); break;
    case 'cross': ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); break;
    case 'pentagon':
      for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; const px = x + r * Math.cos(a), py = y + r * Math.sin(a); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill(); break;
    default: ctx.arc(x, y, r, 0, 7); ctx.fill(); // circle
  }
  ctx.restore();
}

// The DOM twin of drawMark — the same shape as an inline SVG for the legend,
// visibility table and scrub readout, so identity matches the canvas exactly.
export function markSvg(shape, color) {
  const c = 7, r = 5;
  let inner;
  switch (shape) {
    case 'square': inner = `<rect x="${c - r}" y="${c - r}" width="${2 * r}" height="${2 * r}" fill="${color}"/>`; break;
    case 'triangle': inner = `<polygon points="${c},${c - r} ${c + r},${c + r} ${c - r},${c + r}" fill="${color}"/>`; break;
    case 'downtri': inner = `<polygon points="${c},${c + r} ${c + r},${c - r} ${c - r},${c - r}" fill="${color}"/>`; break;
    case 'diamond': inner = `<polygon points="${c},${c - r} ${c + r},${c} ${c},${c + r} ${c - r},${c}" fill="${color}"/>`; break;
    case 'plus': inner = `<path d="M${c - r} ${c}H${c + r}M${c} ${c - r}V${c + r}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`; break;
    case 'cross': inner = `<path d="M${c - r} ${c - r}L${c + r} ${c + r}M${c + r} ${c - r}L${c - r} ${c + r}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`; break;
    case 'pentagon': {
      const pts = [];
      for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; pts.push(`${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}`); }
      inner = `<polygon points="${pts.join(' ')}" fill="${color}"/>`; break;
    }
    default: inner = `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}"/>`;
  }
  return el('span.ng-mark', { html: `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">${inner}</svg>` });
}
