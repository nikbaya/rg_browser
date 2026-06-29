import { formatNum, formatP } from '../lib/data.js';
import { colorForRg, textOnRg, colorForCategory, textOnColor } from '../lib/color.js';

// Column registry. `name` is always shown; the rest are toggleable. `sort` is
// the sortKey emitted when the header is clicked. Every label is explicit about
// whether it describes the genetic correlation (rg) or the partner trait's
// heritability (h²), so there's no ambiguity. Scientific symbols are wrapped in
// `.lc` so the uppercased header style leaves their case alone.
// A small sex tag appended to a stat label (e.g. rg ♀). Kept out of `.lc` so it
// isn't lowercased with the scientific symbol.
const sexTag = (s) => <span class="col-sex">{s}</span>;

export const COLUMNS = [
  { key: 'name', label: 'Correlated phenotype', sort: 'name', always: true },
  { key: 'cat', label: 'Category', sort: 'cat', defaultOn: true },
  { key: 'rg', label: <span class="lc">rg</span>, sort: 'rg', num: true, defaultOn: true },
  { key: 'abs', label: <span class="lc">|rg|</span>, sort: 'abs', num: true },
  { key: 'se', label: <span class="lc">rg SE</span>, sort: 'se', num: true },
  { key: 'z', label: <span class="lc">rg z</span>, sort: 'z', num: true },
  { key: 'p', label: <span class="lc">rg p</span>, sort: 'p', num: true, defaultOn: true },
  { key: 'h2', label: <span class="lc">h²</span>, sort: 'h2', num: true, defaultOn: true },
  { key: 'h2p', label: <span class="lc">h² p</span>, sort: 'h2p', num: true, defaultOn: true },
  { key: 'neff', label: <span class="lc">Neff</span>, sort: 'neff', num: true },
  // Optional male/female strata (off by default). `sex` marks which matrices a
  // column needs loaded; `pheno` columns read straight from phenotypes.json.
  { key: 'rg_m', label: <><span class="lc">rg</span> {sexTag('♂')}</>, sort: 'rg_m', num: true, group: 'male', sex: 'male' },
  { key: 'se_m', label: <><span class="lc">rg SE</span> {sexTag('♂')}</>, sort: 'se_m', num: true, group: 'male', sex: 'male' },
  { key: 'z_m', label: <><span class="lc">rg z</span> {sexTag('♂')}</>, sort: 'z_m', num: true, group: 'male', sex: 'male' },
  { key: 'p_m', label: <><span class="lc">rg p</span> {sexTag('♂')}</>, sort: 'p_m', num: true, group: 'male', sex: 'male' },
  { key: 'h2_m', label: <><span class="lc">h²</span> {sexTag('♂')}</>, sort: 'h2_m', num: true, group: 'male', pheno: 'h2_male' },
  { key: 'rg_f', label: <><span class="lc">rg</span> {sexTag('♀')}</>, sort: 'rg_f', num: true, group: 'female', sex: 'female' },
  { key: 'se_f', label: <><span class="lc">rg SE</span> {sexTag('♀')}</>, sort: 'se_f', num: true, group: 'female', sex: 'female' },
  { key: 'z_f', label: <><span class="lc">rg z</span> {sexTag('♀')}</>, sort: 'z_f', num: true, group: 'female', sex: 'female' },
  { key: 'p_f', label: <><span class="lc">rg p</span> {sexTag('♀')}</>, sort: 'p_f', num: true, group: 'female', sex: 'female' },
  { key: 'h2_f', label: <><span class="lc">h²</span> {sexTag('♀')}</>, sort: 'h2_f', num: true, group: 'female', pheno: 'h2_female' },
];

export function defaultVisibleColumns() {
  return new Set(COLUMNS.filter((c) => c.always || c.defaultOn).map((c) => c.key));
}

// Sexes whose matrices must be loaded for the currently-visible columns.
export function sexesNeeded(visible) {
  const out = new Set();
  for (const c of COLUMNS) if (c.sex && visible.has(c.key)) out.add(c.sex);
  return out;
}

// Presentational, sortable correlation table. `rows` carry { j, rg, se, z, p }.
export function ResultsTable({ rows, phenotypes, visible, sortKey, sortDir, onSort, onRowClick }) {
  const cols = COLUMNS.filter((c) => c.always || visible.has(c.key));
  const arrow = sortDir === 'asc' ? ' ▲' : ' ▼';

  // rg value rendered as a colored chip; '…' while the stratum is still loading.
  const rgChip = (v) =>
    v === undefined ? (
      <span class="cell-loading">…</span>
    ) : (
      <span class="rg-chip" style={`background:${colorForRg(v)};color:${textOnRg(v)}`}>
        {formatNum(v)}
      </span>
    );

  const cell = (col, row) => {
    const p = phenotypes[row.j];
    switch (col.key) {
      case 'name':
        return p.description;
      case 'cat':
        return (
          <span
            class="cat-chip"
            style={`background:${colorForCategory(p.cat)};color:${textOnColor(colorForCategory(p.cat))}`}
          >
            {p.cat}
          </span>
        );
      case 'rg':
        return rgChip(row.rg);
      case 'abs':
        return formatNum(Math.abs(row.rg));
      case 'h2':
        return formatNum(p.h2);
      case 'h2p':
        return formatP(p.h2_p);
      case 'neff':
        return p.neff == null ? '—' : p.neff.toLocaleString('en-US');
      case 'se':
        return formatNum(row.se);
      case 'z':
        return formatNum(row.z);
      case 'p':
        return formatP(row.p);
      // --- optional male/female strata ---
      case 'rg_m':
        return rgChip(row.male === undefined ? undefined : row.male && row.male.rg);
      case 'se_m':
        return row.male === undefined ? '…' : formatNum(row.male && row.male.se);
      case 'z_m':
        return row.male === undefined ? '…' : formatNum(row.male && row.male.z);
      case 'p_m':
        return row.male === undefined ? '…' : formatP(row.male ? row.male.p : NaN);
      case 'h2_m':
        return formatNum(p.h2_male);
      case 'rg_f':
        return rgChip(row.female === undefined ? undefined : row.female && row.female.rg);
      case 'se_f':
        return row.female === undefined ? '…' : formatNum(row.female && row.female.se);
      case 'z_f':
        return row.female === undefined ? '…' : formatNum(row.female && row.female.z);
      case 'p_f':
        return row.female === undefined ? '…' : formatP(row.female ? row.female.p : NaN);
      case 'h2_f':
        return formatNum(p.h2_female);
      default:
        return null;
    }
  };

  return (
    <div class="table-scroll">
    <table class="data-table">
      <thead>
        <tr>
          {cols.map((col) => (
            <th
              key={col.key}
              class={`${col.num ? 'num' : ''}${sortKey === col.sort ? ' sorted' : ''}`}
              onClick={() => onSort(col.sort)}
            >
              {col.label}
              {sortKey === col.sort && <span class="sort-arrow">{arrow}</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.j} class="clickable" onClick={() => onRowClick(row.j)}>
            {cols.map((col) => (
              <td key={col.key} class={col.num ? 'num' : ''}>
                {cell(col, row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
