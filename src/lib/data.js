// Data access layer: loads the compact artifacts produced by scripts/build_data.py
// and exposes typed accessors over the 677x677 correlation matrices.
import { setCategories } from './color.js';

let cache = null;

async function fetchF32(url, n) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const arr = new Float32Array(buf);
  if (arr.length !== n * n) {
    throw new Error(`${url}: expected ${n * n} floats, got ${arr.length}`);
  }
  return arr;
}

// Resolve a data path against Vite's base URL so it works under /rg_browser/.
function dataUrl(file) {
  return `${import.meta.env.BASE_URL}data/${file}`;
}

export async function loadData() {
  if (cache) return cache;

  const [phenotypes, hierarchy] = await Promise.all([
    fetch(dataUrl('phenotypes.json')).then((r) => r.json()),
    fetch(dataUrl('hierarchy.json')).then((r) => r.json()),
  ]);
  const n = phenotypes.length;

  const [rg, se, nlogp] = await Promise.all([
    fetchF32(dataUrl('rg.f32'), n),
    fetchF32(dataUrl('se.f32'), n),
    fetchF32(dataUrl('nlogp.f32'), n),
  ]);

  const idToIndex = new Map();
  phenotypes.forEach((p, i) => idToIndex.set(p.id, i));

  // Register the canonical category order so the categorical color scale is
  // stable across all views.
  const categories = hierarchy.categories || [];
  setCategories(categories);

  cache = { n, phenotypes, hierarchy, categories, rg, se, nlogp, idToIndex };
  return cache;
}

// --- accessors (all take a loaded `data` object) ---

export function get(matrix, n, i, j) {
  return matrix[i * n + j];
}

// Top-k correlations for phenotype i, sorted by |rg| descending (excluding self).
export function topCorrelations(data, i, k = 25) {
  const { n, rg } = data;
  const out = [];
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const v = rg[i * n + j];
    if (Number.isNaN(v)) continue;
    out.push({ j, rg: v });
  }
  out.sort((a, b) => Math.abs(b.rg) - Math.abs(a.rg));
  return out.slice(0, k);
}

// |z| beyond which a two-tailed normal p-value underflows below 1e-300. The
// build script stores nlogp = NaN when the source p underflowed to exactly 0
// (the most significant pairs), so we recover "p ≈ 0" from the z-score.
const Z_UNDERFLOW = 37;

// p-value for a pair, recovering underflowed (p≈0) cases from |z|.
export function pFromNlogpZ(nl, z) {
  if (!Number.isNaN(nl)) return Math.pow(10, -nl);
  if (Number.isFinite(z) && Math.abs(z) >= Z_UNDERFLOW) return 0; // underflowed in source
  return NaN;
}

// Full statistics for the (i, j) pair.
export function pairStats(data, i, j) {
  const { n, rg, se, nlogp, phenotypes } = data;
  const r = rg[i * n + j];
  const s = se[i * n + j];
  const nl = nlogp[i * n + j];
  const z = s ? r / s : NaN;
  return {
    rg: r,
    se: s,
    z,
    p: pFromNlogpZ(nl, z),
    nlogp: nl,
    h2_i: phenotypes[i].h2,
    h2_j: phenotypes[j].h2,
  };
}

// Format a p-value compactly (handles the extreme small values in this dataset).
export function formatP(p) {
  if (Number.isNaN(p)) return '—';
  if (p <= 1e-300) return '<1e-300'; // includes exact 0 (underflow) and denormals
  if (p < 1e-4) return p.toExponential(2);
  return p.toPrecision(3);
}

// Report values to a fixed number of significant figures (3 by default).
export function formatNum(x, sig = 3) {
  if (x == null || Number.isNaN(x)) return '—';
  return x.toPrecision(sig);
}
