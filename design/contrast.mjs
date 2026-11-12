// Measures Vantage contrast over the worst footage: a white frame and a black frame behind every translucent surface.
//
//   node design/contrast.mjs        table
//   node design/contrast.mjs --md   Markdown (design/contrast.md)
//
// Text needs 4.5:1 (WCAG 1.4.3); icons, slider parts, markers and focus rings need 3:1 (WCAG 1.4.11).

const GROUND = [10, 13, 18];
const SURFACE = [18, 22, 29];
const TEXT = [243, 245, 248];
const MUTED = [167, 175, 189];
const SIGNAL = [56, 225, 255];
const EVENT = [255, 176, 32];
const ROUND = [255, 77, 94];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

const over = (top, a, bottom) => top.map((c, i) => c * a + bottom[i] * (1 - a));
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// The band scrim is ground at 96% under the buttons and 82% at the top of the time row.
const bandLow = (f) => over(GROUND, 0.96, f);
const bandHigh = (f) => over(GROUND, 0.82, f);
const chip = (f) => over(SURFACE, 0.86, f);
const tileChip = (f) => over(SURFACE, 0.9, f);
const solid = () => SURFACE;
const track = (f) => over(WHITE, 0.4, bandHigh(f));

const rows = [
  ['Clock (text) on the band, top of the time row', () => TEXT, bandHigh, 4.5],
  ['Duration (muted) on the band, top of the time row', () => MUTED, bandHigh, 4.5],
  ['Key hints (muted) on the band', () => MUTED, bandLow, 4.5],
  ['HUD chip text on its 86% chip', () => TEXT, chip, 4.5],
  ['HUD sync label (muted) on its chip', () => MUTED, chip, 4.5],
  ['Team name (signal) on its chip', () => SIGNAL, chip, 4.5],
  ['Team name (amber) on its chip', () => EVENT, chip, 4.5],
  ['Angle chip: ink on signal', () => GROUND, () => SIGNAL, 4.5],
  ['Tile label on its 90% chip', () => TEXT, tileChip, 4.5],
  ['Toast text on its 92% surface', () => TEXT, (f) => over(SURFACE, 0.92, f), 4.5],
  ['Menu and tooltip text on surface', () => TEXT, solid, 4.5],
  ['Menu hint (muted) on surface', () => MUTED, solid, 4.5],
  ['Marker tooltip: ink on white card', () => GROUND, () => TEXT, 4.5],
  ['Icons on the band', () => TEXT, bandLow, 3],
  ['Timeline track (white 40%) on the band', track, bandHigh, 3],
  ['Played vs unplayed (the white thumb marks the boundary)', () => SIGNAL, track, 1],
  ['Thumb (white) on the played range', () => TEXT, () => SIGNAL, 1],
  ['Thumb (white) on the band', () => TEXT, bandHigh, 3],
  ['Highlight marker (amber) on the band', () => EVENT, bandHigh, 3],
  ['Objective marker (signal) on the band', () => SIGNAL, bandHigh, 3],
  ['Round marker (red) on the band', () => ROUND, bandHigh, 3],
  ['Focus ring (signal) on the band', () => SIGNAL, bandLow, 3],
  ['Focus ring (signal) on its dark halo over video', () => SIGNAL, () => GROUND, 3],
];

const out = rows.map(([name, fg, bg, need]) => {
  const w = ratio(fg(WHITE), bg(WHITE));
  const b = ratio(fg(BLACK), bg(BLACK));
  return { name, w, b, need, pass: need === 1 || Math.min(w, b) >= need };
});

if (process.argv.includes('--md')) {
  console.log('| Pair | Over white frame | Over black frame | Needs | Result |\n| --- | --- | --- | --- | --- |');
  for (const r of out)
    console.log(`| ${r.name} | ${r.w.toFixed(2)}:1 | ${r.b.toFixed(2)}:1 | ${r.need === 1 ? 'shape cue' : `${r.need}:1`} | ${r.need === 1 ? 'Boundary carried by the thumb and halo' : r.pass ? 'Pass' : '**Fail**'} |`);
} else {
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${Math.min(r.w, r.b).toFixed(2).padStart(5)}:1  needs ${r.need}  ${r.name}`);
}
process.exitCode = out.every((r) => r.pass) ? 0 : 1;
