// CSV serialization + client-side download for correlation result tables.
import { rowStats } from './filters.js';
import { statsFromMatrices } from './data.js';

// Escape a field for CSV: quote if it contains a comma, quote, or newline.
function esc(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Raw numeric value at full precision (empty for missing), for downstream analysis.
function num(x) {
  return x == null || Number.isNaN(x) ? '' : String(x);
}

const HEADER = [
  'seed_id',
  'seed_description',
  'partner_id',
  'partner_description',
  'partner_category',
  'rg',
  'se',
  'z',
  'p',
  'h2_partner',
  // Male/female strata (blank when the pair is absent in that stratum).
  'rg_male',
  'se_male',
  'z_male',
  'p_male',
  'h2_partner_male',
  'rg_female',
  'se_female',
  'z_female',
  'p_female',
  'h2_partner_female',
];

// Serialize the given correlation rows (already filtered/sorted) for a seed
// phenotype into a CSV string. `rows` is an array of { j, rg, ... } where j is
// the partner phenotype index. `sexMats` is { male, female } of loaded matrices
// (pass {} to leave the sex columns blank).
export function rowsToCsv(data, seedIndex, rows, sexMats = {}) {
  const { phenotypes, n } = data;
  const seed = phenotypes[seedIndex];
  const lines = [HEADER.join(',')];
  for (const row of rows) {
    const partner = phenotypes[row.j];
    const s = rowStats(data, seedIndex, row.j);
    const m = sexMats.male ? statsFromMatrices(sexMats.male, n, seedIndex, row.j) : null;
    const f = sexMats.female ? statsFromMatrices(sexMats.female, n, seedIndex, row.j) : null;
    lines.push(
      [
        esc(seed.id),
        esc(seed.description),
        esc(partner.id),
        esc(partner.description),
        esc(partner.cat),
        num(s.rg),
        num(s.se),
        num(s.z),
        num(s.p),
        num(partner.h2),
        num(m && m.rg),
        num(m && m.se),
        num(m && m.z),
        num(m && m.p),
        num(partner.h2_male),
        num(f && f.rg),
        num(f && f.se),
        num(f && f.z),
        num(f && f.p),
        num(partner.h2_female),
      ].join(',')
    );
  }
  return lines.join('\n');
}

// Trigger a client-side download of `text` as `filename`.
export function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
