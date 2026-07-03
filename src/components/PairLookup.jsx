import { useEffect, useRef, useState } from 'preact/hooks';
import { pairStats, formatNum, formatP, ensureSexMatrices, statsFromMatrices, sharedCorrelations } from '../lib/data.js';
import { colorForRg, textOnRg } from '../lib/color.js';
import { SearchBox } from './SearchBox.jsx';

const PAGE = 25; // shared-trait rows revealed initially and per scroll step
const P_EXP_MAX = 20; // Max-p slider: exponent range 0 (any) .. 20 (1e−20)
const P_TICKS = [0, 5, 10, 15, 20];

// A labeled phenotype picker built on the shared SearchBox typeahead. Shows the
// currently-selected phenotype, with the search to (re)pick.
function PhenotypePicker({ label, value, onChange, phenotypes }) {
  return (
    <div class="field">
      <label class="field-label">{label}</label>
      <SearchBox
        phenotypes={phenotypes}
        onSelect={onChange}
        variant="compact"
        placeholder="Search phenotype…"
      />
      {value != null && (
        <div class="picker-selected">
          <span class="picker-selected-check" aria-hidden="true">✓</span>
          <span class="picker-selected-body">
            <span class="picker-selected-label">Selected</span>
            <span class="picker-selected-name">
              {phenotypes[value].description}
              <span class="mono picker-selected-id">{phenotypes[value].id}</span>
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

export function PairLookup({ data, initial, initialB }) {
  const { phenotypes, n } = data;
  const [a, setA] = useState(initial ?? null);
  const [b, setB] = useState(initialB ?? null);
  const [sexMats, setSexMats] = useState({}); // { male, female }
  const [pExp, setPExp] = useState(0); // Max-p cap for the shared list as 1e−pExp; 0 => no filter
  const [shown, setShown] = useState(PAGE); // rows currently revealed in the shared list
  const headerRef = useRef(null);
  const [headerStuck, setHeaderStuck] = useState(false);
  const sentinelRef = useRef(null);

  // Load the male/female matrices for the sex comparison (this detailed view
  // shows all three strata side by side).
  useEffect(() => {
    let cancelled = false;
    Promise.all([ensureSexMatrices('male'), ensureSexMatrices('female')]).then(
      ([male, female]) => { if (!cancelled) setSexMats({ male, female }); }
    );
    return () => { cancelled = true; };
  }, []);

  // Slide in a compact fixed bar naming both traits once the header card scrolls
  // out of view, so the pair stays identified while reading the shared-traits list.
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setHeaderStuck(!entry.isIntersecting),
      { rootMargin: '-48px 0px 0px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [a, b]);

  const ready = a != null && b != null && a !== b;
  const both = ready ? pairStats(data, a, b) : null;
  const male = ready && sexMats.male ? statsFromMatrices(sexMats.male, n, a, b) : null;
  const female = ready && sexMats.female ? statsFromMatrices(sexMats.female, n, a, b) : null;
  const maxP = pExp === 0 ? null : Math.pow(10, -pExp);
  const shared = ready ? sharedCorrelations(data, a, b, Infinity, maxP) : null;
  const visibleShared = shared ? shared.slice(0, shown) : null;

  // Reset the reveal count whenever the pair or the p-filter changes.
  useEffect(() => { setShown(PAGE); }, [a, b, pExp]);

  // Endless scroll: reveal another page of shared traits as the sentinel below the
  // list scrolls into view, until every trait is shown.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setShown((s) => s + PAGE); },
      { rootMargin: '200px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shared]);

  return (
    <div>
      <p class="view-intro">
        Pick any two phenotypes to see the full LDSC statistics for that pair — genetic
        correlation, standard error, z-score, p-value, and each trait's heritability —
        for both sexes and, where available, the male- and female-specific analyses.
      </p>

      <div class="controls-row controls-row--top">
        <PhenotypePicker label="Phenotype A" value={a} onChange={setA} phenotypes={phenotypes} />
        <PhenotypePicker label="Phenotype B" value={b} onChange={setB} phenotypes={phenotypes} />
      </div>

      {a != null && b != null && a === b && (
        <p style="color: var(--text-muted);">Pick two different phenotypes.</p>
      )}

      {both && (
        <div>
          <div class={`detail-stickybar pair-stickybar${headerStuck ? ' is-visible' : ''}`} aria-hidden={!headerStuck}>
            <span class="detail-stickybar-name">{phenotypes[a].description}</span>
            <span
              class="rg-chip"
              style={`background:${colorForRg(both.rg)};color:${textOnRg(both.rg)};flex:none;`}
            >
              rg {formatNum(both.rg)}
            </span>
            <span class="detail-stickybar-name pair-stickybar-name-b">{phenotypes[b].description}</span>
          </div>

          <div
            ref={headerRef}
            class="card"
            style="padding: 1.1rem 1.2rem; margin-bottom: 1rem; display:flex; gap:1rem; align-items:center; flex-wrap:wrap;"
          >
            <div style="flex:1 1 200px;">
              <div style="font-weight:700;">{phenotypes[a].description}</div>
              <div class="mono" style="color:var(--text-muted); font-size:0.82rem;">{phenotypes[a].id}</div>
            </div>
            <span
              class="rg-chip"
              style={`background:${colorForRg(both.rg)};color:${textOnRg(both.rg)};font-size:1rem;min-width:5em;padding:0.3rem 0.7rem;`}
            >
              rg {formatNum(both.rg)}
            </span>
            <div style="flex:1 1 200px; text-align:right;">
              <div style="font-weight:700;">{phenotypes[b].description}</div>
              <div class="mono" style="color:var(--text-muted); font-size:0.82rem;">{phenotypes[b].id}</div>
            </div>
          </div>

          <table class="data-table pair-table">
            <thead>
              <tr>
                <th>Statistic</th>
                <th class="num">Both sexes</th>
                <th class="num">Male</th>
                <th class="num">Female</th>
              </tr>
            </thead>
            <tbody>
              <StatRow label={<>Genetic corr. (<span class="lc">rg</span>)</>}
                both={formatNum(both.rg)} male={sexNum(male, 'rg', sexMats.male)} female={sexNum(female, 'rg', sexMats.female)} />
              <StatRow label={<>Std. error <span class="lc">(rg)</span></>}
                both={formatNum(both.se)} male={sexNum(male, 'se', sexMats.male)} female={sexNum(female, 'se', sexMats.female)} />
              <StatRow label={<><span class="lc">z</span>-score <span class="lc">(rg)</span></>}
                both={formatNum(both.z)} male={sexNum(male, 'z', sexMats.male)} female={sexNum(female, 'z', sexMats.female)} />
              <StatRow label={<><span class="lc">p</span>-value <span class="lc">(rg)</span></>}
                both={formatP(both.p)} male={sexP(male, sexMats.male)} female={sexP(female, sexMats.female)} />
              <StatRow label={<><span class="lc">h2</span> · {phenotypes[a].description}</>}
                both={formatNum(phenotypes[a].h2)} male={formatNum(phenotypes[a].h2_male)} female={formatNum(phenotypes[a].h2_female)} />
              <StatRow label={<><span class="lc">h2</span> · {phenotypes[b].description}</>}
                both={formatNum(phenotypes[b].h2)} male={formatNum(phenotypes[b].h2_male)} female={formatNum(phenotypes[b].h2_female)} />
            </tbody>
          </table>
          <p class="view-hint" style="margin-top:0.6rem;">
            Sex-specific h2 is shown only for the phenotypes where the topline analysis
            computed it; "—" elsewhere. A blank male/female correlation means the pair
            was not significant in that stratum.
          </p>

          {shared && (
            <div style="margin-top:1.8rem;">
              <div style="display:flex; gap:1rem 1.6rem; align-items:flex-end; flex-wrap:wrap; justify-content:space-between;">
                <h3 style="margin:0;">Traits most shared</h3>
                <div class="field" style="flex:0 1 240px;">
                  <label class="field-label" for="pair-pexp">
                    Max <span class="lc">rg</span> <span class="lc">p</span> ≤ {pExp === 0 ? 'any' : <span class="lc">{`1e−${pExp}`}</span>}
                  </label>
                  <div class="range-slider single has-ticks">
                    <div class="range-track">
                      <div class="range-fill" style={`left:0; right:${100 - (pExp / P_EXP_MAX) * 100}%`} />
                      {P_TICKS.map((t) => (
                        <span key={t} class="range-tick" style={`left:${(t / P_EXP_MAX) * 100}%`} />
                      ))}
                    </div>
                    <input id="pair-pexp" class="range-input" type="range" min="0" max={P_EXP_MAX} step="1"
                      value={pExp} onInput={(e) => setPExp(parseInt(e.currentTarget.value, 10))} />
                  </div>
                </div>
              </div>
              <p class="view-hint" style="margin:0.3rem 0 0.7rem;">
                Phenotypes that <em>both</em> {phenotypes[a].description} and {phenotypes[b].description} are
                genetically correlated with, ranked by the average of each trait's |<span class="lc">rg</span>|
                rank against the two — a low average means it sits near the top of both lists.
                {maxP != null && <> Showing only traits where both correlations reach <span class="lc">p</span> ≤ {formatP(maxP)}.</>}
              </p>
              {shared.length > 0 ? (
                <>
                  <table class="data-table pair-table">
                    <thead>
                      <tr>
                        <th>Shared trait</th>
                        <th class="num">rg · A <span class="lc pair-th-sub">(rg p)</span></th>
                        <th class="num">rg · B <span class="lc pair-th-sub">(rg p)</span></th>
                        <th class="num">Avg rank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleShared.map((s) => (
                        <tr key={phenotypes[s.j].id}>
                          <td>
                            <a href={`#/p/${encodeURIComponent(phenotypes[s.j].id)}`}>
                              {phenotypes[s.j].description}
                            </a>
                            <span class="mono" style="color:var(--text-muted); font-size:0.78rem; margin-left:0.4rem;">
                              {phenotypes[s.j].id}
                            </span>
                          </td>
                          <td class="num"><RgCell rg={s.rgA} p={s.pA} /></td>
                          <td class="num"><RgCell rg={s.rgB} p={s.pB} /></td>
                          <td class="num">{s.avgRank}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div ref={sentinelRef} aria-hidden="true" style="height:1px;" />
                  <p class="view-hint" style="margin-top:0.5rem;">
                    Showing {Math.min(shown, shared.length)} of {shared.length} shared traits.
                  </p>
                </>
              ) : (
                <p style="color: var(--text-muted);">No shared traits meet this p-value threshold.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// An rg value shown as a color chip with its p-value in small text beneath.
function RgCell({ rg, p }) {
  return (
    <span class="pair-rg-cell">
      <span class="rg-chip" style={`background:${colorForRg(rg)};color:${textOnRg(rg)};`}>
        {formatNum(rg)}
      </span>
      <span class="pair-rg-p mono">{formatP(p)}</span>
    </span>
  );
}

// Format a sex-stratum numeric field; '…' until matrices load.
function sexNum(stats, key, loaded) {
  if (!loaded) return '…';
  return formatNum(stats ? stats[key] : NaN);
}
function sexP(stats, loaded) {
  if (!loaded) return '…';
  return formatP(stats ? stats.p : NaN);
}

function StatRow({ label, both, male, female }) {
  return (
    <tr>
      <td>{label}</td>
      <td class="num">{both}</td>
      <td class="num">{male}</td>
      <td class="num">{female}</td>
    </tr>
  );
}
