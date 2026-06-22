import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// `base` must match the GitHub Pages project path (https://<user>.github.io/rg_browser/).
// Override with VITE_BASE=/ for local-only or root deployments.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/rg_browser/',
  plugins: [preact()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0, // keep the .f32 binaries as separate fetchable files
  },
});
