import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { topCorrelations, formatNum, formatP } from '../lib/data.js';
import { colorForCategory, textOnColor } from '../lib/color.js';
import { phenotypePasses, pairPasses, rowStats } from '../lib/filters.js';
import { rowsToCsv, downloadCsv } from '../lib/csv.js';
import { ResultsTable, COLUMNS, defaultVisibleColumns } from './ResultsTable.jsx';
import { RangeSlider } from './RangeSlider.jsx';

const PAGE = 50; // rows revealed initially and per "Show more" click

const RG_TICKS = [
  { value: -1, label: '−1' },
  { value: -0.5, label: '−.5' },
  { value: 0, label: '0' },
  { value: 0.5, label: '.5' },
  { value: 1, label: '1' },
];
// p-value threshold on a −log10 scale: p ≤ 10^(−exp); exp 0 means "any".
// Tick marks (no labels) at these exponents keep the control compact.
const P_EXP_MAX = 20;
const P_TICKS = [0, 5, 10, 15, 20];
const H2_MAX = 1;
const H2_TICKS = [
  { value: 0, label: '0' },
  { value: 0.25, label: '.25' },
  { value: 0.5, label: '.5' },
  { value: 0.75, label: '.75' },
  { value: 1, label: '1' },
];

// Columns sort ascending by default, except these which start descending
// (largest/most-relevant first). Re-clicking a column flips the direction.
const defaultDir = (key) =>
  key === 'name' || key === 'cat' || key === 'p' || key === 'h2p' ? 'asc' : 'desc';

