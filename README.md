# Genetic Correlation Browser

An interactive, responsive browser of UK Biobank LDSC **genetic correlations** across 677
heritable phenotypes, built from the
[UKBB LDSC r²](https://github.com/astheeggeggs/UKBB_ldsc_r2) significant-correlation results.

**🔗 Live site: https://nikbaya.github.io/rg_browser/**

**💻 Local preview (dev server): [http://localhost:5173/rg_browser/](http://localhost:5173/rg_browser/)** — see [Develop](#develop) to start it.

Styled per the Broad Institute brand (not an official Broad product).

## Views

- **Global structure** — a radial hierarchical edge-bundling diagram of the strongest
  correlations (|rg| ≥ 0.5), bundled along a tree from clustering the full matrix.
- **Heatmap** — the clustered 677×677 correlation matrix rendered on a canvas.
- **Search & explore** — find a phenotype and browse its ranked top correlations.
- **Pairwise lookup** — full LDSC stats (rg, se, z, p, h²) for any two phenotypes.

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
