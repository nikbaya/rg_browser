import { formatNum, formatP } from '../lib/data.js';
import { colorForRg, textOnRg, colorForCategory, textOnColor } from '../lib/color.js';

// Column registry. `name` is always shown; the rest are toggleable. `sort` is
// the sortKey emitted when the header is clicked. Every label is explicit about
// whether it describes the genetic correlation (rg) or the partner trait's
// heritability (h²), so there's no ambiguity. Scientific symbols are wrapped in
// `.lc` so the uppercased header style leaves their case alone.
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
];

export function defaultVisibleColumns() {
  return new Set(COLUMNS.filter((c) => c.always || c.defaultOn).map((c) => c.key));
}

// Presentational, sortable correlation table. `rows` carry { j, rg, se, z, p }.
export function ResultsTable({ rows, phenotypes, visible, sortKey, sortDir, onSort, onRowClick }) {
  const cols = COLUMNS.filter((c) => c.always || visible.has(c.key));
  const arrow = sortDir === 'asc' ? ' ▲' : ' ▼';

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
        return (
          <span class="rg-chip" style={`background:${colorForRg(row.rg)};color:${textOnRg(row.rg)}`}>
            {formatNum(row.rg)}
          </span>
        );
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
      default:
        return null;
    }
  };

  return (
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
  );
}
