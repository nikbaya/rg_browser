// CSV serialization + client-side download for correlation result tables.
import { rowStats } from './filters.js';

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
];

// Serialize the given correlation rows (already filtered/sorted) for a seed
// phenotype into a CSV string. `rows` is an array of { j, rg, ... } where j is
// the partner phenotype index.
export function rowsToCsv(data, seedIndex, rows) {
  const { phenotypes } = data;
  const seed = phenotypes[seedIndex];
  const lines = [HEADER.join(',')];
  for (const row of rows) {
    const partner = phenotypes[row.j];
    const s = rowStats(data, seedIndex, row.j);
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
