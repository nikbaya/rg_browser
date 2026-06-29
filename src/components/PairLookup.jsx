import { useState } from 'preact/hooks';
import { pairStats, formatNum, formatP } from '../lib/data.js';
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
  const { phenotypes } = data;
  const [a, setA] = useState(initial ?? null);
  const [b, setB] = useState(initialB ?? null);

  const stats = a != null && b != null ? pairStats(data, a, b) : null;

  return (
    <div>
      <p class="view-intro">
        Pick any two phenotypes to see the full LDSC statistics for that pair — genetic
        correlation, standard error, z-score, p-value, and each trait's heritability.
      </p>

      <div class="controls-row">
        <PhenotypePicker label="Phenotype A" value={a} onChange={setA} phenotypes={phenotypes} />
        <PhenotypePicker label="Phenotype B" value={b} onChange={setB} phenotypes={phenotypes} />
      </div>

      {a != null && b != null && a === b && (
        <p style="color: var(--text-muted);">Pick two different phenotypes.</p>
      )}

      {stats && a !== b && (
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
              style={`background:${colorForRg(stats.rg)};color:${textOnRg(stats.rg)};font-size:1rem;min-width:5em;padding:0.3rem 0.7rem;`}
            >
              rg {formatNum(stats.rg)}
            </span>
            <div style="flex:1 1 200px; text-align:right;">
              <div style="font-weight:700;">{phenotypes[b].description}</div>
              <div class="mono" style="color:var(--text-muted); font-size:0.82rem;">{phenotypes[b].id}</div>
            </div>
          </div>

          <div class="stat-grid">
            <Stat label={<>Genetic corr. (<span class="lc">rg</span>)</>} value={formatNum(stats.rg)} />
            <Stat label={<>Std. error <span class="lc">(rg)</span></>} value={formatNum(stats.se)} />
            <Stat label={<><span class="lc">z</span>-score <span class="lc">(rg)</span></>} value={formatNum(stats.z)} />
            <Stat label={<><span class="lc">p</span>-value <span class="lc">(rg)</span></>} value={formatP(stats.p)} />
            <Stat label={<span class="lc">h² · {phenotypes[a].description}</span>} value={formatNum(stats.h2_i)} />
            <Stat label={<span class="lc">h² · {phenotypes[b].description}</span>} value={formatNum(stats.h2_j)} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div class="stat">
      <div class="stat-label">{label}</div>
      <div class="stat-value">{value}</div>
    </div>
  );
}
