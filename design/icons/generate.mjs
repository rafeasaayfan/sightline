// Draws the Sightline icon set and writes it to src/video/icons.ts.
//
//   node design/icons/generate.mjs
//
// One set on a 20px grid. Transport glyphs are solid shapes with softened corners (a round-joined stroke in the
// same colour); line glyphs use a 1.75px stroke with round caps and joins. Event glyphs (skull, flag, crown) are
// solid on a 16px grid, for the timeline markers and the kill feed.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A solid shape with rounded corners. */
const solid = (d, extra = '') =>
  `<path d="${d}" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"${extra}/>`;
/** A plain fill, for shapes with holes. */
const fill = (d) => `<path d="${d}" fill="currentColor" fill-rule="evenodd"/>`;
const line = (d, w = 1.75) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const svg = (body, size = 20) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;

/** A six-tooth cog as one filled outline with a round hole. */
function cog(cx, cy, outer, root, hole, teeth = 6, topHalf = 13, rootHalf = 21) {
  const n = (v) => String(Math.round(v * 100) / 100);
  const rad = (d) => (d * Math.PI) / 180;
  const at = (r, d) => `${n(cx + r * Math.cos(rad(d)))} ${n(cy + r * Math.sin(rad(d)))}`;
  let d = '';
  for (let k = 0; k < teeth; k++) {
    const c = -90 + (k * 360) / teeth;
    d += `${k ? 'L' : 'M'}${at(root, c - rootHalf)}L${at(outer, c - topHalf)}A${outer} ${outer} 0 0 1 ${at(outer, c + topHalf)}L${at(root, c + rootHalf)}A${root} ${root} 0 0 1 ${at(root, c + 360 / teeth - rootHalf)}`;
  }
  d += `ZM${n(cx + hole)} ${n(cy)}A${hole} ${hole} 0 1 0 ${n(cx - hole)} ${n(cy)}A${hole} ${hole} 0 1 0 ${n(cx + hole)} ${n(cy)}Z`;
  return fill(d);
}

const speaker = solid('M3.75 8h2.5l4-3.25v10.5l-4-3.25h-2.5Z');

