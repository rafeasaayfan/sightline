// Renders the demo match (script.mjs) at any moment, from three cameras. Pure function of time: every view of
// the same second shows the same match, which is what keeps the three angles in sync.
// Uses UNITS, ROUNDS, KILLS, DURATION from script.mjs (concatenated before this file by record.mjs).

const W = 1600;
const H = 900;
const COLORS = ['#38e1ff', '#ffb020'];
const GLOW = ['rgba(56,225,255,', 'rgba(255,176,32,'];
const ZONE = { x: 800, y: 450, r: 96 };

/* ------------------------------------------------------------------------------------------- Seeded noise */

function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967296;
}
const seeded = (a, b = 0, c = 0) => hash(Math.floor(a * 7919 + b * 104729 + c * 1299709));
const smooth = (x) => x * x * (3 - 2 * x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;

/* ------------------------------------------------------------------------------------------- Arena */

// Cover slabs, mirrored left/right, cut at the chip slant.
const COVER = (() => {
  const half = [
    [380, 170, 120, 46], [330, 450, 60, 150], [430, 730, 140, 46], [610, 300, 54, 120], [600, 640, 80, 44], [520, 85, 70, 36], [540, 820, 80, 36],
  ];
  const out = [];
  for (const [x, y, w, h] of half) {
    out.push({ x, y, w, h });
    out.push({ x: W - x, y: H - y, w, h });
  }
  out.push({ x: 800, y: 150, w: 70, h: 70 }, { x: 800, y: 750, w: 70, h: 70 });
  return out;
})();

// Soft terrain patches (lighter ground) for texture.
const PATCHES = Array.from({ length: 26 }, (_, i) => ({
  x: seeded(i, 1) * W,
  y: seeded(i, 2) * H,
  r: 90 + seeded(i, 3) * 220,
  a: 0.025 + seeded(i, 4) * 0.04,
}));

const SPAWN = [
  { x: 120, y: 450 },
  { x: 1480, y: 450 },
];

/* ------------------------------------------------------------------------------------------- Match state */

UNITS.forEach((u, i) => (u.index = i));
const unitById = Object.fromEntries(UNITS.map((u) => [u.id, u]));
const deathOf = (id, round) => KILLS.find((k) => k.on === id && k.t >= round.start && k.t <= round.end + 9);

function roundAt(t) {
  let r = ROUNDS[0];
  for (const x of ROUNDS) if (t >= x.start - 9) r = x;
  return r;
}

/** Where a unit is at time t, ignoring death (the path it would follow). */
function pathPos(u, r, t) {
  const side = u.team === 0 ? 1 : -1;
  const slot = UNITS.filter((x) => x.team === u.team).indexOf(UNITS.find((x) => x.id === u.id));
  const spawn = SPAWN[u.team];
  const e = Math.max(0, t - r.start);
  const lanes = [170, 450, 730, 330, 590];
  const lane = lanes[Math.floor(seeded(r.n, u.index, 9) * lanes.length)] + (seeded(r.n, u.index, 3) - 0.5) * 80;
  const engageX = 800 - side * (150 + seeded(r.n, u.index, 5) * 170);
  const startY = spawn.y + (slot - 1.5) * 46;
  const startX = spawn.x + (slot % 2) * side * 24;

  let x = lerp(startX, engageX, smooth(clamp(e / 15, 0, 1)));
  let y = lerp(startY, lane, smooth(clamp(e / 7, 0, 1)));
  // Late in the round, the fight pulls toward the middle.
  y = lerp(y, 450 + (lane - 450) * 0.45, smooth(clamp((e - 16) / 10, 0, 1)));
  // Life: a little drift so nobody stands still.
  x += Math.sin(t * 0.9 + u.index * 1.7) * 14 + Math.sin(t * 2.3 + u.index) * 5;
  y += Math.cos(t * 0.7 + u.index * 2.1) * 16 + Math.sin(t * 1.9 + u.index * 0.7) * 5;

  // Capturing team moves onto the objective in the last seconds before the capture.
  if (r.capture && u.team === r.winner) {
    const k = smooth(clamp((t - (r.capture - 8)) / 5, 0, 1));
    const ang = u.index * 1.9;
    x = lerp(x, ZONE.x + Math.cos(ang) * 42, k);
    y = lerp(y, ZONE.y + Math.sin(ang) * 42, k);
  }
  // The clutch: Player 1 pushes forward hunting the last three.
  if (r.n === 3 && u.id === 'a1') {
    const k = smooth(clamp((t - 104) / 8, 0, 1));
    x = lerp(x, 920 + Math.sin(t * 0.8) * 60, k);
    y = lerp(y, 420 + Math.cos(t * 0.6) * 120, k);
  }
  return { x, y };
}

function unitState(u, t) {
  const r = roundAt(t);
  const death = deathOf(u.id, r);
  const between = t < r.start;
  const tt = death && t > death.t ? death.t : t;
  const p = pathPos(u, r, tt);
  const a = pathPos(u, r, tt - 0.35);
  const b = pathPos(u, r, tt + 0.35);
  let heading = Math.atan2(b.y - a.y, b.x - a.x);
  if (Math.hypot(b.x - a.x, b.y - a.y) < 2) heading = u.team === 0 ? 0 : Math.PI;
  // Aim at the target around a shot.
  const shot = KILLS.find((k) => k.by === u.id && t > k.t - 1.4 && t < k.t + 0.25);
  if (shot) {
    const tp = pathPos(unitById[shot.on], r, Math.min(t, shot.t));
    heading = Math.atan2(tp.y - p.y, tp.x - p.x);
  }
  const fadeIn = clamp((t - (r.start - 2)) / 2, 0, 1);
  return { ...p, heading, alive: !(death && t >= death.t), deathT: death?.t, round: r, between, fadeIn };
}

/* ------------------------------------------------------------------------------------------- Drawing */

function slab(ctx, c) {
  const s = 10;
  ctx.beginPath();
  ctx.moveTo(c.x - c.w / 2 + s, c.y - c.h / 2);
  ctx.lineTo(c.x + c.w / 2, c.y - c.h / 2);
  ctx.lineTo(c.x + c.w / 2 - s, c.y + c.h / 2);
  ctx.lineTo(c.x - c.w / 2, c.y + c.h / 2);
  ctx.closePath();
}

function drawArena(ctx, t) {
  ctx.fillStyle = '#0a0e15';
  ctx.fillRect(-200, -200, W + 400, H + 400);
  for (const p of PATCHES) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    g.addColorStop(0, `rgba(120,150,190,${p.a})`);
    g.addColorStop(1, 'rgba(120,150,190,0)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
  }
  // Team bases: faint coloured halves.
  for (const team of [0, 1]) {
    const x = team === 0 ? 0 : W;
    const g = ctx.createRadialGradient(x, 450, 0, x, 450, 420);
    g.addColorStop(0, GLOW[team] + '0.10)');
    g.addColorStop(1, GLOW[team] + '0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 420, 30, 840, 840);
  }
  // Arena boundary.
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, W - 40, H - 40);
  // Mid line.
  ctx.setLineDash([10, 16]);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(800, 30);
  ctx.lineTo(800, H - 30);
  ctx.stroke();
  ctx.setLineDash([]);
  // Cover slabs with a lit top edge.
  for (const c of COVER) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    slab(ctx, c);
    ctx.fillStyle = '#18202d';
    ctx.fill();
    ctx.restore();
    slab(ctx, c);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  drawZone(ctx, t);
}

function drawZone(ctx, t) {
  const r = roundAt(t);
  ctx.save();
  ctx.translate(ZONE.x, ZONE.y);
  // Pulse.
  const pulse = (t * 0.6) % 1;
  ctx.strokeStyle = `rgba(255,255,255,${0.18 * (1 - pulse)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, ZONE.r + pulse * 40, 0, Math.PI * 2);
  ctx.stroke();
  // Ring with rotating dashes.
  ctx.rotate(t * 0.25);
  ctx.setLineDash([14, 10]);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, ZONE.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.rotate(-t * 0.25);
  // Capture progress in the capturing team's colour.
  if (r.capture) {
    const k = clamp((t - (r.capture - 5)) / 5, 0, 1);
    if (k > 0 && t < r.end + 0.5) {
      ctx.fillStyle = GLOW[r.winner] + `${0.06 + 0.1 * k})`;
      ctx.beginPath();
      ctx.arc(0, 0, ZONE.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS[r.winner];
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, ZONE.r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      ctx.stroke();
    }
    const flash = clamp(1 - (t - r.capture) / 1.2, 0, 1);
    if (t >= r.capture && flash > 0) {
      ctx.strokeStyle = GLOW[r.winner] + `${flash})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, ZONE.r + (1 - flash) * 120, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Centre emblem: a small diamond.
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-7, -7, 14, 14);
  ctx.restore();
}

