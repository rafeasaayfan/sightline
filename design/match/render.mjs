// Renders the demo match footage deterministically: every frame is drawn at t = frame / 60 by sim.js in headless
// Chrome, grabbed as a JPEG and piped into ffmpeg (H.264, 60 fps). No real-time capture, so no dropped frames.
//
//   node design/match/render.mjs                          all three cameras into site/public/media/angle1-3.mp4
//   node design/match/render.mjs --views p1               one camera (p1 = angle1, p2 = angle2, overview = angle3)
//   node design/match/render.mjs --preview 11,49,109      PNG stills of each camera into ../preview/ (repo parent)
//   node design/match/render.mjs --clip 105,120 --out x.mp4 --views p1   a short test clip of one camera
//
// Needs Google Chrome plus the dev-only packages in design/match/node_modules:
//   cd design/match && npm i --no-save playwright-core ffmpeg-static
// ffmpeg comes from ffmpeg-static (override with FFMPEG=/path/to/ffmpeg).
// The match data (and so events.vtt and the scoreboard) lives in script.mjs; record.mjs writes those two files.

import { readFileSync, mkdirSync, renameSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { DURATION } from './script.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const site = (p) => here(`../../site/public/${p}`);
const require = createRequire(import.meta.url);
const FFMPEG = process.env.FFMPEG || require('ffmpeg-static');
const W = 1280;
const H = 720;
const FPS = 60;
const BATCH = 24;
const FILES = { p1: 'angle1', p2: 'angle2', overview: 'angle3' };

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const VIEWS = opt('--views', 'p1,p2,overview').split(',');
const previewAt = args.includes('--preview') ? opt('--preview', '11,49,109').split(',').map(Number) : null;
const clip = args.includes('--clip') ? opt('--clip').split(',').map(Number) : null;

const strip = (src) => src.replace(/^export /gm, '').replace(/^import .*$/gm, '');
const code = strip(readFileSync(here('./script.mjs'), 'utf8')) + '\n' + readFileSync(here('./sim.js'), 'utf8');

const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<body style="margin:0;background:#000"><canvas id="c" width="${W}" height="${H}"></canvas></body>`);
await page.addScriptTag({ content: code });

if (previewAt) {
  const out = here('../../../preview');
  mkdirSync(out, { recursive: true });
  for (const t of previewAt) {
    for (const v of VIEWS) {
      const b64 = await page.evaluate(({ v, t, w, h }) => {
        const c = document.getElementById('c');
        drawView(c.getContext('2d'), v, t, w, h);
        return c.toDataURL('image/png').split(',')[1];
      }, { v, t, w: W, h: H });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${out}/render-${v}-${t}.png`, Buffer.from(b64, 'base64'));
    }
  }
  console.log(`previews in ${out}`);
  await browser.close();
  process.exit(0);
}

async function renderView(view, from, to, file) {
  const first = Math.round(from * FPS);
  const last = Math.round(to * FPS); // exclusive
  const tmp = `${file}.tmp.mp4`;
  const ff = spawn(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-r', String(FPS), '-movflags', '+faststart', '-an', tmp,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));
  const t0 = Date.now();
  for (let f = first; f < last; f += BATCH) {
    const n = Math.min(BATCH, last - f);
    const frames = await page.evaluate(({ view, f, n, w, h, fps }) => {
      const c = document.getElementById('c');
      const ctx = c.getContext('2d');
      const out = [];
      for (let i = 0; i < n; i++) {
        drawView(ctx, view, (f + i) / fps, w, h);
        out.push(c.toDataURL('image/jpeg', 0.92).split(',')[1]);
      }
      return out;
    }, { view, f, n, w: W, h: H, fps: FPS });
    for (const b64 of frames) await write(Buffer.from(b64, 'base64'));
    const doneN = f + n - first;
    if (Math.floor(doneN / 600) !== Math.floor((doneN - n) / 600) || f + n >= last) {
      const s = (Date.now() - t0) / 1000;
      process.stdout.write(`  ${view}: ${doneN}/${last - first} frames, ${(doneN / s).toFixed(1)} fps\n`);
    }
  }
  ff.stdin.end();
  await done;
  // On Windows the dev server or a browser may still hold the old file: retry, then copy over it.
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, file);
      break;
    } catch (e) {
      if (i < 10) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      copyFileSync(tmp, file);
      rmSync(tmp);
      break;
    }
  }
  console.log(`wrote ${file} (${(statSync(file).size / 1e6).toFixed(1)} MB)`);
}

if (clip) {
  await renderView(VIEWS[0], clip[0], clip[1], opt('--out', here(`../../../preview/clip-${VIEWS[0]}.mp4`)));
} else {
  mkdirSync(site('media'), { recursive: true });
  for (const v of VIEWS) await renderView(v, 0, DURATION, site(`media/${FILES[v]}.mp4`));
}
await browser.close();
