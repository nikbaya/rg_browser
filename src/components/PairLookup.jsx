import { useEffect, useState } from 'preact/hooks';
import { pairStats, formatNum, formatP, ensureSexMatrices, statsFromMatrices } from '../lib/data.js';
import { colorForRg, textOnRg } from '../lib/color.js';
import { SearchBox } from './SearchBox.jsx';

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
          {phenotypes[value].description}
          <span class="mono picker-selected-id">{phenotypes[value].id}</span>
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

  // Load the male/female matrices for the sex comparison (this detailed view
  // shows all three strata side by side).
  useEffect(() => {
    let cancelled = false;
    Promise.all([ensureSexMatrices('male'), ensureSexMatrices('female')]).then(
      ([male, female]) => { if (!cancelled) setSexMats({ male, female }); }
    );
    return () => { cancelled = true; };
  }, []);

  const ready = a != null && b != null && a !== b;
  const both = ready ? pairStats(data, a, b) : null;
  const male = ready && sexMats.male ? statsFromMatrices(sexMats.male, n, a, b) : null;
  const female = ready && sexMats.female ? statsFromMatrices(sexMats.female, n, a, b) : null;

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
          <div
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
        </div>
      )}
    </div>
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
