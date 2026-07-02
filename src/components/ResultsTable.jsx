import { formatNum, formatP, encodingSummary } from '../lib/data.js';
import { colorForRg, textOnRg, colorForCategory, textOnColor } from '../lib/color.js';
import { Tip } from './Tip.jsx';

// Column registry. `name` is always shown; the rest are toggleable. `sort` is
// the sortKey emitted when the header is clicked. Every label is explicit about
// whether it describes the genetic correlation (rg) or the partner trait's
// heritability (h2), so there's no ambiguity. Scientific symbols are wrapped in
// `.lc` so the uppercased header style leaves their case alone.
// A small sex tag appended to a stat label (e.g. rg ♀). Kept out of `.lc` so it
// isn't lowercased with the scientific symbol.
const sexTag = (s) => <span class="col-sex">{s}</span>;

export const COLUMNS = [
  { key: 'name', label: 'Correlated phenotype', sort: 'name', always: true, cluster: 'base' },
  { key: 'cat', label: 'Category', sort: 'cat', defaultOn: true, cluster: 'base' },
  { key: 'rg', label: <span class="lc">rg</span>, sort: 'rg', num: true, defaultOn: true, cluster: 'rg' },
  { key: 'abs', label: <span class="lc">|rg|</span>, sort: 'abs', num: true, cluster: 'rg' },
  { key: 'se', label: <span class="lc">rg SE</span>, sort: 'se', num: true, cluster: 'rg' },
  { key: 'z', label: <span class="lc">rg z</span>, sort: 'z', num: true, cluster: 'rg' },
  { key: 'p', label: <span class="lc">rg p</span>, sort: 'p', num: true, defaultOn: true, cluster: 'rg' },
  { key: 'h2', label: <span class="lc">h2</span>, sort: 'h2', num: true, defaultOn: true, cluster: 'pheno' },
  { key: 'h2p', label: <span class="lc">h2 p</span>, sort: 'h2p', num: true, defaultOn: true, cluster: 'pheno' },
  { key: 'neff', label: <span class="lc">Neff</span>, sort: 'neff', num: true, cluster: 'pheno' },
  // Optional male/female strata (off by default). `sex` marks which matrices a
  // column needs loaded; `pheno` columns read straight from phenotypes.json.
  { key: 'rg_m', label: <><span class="lc">rg</span> {sexTag('♂')}</>, sort: 'rg_m', num: true, group: 'male', sex: 'male', cluster: 'male' },
  { key: 'se_m', label: <><span class="lc">rg SE</span> {sexTag('♂')}</>, sort: 'se_m', num: true, group: 'male', sex: 'male', cluster: 'male' },
  { key: 'z_m', label: <><span class="lc">rg z</span> {sexTag('♂')}</>, sort: 'z_m', num: true, group: 'male', sex: 'male', cluster: 'male' },
  { key: 'p_m', label: <><span class="lc">rg p</span> {sexTag('♂')}</>, sort: 'p_m', num: true, group: 'male', sex: 'male', cluster: 'male' },
  { key: 'h2_m', label: <><span class="lc">h2</span> {sexTag('♂')}</>, sort: 'h2_m', num: true, group: 'male', pheno: 'h2_male', cluster: 'male' },
  { key: 'rg_f', label: <><span class="lc">rg</span> {sexTag('♀')}</>, sort: 'rg_f', num: true, group: 'female', sex: 'female', cluster: 'female' },
  { key: 'se_f', label: <><span class="lc">rg SE</span> {sexTag('♀')}</>, sort: 'se_f', num: true, group: 'female', sex: 'female', cluster: 'female' },
  { key: 'z_f', label: <><span class="lc">rg z</span> {sexTag('♀')}</>, sort: 'z_f', num: true, group: 'female', sex: 'female', cluster: 'female' },
  { key: 'p_f', label: <><span class="lc">rg p</span> {sexTag('♀')}</>, sort: 'p_f', num: true, group: 'female', sex: 'female', cluster: 'female' },
  { key: 'h2_f', label: <><span class="lc">h2</span> {sexTag('♀')}</>, sort: 'h2_f', num: true, group: 'female', pheno: 'h2_female', cluster: 'female' },
];

// Display titles for each cluster's spanning group header. `base` (name/category)
// gets an empty spanner so the group row aligns above the label row.
const CLUSTER_TITLES = {
  base: '',
  rg: 'Genetic correlation',
  pheno: 'Partner trait',
  male: 'Male',
  female: 'Female',
};

// Coalesce contiguous runs of visible columns sharing a cluster into spanning
// header cells: [{ cluster, title, span }]. First column of each run carries the
// group separator border.
function clusterSpans(cols) {
  const spans = [];
  for (const col of cols) {
    const last = spans[spans.length - 1];
    if (last && last.cluster === col.cluster) last.span += 1;
    else spans.push({ cluster: col.cluster, title: CLUSTER_TITLES[col.cluster] ?? '', span: 1 });
  }
  return spans;
}

// Which visible columns start a new cluster (get a left separator). The first
// column overall never gets one.
function clusterStarts(cols) {
  const starts = new Set();
  let prev = null;
  for (const col of cols) {
    if (prev && col.cluster !== prev) starts.add(col.key);
    prev = col.cluster;
  }
  return starts;
}

export function defaultVisibleColumns() {
  return new Set(COLUMNS.filter((c) => c.always || c.defaultOn).map((c) => c.key));
}

// Quick column presets for the popover. Keys map to the set of visible columns.
export const COLUMN_PRESETS = [
  { key: 'overview', label: 'Overview', cols: () => defaultVisibleColumns() },
  {
    key: 'full',
    label: 'Full stats',
    cols: () =>
      new Set(COLUMNS.filter((c) => c.cluster === 'base' || c.cluster === 'rg' || c.cluster === 'pheno').map((c) => c.key)),
  },
  {
    key: 'sex',
    label: 'Sex-specific',
    cols: () =>
      new Set(
        COLUMNS.filter(
          (c) => c.cluster === 'base' || c.cluster === 'rg' || c.cluster === 'male' || c.cluster === 'female'
        ).map((c) => c.key)
      ),
  },
];

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
  const groups = clusterSpans(cols);
  const starts = clusterStarts(cols);

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
        return (
          <Tip text={encodingSummary(p)} focusable={false}>
            <button class="row-link" onClick={() => onRowClick(row.j)}>
              {p.description}
            </button>
          </Tip>
        );
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
        <tr class="group-row">
          {groups.map((g, i) => (
            <th key={g.cluster + i} colSpan={g.span} class={`group-th${i > 0 ? ' col-group-sep' : ''}`}>
              {g.title}
            </th>
          ))}
        </tr>
        <tr>
          {cols.map((col) => (
            <th
              key={col.key}
              class={`${col.num ? 'num' : ''}${sortKey === col.sort ? ' sorted' : ''}${starts.has(col.key) ? ' col-group-sep' : ''}`}
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
          <tr key={row.j}>
            {cols.map((col) => (
              <td key={col.key} class={`${col.num ? 'num' : ''}${starts.has(col.key) ? ' col-group-sep' : ''}`}>
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
