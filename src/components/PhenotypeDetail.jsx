import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { topCorrelations, formatNum, formatP, ensureSexMatrices, statsFromMatrices, ukbShowcaseLink } from '../lib/data.js';
import { colorForCategory, textOnColor } from '../lib/color.js';
import { phenotypePasses, pairPasses, rowStats } from '../lib/filters.js';
import { rowsToCsv, downloadCsv } from '../lib/csv.js';
import { ResultsTable, COLUMNS, COLUMN_PRESETS, defaultVisibleColumns, sexesNeeded } from './ResultsTable.jsx';
import { RangeSlider } from './RangeSlider.jsx';
import { Tip } from './Tip.jsx';

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
  ['name', 'cat', 'p', 'h2p', 'p_m', 'p_f'].includes(key) ? 'asc' : 'desc';

// Grouping for the column-visibility popover: base columns, then the optional
// male- and female-specific strata.
const COLUMN_GROUPS = [
  { title: null, cols: COLUMNS.filter((c) => !c.always && !c.group) },
  { title: 'Male-specific', cols: COLUMNS.filter((c) => c.group === 'male') },
  { title: 'Female-specific', cols: COLUMNS.filter((c) => c.group === 'female') },
];

// Human-readable name for each GWAS analysis kind (from build_data.py).
const KIND_LABEL = {
  ordinal: 'Ordinal scale',
  binary: 'Binary (case/control)',
  continuous: 'Continuous',
  integer: 'Count / integer',
  categorical: 'Unordered categorical',
};

