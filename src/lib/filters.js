// Shared filtering helpers for correlation result tables. Kept pure so the
// detail page (and any future scoped search) share one implementation.
import { get, pFromNlogpZ } from './data.js';

// Phenotype-level filters: category match + minimum heritability.
export function phenotypePasses(p, { category = 'All', h2Min = '' } = {}) {
  if (category && category !== 'All' && p.cat !== category) return false;
  const t = parseFloat(h2Min);
  // t <= 0 (or blank) means "no heritability filter" — don't drop null-h² traits.
  if (!Number.isNaN(t) && t > 0 && (p.h2 == null || p.h2 < t)) return false;
  return true;
}

// Lightweight per-row stats read straight from the matrices (avoids allocating
// full pairStats objects across all ~677 partners on every keystroke).
export function rowStats(data, i, j) {
  const { n, rg, se, nlogp } = data;
  const r = get(rg, n, i, j);
  const s = get(se, n, i, j);
  const nl = get(nlogp, n, i, j);
  const z = s ? r / s : NaN;
  const p = pFromNlogpZ(nl, z);
  return { rg: r, se: s, z, nlogp: nl, p };
}

// Correlation-level filters: signed rg range, max p-value, min |z|. Any bound
// left blank/NaN is ignored.
export function pairPasses(stats, { rgMin = -1, rgMax = 1, pMax = '', zMin = '' } = {}) {
  const { rg, z, p } = stats;
  const lo = parseFloat(rgMin);
  const hi = parseFloat(rgMax);
  if (!Number.isNaN(lo) && rg < lo) return false;
  if (!Number.isNaN(hi) && rg > hi) return false;
  const pm = parseFloat(pMax);
  if (!Number.isNaN(pm) && !(p <= pm)) return false; // NaN p fails when a threshold is set
  const zm = parseFloat(zMin);
  if (!Number.isNaN(zm) && !(Math.abs(z) >= zm)) return false;
  return true;
}
