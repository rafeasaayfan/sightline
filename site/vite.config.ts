import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// The public demo page. It imports the skin from ../src and builds to site/dist with relative URLs, so the folder
// works at a domain root, on Netlify, or in a shared-hosting subfolder.
export default defineConfig({
  root: path('.'),
  base: './',
  publicDir: path('./public'),
  resolve: {
    alias: { '@': path('../src') },
  },
  server: {
    port: 5191,
    fs: { allow: [path('..')] },
  },
  preview: {
    port: 4191,
  },
  build: {
    outDir: path('./dist'),
    emptyOutDir: true,
    // hls.js (for HLS angles) is large by nature.
    chunkSizeWarningLimit: 900,
  },
});