// Explains how the seed trait was analyzed and — crucially — what the *sign* of a
// genetic correlation means for it. Ordinal traits also show their answer levels
// in GWAS low→high order (the direction PHESANT scored them), so a positive rg is
// unambiguous. Renders nothing for phenotypes with no encoding metadata.
export function EncodingCard({ seed }) {
  const { kind, levels } = seed;
  if (!kind) return null;
  const has = levels && levels.length >= 2;
  const lo = has ? levels[0][1] : null;
  const hi = has ? levels[levels.length - 1][1] : null;

  let note;
  if (kind === 'ordinal' && has) {
    note = (
      <>
        Analyzed as an ordinal score rising from “{lo}” to “{hi}”. A positive rg means a
        shared genetic basis with a <strong>higher</strong> score (toward “{hi}”); a
        negative rg points toward “{lo}”.
      </>
    );
  } else if (kind === 'ordinal') {
    note = <>Analyzed as an ordinal score; a positive rg means a shared genetic basis with a higher value.</>;
  } else if (kind === 'binary') {
    note = (
      <>
        Analyzed as a case/control trait. A positive rg means a shared genetic basis with being a
        <strong> case</strong> — see the UK Biobank Showcase for the exact case definition.
      </>
    );
  } else if (kind === 'categorical') {
    note = <>Analyzed as an unordered categorical trait, so the sign of a genetic correlation has no consistent higher/lower meaning.</>;
  } else {
    // continuous / integer
    note = <>Analyzed as a {kind === 'integer' ? 'count' : 'continuous'} trait. A positive rg means a shared genetic basis with a <strong>higher</strong> value.</>;
  }

  return (
    <div class="detail-encoding">
      <div class="encoding-head">
        <span class="encoding-kind">{KIND_LABEL[kind] || kind}</span>
        <span class="encoding-note">{note}</span>
      </div>
      {kind === 'ordinal' && has && (
        <ol class="encoding-scale" aria-label="Answer levels in GWAS low-to-high order">
          {levels.map(([v, m], i) => (
            <li class="encoding-level" key={v}>
              <span class="encoding-level-v mono">{v}</span>
              <span class="encoding-level-m">{m}</span>
              {i < levels.length - 1 && <span class="encoding-arrow" aria-hidden="true">→</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Detail page for one phenotype: metadata header, filters, and its ranked top
// genetic correlations.
export function PhenotypeDetail({ data, index, onSelect }) {
  const { phenotypes, categories } = data;
  const seed = phenotypes[index];
  const showcase = ukbShowcaseLink(seed.id);

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
  const [sexMats, setSexMats] = useState({}); // { male, female } loaded on demand
  const [sexError, setSexError] = useState(null); // message when a stratum fails to load
  const colsRef = useRef(null);
  const headerRef = useRef(null);
  const [headerStuck, setHeaderStuck] = useState(false);

  // Show a compact fixed context bar (name + key stats) once the full headline
  // card scrolls out of view — mainly useful on mobile while reading the table.
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setHeaderStuck(!entry.isIntersecting),
      { rootMargin: '-48px 0px 0px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Load the male/female matrices lazily whenever a sex-specific column is shown.
  // On failure we surface a banner and switch that stratum's columns back off, so
  // its cells stop showing the "…" loading state forever; the user can re-enable
  // them to retry.
  useEffect(() => {
    const needed = sexesNeeded(visible);
    let cancelled = false;
    needed.forEach((s) => {
      if (sexMats[s]) return;
      ensureSexMatrices(s).then(
        (m) => {
          if (cancelled) return;
          setSexError(null);
          setSexMats((prev) => (prev[s] ? prev : { ...prev, [s]: m }));
        },
        () => {
          if (cancelled) return;
          setSexError(`Couldn't load ${s} statistics — check your connection and try again.`);
          setVisible((v) => {
            const next = new Set(v);
            COLUMNS.forEach((c) => { if (c.sex === s) next.delete(c.key); });
            return next;
          });
        }
      );
    });
    return () => { cancelled = true; };
  }, [visible, sexMats]);

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
    return base.map((r) => {
      const row = { j: r.j, ...rowStats(data, index, r.j) };
      // Sex strata are left undefined (shown as "…") until their matrices load.
      if (sexMats.male) row.male = statsFromMatrices(sexMats.male, data.n, index, r.j);
      if (sexMats.female) row.female = statsFromMatrices(sexMats.female, data.n, index, r.j);
      return row;
    });
  }, [data, index, sexMats]);

  const pMax = pExp === 0 ? '' : Math.pow(10, -pExp);

  // Apply phenotype + correlation filters, then sort.
  const filtered = useMemo(() => {
    const pf = { category: categoryFilter, h2Min };
    const cf = { rgMin: rgLo, rgMax: rgHi, pMax };
    const out = allRows.filter(
      (row) => phenotypePasses(phenotypes[row.j], pf) && pairPasses(row, cf)
    );
    // Per-key sort value for a row: a number (NaN/undefined when missing) or a
    // string for the text columns. Missing values are pushed last in BOTH
    // directions, so sorting never floats blanks to the top.
    const sf = (row, sexKey, field) => (row[sexKey] ? row[sexKey][field] : NaN);
    const valueFor = {
      rg: (r) => r.rg,
      abs: (r) => Math.abs(r.rg),
      name: (r) => phenotypes[r.j].description,
      cat: (r) => phenotypes[r.j].cat,
      h2: (r) => phenotypes[r.j].h2,
      h2p: (r) => phenotypes[r.j].h2_p,
      neff: (r) => phenotypes[r.j].neff,
      se: (r) => r.se,
      z: (r) => Math.abs(r.z),
      p: (r) => r.p,
      rg_m: (r) => sf(r, 'male', 'rg'),
      se_m: (r) => sf(r, 'male', 'se'),
      z_m: (r) => Math.abs(sf(r, 'male', 'z')),
      p_m: (r) => sf(r, 'male', 'p'),
      h2_m: (r) => phenotypes[r.j].h2_male,
      rg_f: (r) => sf(r, 'female', 'rg'),
      se_f: (r) => sf(r, 'female', 'se'),
      z_f: (r) => Math.abs(sf(r, 'female', 'z')),
      p_f: (r) => sf(r, 'female', 'p'),
      h2_f: (r) => phenotypes[r.j].h2_female,
    };
    const valOf = valueFor[sortKey] || valueFor.abs;
    const sign = sortDir === 'asc' ? 1 : -1;
    const missing = (v) => v == null || (typeof v === 'number' && Number.isNaN(v));
    out.sort((a, b) => {
      const va = valOf(a);
      const vb = valOf(b);
      // Blanks always sink to the bottom, regardless of sort direction.
      const am = missing(va);
      const bm = missing(vb);
      if (am || bm) return am && bm ? 0 : am ? 1 : -1;
      let d;
      if (typeof va === 'string' || typeof vb === 'string') {
        d = String(va).localeCompare(String(vb));
        // Category ties break by strongest |rg| so each group leads with its top hit.
        if (sortKey === 'cat' && d === 0) return Math.abs(b.rg) - Math.abs(a.rg);
      } else {
        d = va - vb;
      }
      return sign * d;
    });
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

  // Export always includes the male/female strata, loading them first if needed.
  const exportCsv = async () => {
    try {
      const [male, female] = await Promise.all([
        ensureSexMatrices('male'),
        ensureSexMatrices('female'),
      ]);
      const csv = rowsToCsv(data, index, filtered, { male, female });
      downloadCsv(`rg_${seed.id}.csv`, csv);
      setSexError(null);
    } catch (e) {
      setSexError(`Couldn't prepare the CSV — ${e.message}`);
    }
  };

  const filtersActive =
    categoryFilter !== 'All' || h2Min > 0 || rgLo > -1 || rgHi < 1 || pExp > 0;

  return (
    <div class="detail">
      <div class={`detail-stickybar${headerStuck ? ' is-visible' : ''}`} aria-hidden={!headerStuck}>
        <span class="detail-stickybar-name">{seed.description}</span>
        <span class="detail-stickybar-stats mono">
          <span><span class="lc">h2</span> {formatNum(seed.h2)}</span>
          <span><span class="lc">h2 p</span> {seed.h2_p != null ? formatP(seed.h2_p) : '—'}</span>
          {seed.neff != null && <span><span class="lc">Neff</span> {seed.neff.toLocaleString('en-US')}</span>}
        </span>
      </div>

      <div class="detail-header card" ref={headerRef}>
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
        <div class="detail-headline-body">
          <dl class="detail-stats mono">
            <div>
              <dt><Tip text="SNP heritability — the share of this trait's variance explained by common genotyped variants (both sexes). Liability scale for binary traits, observed scale otherwise.">h2</Tip></dt>
              <dd>{formatNum(seed.h2)}</dd>
            </div>
            <div>
              <dt><Tip text="P-value for the heritability estimate (the test that h² is greater than zero).">h2 p</Tip></dt>
              <dd>{seed.h2_p != null ? formatP(seed.h2_p) : '—'}</dd>
            </div>
            <div>
              <dt><Tip text="Effective sample size for this trait's GWAS.">Neff</Tip></dt>
              <dd>{seed.neff != null ? seed.neff.toLocaleString('en-US') : '—'}</dd>
            </div>
          </dl>
          <EncodingCard seed={seed} />
        </div>
        <div class="detail-header-links">
          <a class="showcase-link" href={`#/pair/${encodeURIComponent(seed.id)}`}>
            Compare with another trait →
          </a>
          {showcase && (
            <a class="showcase-link" href={showcase.url} target="_blank" rel="noopener noreferrer">
              {showcase.label}
            </a>
          )}
        </div>
      </div>

      <div class="controls-row controls-row--filters">
        <div class="field field-cat">
          <label class="field-label" for="d-category">Category</label>
          <select id="d-category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.currentTarget.value)}>
            <option value="All">All categories</option>
            {categories.map((name) => (
              <option value={name} key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div class="field">
          <label class="field-label" for="d-h2">
            Min <span class="lc">h2</span> {h2Min > 0 ? <span class="lc">{`= ${h2Min.toFixed(2)}`}</span> : 'any'}
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
        <div class="field">
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
        <div class="field field-rg">
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
      </div>

      {sexError && (
        <div class="data-error" role="alert">
          {sexError}
        </div>
      )}

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
                <div class="cols-presets">
                  {COLUMN_PRESETS.map((p) => (
                    <button key={p.key} class="btn-ghost btn-ghost-sm" onClick={() => setVisible(p.cols())}>
                      {p.label}
                    </button>
                  ))}
                </div>
                {COLUMN_GROUPS.map((grp) => (
                  <div class="cols-group" key={grp.title || 'base'}>
                    {grp.title && <div class="cols-group-title">{grp.title}</div>}
                    {grp.cols.map((c) => (
                      <label key={c.key} class="cols-option">
                        <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggleCol(c.key)} />
                        {c.label}
                      </label>
                    ))}
                  </div>
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
          seedId={seed.id}
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
