import { SearchBox } from './SearchBox.jsx';

const EXPLORE = [
  { hash: '#/heatmap', label: 'Heatmap', kind: 'heatmap' },
  { hash: '#/network', label: 'Network', kind: 'network' },
  { hash: '#/pair', label: 'Pairwise', kind: 'pair' },
  { hash: '#/faq', label: 'FAQ', kind: 'faq' },
];

// Slim header present on every route: brand (links home), explore links with
// active-route styling, and the persistent compact search on the right (shown
// on every route, including home).
export function TopBar({ routeKind, data, onNavigate }) {
  const go = (hash) => (e) => {
    e.preventDefault();
    onNavigate(hash);
  };

  return (
    <header class="topbar">
      <a class="topbar-brand" href="#/" onClick={go('#/')}>
        <img
          class="topbar-logo"
          src={`${import.meta.env.BASE_URL}rg_col.svg`}
          alt=""
          width="30"
          height="30"
        />
        <span class="topbar-text">
          <span class="topbar-title">Genetic Correlation Browser</span>
          <span class="topbar-sub">UK Biobank · LDSC</span>
        </span>
      </a>

      <nav class="topbar-links" aria-label="Explore">
        {EXPLORE.map((v) => (
          <a
            key={v.kind}
            href={v.hash}
            class={routeKind === v.kind ? 'active' : ''}
            aria-current={routeKind === v.kind ? 'page' : undefined}
            onClick={go(v.hash)}
          >
            {v.label}
          </a>
        ))}
      </nav>

      {data && (
        <div class="topbar-search">
          <SearchBox
            phenotypes={data.phenotypes}
            onSelect={(i) => onNavigate(`#/p/${encodeURIComponent(data.phenotypes[i].id)}`)}
            variant="compact"
            placeholder="Search a phenotype…"
          />
        </div>
      )}
    </header>
  );
}
