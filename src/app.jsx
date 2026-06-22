import { useEffect, useMemo, useState } from 'preact/hooks';
import { loadData } from './lib/data.js';
import { Nav } from './components/Nav.jsx';
import { RadialBundle } from './components/RadialBundle.jsx';
import { Heatmap } from './components/Heatmap.jsx';
import { Search } from './components/Search.jsx';
import { PairLookup } from './components/PairLookup.jsx';

const VIEWS = [
  { id: 'radial', label: 'Global structure' },
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'search', label: 'Search & explore' },
  { id: 'pair', label: 'Pairwise lookup' },
];

export function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('radial');
  // Cross-view selection: a phenotype index to focus on.
  const [focus, setFocus] = useState(null);

  useEffect(() => {
    loadData().then(setData).catch((e) => setError(e.message));
  }, []);

  const goExplore = (i) => {
    setFocus(i);
    setView('search');
  };

  const body = useMemo(() => {
    if (!data) return null;
    switch (view) {
      case 'radial':
        return <RadialBundle data={data} onSelect={goExplore} />;
      case 'heatmap':
        return <Heatmap data={data} onSelect={goExplore} />;
      case 'search':
        return <Search data={data} focus={focus} setFocus={setFocus} />;
      case 'pair':
        return <PairLookup data={data} initial={focus} />;
      default:
        return null;
    }
  }, [data, view, focus]);

  return (
    <div class="app">
      <header class="app-header">
        <h1>Genetic Correlation Browser</h1>
        <span class="subtitle">UK Biobank · LDSC</span>
        {data && <span class="count-badge">{data.n} phenotypes</span>}
      </header>

      {data && <Nav views={VIEWS} active={view} onChange={setView} />}

      <main class="main">
        {error && (
          <div class="loading">
            <p>Could not load data: {error}</p>
          </div>
        )}
        {!data && !error && (
          <div class="loading">
            <div class="spinner" />
            <p>Loading correlation matrix…</p>
          </div>
        )}
        {body}
      </main>

      <footer class="app-footer">
        Data: significant genetic correlations from{' '}
        <a href="https://github.com/astheeggeggs/UKBB_ldsc_r2" target="_blank" rel="noreferrer">
          UKBB&nbsp;LDSC&nbsp;r²
        </a>{' '}
        (Neale lab). Estimated with LD score regression.
      </footer>
    </div>
  );
}
