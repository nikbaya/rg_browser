# Genetic Correlation Browser

An interactive, responsive browser of UK Biobank LDSC **genetic correlations** across 677
heritable phenotypes, built from the
[UKBB LDSC r²](https://github.com/astheeggeggs/UKBB_ldsc_r2) significant-correlation results.

**🔗 Live site: https://nikbaya.github.io/rg_browser/**

**💻 Local preview (dev server): [http://localhost:5173/rg_browser/](http://localhost:5173/rg_browser/)** — see [Develop](#develop) to start it.

Styled per the Broad Institute brand (not an official Broad product).

## Views

- **Global structure** — a radial arc diagram of the strongest correlations (|rg| ≥ 0.5). Traits
  are arranged around the rim by clustering the full matrix (similar ones adjacent), and each
  correlation is drawn as an arc bowing toward the center. Sliders filter the drawn correlations by
  minimum |rg| and maximum p-value, and only still-connected traits stay on the circle (re-spacing
  to fill it as you tighten). Hover a trait to trace its links; click to pin a card listing its top
  correlations with their rg values.
- **Heatmap** — the clustered 677×677 correlation matrix rendered on a canvas.
- **Search & explore** — find a phenotype and browse its ranked top correlations. Each detail
  page links out to the [UK Biobank Data Showcase](https://biobank.ndph.ox.ac.uk/showcase/):
  standard fields (numeric ids) link to their field page; ICD-10 diagnosis phenotypes link to the
  Showcase ICD-10 coding classification (no per-code page exists); curated endpoints have no link.
- **Pairwise lookup** — full LDSC stats (rg, se, z, p, h²) for any two phenotypes, for both
  sexes and, where available, the male- and female-specific analyses.

## Results table columns

The phenotype detail table is column-configurable (the **Columns ▾** menu). Every column is
also explained in the in-app **FAQ** — **when adding or renaming a column, update the FAQ
entry ("What does each column in the results table mean?") so every field stays documented.**

Base columns (both sexes):

| Column | Meaning |
| --- | --- |
| Correlated phenotype | The partner trait's description |
| Category | The partner trait's UK Biobank category |
| `rg` | Genetic correlation between seed and partner |
| `\|rg\|` | Absolute rg (rank by strength regardless of sign) |
| `rg SE` | Standard error of rg |
| `rg z` | z-score, rg ÷ SE |
| `rg p` | p-value for the test of no genetic correlation |
| `h²` | SNP heritability of the partner trait |
| `h² p` | p-value of the partner's h² estimate |
| `Neff` | Effective sample size for the partner trait |

Optional male (♂) / female (♀) columns, from the sex-stratified GWAS, mirror the rg statistics
(`rg`, `rg SE`, `rg z`, `rg p`) plus the partner's sex-specific `h²`. Sex-specific h² appears
only where the topline analysis computed it ("—" otherwise); a blank sex correlation means the
pair was not significant in that stratum. The main views stay focused on both-sexes rg; these
columns (and the Pairwise lookup) surface the sex-specific values. The sex matrices load lazily
the first time a sex column is shown.

## Phenotype categories

Categories come from the [UK Biobank Data Showcase](https://biobank.ndph.ox.ac.uk/showcase/)
schema, resolved in `scripts/build_data.py` (`category_resolver`): numeric UKB fields inherit
their Showcase *main category*, rolled up from ~70 granular groups into a compact set
(`MAIN_CATEGORY_ROLLUP`); ICD-10 / FinnGen / curated endpoints with no field are categorized by
ICD-10 chapter (`ICD_LETTER` / `ICD_ROMAN` / `NAMED_ENDPOINTS`); everything else falls back to
`Other`. This is also explained in the in-app FAQ.

## Data, attribution & disclaimer

The displayed values are publicly released **summary statistics** from the
[UKBB LDSC r²](https://github.com/astheeggeggs/UKBB_ldsc_r2) project (Neale lab), based on GWAS of
the [UK Biobank](https://www.ukbiobank.ac.uk/) — **no individual-level data** is used or exposed.
Each build stamps `public/data/meta.json` with the source and build date, surfaced in the app
footer.

> This research has been conducted using the UK Biobank Resource under **Application Number 31063**.

This tool is for **research and education only — not medical advice**. UK Biobank is predominantly
European-ancestry (limited generalizability); only genome-wide **significant** correlations are
shown (a filtered view); and genetic correlation does **not** imply causation. See the in-app FAQ
for the full limitations.

## Citation & credits

The original UK Biobank rg browser was built by **Duncan Palmer**. This version was created by
**Nikolas Baya** with Claude Code. It is a visualization, not an official Broad or Neale lab
product.

To cite this tool, use [`CITATION.cff`](CITATION.cff). Corrections and questions are welcome via
[GitHub Issues](https://github.com/nikbaya/rg_browser/issues).

## Architecture

The 45MB source TSV is preprocessed once into compact binary matrices (~1.8MB each) plus
small JSON metadata, so the whole end-user payload is ~6MB.

- `scripts/build_data.py` — Python (numpy + scipy) build: parses the raw `.r2` file, builds
  symmetric `rg`/`se`/`-log10(p)` matrices, runs average-linkage hierarchical clustering for a
  shared leaf order, sources per-phenotype heritability from the dedicated
  [topline h2 results](https://github.com/astheeggeggs/UKBB_ldsc_r2/tree/master/h2_results)
  (liability scale for binary traits, observed otherwise), and emits artifacts to `public/data/`.
- `src/` — Vite + Preact + D3 app (`d3-hierarchy`, `d3-shape`, `d3-scale`, `d3-selection`).

## Develop

```bash
# one-time: build the data artifacts (requires numpy + scipy)
npm run build:data        # or: python3 scripts/build_data.py

npm install
npm run dev               # http://localhost:5173/rg_browser/ (next free port if taken)
npm run build && npm run preview
```

> Node is managed via nvm in this environment; run `nvm use --lts` first if `node` isn't found.

## Test

Data accuracy is covered by two suites, both gating deploys via CI:

```bash
pip install -r requirements-dev.txt
pytest          # data integrity + build logic + round-trip vs the raw source
npm test        # frontend accessors (data.js) and color encodings (color.js)
```

The **round-trip test** (`tests/test_roundtrip.py`) re-derives every published
`rg`/`se`/`-log10(p)` value from `data/raw/geno_correlation_sig.r2` and asserts exact
float32 equality — the definitive accuracy check. It runs locally after `npm run build:data`
and skips automatically when the raw source is absent (e.g. in CI, where `data/raw` is
gitignored); CI still runs all internal-invariant, referential-integrity, and build-logic tests.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and deploys to GitHub
Pages. The Vite `base` is `/rg_browser/` (override with `VITE_BASE=/` for a root deployment).
The built `public/data/*` artifacts are committed; the 45MB raw source under `data/raw/` is
gitignored.
