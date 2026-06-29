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

// The sex-stratified strata available as optional columns. The browser stays
// focused on both-sexes rg; these are overlaid only where the user opts in.
export const SEX_STRATA = ['male', 'female'];
const SEX_SUFFIX = { both_sexes: '', male: '_male', female: '_female' };

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

  cache = {
    n, phenotypes, hierarchy, categories, rg, se, nlogp, idToIndex,
    // Lazily-loaded male/female matrices, keyed by sex (for optional columns).
    sexMatrices: {},
  };
  return cache;
}

// Lazily fetch (and cache) the male/female rg/se/nlogp matrices for the optional
// sex-specific columns. The initial payload stays at the both-sexes ~6 MB; each
// sex's matrices (~5.5 MB) load only the first time a user enables its columns.
export async function ensureSexMatrices(sex) {
  if (!cache) throw new Error('ensureSexMatrices called before loadData');
  if (sex === 'both_sexes') return { rg: cache.rg, se: cache.se, nlogp: cache.nlogp };
  if (!SEX_SUFFIX.hasOwnProperty(sex)) throw new Error(`unknown sex: ${sex}`);
  if (cache.sexMatrices[sex]) return cache.sexMatrices[sex];

  const { n } = cache;
  const sfx = SEX_SUFFIX[sex];
  const [rg, se, nlogp] = await Promise.all([
    fetchF32(dataUrl(`rg${sfx}.f32`), n),
    fetchF32(dataUrl(`se${sfx}.f32`), n),
    fetchF32(dataUrl(`nlogp${sfx}.f32`), n),
  ]);
  cache.sexMatrices[sex] = { rg, se, nlogp };
  return cache.sexMatrices[sex];
}

// Per-pair stats { rg, se, z, p, nlogp } from an arbitrary {rg, se, nlogp} set.
// Returns null when the pair has no genetic correlation in that stratum.
export function statsFromMatrices(m, n, i, j) {
  if (!m) return null;
  const r = m.rg[i * n + j];
  const s = m.se[i * n + j];
  const nl = m.nlogp[i * n + j];
  const z = s ? r / s : NaN;
  return { rg: r, se: s, z, nlogp: nl, p: pFromNlogpZ(nl, z) };
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
