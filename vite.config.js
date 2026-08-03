import { defineConfig } from 'vite';

// base is set to the repo name so the built site works under GitHub Pages
// (https://kisa134.github.io/grimhold/). For local dev (`npm run dev`) Vite
// still serves from '/', which is fine.
export default defineConfig({
  base: '/grimhold/',
  server: {
    host: true,
    port: 7100,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
