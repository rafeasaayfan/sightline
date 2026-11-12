// Renders the demo match (script.mjs) at any moment, from three cameras. Pure function of time: every view of
// the same second shows the same match, which is what keeps the three angles in sync.
// Uses UNITS, ROUNDS, KILLS, DURATION from script.mjs (concatenated before this file by render.mjs / record.mjs).
//
// Everything here is visual: the map geometry, the movement tracks and the ambient gunfire are invented for the
// footage. The match facts (who kills whom, when, and the objective captures) come only from script.mjs, and each
// elimination is drawn exactly at its time: the shooter's last round lands and the target goes down at KILLS[i].t.
//
// Movement: each unit follows keyframes per round; the piecewise-linear path is convolved with a triangle filter
// (closed form, via its second antiderivative), so positions and velocities are smooth with no teleports.
// Cameras: overview = whole map; p1/p2 = a follow camera behind that player, eased over a past window, with a
// line-of-sight fog. When the player is down the camera glides to a living teammate until the round restarts.

const W = 1600;
const H = 900;
const TAU = Math.PI * 2;
const TEAM = [[56, 225, 255], [255, 176, 32]];
const RED = [255, 77, 94];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const FONT = '"Segoe UI", "Inter", system-ui, sans-serif';

/* ------------------------------------------------------------------------------------------- Helpers */

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
const ease = (x) => smooth(clamp(x, 0, 1));
const angDiff = (a, b) => ((((b - a) % TAU) + TAU * 1.5) % TAU) - Math.PI;
const angLerp = (a, b, k) => a + angDiff(a, b) * k;

/* ------------------------------------------------------------------------------------------- Map */

// Walls are tall (block sight and are drawn with height). Left half is authored; the right half is the same
// layout turned 180 degrees about the centre, so both sides are fair.
const mirrorRect = ([x, y, w, h]) => [W - x - w, H - y - h, w, h];
const HALF_WALLS = [
  [250, 40, 26, 230], // spawn wall north
  [250, 630, 26, 230], // spawn wall south
  [400, 296, 240, 26], // north lane divider
  [400, 578, 240, 26], // south lane divider
  [540, 110, 26, 110], // north lane pillar
  [470, 690, 26, 100], // south lane pillar
  [664, 40, 24, 82], // A site west stub
];
const EDGE = 40;
const WALLS = [
  ...[[0, 0, W, EDGE], [0, H - EDGE, W, EDGE], [0, EDGE, EDGE, H - 2 * EDGE], [W - EDGE, EDGE, EDGE, H - 2 * EDGE]].map((r) => ({ r, edge: true })),
  ...HALF_WALLS.map((r) => ({ r })),
  ...HALF_WALLS.map((r) => ({ r: mirrorRect(r) })),
  { r: [735, 390, 130, 120], core: true },
].map(({ r: [x, y, w, h], edge, core }) => ({ x, y, w, h, edge: !!edge, core: !!core, z: edge ? 0.7 : 1 }));

// Low cover: crates and barriers (do not block sight, drawn with a little height).
const HALF_CRATES = [
  [410, 330, 38, 38, 0.08], [600, 330, 34, 34, -0.1], [700, 120, 36, 36, 0.12], [452, 186, 36, 36, 0],
  [560, 800, 40, 40, 0.05], [70, 300, 32, 32, -0.06], [560, 520, 30, 30, 0.2], [360, 760, 44, 30, 0],
  [850, 60, 34, 34, 0.1],
];
// The right half mirrors the left, except a few crates nudged off Ember's routes.
const CRATE_NUDGE = { 0: [1222, 536], 1: [1250, 150], 2: [866, 806], 3: [1262, 760], 6: [1380, 640] };
const CRATES = [...HALF_CRATES, ...HALF_CRATES.map(([x, y, w, h, a], i) => [...(CRATE_NUDGE[i] || [W - x - w, H - y - h]), w, h, a])].map(([x, y, w, h, a]) => ({ x, y, w, h, a }));
const BARRELS = [[300, 90], [322, 108], [1300, 810], [1278, 792], [760, 560], [840, 340], [560, 860 - 70], [1040, 70]].map(([x, y]) => ({ x, y }));
const SITES = [
  { name: 'A', x: 800, y: 205, r: 78 },
  { name: 'B', x: 800, y: 695, r: 78 },
];
const ROUND_SITE = { 1: 0, 2: 1, 3: 0, 4: 1 };
// Smoke grenades (visual only, kept off every elimination line).
const SMOKES = [
  { t: 5.5, x: 560, y: 452, dur: 10 },
  { t: 44.5, x: 1010, y: 712, dur: 10 },
  { t: 91, x: 1000, y: 330, dur: 9 },
  { t: 134.5, x: 1060, y: 460, dur: 10 },
];

/* ------------------------------------------------------------------------------------------- Movement tracks */

// [t, x, y, lookDeg?] per unit per round. Before the first key a unit waits at spawn; after the last it holds.
const AZ_SPAWN = { a1: [118, 405], a2: [152, 435], a3: [118, 468], a4: [152, 498] };
const EM_SPAWN = { e1: [1482, 495], e2: [1448, 465], e3: [1482, 432], e4: [1448, 402] };
const sp = (id, t) => [t, ...(AZ_SPAWN[id] || EM_SPAWN[id])];

const TRACKS = {
  1: {
    a1: [sp('a1', 0.5), [2.5, 300, 300], [5, 430, 256], [7.5, 580, 256], [9.6, 652, 228], [11, 690, 215], [13, 722, 210], [16, 770, 192], [19.5, 790, 200], [27, 800, 214], [31, 802, 214]],
    a2: [sp('a2', 0.5), [3, 290, 450], [7, 420, 452], [10, 590, 440], [13, 640, 470], [15.5, 680, 505], [17, 690, 520]],
    a3: [sp('a3', 0.5), [3.2, 300, 600], [6.5, 420, 645], [10, 580, 650], [13, 640, 690], [19.5, 650, 694], [22.5, 700, 700], [24, 702, 700], [25.8, 712, 600], [27.3, 711, 520], [28.6, 712, 420], [30, 720, 330], [31, 730, 300]],
    a4: [sp('a4', 0.5), [3.6, 300, 615], [7, 440, 648], [10.5, 590, 660], [13.5, 620, 744], [22, 626, 744], [24, 690, 640], [25.3, 711, 560], [26.5, 711, 460], [28.5, 730, 320], [31, 750, 270]],
    e3: [sp('e3', 0.5), [3, 1310, 300], [6, 1180, 250], [8.5, 1060, 228], [10, 980, 200], [11, 935, 185]],
    e1: [sp('e1', 0.5), [3, 1300, 460], [7, 1190, 530], [11, 1060, 545], [14, 960, 550], [15.6, 905, 560], [17, 900, 562], [18.2, 915, 580], [19.6, 950, 640], [21.2, 1100, 650], [31, 1110, 652]],
    e2: [sp('e2', 0.5), [3, 1310, 330], [6, 1220, 250], [9, 1160, 240], [10.5, 1180, 172], [24, 1182, 170], [27, 1150, 240], [29.5, 1050, 222], [31, 1030, 220]],
    e4: [sp('e4', 0.5), [3.5, 1300, 560], [7, 1250, 640], [11, 1140, 650], [13, 1110, 740, 180], [20, 1112, 740], [20.8, 1090, 660], [21.6, 1030, 650], [22.5, 962, 738]],
  },
  2: {
    a1: [sp('a1', 40), [42.5, 300, 560], [45, 420, 645], [47.5, 590, 652], [49, 650, 670]],
    a3: [sp('a3', 40), [43, 290, 452], [47, 430, 452], [50.5, 600, 446], [53, 650, 500], [55.5, 690, 560]],
    a4: [sp('a4', 40), [43, 300, 300], [46, 430, 256], [50, 580, 256], [53, 645, 232], [57, 652, 236], [59.2, 690, 300], [61, 690, 340], [63, 700, 300], [66, 760, 240], [71, 780, 232]],
    a2: [sp('a2', 40), [43, 290, 380], [47, 352, 332, 0], [62, 354, 334], [65, 370, 640], [68, 560, 652], [71, 590, 655]],
    e1: [sp('e1', 40), [42.5, 1300, 600], [45, 1180, 645], [47, 1010, 668], [48.5, 900, 690], [49, 888, 690], [51, 850, 690], [54, 805, 700], [71, 806, 700]],
    e4: [sp('e4', 40), [43, 1300, 452], [47, 1180, 452], [51, 1000, 470], [53.5, 922, 556], [55.5, 900, 584], [58, 850, 650], [60, 812, 676], [71, 812, 676]],
    e2: [sp('e2', 40), [43, 1300, 400], [47, 1230, 340], [52, 1180, 360], [56.5, 1060, 360], [58.5, 1000, 360], [61, 962, 362]],
    e3: [sp('e3', 40), [43, 1310, 300], [46.5, 1180, 250], [50, 1060, 240], [55, 1062, 242], [57.5, 1235, 262], [59.5, 1240, 470], [61.5, 1120, 520], [63, 940, 560], [65, 850, 660], [71, 830, 690]],
  },
  3: {
    a1: [sp('a1', 80), [82.5, 300, 340], [85, 450, 440], [87, 600, 420], [88, 640, 400], [90, 662, 470], [92.5, 700, 562], [104, 702, 562], [106.5, 690, 430], [108.2, 690, 370], [109, 688, 356], [110.5, 670, 310], [113.5, 680, 272], [115.5, 760, 285], [117.5, 840, 285], [118, 846, 284], [121, 860, 290]],
    a2: [sp('a2', 80), [83, 300, 300], [86, 430, 256], [89, 580, 256], [92, 640, 232], [95, 700, 202], [97, 720, 192]],
    a3: [sp('a3', 80), [83, 300, 300], [86, 430, 266], [90, 600, 266], [94, 660, 262], [97, 690, 250], [99.5, 710, 240]],
    a4: [sp('a4', 80), [84, 300, 452], [88, 450, 452], [92, 600, 432], [96, 660, 380], [100, 700, 330], [102, 718, 312]],
    e2: [sp('e2', 80), [83, 1300, 420], [85.5, 1100, 440], [87, 960, 370], [88, 880, 312]],
    e1: [sp('e1', 80), [83, 1310, 300], [86, 1180, 250], [90, 1060, 232], [94, 980, 222], [97, 900, 226], [99, 880, 232], [102, 868, 242], [107, 862, 244], [109, 860, 245]],
    e3: [sp('e3', 80), [83, 1310, 292], [86, 1180, 250], [88, 1085, 248], [90, 1050, 165], [93, 1000, 150], [97, 922, 140], [99.5, 880, 150], [102, 930, 140], [105, 1060, 135], [110, 1062, 136], [112, 960, 140], [113.5, 880, 142]],
    e4: [sp('e4', 80), [83, 1300, 362], [86, 1245, 300], [90, 1160, 250], [95, 1000, 262], [100, 930, 260], [102, 910, 256], [104, 960, 232], [106.5, 1080, 246], [108, 1150, 236], [109.5, 1162, 180], [116, 1164, 180], [117, 1160, 238], [117.7, 1104, 246], [118, 1096, 248]],
  },
  4: {
    a4: [sp('a4', 130), [133, 300, 620], [136, 450, 646], [138, 580, 652], [139, 610, 660]],
    a1: [sp('a1', 130), [133, 300, 452], [136, 450, 452], [139, 580, 450], [141, 640, 472], [143, 690, 540], [145, 700, 570], [147, 742, 640], [149, 790, 680], [158, 796, 690]],
    a2: [sp('a2', 130), [133, 300, 590], [136, 440, 645], [140, 520, 672], [143, 630, 722], [146, 662, 718], [148, 690, 732], [150, 700, 740], [152, 762, 722], [158, 770, 716]],
    a3: [sp('a3', 130), [133, 300, 330], [136, 430, 256], [140, 580, 256], [143, 642, 232], [152, 646, 236], [155, 690, 330], [158, 694, 420]],
    e1: [sp('e1', 130), [133, 1300, 600], [135.5, 1180, 640], [137.5, 1000, 660], [139, 852, 690], [140.3, 955, 768], [141.8, 1005, 822], [144, 1080, 822], [145.5, 1092, 752], [158, 1094, 750]],
    e3: [sp('e3', 130), [133, 1300, 452], [136, 1180, 460], [139, 1050, 500], [142, 950, 540], [144, 930, 610], [145, 920, 640]],
    e2: [sp('e2', 130), [133, 1300, 610], [136, 1200, 806], [140, 1150, 822], [146.5, 1152, 822], [148.5, 1000, 822], [150, 955, 770]],
    e4: [sp('e4', 130), [133, 1300, 300], [136, 1180, 250], [140, 1060, 242], [142, 1150, 240], [143.5, 1162, 180], [150, 1164, 180], [151.3, 1225, 250], [152.3, 1240, 330], [154, 1232, 450], [156, 1150, 470], [158, 1100, 480]],
  },
};