function drawUnit(ctx, u, s, t, highlight) {
  const color = COLORS[u.team];
  const alpha = s.fadeIn;
  if (!s.alive) {
    const since = t - s.deathT;
    // Death marker: an X that fades to a faint ghost.
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.globalAlpha = alpha * Math.max(0.22, 1 - since / 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-8, -8); ctx.lineTo(8, 8); ctx.moveTo(8, -8); ctx.lineTo(-8, 8);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // Trail.
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  for (let i = 1; i <= 12; i++) {
    const a = pathPos(u, s.round, t - i * 0.12);
    const b = pathPos(u, s.round, t - (i - 1) * 0.12);
    if (t - i * 0.12 < s.round.start) break;
    ctx.strokeStyle = GLOW[u.team] + `${0.28 * (1 - i / 12)})`;
    ctx.lineWidth = 6 * (1 - i / 14);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.translate(s.x, s.y);
  if (highlight) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.rotate(s.heading);
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(-12, -14);
  ctx.lineTo(-5, 0);
  ctx.lineTo(-12, 14);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(2, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawShots(ctx, t) {
  const r = roundAt(t);
  // Ambient fire: misses between nearby enemies, a few per second, from a deterministic schedule.
  const slot = Math.floor(t * 3);
  for (let j = 0; j < 2; j++) {
    const k = seeded(slot, j, 11);
    if (k > 0.55) continue;
    const ui = Math.floor(seeded(slot, j, 12) * 8);
    const shooter = UNITS[ui];
    const ss = unitState(shooter, t);
    if (!ss.alive || ss.between || t < r.start + 4) continue;
    const enemies = UNITS.filter((x) => x.team !== shooter.team).map((x) => ({ x, s: unitState(x, t) })).filter((e) => e.s.alive);
    if (!enemies.length) continue;
    enemies.sort((a, b) => Math.hypot(a.s.x - ss.x, a.s.y - ss.y) - Math.hypot(b.s.x - ss.x, b.s.y - ss.y));
    const tgt = enemies[0].s;
    if (Math.hypot(tgt.x - ss.x, tgt.y - ss.y) > 640) continue;
    const phase = t * 3 - slot;
    if (phase > 0.35) continue;
    const miss = (seeded(slot, j, 13) - 0.5) * 70;
    tracer(ctx, ss, { x: tgt.x + miss, y: tgt.y - miss * 0.6 }, COLORS[shooter.team], 1 - phase / 0.35, 0.45);
  }
  // Scripted eliminations: a bright tracer, then a burst.
  for (const k of KILLS) {
    const by = unitById[k.by];
    const on = unitById[k.on];
    if (t > k.t - 0.18 && t < k.t + 0.05) {
      const a = unitState(by, t);
      const b = pathPos(on, roundAt(k.t), k.t);
      tracer(ctx, a, b, COLORS[by.team], 1, 1);
    }
    const since = t - k.t;
    if (since >= 0 && since < 0.9) {
      const b = pathPos(on, roundAt(k.t), k.t);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.strokeStyle = GLOW[by.team] + `${1 - since / 0.9})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 10 + since * 90, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + k.t;
        const d = 12 + since * 70;
        ctx.fillStyle = `rgba(255,255,255,${1 - since / 0.9})`;
        ctx.fillRect(Math.cos(ang) * d - 2, Math.sin(ang) * d - 2, 4, 4);
      }
      ctx.restore();
    }
  }
}

function tracer(ctx, a, b, color, strength, width) {
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.lineWidth = 3 * width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x + Math.cos(a.heading) * 20, a.y + Math.sin(a.heading) * 20);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(a.x + Math.cos(a.heading) * 22, a.y + Math.sin(a.heading) * 22, 5 * width, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWorld(ctx, t, focusId) {
  drawArena(ctx, t);
  drawShots(ctx, t);
  for (const u of UNITS) drawUnit(ctx, u, unitState(u, t), t, u.id === focusId);
}

/* ------------------------------------------------------------------------------------------- Cameras */

function vignette(ctx, w, h, strength) {
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function roundFade(ctx, t, w, h) {
  // Between rounds the picture dips to dark and comes back.
  const r = roundAt(t);
  let k = 0;
  if (t > r.end) k = clamp((t - r.end) / 2.5, 0, 1);
  if (t < r.start) k = clamp((r.start - t) / 2, 0, 1);
  if (k > 0) {
    ctx.fillStyle = `rgba(5,7,11,${k * 0.7})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Map overview: the whole arena. */
function drawOverview(ctx, t, w, h) {
  ctx.save();
  const s = Math.min(w / W, h / H);
  ctx.translate((w - W * s) / 2, (h - H * s) / 2);
  ctx.scale(s, s);
  drawWorld(ctx, t, null);
  ctx.restore();
  vignette(ctx, w, h, 0.45);
  roundFade(ctx, t, w, h);
}

/** A player's point of view: the camera rides behind them, rotated to their heading, with fog beyond sight. */
function drawPov(ctx, t, w, h, id) {
  const me = UNITS.find((u) => u.id === id);
  let followId = id;
  let s = unitState(me, t);
  // When the player is down, spectate the nearest living teammate.
  if (!s.alive && t - s.deathT > 1.5) {
    const mates = UNITS.filter((u) => u.team === me.team && u.id !== id).map((u) => ({ u, s: unitState(u, t) })).filter((m) => m.s.alive);
    if (mates.length) {
      mates.sort((a, b) => Math.hypot(a.s.x - s.x, a.s.y - s.y) - Math.hypot(b.s.x - s.x, b.s.y - s.y));
      followId = mates[0].u.id;
      s = mates[0].s;
    }
  }
  // Camera heading: smoothed over a second so the view turns calmly.
  let hx = 0, hy = 0;
  const fu = UNITS.find((u) => u.id === followId);
  for (let i = -4; i <= 4; i++) {
    const q = unitState(fu, t + i * 0.12);
    hx += Math.cos(q.heading);
    hy += Math.sin(q.heading);
  }
  const camHeading = Math.atan2(hy, hx);
  const zoom = 1.75;
  ctx.save();
  ctx.translate(w / 2, h * 0.62);
  ctx.rotate(-camHeading - Math.PI / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-s.x, -s.y);
  drawWorld(ctx, t, followId);
  ctx.restore();
  // Fog of war beyond sight, and a soft vision cone ahead.
  const cx = w / 2, cy = h * 0.62;
  const fog = ctx.createRadialGradient(cx, cy, h * 0.28, cx, cy, h * 0.85);
  fog.addColorStop(0, 'rgba(4,6,10,0)');
  fog.addColorStop(1, 'rgba(4,6,10,0.82)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, w, h);
  const cone = ctx.createRadialGradient(cx, cy, 10, cx, cy - h * 0.3, h * 0.7);
  cone.addColorStop(0, 'rgba(255,255,255,0.05)');
  cone.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, h, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
  ctx.closePath();
  ctx.fill();
  vignette(ctx, w, h, 0.35);
  roundFade(ctx, t, w, h);
}

/** Draw one camera into a 2D context. view: 'overview' | 'p1' | 'p2'. */
function drawView(ctx, view, t, w, h) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (view === 'overview') drawOverview(ctx, t, w, h);
  else drawPov(ctx, t, w, h, view === 'p1' ? 'a1' : 'e1');
}
