// Data access layer: loads the compact artifacts produced by scripts/build_data.py
// and exposes typed accessors over the 677x677 correlation matrices.
import { setCategories } from './color.js';

let cache = null;

// Network requests can hang indefinitely on a flaky connection; abort after
// this long so the UI can show an error instead of an endless spinner.
const FETCH_TIMEOUT_MS = 30000;

// fetch() with a timeout via AbortController. Throws a clear error on timeout or
// network failure so callers can surface it.
async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Timed out loading ${url} (>${FETCH_TIMEOUT_MS / 1000}s)`);
    }
    throw new Error(`Network error loading ${url}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchF32(url, n) {
  const res = await fetchWithTimeout(url);
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
    fetchWithTimeout(dataUrl('phenotypes.json')).then((r) => r.json()),
    fetchWithTimeout(dataUrl('hierarchy.json')).then((r) => r.json()),
  ]);
  const n = phenotypes.length;

  // Provenance/version stamp; optional so the app still loads if it's absent.
  const meta = await fetchWithTimeout(dataUrl('meta.json'))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

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
    n, phenotypes, hierarchy, categories, rg, se, nlogp, idToIndex, meta,
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

// Traits "most shared" between phenotypes a and b: the traits that both a and b
// are genetically correlated with. Each candidate trait j is ranked by |rg|
// against a and (separately) against b; the two ranks are averaged, and the list
// is sorted by that average (ascending — a low avg rank means j sits near the top
// of *both* traits' correlation lists). Only traits with a (non-NaN) correlation
// to BOTH a and b are eligible; a and b themselves are excluded.
//
// `maxP` optionally tightens eligibility: when set, a trait is kept only if the
// p-value of *both* its correlations (to a and to b) is <= maxP. Ranks are still
// computed over each seed's full correlation list, so filtering removes rows
// without renumbering the ranks that survive.
export function sharedCorrelations(data, a, b, k = 15, maxP = null) {
  const { n, rg, se, nlogp } = data;
  // p-value of the (i, j) correlation, recovering underflowed (p≈0) cases.
  const pFor = (i, j) => {
    const s = se[i * n + j];
    const z = s ? rg[i * n + j] / s : NaN;
    return pFromNlogpZ(nlogp[i * n + j], z);
  };
  const passesP = (i, j) => {
    if (maxP == null) return true;
    const p = pFor(i, j);
    return !Number.isNaN(p) && p <= maxP;
  };
  // Map j -> 1-based rank of j among all traits by |rg| against seed i.
  const ranksAgainst = (i) => {
    const list = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const v = rg[i * n + j];
      if (Number.isNaN(v)) continue;
      list.push({ j, abs: Math.abs(v) });
    }
    list.sort((x, y) => y.abs - x.abs);
    const rank = new Map();
    list.forEach((e, idx) => rank.set(e.j, idx + 1));
    return rank;
  };
  const rankA = ranksAgainst(a);
  const rankB = ranksAgainst(b);
  const out = [];
  for (const [j, ra] of rankA) {
    if (j === b) continue; // the paired traits themselves aren't "shared" partners
    const rb = rankB.get(j);
    if (rb === undefined) continue; // must be correlated with both
    if (!passesP(a, j) || !passesP(b, j)) continue; // both correlations significant enough
    out.push({
      j,
      rgA: rg[a * n + j],
      rgB: rg[b * n + j],
      pA: pFor(a, j),
      pB: pFor(b, j),
      rankA: ra,
      rankB: rb,
      avgRank: (ra + rb) / 2,
    });
  }
  out.sort((x, y) => x.avgRank - y.avgRank);
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

// UK Biobank Data Showcase link for a phenotype: { url, label } or null.
//   • Numeric ids carry a UKB field id (e.g. "5101_irnt" → 5101, "2395_2" →
//     2395, "2365") → that field's Data Showcase page.
//   • Pure ICD10-code ids (e.g. "I48", "C44", "M20" — one letter + ≥2 digits,
//     no underscore) come from the main-diagnoses field → the showcase's ICD10
//     classification (data-coding 19). The showcase has no per-code deep link,
//     so this opens the searchable ICD10 coding page.
// Returns null for curated/derived ids without a showcase page (e.g. FinnGen-
// style "C3_PROSTATE", "I9_MI", or "CARDIAC_ARRHYTM").
const UKB_ICD10_CODING = 19;
export function ukbShowcaseLink(id) {
  const field = /^(\d+)(?:_|$)/.exec(id);
  if (field) {
    return {
      url: `https://biobank.ndph.ox.ac.uk/showcase/field.cgi?id=${field[1]}`,
      label: 'View on UK Biobank Showcase ↗',
    };
  }
  if (/^[A-Z]\d{2}\d*$/.test(id)) {
    return {
      url: `https://biobank.ndph.ox.ac.uk/showcase/coding.cgi?id=${UKB_ICD10_CODING}`,
      label: 'View ICD10 coding on UK Biobank Showcase ↗',
    };
  }
  return null;
}

// Terse, plain-text label of how a phenotype was analyzed, for `title` tooltips:
// just the type for continuous/binary/etc., and the low→high answer order for
// ordinal traits (whose direction is the subtle case). Returns '' when the
// phenotype carries no encoding metadata.
export function encodingSummary(p) {
  const { kind, levels } = p || {};
  if (!kind) return '';
  if (kind === 'ordinal') {
    if (levels && levels.length >= 2) {
      return `Ordinal scale (low → high): ${levels.map((l) => l[1]).join(' → ')}`;
    }
    return 'Ordinal scale';
  }
  if (kind === 'binary') return 'Binary (case/control) trait';
  if (kind === 'integer') return 'Count trait';
  if (kind === 'categorical') return 'Unordered categorical trait';
  return 'Continuous trait';
}

// Format a p-value compactly (handles the extreme small values in this dataset).
export function formatP(p) {
  if (p == null || Number.isNaN(p)) return '—'; // null: stat not computed for this trait
  if (p <= 1e-300) return '<1e-300'; // includes exact 0 (underflow) and denormals
  if (p < 1e-4) return p.toExponential(2);
  return p.toPrecision(3);
}

// Report values to a fixed number of significant figures (3 by default).
export function formatNum(x, sig = 3) {
  if (x == null || Number.isNaN(x)) return '—';
  return x.toPrecision(sig);
}