const SMOOTH_W = 0.45; // triangle-filter half width, seconds

function makeTrack(keys, team) {
  const n = keys.length;
  const T = keys.map((k) => k[0]), X = keys.map((k) => k[1]), Y = keys.map((k) => k[2]);
  const VX = [], VY = [], AX = [0], AY = [0], CX = [0], CY = [0], LOOK = [];
  for (let i = 0; i < n - 1; i++) {
    const d = T[i + 1] - T[i];
    VX[i] = d > 0 ? (X[i + 1] - X[i]) / d : 0;
    VY[i] = d > 0 ? (Y[i + 1] - Y[i]) / d : 0;
    AX[i + 1] = AX[i] + X[i] * d + (VX[i] * d * d) / 2;
    AY[i + 1] = AY[i] + Y[i] * d + (VY[i] * d * d) / 2;
    CX[i + 1] = CX[i] + AX[i] * d + (X[i] * d * d) / 2 + (VX[i] * d * d * d) / 6;
    CY[i + 1] = CY[i] + AY[i] * d + (Y[i] * d * d) / 2 + (VY[i] * d * d * d) / 6;
  }
  // Where the unit looks while standing after key i: explicit, or the way it last moved.
  let look = team === 0 ? 0 : Math.PI;
  for (let i = 0; i < n; i++) {
    if (i > 0 && Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]) > 4) look = Math.atan2(Y[i] - Y[i - 1], X[i] - X[i - 1]);
    if (keys[i][3] !== undefined) look = (keys[i][3] * Math.PI) / 180;
    LOOK[i] = look;
  }
  return { n, T, X, Y, VX, VY, AX, AY, CX, CY, LOOK };
}

function segIndex(tr, s) {
  let i = 0;
  while (i < tr.n - 1 && s >= tr.T[i + 1]) i++;
  return i;
}

// First and second antiderivatives of the piecewise-linear path, measured from its first key.
function anti(tr, s) {
  const { T, X, Y } = tr;
  if (s <= T[0]) {
    const d = s - T[0];
    return [X[0] * d, Y[0] * d, (X[0] * d * d) / 2, (Y[0] * d * d) / 2];
  }
  const i = segIndex(tr, s);
  const d = s - T[i];
  const vx = i < tr.n - 1 ? tr.VX[i] : 0, vy = i < tr.n - 1 ? tr.VY[i] : 0;
  return [
    tr.AX[i] + X[i] * d + (vx * d * d) / 2,
    tr.AY[i] + Y[i] * d + (vy * d * d) / 2,
    tr.CX[i] + tr.AX[i] * d + (X[i] * d * d) / 2 + (vx * d * d * d) / 6,
    tr.CY[i] + tr.AY[i] * d + (Y[i] * d * d) / 2 + (vy * d * d * d) / 6,
  ];
}

function trackPos(tr, t) {
  const w = SMOOTH_W;
  const a = anti(tr, t - w), b = anti(tr, t), c = anti(tr, t + w);
  return { x: (a[2] - 2 * b[2] + c[2]) / (w * w), y: (a[3] - 2 * b[3] + c[3]) / (w * w) };
}

function trackVel(tr, t) {
  const w = SMOOTH_W;
  const a = anti(tr, t - w), b = anti(tr, t), c = anti(tr, t + w);
  return { x: (a[0] - 2 * b[0] + c[0]) / (w * w), y: (a[1] - 2 * b[1] + c[1]) / (w * w) };
}

/* ------------------------------------------------------------------------------------------- Match state */

UNITS.forEach((u, i) => (u.index = i));
const unitById = Object.fromEntries(UNITS.map((u) => [u.id, u]));
const TR = {};
for (const r of ROUNDS) {
  TR[r.n] = {};
  for (const u of UNITS) TR[r.n][u.id] = makeTrack(TRACKS[r.n][u.id] || [sp(u.id, r.start)], u.team);
}

/** When the picture cuts to round r (hidden under the black between rounds). */
function switchTime(r) {
  const i = ROUNDS.indexOf(r);
  return i === 0 ? -Infinity : (ROUNDS[i - 1].end + r.start) / 2;
}
function roundAt(t) {
  let r = ROUNDS[0];
  for (const x of ROUNDS) if (t >= switchTime(x)) r = x;
  return r;
}
const deathOf = (id, r) => KILLS.find((k) => k.on === id && k.t >= r.start && k.t <= r.end + 0.01);
const isAlive = (u, t, r = roundAt(t)) => {
  const d = deathOf(u.id, r);
  return !(d && t >= d.t);
};

/** Raw (living) position of unit u at time t in the round that is on screen at t. */
function posAt(u, t, r = roundAt(t)) {
  return trackPos(TR[r.n][u.id], Math.max(t, switchTime(r)));
}

// Line of sight: segment a-b against the tall walls (Liang-Barsky per rect).
function segHitsRect(ax, ay, bx, by, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy], q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}
function los(a, b) {
  for (const w of WALLS) if (!w.edge && segHitsRect(a.x, a.y, b.x, b.y, w.x, w.y, w.x + w.w, w.y + w.h)) return false;
  return true;
}

const KILLS_BY = Object.fromEntries(UNITS.map((u) => [u.id, KILLS.filter((k) => k.by === u.id)]));
const ENGAGE = 360;

const memo = new Map();
function memoize(key, fn) {
  let v = memo.get(key);
  if (v === undefined) {
    if (memo.size > 60000) memo.clear();
    v = fn();
    memo.set(key, v);
  }
  return v;
}

