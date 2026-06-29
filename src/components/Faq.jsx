// Static FAQ / methods page. No data dependency, so it renders even while the
// correlation matrix is still loading (or if it fails to load).

const ITEMS = [
  {
    q: 'What does this browser show?',
    a: (
      <p>
        Pairwise <strong>genetic correlations</strong> (rg) across 677 heritable UK Biobank
        phenotypes, estimated with cross-trait LD score regression (LDSC). A genetic correlation
        measures the degree to which two traits share common-variant genetic architecture,
        independent of environmental confounding.
      </p>
    ),
  },
  {
    q: 'How do I read the genetic correlation (rg)?',
    a: (
      <p>
        rg ranges from <strong>−1</strong> (opposite genetic effects) through <strong>0</strong>{' '}
        (no shared genetics) to <strong>+1</strong> (identical genetic basis). The diverging color
        scale runs blue (negative) → white (zero) → red (positive).
      </p>
    ),
  },
  {
    q: 'What does each column in the results table mean?',
    a: (
      <>
        <p>
          The phenotype detail table can show the following columns (toggle them with the{' '}
          <strong>Columns ▾</strong> menu). "Partner" refers to the phenotype each row is
          correlated <em>with</em>; the seed phenotype is the one named at the top of the page.
        </p>
        <ul>
          <li><strong>Correlated phenotype</strong> — the partner trait's description.</li>
          <li><strong>Category</strong> — the partner trait's UK Biobank category.</li>
          <li><strong><span class="lc">rg</span></strong> — genetic correlation between the seed and partner (both sexes).</li>
          <li><strong><span class="lc">|rg|</span></strong> — absolute value of rg, for ranking by strength regardless of sign.</li>
          <li><strong><span class="lc">rg SE</span></strong> — standard error of the rg estimate.</li>
          <li><strong><span class="lc">rg z</span></strong> — z-score, rg ÷ SE.</li>
          <li><strong><span class="lc">rg p</span></strong> — p-value for the test of no genetic correlation.</li>
          <li><strong><span class="lc">h²</span></strong> — SNP heritability of the <em>partner</em> trait (both sexes).</li>
          <li><strong><span class="lc">h² p</span></strong> — p-value of the partner's heritability estimate.</li>
          <li><strong><span class="lc">Neff</span></strong> — effective sample size for the partner trait.</li>
        </ul>
        <p>
          Optional <strong>male-specific</strong> (♂) and <strong>female-specific</strong> (♀)
          columns mirror the rg statistics, computed from sex-stratified GWAS:
        </p>
        <ul>
          <li><strong><span class="lc">rg</span> ♂ / ♀</strong> — genetic correlation in the male / female analysis.</li>
          <li><strong><span class="lc">rg SE</span> ♂ / ♀</strong> — its standard error.</li>
          <li><strong><span class="lc">rg z</span> ♂ / ♀</strong> — its z-score.</li>
          <li><strong><span class="lc">rg p</span> ♂ / ♀</strong> — its p-value.</li>
          <li>
            <strong><span class="lc">h²</span> ♂ / ♀</strong> — the partner trait's sex-specific SNP
            heritability, shown only for the phenotypes where the topline analysis computed it
            ("—" otherwise).
          </li>
        </ul>
        <p>
          A blank male/female correlation means the pair was not significant in that stratum. The
          main views (heatmap, network, search) stay focused on the both-sexes correlations; the
          sex-specific values are available as these optional columns and in the Pairwise lookup.
        </p>
      </>
    ),
  },
  {
    q: 'Why are some |rg| values greater than 1?',
    a: (
      <p>
        rg is theoretically bounded to [−1, 1], but it is an <em>estimate</em>: sampling noise in
        LDSC can push a handful of values slightly past ±1 (here, up to about ±1.17). These are
        kept as reported rather than clamped, so the numbers match the source. The color scale
        clamps them visually to the ±1 endpoints.
      </p>
    ),
  },
  {
    q: 'What is heritability (h²), and on what scale is it reported?',
    a: (
      <>
        <p>
          h² is the <strong>SNP heritability</strong> — the share of a trait's variance explained
          by common genetic variants. It comes from the dedicated{' '}
          <a
            href="https://github.com/astheeggeggs/UKBB_ldsc_r2/tree/master/h2_results"
            target="_blank"
            rel="noreferrer"
          >
            topline UKBB LDSC h² results
          </a>{' '}
          (one estimate per phenotype), not from the genetic-correlation files.
        </p>
        <p>
          The scale depends on the trait type:
        </p>
        <ul>
          <li>
            <strong>Binary (case/control) traits</strong> are reported on the{' '}
            <strong>liability scale</strong>, which assumes an underlying continuous liability and
            is comparable across traits with different prevalences.
          </li>
          <li>
            <strong>Quantitative traits</strong> are reported on the <strong>observed scale</strong>.
          </li>
        </ul>
        <p>
          For continuous traits the two scales coincide, so this distinction only affects
          case/control phenotypes.
        </p>
      </>
    ),
  },
  {
    q: 'What do the standard error, z-score, and p-value mean?',
    a: (
      <p>
        The <strong>standard error</strong> (se) quantifies the uncertainty of each rg estimate;
        the <strong>z-score</strong> is rg ÷ se; and the <strong>p-value</strong> tests the null
        hypothesis of no genetic correlation. Very small p-values are stored as −log₁₀(p) for
        precision and shown in scientific notation.
      </p>
    ),
  },
  {
    q: 'How are the phenotypes ordered and clustered?',
    a: (
      <p>
        Phenotypes are arranged by <strong>average-linkage hierarchical clustering</strong> on a
        distance of 1 − rg, so genetically similar traits sit next to each other in the heatmap and
        radial views. The same leaf order is shared across every view. The network/radial diagram
        draws only the strongest edges (|rg| ≥ 0.5), capped per phenotype to stay legible.
      </p>
    ),
  },
  {
    q: 'Where does the data come from?',
    a: (
      <p>
        Significant genetic correlations from the{' '}
        <a href="https://github.com/astheeggeggs/UKBB_ldsc_r2" target="_blank" rel="noreferrer">
          UKBB LDSC r²
        </a>{' '}
        project (Neale lab), based on GWAS of the UK Biobank. Phenotype categories are mapped from
        the UK Biobank Data Showcase schema. This is a visualization, not an official Broad or Neale
        lab product.
      </p>
    ),
  },
];

export function Faq() {
  return (
    <div class="faq">
      <p class="view-intro">
        Background on the data and methods behind this browser. Genetic correlations are estimated
        with LD score regression from UK Biobank GWAS.
      </p>
      {ITEMS.map((item) => (
        <section class="faq-item card" key={item.q}>
          <h2 class="faq-q">{item.q}</h2>
          <div class="faq-a">{item.a}</div>
        </section>
      ))}
    </div>
  );
}
