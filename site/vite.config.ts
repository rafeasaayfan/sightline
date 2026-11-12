import { fileURLToPath, URL } from 'node:url';

import { readFileSync, rmSync } from 'node:fs';

import { defineConfig, type Plugin } from 'vite';

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// When every angle in match.json streams from Mux, the local MP4s in public/media are dead weight: leave them out of
// dist so the deploy stays small. Angles without a Mux playback ID keep their files.
function dropLocalMedia(): Plugin {
  return {
    name: 'sightline-drop-local-media',
    apply: 'build',
    closeBundle() {
      const match = JSON.parse(readFileSync(path('./public/match.json'), 'utf8')) as { angles: { mux?: string }[] };
      if (match.angles.every((a) => a.mux)) rmSync(path('./dist/media'), { recursive: true, force: true });
    },
  };
}

// The public demo page. It imports the skin from ../src and builds to site/dist with relative URLs, so the folder
// works at a domain root, on Netlify, or in a shared-hosting subfolder.
export default defineConfig({
  root: path('.'),
  base: './',
  publicDir: path('./public'),
  plugins: [dropLocalMedia()],
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
