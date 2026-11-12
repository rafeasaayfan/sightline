// Records the demo match from three cameras and writes its events and scoreboard.
//
//   node design/match/record.mjs --preview 12,60,110     stills of each camera at those seconds
//   node design/match/record.mjs                         full recording into site/public/media/
//
//   node design/match/record.mjs --views p1              one camera per run (steadier frame rate)
//
// Needs Google Chrome, playwright-core and ffmpeg (dev tools, not site dependencies):
//   npm i --no-save playwright-core ffmpeg-static
//   set FFMPEG to the ffmpeg binary, for example: FFMPEG="$(node -p "require('ffmpeg-static')")"
// The three MP4s are what you upload to Mux; events.vtt and the scoreboard in match.json come from the same script.

import { readFileSync, writeFileSync, mkdirSync, createWriteStream, renameSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { DURATION, eventsVtt, scoreboard } from './script.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const site = (p) => here(`../../site/public/${p}`);
const W = 1280;
const H = 720;
const FILES = { p1: 'angle1', p2: 'angle2', overview: 'angle3' };
const viewArg = process.argv.indexOf('--views');
const VIEWS = viewArg > 0 ? process.argv[viewArg + 1].split(',') : ['p1', 'p2', 'overview'];

const strip = (src) => src.replace(/^export /gm, '').replace(/^import .*$/gm, '');
const code = strip(readFileSync(here('./script.mjs'), 'utf8')) + '\n' + readFileSync(here('./sim.js'), 'utf8');

const args = process.argv.slice(2);
const previewAt = args[0] === '--preview' ? (args[1] ?? '12,60,110').split(',').map(Number) : null;

const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: W, height: H * VIEWS.length } });
await page.setContent(
  `<body style="margin:0;background:#000">${VIEWS.map((v) => `<canvas id="${v}" width="${W}" height="${H}" style="display:block"></canvas>`).join('')}</body>`,
);
await page.addScriptTag({ content: code });

if (previewAt) {
  const out = here('../../../preview');
  mkdirSync(out, { recursive: true });
  for (const t of previewAt) {
    await page.evaluate(({ t, views, w, h }) => { for (const v of views) drawView(document.getElementById(v).getContext('2d'), v, t, w, h); }, { t, views: VIEWS, w: W, h: H });
    for (const v of VIEWS) await page.locator(`#${v}`).screenshot({ path: `${out}/match-${v}-${t}.png` });
  }
  console.log(`previews in ${out}`);
  await browser.close();
  process.exit(0);
}

// Full recording: all three cameras at once, in real time, H.264 MP4.
mkdirSync(site('media'), { recursive: true });
const streams = Object.fromEntries(VIEWS.map((v) => [v, createWriteStream(site(`media/${{ p1: 'angle1', p2: 'angle2', overview: 'angle3' }[v]}.mp4`))]));
await page.exposeFunction('chunk', (view, b64) => streams[view].write(Buffer.from(b64, 'base64')));
console.log(`recording ${DURATION}s in real time…`);
await page.evaluate(
  ({ views, w, h, duration }) =>
    new Promise((resolve) => {
      const ctxs = Object.fromEntries(views.map((v) => [v, document.getElementById(v).getContext('2d')]));
      const recorders = views.map((v) => {
        const rec = new MediaRecorder(document.getElementById(v).captureStream(30), { mimeType: 'video/mp4;codecs=avc1.640028', videoBitsPerSecond: 2_400_000 });
        rec.ondataavailable = async (e) => {
          const buf = new Uint8Array(await e.data.arrayBuffer());
          let s = '';
          for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          await window.chunk(v, btoa(s));
        };
        return rec;
      });
      let done = 0;
      for (const r of recorders) r.onstop = () => setTimeout(() => ++done === recorders.length && resolve(), 1500);
      const t0 = performance.now();
      for (const r of recorders) r.start(1000);
      const frame = () => {
        const t = (performance.now() - t0) / 1000;
        for (const v of views) drawView(ctxs[v], v, Math.min(t, duration), w, h);
        if (t < duration) requestAnimationFrame(frame);
        else for (const r of recorders) r.stop();
      };
      requestAnimationFrame(frame);
    }),
  { views: VIEWS, w: W, h: H, duration: DURATION },
);
await new Promise((r) => setTimeout(r, 1500));
for (const s of Object.values(streams)) s.end();
await browser.close();

// MediaRecorder writes fragmented MP4: remux to a regular MP4 with its index up front so it seeks (no re-encode).
for (const v of VIEWS) {
  const file = site(`media/${FILES[v]}.mp4`);
  if (!process.env.FFMPEG) {
    console.warn('Set FFMPEG to an ffmpeg binary to make the MP4s seekable.');
    break;
  }
  execFileSync(process.env.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-c', 'copy', '-movflags', '+faststart', `${file}.tmp.mp4`]);
  // On Windows the dev server or a browser may still hold the old file: retry, then copy over it.
  for (let i = 0; ; i++) {
    try {
      renameSync(`${file}.tmp.mp4`, file);
      break;
    } catch (e) {
      if (i < 10) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      copyFileSync(`${file}.tmp.mp4`, file);
      rmSync(`${file}.tmp.mp4`);
      break;
    }
  }
}

writeFileSync(site('events.vtt'), eventsVtt());
const match = JSON.parse(readFileSync(site('match.json'), 'utf8'));
match.scoreboard = scoreboard();
writeFileSync(site('match.json'), JSON.stringify(match, null, 2) + '\n');
console.log('wrote media/angle1-3.mp4, events.vtt and the scoreboard');
