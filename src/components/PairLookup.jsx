import { useMemo, useState } from 'preact/hooks';
import { pairStats, formatNum, formatP } from '../lib/data.js';
import { colorForRg, textOnRg } from '../lib/color.js';

// A small typeahead select over phenotypes.
function PhenotypePicker({ label, value, onChange, phenotypes }) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const out = [];
    for (let i = 0; i < phenotypes.length; i++) {
      if (phenotypes[i].description.toLowerCase().includes(s)) out.push(i);
      if (out.length >= 20) break;
    }
    return out;
  }, [q, phenotypes]);

  return (
    <div class="field" style="position: relative;">
      <label class="field-label">{label}</label>
      <input
        type="text"
        placeholder="Search phenotype…"
        value={value != null && !q ? phenotypes[value].description : q}
        onInput={(e) => setQ(e.currentTarget.value)}
      />
      {q && matches.length > 0 && (
        <div
          class="card"
          style="position:absolute; z-index:20; left:0; right:0; margin-top:4px; max-height:240px; overflow:auto;"
        >
          <table class="data-table">
            <tbody>
              {matches.map((i) => (
                <tr
                  key={i}
                  class="clickable"
                  onClick={() => {
                    onChange(i);
                    setQ('');
                  }}
                >
                  <td>{phenotypes[i].description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PairLookup({ data, initial }) {
  const { phenotypes } = data;
  const [a, setA] = useState(initial ?? null);
  const [b, setB] = useState(null);

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
              rg {stats.rg.toFixed(3)}
            </span>
            <div style="flex:1 1 200px; text-align:right;">
              <div style="font-weight:700;">{phenotypes[b].description}</div>
              <div class="mono" style="color:var(--text-muted); font-size:0.82rem;">{phenotypes[b].id}</div>
            </div>
          </div>

          <div class="stat-grid">
            <Stat label="Genetic corr. (rg)" value={formatNum(stats.rg)} />
            <Stat label="Std. error" value={formatNum(stats.se)} />
            <Stat label="z-score" value={formatNum(stats.z, 2)} />
            <Stat label="p-value" value={formatP(stats.p)} />
            <Stat label={`h² · ${phenotypes[a].description}`} value={formatNum(stats.h2_i)} />
            <Stat label={`h² · ${phenotypes[b].description}`} value={formatNum(stats.h2_j)} />
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
