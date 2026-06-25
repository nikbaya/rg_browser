# Genetic Correlation Browser

An interactive, responsive browser of UK Biobank LDSC **genetic correlations** across 677
heritable phenotypes, built from the
[UKBB LDSC r²](https://github.com/astheeggeggs/UKBB_ldsc_r2) significant-correlation results.

**🔗 Live site: https://nikbaya.github.io/rg_browser/**

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
  shared leaf order, and emits artifacts to `public/data/`.
- `src/` — Vite + Preact + D3 app (`d3-hierarchy`, `d3-shape`, `d3-scale`, `d3-selection`).

## Develop

```bash
# one-time: build the data artifacts (requires numpy + scipy)
npm run build:data        # or: python3 scripts/build_data.py

npm install
npm run dev               # http://localhost:5173/rg_browser/
npm run build && npm run preview
```

> Node is managed via nvm in this environment; run `nvm use --lts` first if `node` isn't found.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and deploys to GitHub
Pages. The Vite `base` is `/rg_browser/` (override with `VITE_BASE=/` for a root deployment).
The built `public/data/*` artifacts are committed; the 45MB raw source under `data/raw/` is
gitignored.
