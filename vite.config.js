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
  // FBXLoader pulls in fflate for compressed FBX blobs, but our Synty assets are
  // uncompressed and Vite can't bundle fflate into the prod build (it externalizes
  // it -> FBX parse throws -> box fallback). We patch FBXLoader (see
  // patches/three+*.patch, applied by patch-package on install) to drop the
  // fflate dependency entirely.
  optimizeDeps: {
    include: ['three'],
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
