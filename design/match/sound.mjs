// The demo match soundtrack: synthesized from scratch (no samples), timed from the same script as the picture.
//
//   node design/match/sound.mjs            writes design/match/out/match.wav (48 kHz stereo)
//   node design/match/sound.mjs --mux      also muxes it into site/public/media/angle1-3.mp4 (AAC), overview quieter
//
// Layers: a low ambience with sparse distant fire during rounds; a burst of shots before each elimination with a
// short kill-confirm tone; a bigger sting on the clutch; a countdown and start tone per round; a rising sweep and a
// chord on each objective capture; a falling two-tone at each round's end.

import { mkdirSync, writeFileSync, renameSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DURATION, ROUNDS, KILLS } from './script.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const site = (p) => fileURLToPath(new URL(`../../site/public/${p}`, import.meta.url));
const RATE = 48000;
const N = Math.ceil(DURATION * RATE);
const L = new Float32Array(N);
const R = new Float32Array(N);

// Deterministic randomness, so the soundtrack is the same on every run.
let seed = 0x5eed1;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => rand() * 2 - 1;

/** Add a mono signal fn(localTime) at time t0 for dur seconds, panned (-1 left … 1 right). */
function add(t0, dur, pan, fn) {
  const start = Math.max(0, Math.floor(t0 * RATE));
  const end = Math.min(N, Math.floor((t0 + dur) * RATE));
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = start; i < end; i++) {
    const v = fn(i / RATE - t0);
    L[i] += v * gl;
    R[i] += v * gr;
  }
}

/** One gunshot: a sharp noise crack, a low thump and a short filtered tail. */
function shot(t0, gain, pan) {
  let lp = 0;
  add(t0, 0.5, pan, (t) => {
    const crack = noise() * Math.exp(-t / 0.012);
    const thump = Math.sin(2 * Math.PI * (55 + 40 * Math.exp(-t / 0.02)) * t) * Math.exp(-t / 0.07);
    lp += 0.08 * (noise() - lp);
    const tail = lp * 4 * Math.exp(-t / 0.22);
    return gain * (0.9 * crack + 0.7 * thump + 0.35 * tail);
  });
}

/** A short sine blip with a soft attack. */
function tone(t0, freq, dur, gain, pan = 0, glide = 0) {
  add(t0, dur, pan, (t) => {
    const env = Math.min(1, t / 0.004) * Math.exp(-t / (dur * 0.45));
    const f = freq + glide * (t / dur);
    return gain * env * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t));
  });
}

// Ambience: brown noise, gently breathing, under everything.
{
  let brown = 0;
  let hp = 0;
  for (let i = 0; i < N; i++) {
    brown = 0.997 * brown + 0.03 * noise();
    hp = 0.995 * hp + 0.005 * brown;
    const t = i / RATE;
    const breathe = 0.75 + 0.25 * Math.sin(2 * Math.PI * t * 0.07);
    const v = (brown - hp) * 0.32 * breathe;
    L[i] += v;
    R[i] += v * 0.92 + noise() * 0.002;
  }
}

// Distant fire during rounds: sparse, quiet, panned wide.
for (const r of ROUNDS) {
  for (let t = r.start + 3 + rand() * 4; t < r.end - 2; t += 3.5 + rand() * 6) {
    const pan = rand() * 1.6 - 0.8;
    const n = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) shot(t + k * (0.11 + rand() * 0.05), 0.12 + rand() * 0.06, pan);
  }
}

// Eliminations: a burst that ends on the kill, return fire just before, then the confirm tone.
for (const k of KILLS) {
  const pan = rand() * 1.2 - 0.6;
  const shots = 3 + Math.floor(rand() * 2);
  for (let s = 0; s < shots; s++) shot(k.t - (shots - 1 - s) * 0.115, 0.55 + rand() * 0.15, pan);
  shot(k.t - 0.62, 0.3, -pan * 0.7);
  shot(k.t - 0.5, 0.28, -pan * 0.7);
  tone(k.t + 0.06, 880, 0.07, 0.11);
  tone(k.t + 0.13, 1320, 0.09, 0.1);
  if (k.clutch === 3) {
    for (const [f, d] of [[523.25, 0], [659.25, 0.05], [783.99, 0.1], [1046.5, 0.16]]) tone(k.t + 0.3 + d, f, 1.1, 0.09);
  }
}

// Rounds: countdown beeps into each start, a falling two-tone at each end.
for (const r of ROUNDS) {
  for (const d of [3, 2, 1]) if (r.start - d > 0) tone(r.start - d, 620, 0.12, 0.12);
  tone(Math.max(0.05, r.start), 1040, 0.35, 0.14);
  tone(r.end, 740, 0.25, 0.1);
  tone(r.end + 0.22, 494, 0.45, 0.1);
}

// Objective captures: a rising sweep into the capture, then a bright chord.
for (const r of ROUNDS) {
  if (!r.capture) continue;
  add(r.capture - 1.4, 1.4, 0, (t) => {
    const f = 280 + 640 * (t / 1.4) ** 2;
    return 0.07 * (t / 1.4) * Math.sin(2 * Math.PI * f * t);
  });
  for (const [f, d] of [[587.33, 0], [739.99, 0.04], [880, 0.08]]) tone(r.capture + d, f, 0.9, 0.08);
}

// Master: soft clip, normalise to -1 dBFS, 16-bit stereo WAV.
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.2);
  R[i] = Math.tanh(R[i] * 1.2);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.89 / (peak || 1);
const pcm = Buffer.alloc(44 + N * 4);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(36 + N * 4, 4);
pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(RATE, 24);
pcm.writeUInt32LE(RATE * 4, 28);
pcm.writeUInt16LE(4, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4);
}
mkdirSync(here('./out'), { recursive: true });
const wav = here('./out/match.wav');
writeFileSync(wav, pcm);
console.log(`wrote ${wav} (${DURATION}s, peak normalised)`);

if (process.argv.includes('--mux')) {
  const ffmpeg = process.env.FFMPEG ?? here('./node_modules/ffmpeg-static/ffmpeg.exe');
  for (const [n, volume] of [[1, 1], [2, 1], [3, 0.6]]) {
    const file = site(`media/angle${n}.mp4`);
    if (!existsSync(file)) {
      console.warn(`skipped angle${n}: not found`);
      continue;
    }
    const tmp = `${file}.audio.mp4`;
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', `volume=${volume}`, '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', tmp]);
    // On Windows a dev server may still hold the old file: retry, then copy over it.
    for (let i = 0; ; i++) {
      try {
        renameSync(tmp, file);
        break;
      } catch (error) {
        if (i < 10) {
          execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 400)']);
          continue;
        }
        copyFileSync(tmp, file);
        rmSync(tmp);
        break;
      }
    }
    console.log(`angle${n}: audio muxed${volume < 1 ? ' (quieter, map view)' : ''}`);
  }
}
