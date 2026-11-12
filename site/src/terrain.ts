/*
 * The page background: a topographic map, like the recon sheet on a briefing table. Contour lines of a noise field,
 * drawn once into a fixed canvas (and again only when the width changes). Every fourth line is an index contour,
 * a little brighter, as on a real survey map. Nothing animates; the sheet drifts slightly with the scroll.
 */

const STEP = 11; // grid cell in CSS pixels
const LEVELS = 22;

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  const u = s(xf);
  const v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function field(x: number, y: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < 4; o++) {
    sum += noise(x * freq, y * freq) * amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

function draw(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cols = Math.ceil(w / STEP) + 1;
  const rows = Math.ceil(h / STEP) + 1;
  const scale = 1 / 260; // map units per pixel: broad, slow hills
  const grid = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = field(i * STEP * scale + 7.3, j * STEP * scale + 2.1);
      grid[j * cols + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  ctx.lineJoin = 'round';
  for (let l = 1; l < LEVELS; l++) {
    const iso = min + ((max - min) * l) / LEVELS;
    const index = l % 4 === 0;
    ctx.beginPath();
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = grid[j * cols + i]!;
        const b = grid[j * cols + i + 1]!;
        const c = grid[(j + 1) * cols + i + 1]!;
        const d = grid[(j + 1) * cols + i]!;
        const code = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const x = i * STEP;
        const y = j * STEP;
        const t = (p: number, q: number) => (iso - p) / (q - p);
        const top = () => [x + STEP * t(a, b), y] as const;
        const right = () => [x + STEP, y + STEP * t(b, c)] as const;
        const bottom = () => [x + STEP * t(d, c), y + STEP] as const;
        const left = () => [x, y + STEP * t(a, d)] as const;
        const seg = (p: readonly [number, number], q: readonly [number, number]) => {
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
        };
        switch (code) {
          case 1: case 14: seg(left(), bottom()); break;
          case 2: case 13: seg(bottom(), right()); break;
          case 3: case 12: seg(left(), right()); break;
          case 4: case 11: seg(top(), right()); break;
          case 6: case 9: seg(top(), bottom()); break;
          case 7: case 8: seg(left(), top()); break;
          case 5: seg(left(), top()); seg(bottom(), right()); break;
          case 10: seg(top(), right()); seg(left(), bottom()); break;
        }
      }
    }
    ctx.strokeStyle = index ? 'rgb(255 255 255 / 0.085)' : 'rgb(255 255 255 / 0.04)';
    ctx.lineWidth = index ? 1.1 : 0.8;
    ctx.stroke();
  }
  // The fade toward the edges is baked into the pixels once (not a CSS mask, which costs a GPU pass every frame
  // while video plays).
  const fade = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, Math.max(w, h) * 0.95);
  fade.addColorStop(0, 'rgb(0 0 0 / 1)');
  fade.addColorStop(0.45, 'rgb(0 0 0 / 1)');
  fade.addColorStop(0.8, 'rgb(0 0 0 / 0.35)');
  fade.addColorStop(1, 'rgb(0 0 0 / 0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  canvas.dataset.ready = '';
}

export function startTerrain(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-terrain]');
  if (!canvas) return;
  let width = 0;
  const redraw = () => {
    if (canvas.clientWidth === width) return;
    width = canvas.clientWidth;
    draw(canvas);
  };
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1));
  idle(redraw);
  let timer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(redraw, 200);
  });

  // A slight drift with the scroll, so the sheet feels like a surface under the page.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let queued = false;
    window.addEventListener(
      'scroll',
      () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          canvas.style.translate = `0 ${-Math.min(scrollY * 0.04, innerHeight * 0.25)}px`;
        });
      },
      { passive: true },
    );
  }
}