/** The enemy u is engaging at t: nearest visible living enemy within range. */
function engagedEnemy(u, t, r) {
  return memoize(`eng|${u.id}|${t}`, () => {
    if (t < r.start || (r.capture && t > r.capture) || t > r.end) return null;
    const p = posAt(u, t, r);
    let best = null, bd = ENGAGE;
    for (const e of UNITS) {
      if (e.team === u.team || !isAlive(e, t, r)) continue;
      const q = posAt(e, t, r);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd && los(p, q)) { bd = d; best = e; }
    }
    return best;
  });
}

/** Where u wants to face at t (before smoothing). */
function rawFacing(u, t, r) {
  return memoize(`raw|${u.id}|${t}`, () => {
    const p = posAt(u, t, r);
    for (const k of KILLS_BY[u.id]) {
      if (t > k.t - 1.1 && t < k.t + 0.4 && k.t >= r.start && k.t <= r.end) {
        const q = posAt(unitById[k.on], Math.min(t, k.t), r);
        return Math.atan2(q.y - p.y, q.x - p.x);
      }
    }
    const e = engagedEnemy(u, t, r);
    if (e) {
      const q = posAt(e, t, r);
      return Math.atan2(q.y - p.y, q.x - p.x);
    }
    const tr = TR[r.n][u.id];
    const v = trackVel(tr, Math.max(t, switchTime(r)));
    const sp = Math.hypot(v.x, v.y);
    const hold = tr.LOOK[segIndex(tr, t)];
    if (sp < 8) return hold;
    const mv = Math.atan2(v.y, v.x);
    return angLerp(hold, mv, clamp((sp - 8) / 30, 0, 1));
  });
}

/** Smoothed facing: a weighted average of the wanted direction over the last 0.45 s. */
function facing(u, t, r = roundAt(t)) {
  const d = deathOf(u.id, r);
  const tt = d && t > d.t ? d.t : t;
  let hx = 0, hy = 0;
  const t0 = Math.max(switchTime(r), -1);
  for (let j = 0; j < 10; j++) {
    const s = Math.max(tt - j * 0.05, t0);
    const a = rawFacing(u, s, r);
    hx += Math.cos(a) * (10 - j);
    hy += Math.sin(a) * (10 - j);
  }
  return Math.atan2(hy, hx);
}

const muzzleOf = (p, f) => ({ x: p.x + Math.cos(f) * 38 - Math.sin(f) * 4.2, y: p.y + Math.sin(f) * 38 + Math.cos(f) * 4.2 });

/** First wall hit along a ray from a in direction ang, up to maxD. */
function rayWall(a, ang, maxD) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let best = maxD;
  for (const w of WALLS) {
    // slab intersection
    let t0 = 0, t1 = best;
    const tx1 = (w.x - a.x) / dx, tx2 = (w.x + w.w - a.x) / dx;
    const ty1 = (w.y - a.y) / dy, ty2 = (w.y + w.h - a.y) / dy;
    t0 = Math.max(t0, Math.min(tx1, tx2), Math.min(ty1, ty2));
    t1 = Math.min(t1, Math.max(tx1, tx2), Math.max(ty1, ty2));
    if (t0 <= t1 && t0 < best) best = t0;
  }
  return best;
}

/* ------------------------------------------------------------------------------------------- Gunfire */

// Every shot in the match, computed once (deterministic): the three-round burst of each elimination, plus
// ambient fire between enemies that can see each other (misses that end in a wall or on the floor).
const SHOTS = (() => {
  const shots = [];
  for (const k of KILLS) {
    const r = roundAt(k.t);
    const by = unitById[k.by], on = unitById[k.on];
    [-0.3, -0.15, 0].forEach((dt, i) => {
      const t = k.t + dt;
      const p = posAt(by, t, r), f = facing(by, t, r);
      const m = muzzleOf(p, f);
      const q = posAt(on, t, r);
      shots.push({ t, team: by.team, by: by.id, on: on.id, ax: m.x, ay: m.y, bx: q.x, by2: q.y, kind: i === 2 ? 'kill' : 'hit', ang: Math.atan2(q.y - m.y, q.x - m.x) });
    });
  }
  for (const r of ROUNDS) {
    const stop = r.capture ?? r.end;
    for (const u of UNITS) {
      let next = r.start + 1.2 + seeded(r.n, u.index, 41) * 0.8;
      for (let t = r.start + 1; t < stop; t = Math.round((t + 0.1) * 10) / 10) {
        if (t < next || !isAlive(u, t, r)) continue;
        if (KILLS_BY[u.id].some((k) => t > k.t - 1.0 && t < k.t + 0.5)) continue;
        const e = engagedEnemy(u, t, r);
        if (!e) continue;
        const p = posAt(u, t, r), q = posAt(e, t, r);
        if (Math.abs(angDiff(facing(u, t, r), Math.atan2(q.y - p.y, q.x - p.x))) > 0.2) continue;
        const nb = 2 + Math.floor(seeded(t * 10, u.index, 42) * 2);
        for (let i = 0; i < nb; i++) {
          const ts = t + i * 0.11;
          if (!isAlive(u, ts, r) || !isAlive(e, ts, r)) break;
          const ps = posAt(u, ts, r), f = facing(u, ts, r), m = muzzleOf(ps, f), qs = posAt(e, ts, r);
          const side = seeded(ts * 100, u.index, 43) < 0.5 ? -1 : 1;
          const off = side * (16 + seeded(ts * 100, u.index, 44) * 22);
          const dist = Math.hypot(qs.x - m.x, qs.y - m.y);
          const ang = Math.atan2(qs.y - m.y, qs.x - m.x) + Math.atan2(off, dist);
          const maxD = dist + 140 + seeded(ts * 100, u.index, 45) * 120;
          const d = rayWall(m, ang, maxD);
          if (i === nb - 1 && seeded(ts * 100, u.index, 47) < 0.3) {
            // a grazing hit: some damage, never lethal (only the scripted eliminations kill)
            const a2 = Math.atan2(qs.y - m.y, qs.x - m.x);
            shots.push({ t: ts, team: u.team, by: u.id, on: e.id, ax: m.x, ay: m.y, bx: qs.x, by2: qs.y, kind: 'chip', ang: a2, dmg: 12 + Math.round(seeded(ts * 100, u.index, 48) * 14) });
          } else {
            shots.push({ t: ts, team: u.team, by: u.id, on: null, ax: m.x, ay: m.y, bx: m.x + Math.cos(ang) * d, by2: m.y + Math.sin(ang) * d, kind: d < maxD - 0.5 ? 'wall' : 'floor', ang });
          }
        }
        next = t + nb * 0.11 + 0.75 + seeded(t * 10, u.index, 46) * 0.9;
      }
    }
  }
  shots.sort((a, b) => a.t - b.t);
  return shots;
})();

function health(u, t, r) {
  if (!isAlive(u, t, r)) return 0;
  let hp = 100;
  for (const s of SHOTS) {
    if (s.t > t) break;
    if (s.on !== u.id || s.t < r.start - 0.01 || s.t > r.end + 1) continue;
    hp = s.kind === 'chip' ? Math.max(hp - s.dmg, 34) : Math.round(hp * 0.45);
  }
  return hp;
}

/** Full drawable state of a unit at t (handles death: frozen pose plus a short knock-back). */
function unitState(u, t) {
  const r = roundAt(t);
  const d = deathOf(u.id, r);
  const alive = !(d && t >= d.t);
  const tt = alive ? t : d.t;
  let p = posAt(u, tt, r);
  const f = facing(u, tt, r);
  let fall = 0, since = 0, push = 0;
  if (!alive) {
    since = t - d.t;
    fall = ease(since / 0.45);
    const sh = posAt(unitById[d.by], d.t, r);
    push = Math.atan2(p.y - sh.y, p.x - sh.x);
    p = { x: p.x + Math.cos(push) * 16 * fall, y: p.y + Math.sin(push) * 16 * fall };
  }
  return { x: p.x, y: p.y, facing: f, alive, since, fall, push, round: r, death: d, hp: alive ? health(u, t, r) : 0 };
}

/* ------------------------------------------------------------------------------------------- Static map art */

