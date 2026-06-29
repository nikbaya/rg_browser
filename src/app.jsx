import { useEffect, useMemo, useState } from 'preact/hooks';
import { loadData } from './lib/data.js';
import { SearchBox } from './components/SearchBox.jsx';
import { TopBar } from './components/TopBar.jsx';
import { HomeHero } from './components/HomeHero.jsx';
import { PhenotypeDetail } from './components/PhenotypeDetail.jsx';
import { RadialBundle } from './components/RadialBundle.jsx';
import { Heatmap } from './components/Heatmap.jsx';
import { PairLookup } from './components/PairLookup.jsx';
import { Faq } from './components/Faq.jsx';

// Parse the location hash into a route descriptor. Phenotype ids travel in the
// URL (decoded here); components keep working with array indices, bridged via
// data.idToIndex at render time.
function parseHash(hash) {
  const h = (hash || '').replace(/^#/, '');
  const parts = h.split('/').filter(Boolean); // e.g. "/p/50_irnt" -> ['p','50_irnt']
  if (parts.length === 0) return { kind: 'home' };
  switch (parts[0]) {
    case 'p':
      return { kind: 'detail', id: parts[1] ? decodeURIComponent(parts[1]) : null };
    case 'heatmap':
      return { kind: 'heatmap' };
    case 'network':
      return { kind: 'network' };
    case 'pair':
      return {
        kind: 'pair',
        id: parts[1] ? decodeURIComponent(parts[1]) : null,
        idB: parts[2] ? decodeURIComponent(parts[2]) : null,
      };
    case 'faq':
      return { kind: 'faq' };
    default:
      return { kind: 'home' };
  }
}

// GoatCounter loads async; resolve once its count() is available (or give up
// quietly after a few seconds offline / blocked).
let gcReady = null;
function whenGoatCounter() {
  if (gcReady) return gcReady;
  gcReady = new Promise((resolve) => {
    if (window.goatcounter?.count) return resolve();
    const id = setInterval(() => {
      if (window.goatcounter?.count) {
        clearInterval(id);
        resolve();
      }
    }, 150);
    setTimeout(() => {
      clearInterval(id);
      resolve();
    }, 8000);
  });
  return gcReady;
}

// Count the current hash route as a pageview (e.g. "/p/50_irnt", "/heatmap").
function countView() {
  const path = window.location.hash ? window.location.hash.replace(/^#/, '') : '/';
  whenGoatCounter().then(() => window.goatcounter?.count?.({ path }));
}

export function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    loadData().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    countView(); // initial view
    const onHash = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
      countView();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (hash) => {
    if (window.location.hash === hash) {
      // Same hash (e.g. re-centering on a row already shown) won't fire
      // hashchange — refresh the route manually.
      setRoute(parseHash(hash));
      window.scrollTo(0, 0);
    } else {
      window.location.hash = hash;
    }
  };
  const goPhenotype = (i) => navigate(`#/p/${encodeURIComponent(data.phenotypes[i].id)}`);

  // Resolve a routed phenotype id to an index once data is available.
  const focusIndex = useMemo(() => {
    if (!data || route.kind !== 'detail' || route.id == null) return null;
    return data.idToIndex.has(route.id) ? data.idToIndex.get(route.id) : undefined;
  }, [data, route]);

  const needsData = route.kind !== 'faq';

  const body = useMemo(() => {
    if (route.kind === 'faq') return <Faq />;
    if (!data) return null;
    switch (route.kind) {
      case 'home':
        return <HomeHero data={data} onNavigate={navigate} onSelect={goPhenotype} />;
      case 'detail':
        if (focusIndex == null) {
          return (
            <div class="card not-found">
              <h2>Phenotype not found</h2>
              <p>
                We couldn't find a phenotype for <span class="mono">{route.id}</span>. Try searching
                for it instead.
              </p>
              <SearchInline data={data} onSelect={goPhenotype} />
              <a class="not-found-home" href="#/" onClick={(e) => { e.preventDefault(); navigate('#/'); }}>
                ← Back to home
              </a>
            </div>
          );
        }
        return <PhenotypeDetail data={data} index={focusIndex} onSelect={goPhenotype} />;
      case 'heatmap':
        return <Heatmap data={data} onSelect={goPhenotype} />;
      case 'network':
        return <RadialBundle data={data} onSelect={goPhenotype} />;
      case 'pair': {
        const initial = route.id != null && data.idToIndex.has(route.id)
          ? data.idToIndex.get(route.id)
          : null;
        const initialB = route.idB != null && data.idToIndex.has(route.idB)
          ? data.idToIndex.get(route.idB)
          : null;
        return <PairLookup data={data} initial={initial} initialB={initialB} />;
      }
      default:
        return null;
    }
  }, [data, route, focusIndex]);

  const isHome = route.kind === 'home';

  return (
    <div class="app">
      <TopBar routeKind={isHome ? 'home' : route.kind} data={data} onNavigate={navigate} />

      <main class={`main${isHome ? ' main--home' : ''}`}>
        {needsData && error && (
          <div class="loading">
            <p>Could not load data: {error}</p>
          </div>
        )}
        {needsData && !data && !error && (
          <div class="loading">
            <div class="spinner" />
            <p>Loading correlation matrix…</p>
          </div>
        )}
        {body}
      </main>

      <footer class="app-footer">
        <p>
          Data: significant genetic correlations from{' '}
          <a href="https://github.com/astheeggeggs/UKBB_ldsc_r2" target="_blank" rel="noreferrer">
            UKBB&nbsp;LDSC&nbsp;r²
          </a>{' '}
          (Neale lab), GWAS of the{' '}
          <a href="https://www.ukbiobank.ac.uk/" target="_blank" rel="noreferrer">
            UK&nbsp;Biobank
          </a>{' '}
          — publicly released summary statistics, no individual-level data.
          {data?.meta?.built_date ? ` · Data built ${data.meta.built_date}` : ''}
        </p>
        <p class="app-footer-sub">
          Research and education only — not medical advice. See the{' '}
          <a href="#/faq">FAQ</a> for methods, limitations, credits, and privacy.
        </p>
      </footer>
    </div>
  );
}

// Small inline search used on the not-found card.
function SearchInline({ data, onSelect }) {
  return (
    <div style="margin: 0.8rem 0;">
      <SearchBox phenotypes={data.phenotypes} onSelect={onSelect} variant="compact" />
    </div>
  );
}
