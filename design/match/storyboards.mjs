// Seek-bar thumbnails and posters for the local demo angles.
//
//   FFMPEG=path/to/ffmpeg node design/match/storyboards.mjs
//
// For each site/public/media/angleN.mp4 it writes:
//   site/public/storyboards/angleN.jpg   a sprite of 160×90 frames, one every STEP seconds
//   site/public/storyboards/angleN.vtt   WebVTT cues pointing at each frame (#xywh), the format Video.js reads
//   site/public/posters/angleN.jpg       a 640×360 poster at POSTER_AT seconds
// and site/public/poster.jpg (the stage poster, 1280×720) from angle 1.
// Angles hosted on Mux don't need these: Mux serves its own storyboard at image.mux.com/<id>/storyboard.vtt.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DURATION } from './script.mjs';

const ffmpeg = process.env.FFMPEG ?? fileURLToPath(new URL('./node_modules/ffmpeg-static/ffmpeg.exe', import.meta.url));
const site = (p) => fileURLToPath(new URL(`../../site/public/${p}`, import.meta.url));
const STEP = 2;
const W = 160;
const H = 90;
const COLS = 10;
const POSTER_AT = 2;

const stamp = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(3).padStart(6, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`;
};

const run = (args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

mkdirSync(site('storyboards'), { recursive: true });
mkdirSync(site('posters'), { recursive: true });

const frames = Math.ceil(DURATION / STEP);
const rows = Math.ceil(frames / COLS);

for (const n of [1, 2, 3]) {
  const src = site(`media/angle${n}.mp4`);
  if (!existsSync(src)) {
    console.warn(`skipped angle${n}: ${src} not found`);
    continue;
  }
  run(['-i', src, '-vf', `fps=1/${STEP},scale=${W}:${H},tile=${COLS}x${rows}`, '-frames:v', '1', '-q:v', '5', site(`storyboards/angle${n}.jpg`)]);
  let vtt = 'WEBVTT\n';
  for (let i = 0; i < frames; i++) {
    const x = (i % COLS) * W;
    const y = Math.floor(i / COLS) * H;
    vtt += `\n${stamp(i * STEP)} --> ${stamp(Math.min(DURATION, (i + 1) * STEP))}\nangle${n}.jpg#xywh=${x},${y},${W},${H}\n`;
  }
  writeFileSync(site(`storyboards/angle${n}.vtt`), vtt);
  run(['-ss', String(POSTER_AT), '-i', src, '-frames:v', '1', '-vf', 'scale=640:360', '-q:v', '4', site(`posters/angle${n}.jpg`)]);
  if (n === 1) run(['-ss', String(POSTER_AT), '-i', src, '-frames:v', '1', '-q:v', '3', site('poster.jpg')]);
  console.log(`angle${n}: storyboard (${frames} frames), poster`);
}