// Detail page for one phenotype: metadata header, filters, and its ranked top
// genetic correlations.
export function PhenotypeDetail({ data, index, onSelect }) {
  const { phenotypes, categories } = data;
  const seed = phenotypes[index];

  const [sortKey, setSortKey] = useState('abs');
  const [sortDir, setSortDir] = useState('desc');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [h2Min, setH2Min] = useState(0);
  const [rgLo, setRgLo] = useState(-1);
  const [rgHi, setRgHi] = useState(1);
  const [pExp, setPExp] = useState(0); // 0 => no p filter
  const [visible, setVisible] = useState(() => defaultVisibleColumns());
  const [colsOpen, setColsOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const colsRef = useRef(null);

  // Collapse back to the first page when the seed or any filter changes.
  useEffect(() => {
    setShown(PAGE);
  }, [index, categoryFilter, h2Min, rgLo, rgHi, pExp]);

  // Close the Columns popover on outside click.
  useEffect(() => {
    if (!colsOpen) return undefined;
    const onDocClick = (e) => {
      if (colsRef.current && !colsRef.current.contains(e.target)) setColsOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [colsOpen]);

  // Header click: same column flips direction; a new column resets to its default.
  const onSort = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(defaultDir(key));
    }
  };

  // All correlations for the seed, enriched with per-row stats (computed once
  // per seed). Cheap matrix reads, not full pairStats allocations.
  const allRows = useMemo(() => {
    const base = topCorrelations(data, index, data.n);
    return base.map((r) => ({ j: r.j, ...rowStats(data, index, r.j) }));
  }, [data, index]);

  const pMax = pExp === 0 ? '' : Math.pow(10, -pExp);

  // Apply phenotype + correlation filters, then sort.
  const filtered = useMemo(() => {
    const pf = { category: categoryFilter, h2Min };
    const cf = { rgMin: rgLo, rgMax: rgHi, pMax };
    const out = allRows.filter(
      (row) => phenotypePasses(phenotypes[row.j], pf) && pairPasses(row, cf)
    );
    // Ascending base comparators; direction applied via `sign`.
    const num = (x) => (Number.isNaN(x) ? Infinity : x);
    const base = {
      rg: (a, b) => a.rg - b.rg,
      abs: (a, b) => Math.abs(a.rg) - Math.abs(b.rg),
      name: (a, b) => phenotypes[a.j].description.localeCompare(phenotypes[b.j].description),
      cat: (a, b) =>
        phenotypes[a.j].cat.localeCompare(phenotypes[b.j].cat) || Math.abs(b.rg) - Math.abs(a.rg),
      h2: (a, b) => num(phenotypes[a.j].h2 ?? NaN) - num(phenotypes[b.j].h2 ?? NaN),
      h2p: (a, b) => num(phenotypes[a.j].h2_p ?? NaN) - num(phenotypes[b.j].h2_p ?? NaN),
      neff: (a, b) => num(phenotypes[a.j].neff ?? NaN) - num(phenotypes[b.j].neff ?? NaN),
      se: (a, b) => num(a.se) - num(b.se),
      z: (a, b) => Math.abs(num(a.z)) - Math.abs(num(b.z)),
      p: (a, b) => num(a.p) - num(b.p),
    };
    const cmp = base[sortKey] || base.abs;
    const sign = sortDir === 'asc' ? 1 : -1;
    out.sort((a, b) => sign * cmp(a, b));
    return out;
  }, [allRows, phenotypes, categoryFilter, h2Min, rgLo, rgHi, pMax, sortKey, sortDir]);

  const total = filtered.length;
  const rows = filtered.slice(0, shown);

  const toggleCol = (key) =>
    setVisible((v) => {
      const next = new Set(v);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const exportCsv = () => {
    const csv = rowsToCsv(data, index, filtered);
    downloadCsv(`rg_${seed.id}.csv`, csv);
  };

  const filtersActive =
    categoryFilter !== 'All' || h2Min > 0 || rgLo > -1 || rgHi < 1 || pExp > 0;

  return (
    <div class="detail">
      <div class="detail-header card">
        <div class="field-label">Phenotype</div>
        <h1 class="detail-name">{seed.description}</h1>
        <div class="detail-meta mono">
          {seed.id}
          <span> · </span>
          <span
            class="cat-chip"
            style={`background:${colorForCategory(seed.cat)};color:${textOnColor(colorForCategory(seed.cat))}`}
          >
            {seed.cat}
          </span>
        </div>
        <div class="detail-h2 mono">
          <span>h² = {formatNum(seed.h2)}</span>
          <span> · h² p = {seed.h2_p != null ? formatP(seed.h2_p) : '—'}</span>
          <span> · Neff = {seed.neff != null ? seed.neff.toLocaleString('en-US') : '—'}</span>
        </div>
      </div>

      <div class="controls-row">
        <div class="field" style="flex: 0 1 220px;">
          <label class="field-label" for="d-category">Category</label>
          <select id="d-category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.currentTarget.value)}>
            <option value="All">All categories</option>
            {categories.map((name) => (
              <option value={name} key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div class="field" style="flex: 1 1 200px;">
          <label class="field-label" for="d-h2">
            Min <span class="lc">h²</span> {h2Min > 0 ? <span class="lc">{`= ${h2Min.toFixed(2)}`}</span> : 'any'}
          </label>
          <div class="range-slider has-ticks single">
            <div class="range-track">
              <div class="range-fill" style={`left:0; right:${100 - (h2Min / H2_MAX) * 100}%`} />
              {H2_TICKS.map((t) => (
                <span key={t.value} class="range-tick" style={`left:${(t.value / H2_MAX) * 100}%`} />
              ))}
            </div>
            <input id="d-h2" class="range-input" type="range" min="0" max={H2_MAX} step="0.01"
              list="h2-ticks" value={h2Min}
              onInput={(e) => setH2Min(parseFloat(e.currentTarget.value))} />
            <datalist id="h2-ticks">
              {H2_TICKS.map((t) => (
                <option key={t.value} value={t.value} />
              ))}
            </datalist>
            <div class="range-tick-labels">
              {H2_TICKS.map((t) => (
                <span key={t.value} class="range-tick-label" style={`left:${(t.value / H2_MAX) * 100}%`}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div class="field" style="flex: 1 1 240px;">
          <label class="field-label"><span class="lc">rg</span> range</label>
          <RangeSlider
            min={-1} max={1} step={0.05}
            lo={rgLo} hi={rgHi}
            onChange={(lo, hi) => { setRgLo(lo); setRgHi(hi); }}
            format={(v) => v.toFixed(2)}
            ticks={RG_TICKS}
            listId="rg-ticks"
          />
        </div>
        <div class="field" style="flex: 0 1 190px;">
          <label class="field-label" for="d-pexp">
            <span class="lc">rg</span> <span class="lc">p</span> ≤ {pExp === 0 ? 'any' : <span class="lc">{`1e−${pExp}`}</span>}
          </label>
          <div class="range-slider single has-ticks">
            <div class="range-track">
              <div class="range-fill" style={`left:0; right:${100 - (pExp / P_EXP_MAX) * 100}%`} />
              {P_TICKS.map((t) => (
                <span key={t} class="range-tick" style={`left:${(t / P_EXP_MAX) * 100}%`} />
              ))}
            </div>
            <input id="d-pexp" class="range-input" type="range" min="0" max={P_EXP_MAX} step="1"
              value={pExp} onInput={(e) => setPExp(parseInt(e.currentTarget.value, 10))} />
          </div>
        </div>
      </div>

      <div class="results-toolbar">
        <span class="result-count">
          {total === 0
            ? 'No correlated phenotypes match the current filters.'
            : `Showing ${rows.length} of ${total} correlated phenotypes${filtersActive ? ' matching filters' : ''}`}
        </span>
        <div class="results-actions">
          <div class="cols-wrap" ref={colsRef}>
            <button class="btn-ghost" onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen}>
              Columns ▾
            </button>
            {colsOpen && (
              <div class="cols-popover">
                {COLUMNS.filter((c) => !c.always).map((c) => (
                  <label key={c.key} class="cols-option">
                    <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggleCol(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button class="btn-ghost" onClick={exportCsv} disabled={total === 0}>
            Export CSV
          </button>
        </div>
      </div>

      {total > 0 && (
        <ResultsTable
          rows={rows}
          phenotypes={phenotypes}
          visible={visible}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          onRowClick={onSelect}
        />
      )}

      {shown < total && (
        <div class="show-more-wrap">
          <button class="btn-ghost" onClick={() => setShown((s) => Math.min(s + PAGE, total))}>
            Show more ({total - shown} more)
          </button>
        </div>
      )}
    </div>
  );
}