const icons = {
  play: svg(solid('M7 4.75v10.5L15.75 10Z')),
  pause: svg(solid('M5.75 4.75h2.5v10.5h-2.5ZM11.75 4.75h2.5v10.5h-2.5Z')),
  restart: svg(line('M4.5 10a5.5 5.5 0 1 0 1.75-4') + solid('M4.25 3.75v3.5h3.5Z')),
  'highlight-prev': svg(solid('M15 5.25v9.5L8.5 10Z') + solid('M5 5h1.5v10H5Z')),
  'highlight-next': svg(solid('M5 5.25v9.5L11.5 10Z') + solid('M13.5 5H15v10h-1.5Z')),
  'volume-high': svg(speaker + line('M13.25 7.75a3.25 3.25 0 0 1 0 4.5M15.5 5.5a6.5 6.5 0 0 1 0 9')),
  'volume-low': svg(speaker + line('M13.25 7.75a3.25 3.25 0 0 1 0 4.5')),
  'volume-off': svg(speaker + line('M13 8l4 4M17 8l-4 4')),
  'captions-on': svg(
    fill('M4.5 4h11A2.5 2.5 0 0 1 18 6.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 2 13.5v-7A2.5 2.5 0 0 1 4.5 4ZM5.5 9.25h3.5v1.5H5.5ZM11 9.25h3.5v1.5H11ZM5.5 12h2v1.25h-2ZM9.5 12h5v1.25h-5Z'),
  ),
  'captions-off': svg(line('M4.5 4.75h11a1.75 1.75 0 0 1 1.75 1.75v7a1.75 1.75 0 0 1-1.75 1.75h-11A1.75 1.75 0 0 1 2.75 13.5v-7A1.75 1.75 0 0 1 4.5 4.75Z') + line('M6 10h3M11.5 10h2.5M6 12.75h1.5M10 12.75h4', 1.5)),
  gear: svg(cog(10, 10, 8, 6, 2.5)),
  'pip-enter': svg(line('M17.25 9V6A1.75 1.75 0 0 0 15.5 4.25h-11A1.75 1.75 0 0 0 2.75 6v8a1.75 1.75 0 0 0 1.75 1.75H8') + solid('M11 11.5h6v4h-6Z')),
  'pip-exit': svg(line('M17.25 9V6A1.75 1.75 0 0 0 15.5 4.25h-11A1.75 1.75 0 0 0 2.75 6v8a1.75 1.75 0 0 0 1.75 1.75H8') + line('M11.5 11.5l4.5 4M11.5 11.5v3M11.5 11.5h3')),
  'fullscreen-enter': svg(line('M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4')),
  'fullscreen-exit': svg(line('M7.5 3.5v4h-4M16.5 7.5h-4v-4M12.5 16.5v-4h4M3.5 12.5h4v4')),
  /** Multiview: the stage and two angles. */
  multiview: svg(line('M2.75 4.75h9v10.5h-9ZM14.25 4.75h3v4.25h-3ZM14.25 11h3v4.25h-3Z', 1.5)),
  'multiview-exit': svg(solid('M3.5 5.5h7.5v9h-7.5Z') + line('M14.25 4.75h3v4.25h-3ZM14.25 11h3v4.25h-3Z', 1.5)),
  /** Instant replay: a turn back with a play mark inside. */
  replay: svg(line('M4.25 10a5.75 5.75 0 1 0 1.9-4.25') + solid('M4 3.5v3.75h3.75Z') + solid('M9 7.75v4.5L12.5 10Z')),
  chevron: svg(line('M7.75 5.25 12.5 10l-4.75 4.75', 2)),
  keyboard: svg(line('M4 5h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 15H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 5Z') + fill('M5.5 8h1.75v1.75H5.5ZM9.1 8h1.75v1.75H9.1ZM12.75 8h1.75v1.75h-1.75ZM7 11.5h6v1.5H7Z')),
  /** Centre play: a solid glyph drawn on its own 24px grid. */
  'play-large': svg(solid('M8.5 5.5v13L18.75 12Z'), 24),
  /** Event glyphs on a 16px grid. */
  skull: svg(
    fill('M8 1.25c-3.6 0-6 2.35-6 5.5 0 1.85.85 3.2 2 4V13a1.25 1.25 0 0 0 1.25 1.25h5.5A1.25 1.25 0 0 0 12 13v-2.25c1.15-.8 2-2.15 2-4 0-3.15-2.4-5.5-6-5.5ZM5.6 5.6a1.65 1.65 0 1 1 0 3.3a1.65 1.65 0 1 1 0-3.3ZM10.4 5.6a1.65 1.65 0 1 1 0 3.3a1.65 1.65 0 1 1 0-3.3ZM8 9.4l1 1.6H7ZM6.6 12.1h.9v2.1h-.9ZM8.5 12.1h.9v2.1h-.9Z'),
    16,
  ),
  flag: svg(fill('M3 1.5h1.6v13H3ZM5.4 2.25h7.85l-1.9 3.25 1.9 3.25H5.4Z'), 16),
  crown: svg(fill('M1.75 4.5l3.4 2.6L8 2.25l2.85 4.85 3.4-2.6-1.15 7.25H2.9ZM2.9 12.85h10.2v1.4H2.9Z'), 16),
};

const body = Object.entries(icons)
  .map(([name, markup]) => `  '${name}':\n    '${markup}',`)
  .join('\n');
const out = `// Generated by design/icons/generate.mjs. Edit the generator, not this file.\n\n/** The Sightline icon set, registered under the \`sightline\` family. */\nexport const sightlineIcons: Record<string, string> = {\n${body}\n};\n`;

const target = fileURLToPath(new URL('../../src/video/icons.ts', import.meta.url));
writeFileSync(target, out);
console.log(`wrote ${Object.keys(icons).length} icons to ${target}`);
