// Soft diverging color scale for genetic correlations in [-1, 1], matching the
// original UKBB LDSC browser's signature scale (and the conventional correlation
// colormap: cool = negative, warm = positive):
//   rg = -1 -> cornflower blue (#6495ed)
//   rg =  0 -> white
//   rg = +1 -> coral (#cd5555)
import { scaleLinear, scaleOrdinal } from 'd3-scale';

const rgColor = scaleLinear()
  .domain([-1, 0, 1])
  .range(['#6495ed', '#ffffff', '#cd5555'])
  .clamp(true);

export function colorForRg(rg) {
  if (rg == null || Number.isNaN(rg)) return '#e4e4ea';
  return rgColor(rg);
}

// Relative luminance (0..1) of an "rgb(r, g, b)" or "#rrggbb"/"#rgb" string.
function luminance(s) {
  let r, g, b;
  const m = s.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (m) {
    [, r, g, b] = m.map(Number);
  } else {
    const h = s.replace('#', '');
    const v = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
    r = (v >> 16) & 255;
    g = (v >> 8) & 255;
    b = v & 255;
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Pick dark/white text for legibility on a given rg-colored chip. The softer
// scale is lighter than the old Broad scale, so test the actual interpolated
// color's luminance rather than a fixed |rg| cutoff.
export function textOnRg(rg) {
  if (rg == null || Number.isNaN(rg)) return '#3e3e40';
  return luminance(rgColor(rg)) < 0.6 ? '#ffffff' : '#3e3e40';
}

// --- Categorical scale for phenotype categories ---------------------------
// A 24-color qualitative palette (Tableau-20 plus a few extras), distinct from
// the red/white/blue rg scale so the two encodings never read as the same thing.
const CATEGORY_PALETTE = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2',
  '#edc948', '#9c755f', '#ff9da7', '#bab0ac', '#1b9e77', '#d37295',
  '#a0cbe8', '#8cd17d', '#b6992d', '#86bcb6', '#d4a6c8', '#7b6888',
  '#ffbe7d', '#79706e', '#5254a3', '#637939', '#17becf', '#8c6d31',
];

let categories = [];
const catColor = scaleOrdinal().range(CATEGORY_PALETTE);

// Register the canonical category list (call once after data load). The first
// categories get the first palette colors, so order drives color assignment.
export function setCategories(list) {
  categories = list || [];
  catColor.domain(categories);
}

export function getCategories() {
  return categories;
}

export function colorForCategory(name) {
  if (!name) return '#bab0ac';
  return catColor(name);
}

// Black/white text for legibility on an arbitrary hex background (luminance test).
export function textOnColor(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1f1f1f' : '#ffffff';
}
