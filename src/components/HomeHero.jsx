import { SearchBox } from './SearchBox.jsx';
import { HeatmapPreview, NetworkPreview, PairPreview } from './ExplorePreviews.jsx';

// Each chip shows a clean label but searches an explicit query so it resolves
// to the intended phenotype. A mix of classic heritable traits where genetic
// correlation matters, plus a couple of pop-science traits.
const EXAMPLES = [
  { label: 'BMI', query: 'Body mass index' },
  { label: 'Height', query: 'Standing height' },
  { label: 'Coronary heart disease', query: 'Major coronary heart disease' },
  { label: 'Neuroticism', query: 'Neuroticism score' },
  { label: 'Happiness', query: 'Happiness' },
  { label: 'Chronotype', query: 'Morning/evening person (chronotype)' },
];

const EXPLORE_CARDS = [
  {
    hash: '#/heatmap',
    title: 'Heatmap',
    desc: 'The full clustered correlation matrix across all phenotypes.',
    Preview: HeatmapPreview,
  },
  {
    hash: '#/network',
    title: 'Network',
    desc: 'Radial bundling of the strongest genetic correlations.',
    Preview: NetworkPreview,
  },
  {
    hash: '#/pair',
    title: 'Pairwise lookup',
    desc: 'Full LDSC statistics for any pair of phenotypes.',
    Preview: PairPreview,
  },
];

// Search-first landing: a centered hero search, quick examples, and entry
// points to the explore views.
export function HomeHero({ data, onNavigate, onSelect }) {
  const { phenotypes } = data;

  const tryExample = (q) => {
    const s = q.toLowerCase();
    // Prefer an exact description match, then fall back to the first substring hit.
    let i = phenotypes.findIndex((p) => p.description.toLowerCase() === s);
    if (i < 0) i = phenotypes.findIndex((p) => p.description.toLowerCase().includes(s));
    if (i >= 0) onSelect(i);
  };

  return (
    <div class="hero">
      <img
        class="hero-logo"
        src={`${import.meta.env.BASE_URL}rg_col.svg`}
        alt="Genetic correlation matrix logo"
        width="72"
        height="72"
      />
      <h1 class="hero-title">Genetic Correlation Browser</h1>
      <p class="hero-tagline">
        Explore genetic correlations across <strong>{data.n}</strong> heritable UK Biobank
        phenotypes, estimated with LD score regression.
      </p>

      <div class="hero-search">
        <SearchBox
          phenotypes={phenotypes}
          onSelect={onSelect}
          variant="hero"
          placeholder="Search a phenotype — e.g. BMI, depression, cholesterol…"
          autoFocus
        />
      </div>

      <div class="hero-chips">
        <span class="hero-chips-label">Try:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex.label} class="hero-chip" onClick={() => tryExample(ex.query)}>
            {ex.label}
          </button>
        ))}
      </div>

      <div class="explore-cards">
        {EXPLORE_CARDS.map((c) => (
          <a
            key={c.hash}
            href={c.hash}
            class="explore-card card"
            onClick={(e) => {
              e.preventDefault();
              onNavigate(c.hash);
            }}
          >
            <span class="explore-card-preview">
              <c.Preview />
            </span>
            <span class="explore-card-body">
              <span class="explore-card-title">{c.title}</span>
              <span class="explore-card-desc">{c.desc}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
