import { useMemo, useState } from 'preact/hooks';
import { topCorrelations, formatNum } from '../lib/data.js';
import { colorForRg, textOnRg } from '../lib/color.js';

// Search a phenotype, then show its ranked top genetic correlations.
export function Search({ data, focus, setFocus }) {
  const { phenotypes } = data;
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('abs'); // 'abs' | 'rg' | 'name'

  // When arriving from another view with a focus index, prefill nothing but select it.
  const selected = focus;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (let i = 0; i < phenotypes.length; i++) {
      const d = phenotypes[i].description.toLowerCase();
      if (d.includes(q)) out.push(i);
      if (out.length >= 30) break;
    }
    return out;
  }, [query, phenotypes]);

  const rows = useMemo(() => {
    if (selected == null) return [];
    const r = topCorrelations(data, selected, 50);
    const sorted = [...r];
    if (sortKey === 'rg') sorted.sort((a, b) => b.rg - a.rg);
    else if (sortKey === 'name')
      sorted.sort((a, b) => phenotypes[a.j].description.localeCompare(phenotypes[b.j].description));
    else sorted.sort((a, b) => Math.abs(b.rg) - Math.abs(a.rg));
    return sorted;
  }, [selected, sortKey, data]);

  return (
    <div>
      <p class="view-intro">
        Search for a phenotype, then browse its strongest genetic correlations across all{' '}
        <strong>{phenotypes.length}</strong> traits. Click any row to re-center on that phenotype.
      </p>

      <div class="controls-row">
        <div class="field" style="flex: 1 1 320px;">
          <label class="field-label" for="ph-search">Phenotype</label>
          <input
            id="ph-search"
            type="text"
            placeholder="e.g. cholesterol, BMI, depression…"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
      </div>

      {query && matches.length > 0 && (
        <div class="card" style="margin-bottom: 1.2rem; max-height: 260px; overflow:auto;">
          <table class="data-table">
            <tbody>
              {matches.map((i) => (
                <tr
                  key={i}
                  class="clickable"
                  onClick={() => {
                    setFocus(i);
                    setQuery('');
                  }}
                >
                  <td>{phenotypes[i].description}</td>
                  <td class="mono" style="color: var(--text-muted); text-align:right;">
                    {phenotypes[i].id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected != null && (
        <div>
          <div class="card" style="padding: 1.1rem 1.2rem; margin-bottom: 1.2rem;">
            <div class="field-label">Selected phenotype</div>
            <div style="font-size: 1.25rem; font-weight: 700;">
              {phenotypes[selected].description}
            </div>
            <div class="mono" style="color: var(--text-muted); font-size: 0.85rem;">
              {phenotypes[selected].id}
              {phenotypes[selected].h2 != null && (
                <span> · h² = {formatNum(phenotypes[selected].h2)}</span>
              )}
            </div>
          </div>

          <table class="data-table">
            <thead>
              <tr>
                <th onClick={() => setSortKey('name')}>Correlated phenotype</th>
                <th class="num" onClick={() => setSortKey('abs')}>|rg|</th>
                <th class="num" onClick={() => setSortKey('rg')}>rg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.j} class="clickable" onClick={() => setFocus(row.j)}>
                  <td>{phenotypes[row.j].description}</td>
                  <td class="num">{Math.abs(row.rg).toFixed(3)}</td>
                  <td class="num">
                    <span
                      class="rg-chip"
                      style={`background:${colorForRg(row.rg)};color:${textOnRg(row.rg)}`}
                    >
                      {row.rg.toFixed(3)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected == null && !query && (
        <p style="color: var(--text-muted);">Start typing above to find a phenotype.</p>
      )}
    </div>
  );
}