let MAPCACHE = {};

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexPath(ctx, x, y, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * TAU;
    i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

function zoneOf(x, y) {
  if (x < 276 || x > W - 276) return 'spawn';
  if (x > 640 && x < 960) return 'plaza';
  return 'lane';
}

/** Floor, markings, light pools and baked shadows, drawn in world units onto a canvas at the given scale. */
function buildMap(scale) {
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);

  // Base.
  ctx.fillStyle = '#0c0f14';
  ctx.fillRect(0, 0, W, H);

  // Tiles: concrete slabs in the lanes, large panels on the plaza, tread plates in the spawns.
  for (let gx = 0; gx < W; gx += 50) {
    for (let gy = 0; gy < H; gy += 50) {
      const z = zoneOf(gx + 25, gy + 25);
      const n = seeded(gx, gy, 1);
      let l = z === 'spawn' ? 17 : z === 'plaza' ? 21 : 19;
      l += (n - 0.5) * 4;
      ctx.fillStyle = `rgb(${l | 0},${(l + 3.5) | 0},${(l + 8) | 0})`;
      ctx.fillRect(gx, gy, 50, 50);
    }
  }
  // Large-scale tonal variation (wear, dirt).
  for (let i = 0; i < 46; i++) {
    const x = seeded(i, 7) * W, y = seeded(i, 8) * H, r = 80 + seeded(i, 9) * 240;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = seeded(i, 10) < 0.6;
    g.addColorStop(0, dark ? `rgba(0,0,0,${0.12 + seeded(i, 11) * 0.14})` : `rgba(150,170,200,${0.025 + seeded(i, 11) * 0.03})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Speckle grain.
  for (let i = 0; i < 26000; i++) {
    const x = seeded(i, 21) * W, y = seeded(i, 22) * H, s = 0.6 + seeded(i, 23) * 1.6;
    ctx.fillStyle = seeded(i, 24) < 0.5 ? `rgba(255,255,255,${0.015 + seeded(i, 25) * 0.035})` : `rgba(0,0,0,${0.05 + seeded(i, 25) * 0.1})`;
    ctx.fillRect(x, y, s, s);
  }
  // Spawn tread plate: small diagonal ridges.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 276, H);
  ctx.rect(W - 276, 0, 276, H);
  ctx.clip();
  for (let x = 0; x < W; x += 14) {
    for (let y = 0; y < H; y += 14) {
      if (x > 276 && x < W - 290) continue;
      const odd = ((x + y) / 14) % 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (odd) { ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + 9, y + 9); }
      else { ctx.moveTo(x + 9, y + 3); ctx.lineTo(x + 3, y + 9); }
      ctx.stroke();
    }
  }
  ctx.restore();
  // Tile seams: lanes every 100, plaza every 160, spawns every 50.
  const seam = (x0, y0, x1, y1, step) => {
    for (let x = x0; x <= x1; x += step) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x - 1, y0, 1.6, y1 - y0);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(x + 0.6, y0, 1, y1 - y0);
    }
    for (let y = y0; y <= y1; y += step) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x0, y - 1, x1 - x0, 1.6);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(x0, y + 0.6, x1 - x0, 1);
    }
  };
  seam(0, 0, 276, H, 50);
  seam(W - 276, 0, W, H, 50);
  seam(300, 0, 640, H, 100);
  seam(960, 0, 1300, H, 100);
  seam(640, 0, 960, H, 80);
  // Cracks.
  for (let i = 0; i < 34; i++) {
    let x = seeded(i, 31) * W, y = seeded(i, 32) * H, a = seeded(i, 33) * TAU;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const n = 4 + Math.floor(seeded(i, 34) * 6);
    for (let j = 0; j < n; j++) {
      a += (seeded(i, j, 35) - 0.5) * 1.3;
      x += Math.cos(a) * (6 + seeded(i, j, 36) * 14);
      y += Math.sin(a) * (6 + seeded(i, j, 36) * 14);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Drain grates and vents (props, flat).
  for (const [x, y, w, h] of [[440, 520, 56, 22], [W - 496, H - 542, 56, 22], [760, 820, 80, 18], [760, 62, 80, 18], [80, 120, 22, 60], [W - 102, H - 180, 22, 60]]) {
    ctx.fillStyle = '#07090c';
    rr(ctx, x, y, w, h, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,140,165,0.22)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (w > h) for (let i = x + 5; i < x + w - 3; i += 5) { ctx.moveTo(i, y + 3); ctx.lineTo(i, y + h - 3); }
    else for (let i = y + 5; i < y + h - 3; i += 5) { ctx.moveTo(x + 3, i); ctx.lineTo(x + w - 3, i); }
    ctx.stroke();
  }

  // Painted floor markings: lane guide lines and chevrons toward the sites.
  ctx.save();
  ctx.setLineDash([18, 14]);
  ctx.strokeStyle = 'rgba(210,220,235,0.07)';
  ctx.lineWidth = 3;
  for (const y of [258, 450, 642]) {
    ctx.beginPath();
    ctx.moveTo(300, y);
    ctx.lineTo(1300, y);
    ctx.stroke();
  }
  ctx.restore();
  const chevron = (x, y, ang, a) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.strokeStyle = `rgba(220,228,240,${a})`;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'miter';
    for (const o of [-10, 4]) {
      ctx.beginPath();
      ctx.moveTo(o - 7, -11);
      ctx.lineTo(o + 5, 0);
      ctx.lineTo(o - 7, 11);
      ctx.stroke();
    }
    ctx.restore();
  };
  chevron(350, 236, -0.25, 0.08);
  chevron(W - 350, H - 236, Math.PI - 0.25, 0.08);
  chevron(350, 664, 0.25, 0.08);
  chevron(W - 350, H - 664, Math.PI + 0.25, 0.08);
  chevron(W - 350, 236, Math.PI + 0.25, 0.08);
  chevron(350, H - 236, 0.25, 0.08);

  // Spawn zones: team-tinted floor and hazard edging at the exits.
  for (const team of [0, 1]) {
    const x0 = team === 0 ? EDGE : W - 276;
    const g = ctx.createLinearGradient(team === 0 ? 0 : W, 0, team === 0 ? 300 : W - 300, 0);
    g.addColorStop(0, rgba(TEAM[team], 0.09));
    g.addColorStop(1, rgba(TEAM[team], 0));
    ctx.fillStyle = g;
    ctx.fillRect(x0 - 10, EDGE, 250, H - 2 * EDGE);
    // Hazard stripes along the spawn line.
    const sx = team === 0 ? 282 : W - 296;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, 272, 14, 356);
    ctx.clip();
    ctx.fillStyle = 'rgba(8,9,11,0.6)';
    ctx.fillRect(sx, 272, 14, 356);
    ctx.fillStyle = rgba(TEAM[team], 0.28);
    for (let y = 260; y < 640; y += 18) {
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx + 14, y + 10);
      ctx.lineTo(sx + 14, y + 19);
      ctx.lineTo(sx, y + 9);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // Spawn pads: one per player.
    const spawns = team === 0 ? AZ_SPAWN : EM_SPAWN;
    for (const [x, y] of Object.values(spawns)) {
      ctx.strokeStyle = rgba(TEAM[team], 0.16);
      ctx.lineWidth = 1.5;
      hexPath(ctx, x, y, 17, Math.PI / 6);
      ctx.stroke();
    }
    // Team emblem painted large in the spawn: an original split-chevron mark.
    ctx.save();
    ctx.translate(team === 0 ? 150 : W - 150, team === 0 ? 220 : H - 220);
    ctx.rotate(team === 0 ? 0 : Math.PI);
    ctx.fillStyle = rgba(TEAM[team], 0.07);
    ctx.beginPath();
    ctx.moveTo(-34, -30); ctx.lineTo(6, 0); ctx.lineTo(-34, 30); ctx.lineTo(-20, 0); ctx.closePath();
    ctx.moveTo(-6, -30); ctx.lineTo(34, 0); ctx.lineTo(-6, 30); ctx.lineTo(8, 0); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Objective sites: painted hex pad, tick ring and a stencil letter.
  for (const s of SITES) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    hexPath(ctx, s.x, s.y, s.r + 8, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(235,240,248,0.16)';
    ctx.lineWidth = 3;
    hexPath(ctx, s.x, s.y, s.r + 8, 0);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(235,240,248,0.07)';
    ctx.lineWidth = 1.5;
    hexPath(ctx, s.x, s.y, s.r - 10, 0);
    ctx.stroke();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU;
      ctx.strokeStyle = `rgba(235,240,248,${i % 3 ? 0.06 : 0.14})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(a) * (s.r + 18), s.y + Math.sin(a) * (s.r + 18));
      ctx.lineTo(s.x + Math.cos(a) * (s.r + 24), s.y + Math.sin(a) * (s.r + 24));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(235,240,248,0.10)';
    ctx.font = `800 64px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.name, s.x, s.y + 2);
    ctx.restore();
  }

  // Overhead light pools.
  const lights = [[160, 450], [W - 160, 450], [800, 205], [800, 695], [520, 200], [W - 520, H - 200], [520, 700], [W - 520, H - 700], [800, 450], [420, 450], [W - 420, 450]];
  for (const [x, y] of lights) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 210);
    g.addColorStop(0, 'rgba(175,200,235,0.11)');
    g.addColorStop(0.5, 'rgba(175,200,235,0.03)');
    g.addColorStop(1, 'rgba(175,200,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 210, y - 210, 420, 420);
  }

  // Baked contact shadows of walls, crates and barrels (light from the upper left).
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 22 * scale;
  ctx.shadowOffsetX = 12 * scale;
  ctx.shadowOffsetY = 15 * scale;
  ctx.fillStyle = '#06080b';
  for (const w of WALLS) if (!w.edge) ctx.fillRect(w.x, w.y, w.w, w.h);
  ctx.shadowBlur = 12 * scale;
  ctx.shadowOffsetX = 6 * scale;
  ctx.shadowOffsetY = 8 * scale;
  for (const c of CRATES) {
    ctx.save();
    ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
    ctx.rotate(c.a);
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();
  }
  for (const b of BARRELS) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 11, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  // Ambient occlusion along the outer wall.
  for (const [x0, y0, x1, y1] of [[0, EDGE, 0, EDGE + 60], [0, H - EDGE, 0, H - EDGE - 60], [EDGE, 0, EDGE + 60, 0], [W - EDGE, 0, W - EDGE - 60, 0]]) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  return c;
}

function getMap(scale) {
  const key = String(scale);
  if (!MAPCACHE[key]) MAPCACHE[key] = buildMap(scale);
  return MAPCACHE[key];
}

/* ------------------------------------------------------------------------------------------- Dynamic world */

// Walls and crates with height: the top face is pushed away from the camera point, so walls lean like real
// geometry as the camera moves.
function drawSolids(ctx, cam) {
  const K = 0.05;
  const items = [
    ...WALLS.map((w) => ({ kind: 'wall', w, z: w.z, cx: w.x + w.w / 2, cy: w.y + w.h / 2 })),
    ...CRATES.map((c) => ({ kind: 'crate', w: c, z: 0.42, cx: c.x + c.w / 2, cy: c.y + c.h / 2 })),
    ...BARRELS.map((b) => ({ kind: 'barrel', w: b, z: 0.38, cx: b.x, cy: b.y })),
  ];
  items.sort((a, b) => Math.hypot(b.cx - cam.x, b.cy - cam.y) - Math.hypot(a.cx - cam.x, a.cy - cam.y));
  for (const it of items) {
    const k = K * it.z;
    const lift = (x, y) => [x + (x - cam.x) * k, y + (y - cam.y) * k];
    if (it.kind === 'barrel') {
      const b = it.w;
      const [tx, ty] = lift(b.x, b.y);
      const r = 11 * (1 + k);
      ctx.fillStyle = '#0e1217';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 11, 0, TAU);
      ctx.fill();
      // body between base and top
      ctx.strokeStyle = '#141a21';
      ctx.lineWidth = 22;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      const g = ctx.createRadialGradient(tx - 4, ty - 4, 1, tx, ty, r);
      g.addColorStop(0, '#4a3a2a');
      g.addColorStop(1, '#2a2119');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(tx, ty, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,120,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx, ty, r - 2.5, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx, ty, r * 0.45, 0, TAU);
      ctx.stroke();
      continue;
    }
    let pts;
    const w = it.w;
    if (it.kind === 'crate') {
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2, ca = Math.cos(w.a), sa = Math.sin(w.a);
      pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + (u * w.w * ca) / 2 - (v * w.h * sa) / 2, cy + (u * w.w * sa) / 2 + (v * w.h * ca) / 2]);
    } else {
      pts = [[w.x, w.y], [w.x + w.w, w.y], [w.x + w.w, w.y + w.h], [w.x, w.y + w.h]];
    }
    const top = pts.map(([x, y]) => lift(x, y));
    // Side faces facing the camera.
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      const nx = b[1] - a[1], ny = -(b[0] - a[0]); // outward normal for clockwise points
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (nx * (cam.x - mx) + ny * (cam.y - my) <= 0) continue;
      const len = Math.hypot(nx, ny);
      const light = (-nx / len) * 0.6 + (-ny / len) * 0.8; // light from upper-left
      const base = it.kind === 'crate' ? [40, 38, 33] : [30, 37, 48];
      const f = 0.55 + 0.35 * light;
      ctx.fillStyle = `rgb(${(base[0] * f) | 0},${(base[1] * f) | 0},${(base[2] * f) | 0})`;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineTo(top[(i + 1) % 4][0], top[(i + 1) % 4][1]);
      ctx.lineTo(top[i][0], top[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    // Top face.
    const xs = top.map((p) => p[0]), ys = top.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    if (it.kind === 'crate') {
      g.addColorStop(0, '#3b3a35');
      g.addColorStop(1, '#25241f');
    } else if (w.core) {
      g.addColorStop(0, '#3a4657');
      g.addColorStop(1, '#202833');
    } else if (w.edge) {
      g.addColorStop(0, '#1c222b');
      g.addColorStop(1, '#12161c');
    } else {
      g.addColorStop(0, '#343f4e');
      g.addColorStop(1, '#1d2430');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    // Rim light on the lit edges, dark lip on the others.
    for (let i = 0; i < 4; i++) {
      const a = top[i], b = top[(i + 1) % 4];
      const lit = i === 0 || i === 3;
      ctx.strokeStyle = lit ? 'rgba(220,235,255,0.20)' : 'rgba(0,0,0,0.45)';
      ctx.lineWidth = lit ? 1.4 : 1.6;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    if (it.kind === 'crate') {
      // Planks and a cross brace.
      const [p0, p1, p2, p3] = top;
      const L = (p, q, k) => [lerp(p[0], q[0], k), lerp(p[1], q[1], k)];
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const k of [0.33, 0.66]) {
        const a = L(p0, p1, k), b = L(p3, p2, k);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
      const i0 = L(p0, p2, 0.12), i1 = L(p0, p2, 0.88), j0 = L(p1, p3, 0.12), j1 = L(p1, p3, 0.88);
      ctx.strokeStyle = 'rgba(255,230,190,0.12)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(i0[0], i0[1]); ctx.lineTo(i1[0], i1[1]);
      ctx.moveTo(j0[0], j0[1]); ctx.lineTo(j1[0], j1[1]);
      ctx.stroke();
    } else if (!w.edge) {
      // Inset panel and bolts on wall tops.
      const ins = 4;
      const tx = x0 + ins, ty = y0 + ins, tw = x1 - x0 - ins * 2, th = y1 - y0 - ins * 2;
      if (tw > 6 && th > 6) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx, ty, tw, th);
        const long = tw > th;
        const n = Math.floor((long ? tw : th) / 60);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        for (let i = 1; i <= n; i++) {
          if (long) { const x = tx + (tw * i) / (n + 1); ctx.moveTo(x, ty); ctx.lineTo(x, ty + th); }
          else { const y = ty + (th * i) / (n + 1); ctx.moveTo(tx, y); ctx.lineTo(tx + tw, y); }
        }
        ctx.stroke();
      }
      if (w.core) {
        // Rooftop unit on the central block.
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        ctx.fillStyle = '#10141a';
        rr(ctx, cx - 26, cy - 20, 52, 40, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.stroke();
        ctx.strokeStyle = 'rgba(140,160,185,0.18)';
        ctx.beginPath();
        ctx.arc(cx, cy, 13, 0, TAU);
        ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12);
          ctx.stroke();
        }
      }
    } else {
      // Outer wall: a running pipe along the inner edge.
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 6, y0 + 6, x1 - x0 - 12, y1 - y0 - 12);
    }
  }
}

function activeSite(r) {
  return SITES[ROUND_SITE[r.n]];
}

function drawSites(ctx, t) {
  const r = roundAt(t);
  const s = activeSite(r);
  ctx.save();
  ctx.translate(s.x, s.y);
  // Active-site beacon: soft fill, a slow pulse and a rotating segmented ring.
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s.r + 20);
  g.addColorStop(0, 'rgba(235,240,248,0.05)');
  g.addColorStop(1, 'rgba(235,240,248,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, s.r + 20, 0, TAU);
  ctx.fill();
  const pulse = (t * 0.5) % 1;
  ctx.strokeStyle = `rgba(235,240,248,${0.16 * (1 - pulse)})`;
  ctx.lineWidth = 2;
  hexPath(ctx, 0, 0, s.r + 8 + pulse * 34, 0);
  ctx.stroke();
  ctx.save();
  ctx.rotate(t * 0.2);
  ctx.strokeStyle = 'rgba(235,240,248,0.26)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, s.r + 30, (i / 6) * TAU, (i / 6) * TAU + 0.6);
    ctx.stroke();
  }
  ctx.restore();
  if (r.capture) {
    const k = clamp((t - (r.capture - 6)) / 6, 0, 1);
    const c = TEAM[r.winner];
    if (k > 0 && t < r.end + 4) {
      ctx.fillStyle = rgba(c, 0.05 + 0.1 * k);
      hexPath(ctx, 0, 0, s.r + 8, 0);
      ctx.fill();
      // progress ring
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(0, 0, s.r + 30, 0, TAU);
      ctx.stroke();
      ctx.save();
      ctx.shadowColor = rgba(c, 0.9);
      ctx.shadowBlur = 14;
      ctx.strokeStyle = rgba(c, 1);
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, s.r + 30, -Math.PI / 2, -Math.PI / 2 + k * TAU);
      ctx.stroke();
      ctx.restore();
    }
    const since = t - r.capture;
    if (since >= 0 && since < 1.6) {
      const f = since / 1.6;
      ctx.strokeStyle = rgba(c, (1 - f) * 0.9);
      ctx.lineWidth = 8 * (1 - f) + 1;
      hexPath(ctx, 0, 0, s.r + 8 + ease(f) * 160, 0);
      ctx.stroke();
      ctx.fillStyle = rgba(c, 0.25 * (1 - f));
      hexPath(ctx, 0, 0, s.r + 8, 0);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawFootprints(ctx, t, u, s) {
  if (!s.alive) return;
  const r = s.round;
  const step = 0.2;
  const base = Math.floor(t / step);
  ctx.fillStyle = rgba(TEAM[u.team], 1);
  for (let j = 1; j <= 12; j++) {
    const tq = (base - j) * step;
    if (tq < r.start) break;
    const v = trackVel(TR[r.n][u.id], tq);
    if (Math.hypot(v.x, v.y) < 25) continue;
    const p = posAt(u, tq, r);
    const a = Math.atan2(v.y, v.x);
    const side = (base - j) % 2 ? 1 : -1;
    const age = (t - tq) / (12 * step);
    ctx.globalAlpha = 0.16 * (1 - age);
    ctx.beginPath();
    ctx.ellipse(p.x - Math.sin(a) * 4 * side, p.y + Math.cos(a) * 4 * side, 3.2, 1.8, a, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCone(ctx, u, s, len, alpha) {
  if (!s.alive) return;
  const g = ctx.createRadialGradient(s.x, s.y, 8, s.x, s.y, len);
  g.addColorStop(0, rgba(TEAM[u.team], alpha));
  g.addColorStop(1, rgba(TEAM[u.team], 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.arc(s.x, s.y, len, s.facing - 0.42, s.facing + 0.42);
  ctx.closePath();
  ctx.fill();
}

/** A top-down soldier: pack, armoured torso with a team stripe, both arms on the rifle, helmet and goggles. */
function drawSoldier(ctx, team, dead, breathe) {
  const c = TEAM[team];
  const accent = dead ? 'rgba(120,128,140,0.5)' : rgba(c, 1);
  // pack
  ctx.fillStyle = dead ? '#1a1d22' : '#1d242d';
  rr(ctx, -14.5, -7, 8, 14, 2.5);
  ctx.fill();
  // torso (vest)
  ctx.fillStyle = dead ? '#2b2f35' : '#343e4b';
  ctx.beginPath();
  ctx.ellipse(-1.5, 0, 7.4 * breathe, 13, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // team stripe across the shoulders
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.ellipse(-1.5, 0, 5.2, 11.2, 0, Math.PI * 0.62, Math.PI * 1.38);
  ctx.stroke();
  // arms reaching to the rifle
  ctx.lineCap = 'round';
  ctx.strokeStyle = dead ? '#2c3036' : '#3b4553';
  ctx.lineWidth = 4.6;
  ctx.beginPath();
  ctx.moveTo(-0.5, 10.5);
  ctx.quadraticCurveTo(5, 10, 10, 5.8);
  ctx.moveTo(-0.5, -10.5);
  ctx.quadraticCurveTo(9, -8, 17, 2.4);
  ctx.stroke();
  // rifle
  ctx.fillStyle = '#0a0c0f';
  rr(ctx, 2, 1.6, 23, 4.2, 1.2);
  ctx.fill();
  ctx.fillRect(24, 2.7, 8, 2);
  ctx.fillRect(12, 5.4, 3.4, 4.2);
  ctx.strokeStyle = 'rgba(170,185,205,0.4)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(3, 2.2);
  ctx.lineTo(24, 2.2);
  ctx.stroke();
  // gloves
  ctx.fillStyle = '#161a20';
  ctx.beginPath();
  ctx.arc(10, 5.8, 2.3, 0, TAU);
  ctx.arc(17, 2.6, 2.3, 0, TAU);
  ctx.fill();
  // helmet
  const hg = ctx.createRadialGradient(-1.5, -2, 0.5, 0, 0, 6.5);
  hg.addColorStop(0, dead ? '#4a4f57' : '#616d7c');
  hg.addColorStop(1, dead ? '#25282d' : '#2a313b');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(0, 0, 5.9, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // goggles strap and lens
  ctx.fillStyle = dead ? '#3a3f46' : '#0d1014';
  rr(ctx, 3.2, -3.2, 2.6, 6.4, 1.2);
  ctx.fill();
  ctx.fillStyle = dead ? 'rgba(0,0,0,0)' : rgba(c, 0.85);
  ctx.fillRect(4.6, -2.4, 1, 4.8);
}

function drawUnit(ctx, u, s, t, opts) {
  const c = TEAM[u.team];
  ctx.save();
  ctx.translate(s.x, s.y);
  if (!s.alive) {
    // Downed: the body slumps away from the shot and greys out; a red marker stays where they fell.
    const f = s.fall;
    ctx.save();
    ctx.globalAlpha = lerp(1, 0.62, f);
    ctx.rotate(s.facing + 0.9 * f);
    ctx.scale(1 + 0.12 * f, 1 - 0.12 * f);
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    drawSoldier(ctx, u.team, f > 0.25, 1);
    ctx.restore();
    const flash = clamp(1 - s.since / 0.35, 0, 1);
    if (flash > 0) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
      g.addColorStop(0, rgba(RED, 0.45 * flash));
      g.addColorStop(1, rgba(RED, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, TAU);
      ctx.fill();
    }
    // marker: red ring with an X, slightly offset so the body stays readable
    const m = ease((s.since - 0.25) / 0.4);
    if (m > 0) {
      ctx.globalAlpha = m * 0.95;
      ctx.strokeStyle = rgba(RED, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba(c, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 19.5, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = rgba(RED, 1);
      ctx.beginPath();
      ctx.moveTo(-4, -4); ctx.lineTo(4, 4); ctx.moveTo(4, -4); ctx.lineTo(-4, 4);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  // Ground ring and soft shadow.
  const sg = ctx.createRadialGradient(3, 4, 2, 3, 4, 20);
  sg.addColorStop(0, 'rgba(0,0,0,0.55)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(3, 4, 20, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(c, opts.focus ? 0.9 : 0.45);
  ctx.lineWidth = opts.focus ? 2 : 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, 17, 0, TAU);
  ctx.stroke();
  if (opts.focus) {
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 30);
    g.addColorStop(0, rgba(c, 0.22));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, TAU);
    ctx.fill();
  }
  ctx.rotate(s.facing);
  // recoil kick when firing
  let kick = 0;
  for (const sh of opts.shots) if (sh.by === u.id && t >= sh.t && t < sh.t + 0.08) kick = Math.max(kick, 1 - (t - sh.t) / 0.08);
  ctx.translate(-2.2 * kick, 0);
  ctx.scale(1.2, 1.2);
  drawSoldier(ctx, u.team, false, 1 + Math.sin(t * 2.4 + u.index) * 0.03);
  ctx.restore();
}

function drawShots(ctx, t, recent) {
  for (const s of recent) {
    const a = t - s.t;
    const c = TEAM[s.team];
    const kill = s.kind === 'kill';
    // tracer
    if (a < 0.14) {
      const L = Math.hypot(s.bx - s.ax, s.by2 - s.ay);
      const head = 1; // hitscan: the round is there on the frame it is fired
      const tail = clamp(a / 0.13, 0, 1);
      const hx = lerp(s.ax, s.bx, head), hy = lerp(s.ay, s.by2, head);
      const tx = lerp(s.ax, s.bx, tail), ty = lerp(s.ay, s.by2, tail);
      if (L > 1 && head > tail) {
        const g = ctx.createLinearGradient(tx, ty, hx, hy);
        g.addColorStop(0, rgba(c, 0));
        g.addColorStop(1, kill ? 'rgba(255,255,255,0.95)' : rgba(c, 0.85));
        ctx.save();
        ctx.strokeStyle = g;
        ctx.lineCap = 'round';
        ctx.lineWidth = kill ? 3.2 : 2;
        ctx.shadowColor = rgba(c, 1);
        ctx.shadowBlur = kill ? 16 : 8;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.restore();
      }
    }
    // muzzle flash
    if (a < 0.055) {
      const k = 1 - a / 0.055;
      ctx.save();
      ctx.translate(s.ax, s.ay);
      ctx.rotate(s.ang);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
      g.addColorStop(0, `rgba(255,240,200,${0.8 * k})`);
      g.addColorStop(0.4, rgba(c, 0.35 * k));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255,250,230,${k})`;
      ctx.beginPath();
      const len = 14 + seeded(s.t * 1000, 3) * 8;
      ctx.moveTo(0, -3.5);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(4, 0);
      ctx.closePath();
      ctx.moveTo(2, 0);
      ctx.lineTo(7, -8);
      ctx.lineTo(5, 0);
      ctx.lineTo(7, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // impact
    const ia = s.kind === 'wall' || s.kind === 'floor' ? a - 0.016 : a;
    if (ia >= 0 && ia < 0.45) {
      const k = ia / 0.45;
      ctx.save();
      ctx.translate(s.bx, s.by2);
      if (s.kind === 'wall' || s.kind === 'floor') {
        const col = s.kind === 'wall' ? [255, 214, 150] : [190, 196, 205];
        ctx.globalCompositeOperation = s.kind === 'wall' ? 'lighter' : 'source-over';
        for (let i = 0; i < 6; i++) {
          const ang = s.ang + Math.PI + (seeded(s.t * 1000, i, 5) - 0.5) * 2.2;
          const d0 = 2 + ease(k) * (10 + seeded(s.t * 1000, i, 6) * 16);
          const d1 = d0 + 5 * (1 - k);
          ctx.strokeStyle = rgba(col, (1 - k) * 0.9);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(Math.cos(ang) * d0, Math.sin(ang) * d0);
          ctx.lineTo(Math.cos(ang) * d1, Math.sin(ang) * d1);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(150,155,165,${0.22 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(0, 0, 4 + k * 10, 0, TAU);
        ctx.fill();
      } else {
        // hit on a player: red burst along the shot
        const n = kill ? 12 : 6;
        for (let i = 0; i < n; i++) {
          const ang = s.ang + (seeded(s.t * 1000, i, 7) - 0.5) * 1.6;
          const d = 4 + ease(k) * (12 + seeded(s.t * 1000, i, 8) * (kill ? 30 : 14));
          ctx.fillStyle = rgba(RED, (1 - k) * 0.95);
          ctx.beginPath();
          ctx.arc(Math.cos(ang) * d, Math.sin(ang) * d, (kill ? 2.4 : 1.7) * (1 - k * 0.6), 0, TAU);
          ctx.fill();
        }
        if (kill) {
          ctx.strokeStyle = rgba(RED, 0.9 * (1 - k));
          ctx.lineWidth = 3 * (1 - k) + 0.5;
          ctx.beginPath();
          ctx.arc(0, 0, 10 + ease(k) * 46, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
}

function drawSmoke(ctx, t) {
  for (const s of SMOKES) {
    const age = t - s.t;
    if (age < 0 || age > s.dur + 3) continue;
    const grow = ease(age / 1.2);
    const fade = 1 - ease((age - s.dur) / 3);
    for (let i = 0; i < 16; i++) {
      const a = seeded(i, s.t, 61) * TAU + age * 0.05 * (i % 2 ? 1 : -1);
      const d = (8 + seeded(i, s.t, 62) * 52) * grow;
      const x = s.x + Math.cos(a) * d + Math.sin(t * 0.4 + i) * 5;
      const y = s.y + Math.sin(a) * d + Math.cos(t * 0.33 + i * 1.3) * 5;
      const r = (30 + seeded(i, s.t, 63) * 26) * (0.35 + 0.65 * grow) * (1 + 0.15 * clamp((age - s.dur) / 3, 0, 1));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const al = 0.17 * fade;
      g.addColorStop(0, `rgba(176,184,196,${al})`);
      g.addColorStop(0.6, `rgba(150,158,170,${al * 0.55})`);
      g.addColorStop(1, 'rgba(140,148,160,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  }
}

function drawDust(ctx, t) {
  ctx.fillStyle = 'rgba(210,220,235,1)';
  for (let i = 0; i < 90; i++) {
    const x = (seeded(i, 71) * W + t * (4 + seeded(i, 72) * 8)) % W;
    const y = (seeded(i, 73) * H + Math.sin(t * 0.3 + i) * 18 + t * 2) % H;
    ctx.globalAlpha = 0.05 + 0.08 * (0.5 + 0.5 * Math.sin(t * (0.5 + seeded(i, 74)) + i));
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------------------------------- Visibility */

const SEGMENTS = (() => {
  const segs = [];
  for (const w of WALLS) {
    const x0 = w.x, y0 = w.y, x1 = w.x + w.w, y1 = w.y + w.h;
    segs.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]);
  }
  return segs;
})();
const CORNERS = WALLS.flatMap((w) => [[w.x, w.y], [w.x + w.w, w.y], [w.x + w.w, w.y + w.h], [w.x, w.y + w.h]]);

function castRay(ox, oy, ang, maxD) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let best = maxD;
  for (const [x0, y0, x1, y1] of SEGMENTS) {
    const ex = x1 - x0, ey = y1 - y0;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const tx = ((x0 - ox) * ey - (y0 - oy) * ex) / den;
    const u = ((x0 - ox) * dy - (y0 - oy) * dx) / den;
    if (tx > 0 && u >= 0 && u <= 1 && tx < best) best = tx;
  }
  return best;
}

function visibilityPolygon(ox, oy, maxD) {
  const angs = [];
  for (let i = 0; i < 180; i++) angs.push((i / 180) * TAU - Math.PI);
  for (const [x, y] of CORNERS) {
    if (Math.hypot(x - ox, y - oy) > maxD) continue;
    const a = Math.atan2(y - oy, x - ox);
    angs.push(a - 0.0004, a + 0.0004);
  }
  angs.sort((a, b) => a - b);
  return angs.map((a) => {
    const d = castRay(ox, oy, a, maxD);
    return [ox + Math.cos(a) * d, oy + Math.sin(a) * d];
  });
}

/* ------------------------------------------------------------------------------------------- Cameras */

function darkness(t) {
  let d = 0;
  for (const r of ROUNDS) {
    const i = ROUNDS.indexOf(r);
    const next = ROUNDS[i + 1];
    const sw = next ? switchTime(next) : Infinity;
    if (t >= r.end + 1.6 && t < sw) d = Math.max(d, ease((t - (r.end + 1.6)) / 2.4));
    if (next && t >= sw && t < sw + 2.2) d = Math.max(d, 1 - ease((t - sw) / 2));
  }
  return d;
}

function overlays(ctx, t, w, h, sc) {
  // Vignette and a cool grade.
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Round banner after each round ends.
  const r = roundAt(t);
  const since = t - r.end;
  if (since > 0 && since < 4) {
    const a = ease(since / 0.4) * (1 - ease((since - 3) / 0.8));
    const c = TEAM[r.winner];
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = h * 0.36;
    ctx.fillStyle = 'rgba(6,8,11,0.72)';
    ctx.fillRect(w / 2 - 230 * sc, y - 34 * sc, 460 * sc, 68 * sc);
    ctx.fillStyle = rgba(c, 1);
    ctx.fillRect(w / 2 - 230 * sc, y - 34 * sc, 460 * sc, 3 * sc);
    ctx.font = `600 ${12 * sc}px ${FONT}`;
    ctx.fillStyle = 'rgba(220,228,240,0.7)';
    ctx.fillText(`ROUND ${r.n}  ·  ${r.by === 'objective' ? 'OBJECTIVE SECURED' : 'TEAM ELIMINATED'}`.split('').join(' '), w / 2, y - 12 * sc);
    ctx.font = `800 ${24 * sc}px ${FONT}`;
    ctx.fillStyle = rgba(c, 1);
    ctx.fillText(`${TEAMS[r.winner].toUpperCase()} WINS THE ROUND`, w / 2, y + 12 * sc);
    ctx.restore();
  }
  // Between rounds: dip to black with the next round's card.
  const d = darkness(t);
  if (d > 0) {
    ctx.fillStyle = `rgba(4,5,8,${d})`;
    ctx.fillRect(0, 0, w, h);
    const i = ROUNDS.indexOf(r);
    const next = t < switchTime(r) + 3 && i > 0 ? r : ROUNDS[i + 1];
    if (next && d > 0.5) {
      ctx.save();
      ctx.globalAlpha = ease((d - 0.5) / 0.4);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${34 * sc}px ${FONT}`;
      ctx.fillStyle = '#e8edf5';
      ctx.fillText(`ROUND ${next.n}`, w / 2, h / 2 - 6 * sc);
      ctx.font = `600 ${12 * sc}px ${FONT}`;
      ctx.fillStyle = 'rgba(200,210,225,0.6)';
      ctx.fillText(`OBJECTIVE ${activeSite(next).name}`, w / 2, h / 2 + 26 * sc);
      ctx.fillStyle = rgba(TEAM[0], 0.9);
      ctx.fillRect(w / 2 - 90 * sc, h / 2 + 46 * sc, 86 * sc, 2 * sc);
      ctx.fillStyle = rgba(TEAM[1], 0.9);
      ctx.fillRect(w / 2 + 4 * sc, h / 2 + 46 * sc, 86 * sc, 2 * sc);
      ctx.restore();
    }
  }
}

function drawLabel(ctx, x, y, u, s, sc, alpha) {
  const c = TEAM[u.team];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `600 ${10.5 * sc}px ${FONT}`;
  const tw = ctx.measureText(u.name).width;
  const pw = tw + 14 * sc, ph = 15 * sc;
  ctx.fillStyle = 'rgba(6,8,11,0.72)';
  rr(ctx, x - pw / 2, y - ph, pw, ph, 3 * sc);
  ctx.fill();
  ctx.fillStyle = rgba(c, 1);
  ctx.fillRect(x - pw / 2, y - ph + 3 * sc, 2.2 * sc, ph - 6 * sc);
  ctx.fillStyle = '#e9eef6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(u.name, x + 1 * sc, y - ph / 2 + 0.5 * sc);
  // health bar
  const bw = 34 * sc, bh = 3 * sc;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - bw / 2, y + 3 * sc, bw, bh);
  ctx.fillStyle = s.hp > 40 ? rgba(c, 1) : rgba(RED, 1);
  ctx.fillRect(x - bw / 2, y + 3 * sc, (bw * s.hp) / 100, bh);
  ctx.restore();
}

function recentShots(t) {
  const out = [];
  for (const s of SHOTS) {
    if (s.t > t) break;
    if (t - s.t < 0.5) out.push(s);
  }
  return out;
}

/** Map overview: the whole arena, every unit, broadcast style. */
function drawOverview(ctx, t, w, h) {
  const sc = Math.min(w / W, h / H);
  const ox = (w - W * sc) / 2, oy = (h - H * sc) / 2;
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(sc, sc);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(getMap(sc * 1.5), 0, 0, W, H);
  const states = UNITS.map((u) => [u, unitState(u, t)]);
  const shots = recentShots(t);
  drawSites(ctx, t);
  for (const [u, s] of states) drawFootprints(ctx, t, u, s);
  for (const [u, s] of states) if (!s.alive) drawUnit(ctx, u, s, t, { shots });
  for (const [u, s] of states) drawCone(ctx, u, s, 190, 0.13);
  drawSolids(ctx, { x: W / 2, y: H / 2 });
  for (const [u, s] of states) if (s.alive) drawUnit(ctx, u, s, t, { shots, focus: u.id === 'a1' || u.id === 'e1' });
  drawShots(ctx, t, shots);
  drawSmoke(ctx, t);
  drawDust(ctx, t);
  ctx.restore();
  for (const [u, s] of states) {
    if (!s.alive) continue;
    drawLabel(ctx, ox + s.x * sc, oy + (s.y - 30) * sc, u, s, 0.95, 1);
  }
  overlays(ctx, t, w, h, w / 1280);
}

/** Who a POV camera is watching at t: the player, or after they fall, a living teammate (chained). */
function spectateChain(id, r) {
  const list = [{ id, from: -Infinity }];
  let cur = id;
  for (;;) {
    const d = deathOf(cur, r);
    if (!d) break;
    const at = d.t + 1.6;
    const deadPos = posAt(unitById[cur], d.t, r);
    const mates = UNITS.filter((u) => u.team === unitById[id].team && !list.some((l) => l.id === u.id) && isAlive(u, at, r));
    if (!mates.length) break;
    mates.sort((a, b) => {
      const pa = posAt(a, at, r), pb = posAt(b, at, r);
      return Math.hypot(pa.x - deadPos.x, pa.y - deadPos.y) - Math.hypot(pb.x - deadPos.x, pb.y - deadPos.y);
    });
    list.push({ id: mates[0].id, from: at });
    cur = mates[0].id;
  }
  return list;
}

/** Eased follow pose for one unit: position averaged over the last 0.5 s, heading over the last 1.4 s, look-ahead. */
function followPose(u, t, r) {
  const t0 = switchTime(r);
  const d = deathOf(u.id, r);
  const clampT = (s) => Math.max(t0, d ? Math.min(s, d.t + 0.4) : s);
  let x = 0, y = 0, ws = 0;
  for (let j = 0; j < 8; j++) {
    const s = clampT(t - j * 0.07);
    const st = d && s >= d.t ? unitState(u, s) : posAt(u, s, r);
    const wt = 8 - j;
    x += st.x * wt;
    y += st.y * wt;
    ws += wt;
  }
  x /= ws;
  y /= ws;
  let hx = 0, hy = 0;
  for (let j = 0; j < 14; j++) {
    const s = clampT(t - j * 0.1);
    const a = facing(u, s, r);
    hx += Math.cos(a) * (14 - j);
    hy += Math.sin(a) * (14 - j);
  }
  const heading = Math.atan2(hy, hx);
  return { x: x + Math.cos(heading) * 55, y: y + Math.sin(heading) * 55, heading };
}

function povCamera(id, t) {
  const r = roundAt(t);
  const chain = spectateChain(id, r);
  let k = 0;
  while (k + 1 < chain.length && t >= chain[k + 1].from) k++;
  const cur = followPose(unitById[chain[k].id], t, r);
  let cam = cur;
  if (k > 0) {
    const b = ease((t - chain[k].from) / 1.3);
    if (b < 1) {
      const prev = followPose(unitById[chain[k - 1].id], t, r);
      cam = { x: lerp(prev.x, cur.x, b), y: lerp(prev.y, cur.y, b), heading: angLerp(prev.heading, cur.heading, b) };
    }
  }
  return { ...cam, followId: chain[k].id, spectating: k > 0, blendFrom: k > 0 ? chain[k - 1].id : null };
}

let FOG = null;

/** A player's point of view: the camera rides behind them, turned to where they look, with line-of-sight fog. */
function drawPov(ctx, t, w, h, id) {
  const r = roundAt(t);
  const cam = povCamera(id, t);
  const zoom = 1.5 * (w / 1280);
  const ax = w / 2, ay = h * 0.6;
  const rot = -cam.heading - Math.PI / 2;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const toScreen = (x, y) => {
    const dx = (x - cam.x) * zoom, dy = (y - cam.y) * zoom;
    return [ax + dx * cr - dy * sr, ay + dx * sr + dy * cr];
  };
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(rot);
  ctx.scale(zoom, zoom);
  ctx.translate(-cam.x, -cam.y);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(getMap(2), 0, 0, W, H);

  const me = unitById[cam.followId];
  const meS = unitState(me, t);
  const states = UNITS.map((u) => [u, unitState(u, t)]);
  const shots = recentShots(t);
  // Enemy visibility from the watched unit (faded over the last 0.25 s so it never pops).
  const eye = { x: meS.x, y: meS.y };
  const vis = (u) => {
    if (u.team === me.team) return 1;
    let v = 0;
    for (let j = 0; j < 4; j++) {
      const s = Math.max(t - j * 0.08, r.start);
      const a = unitState(me, s), b = unitState(u, s);
      if (los(a, b)) v += 0.25;
    }
    return v;
  };
  drawSites(ctx, t);
  for (const [u, s] of states) if (vis(u) > 0) drawFootprints(ctx, t, u, s);
  for (const [u, s] of states) if (!s.alive) drawUnit(ctx, u, s, t, { shots });
  ctx.restore();

  // Line-of-sight fog: everything the watched unit cannot see is dimmed, with a soft edge.
  const fw = Math.ceil(w / 4), fh = Math.ceil(h / 4);
  if (!FOG) FOG = document.createElement('canvas');
  if (FOG.width !== fw) { FOG.width = fw; FOG.height = fh; }
  const f = FOG.getContext('2d');
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = 'source-over';
  f.filter = 'none';
  f.clearRect(0, 0, fw, fh);
  f.fillStyle = 'rgba(3,5,8,0.6)';
  f.fillRect(0, 0, fw, fh);
  f.globalCompositeOperation = 'destination-out';
  f.filter = 'blur(2.5px)';
  const poly = visibilityPolygon(eye.x, eye.y, 1100);
  f.fillStyle = '#fff';
  f.beginPath();
  poly.forEach(([x, y], i) => {
    const [sx, sy] = toScreen(x, y);
    i ? f.lineTo(sx / 4, sy / 4) : f.moveTo(sx / 4, sy / 4);
  });
  f.closePath();
  f.fill();
  f.filter = 'none';
  f.globalCompositeOperation = 'source-over';
  ctx.drawImage(FOG, 0, 0, w, h);

  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(rot);
  ctx.scale(zoom, zoom);
  ctx.translate(-cam.x, -cam.y);
  // Vision cone of the watched unit: a soft light ahead.
  if (meS.alive) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawCone(ctx, me, meS, 300, 0.07);
    ctx.restore();
  }
  drawSolids(ctx, { x: cam.x, y: cam.y });
  for (const [u, s] of states) {
    if (!s.alive) continue;
    const v = vis(u);
    if (v <= 0) continue;
    ctx.save();
    ctx.globalAlpha = v;
    drawUnit(ctx, u, s, t, { shots, focus: u.id === cam.followId });
    ctx.restore();
  }
  drawShots(ctx, t, shots);
  drawSmoke(ctx, t);
  drawDust(ctx, t);
  ctx.restore();

  for (const [u, s] of states) {
    if (!s.alive) continue;
    const v = vis(u);
    if (v <= 0) continue;
    // Tag sits on the side away from where the unit points, so it never covers the rifle.
    const [sx, sy] = toScreen(s.x, s.y);
    const a = s.facing + rot;
    const d = 40 * (w / 1280);
    drawLabel(ctx, sx - Math.cos(a) * d, sy - Math.sin(a) * d + 6 * (w / 1280), u, s, w / 1280, v);
  }
  // Spectating tag.
  const sc = w / 1280;
  const tagA = cam.spectating ? ease((t - (deathOf(id, r)?.t ?? t) - 1.2) / 0.5) : 0;
  if (tagA > 0) {
    const name = unitById[cam.followId].name;
    ctx.save();
    ctx.globalAlpha = tagA;
    ctx.font = `600 ${11 * sc}px ${FONT}`;
    const label = 'SPECTATING';
    const tw1 = ctx.measureText(label).width;
    ctx.font = `700 ${13 * sc}px ${FONT}`;
    const tw2 = ctx.measureText(name).width;
    const pw = tw1 + tw2 + 34 * sc;
    const x = w / 2 - pw / 2, y = h - 132 * sc;
    ctx.fillStyle = 'rgba(6,8,11,0.75)';
    rr(ctx, x, y, pw, 26 * sc, 4 * sc);
    ctx.fill();
    ctx.fillStyle = rgba(TEAM[me.team], 1);
    ctx.fillRect(x, y + 23 * sc, pw, 3 * sc);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `600 ${11 * sc}px ${FONT}`;
    ctx.fillStyle = 'rgba(200,210,225,0.7)';
    ctx.fillText(label, x + 12 * sc, y + 12 * sc);
    ctx.font = `700 ${13 * sc}px ${FONT}`;
    ctx.fillStyle = '#eef2f8';
    ctx.fillText(name, x + 22 * sc + tw1, y + 12 * sc);
    ctx.restore();
  }
  overlays(ctx, t, w, h, sc);
}

/** Draw one camera into a 2D context. view: 'overview' | 'p1' | 'p2'. */
function drawView(ctx, view, t, w, h) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (view === 'overview') drawOverview(ctx, t, w, h);
  else drawPov(ctx, t, w, h, view === 'p1' ? 'a1' : 'e1');
}
