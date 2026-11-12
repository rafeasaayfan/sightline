import { formatTime, type MatchEvent } from '@/video/skin';

interface ScoreRow {
  t: number;
  round: number;
  [team: string]: number;
}

interface SummaryInput {
  match: { scoreboard?: ScoreRow[] };
  events: MatchEvent[];
  teams: [string, string];
  duration: number;
  seek: (time: number) => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/*
 * Match summary, written from the data the page already has: the scoreboard in match.json and the events in
 * events.vtt. It reads like a caster's recap, and every moment in it is a button that seeks the stage.
 */
export function renderSummary({ match, events, teams, duration, seek }: SummaryInput): void {
  const host = document.querySelector<HTMLElement>('[data-summary]');
  const rows = [...(match.scoreboard ?? [])].sort((a, b) => a.t - b.t);
  if (!host || rows.length === 0 || !Number.isFinite(duration) || duration <= 0) return;

  const [a, b] = teams;
  const ka = a.toLowerCase();
  const kb = b.toLowerCase();
  const last = rows[rows.length - 1]!;
  const sa = last[ka] ?? 0;
  const sb = last[kb] ?? 0;
  const rounds = Math.max(...rows.map((r) => r.round));
  const leader = sa === sb ? null : sa > sb ? a : b;

  // The moment the eventual leader went ahead for good.
  let decisive: number | null = null;
  for (const r of rows) {
    const d = (r[ka] ?? 0) - (r[kb] ?? 0);
    const ahead = d === 0 ? null : d > 0 ? a : b;
    if (ahead !== leader) decisive = null;
    else if (decisive === null) decisive = r.t;
  }
  const clutch = events.find((e) => e.type === 'clutch');
  const swing = clutch ?? (decisive !== null ? events.find((e) => Math.abs(e.time - decisive!) < 2) : undefined);

  const headline = leader
    ? `${leader} take it ${Math.max(sa, sb)}–${Math.min(sa, sb)} across ${rounds} rounds.`
    : `${a} and ${b} finish level at ${sa}–${sb} after ${rounds} rounds.`;
  const swingLine = swing
    ? ` The swing came at ${formatTime(swing.time)}: ${swing.label.replace(/ · /g, ', ').toLowerCase()}${leader && decisive !== null ? `, and ${leader} never trailed again` : ''}.`
    : '';
  const elims = events.filter((e) => e.type === 'elim').length;
  const objs = events.filter((e) => e.kind === 'objective').length;

  host.querySelector('[data-summary-text]')!.textContent = `${headline}${swingLine} ${elims} eliminations and ${objs} objectives on the timeline.`;
  host.querySelector('[data-summary-score]')!.innerHTML =
    `<span class="score-team score-a">${esc(a)}</span><span class="score-num">${sa}</span><span class="score-sep" aria-hidden="true">·</span><span class="score-num">${sb}</span><span class="score-team score-b">${esc(b)}</span>`;
  host.querySelector('[data-summary-score]')!.setAttribute('aria-label', `Final score: ${a} ${sa}, ${b} ${sb}`);

  // Momentum: the score difference over the match, with the events beneath it.
  const W = 640;
  const H = 160;
  const mid = H / 2;
  const maxDiff = Math.max(1, ...rows.map((r) => Math.abs((r[ka] ?? 0) - (r[kb] ?? 0))));
  const x = (t: number) => (t / duration) * W;
  const y = (d: number) => mid - (d / maxDiff) * (mid - 18);
  let path = `M0 ${y(0)}`;
  for (const r of rows) {
    const d = (r[ka] ?? 0) - (r[kb] ?? 0);
    path += `H${x(r.t).toFixed(1)}V${y(d).toFixed(1)}`;
  }
  path += `H${W}`;
  const marks = events
    .map((e) => {
      const cx = x(e.time).toFixed(1);
      if (e.kind === 'round') return `<rect x="${cx}" y="${H - 22}" width="2" height="14" fill="var(--round)"/>`;
      if (e.kind === 'objective') return `<rect x="${(+cx - 4).toFixed(1)}" y="${H - 19}" width="8" height="8" rx="2" fill="var(--signal)"/>`;
      return `<rect x="${(+cx - 4).toFixed(1)}" y="${H - 19}" width="8" height="8" fill="var(--event)" transform="rotate(45 ${cx} ${H - 15})"/>`;
    })
    .join('');
  const chart = host.querySelector<HTMLElement>('[data-summary-chart]')!;
  chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Momentum: ${esc(a)} above the line, ${esc(b)} below, across the match">
    <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="rgb(255 255 255 / .18)" stroke-dasharray="3 5"/>
    <path d="${path}" fill="none" stroke="var(--signal)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    ${marks}
  </svg>`;
  chart.onclick = (e) => {
    const r = chart.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * duration);
  };

  const list = host.querySelector<HTMLOListElement>('[data-summary-moments]')!;
  const moments = events.filter((e) => e.kind !== 'round' || e === events.find((x) => x.kind === 'round'));
  list.replaceChildren(
    ...moments.slice(0, 8).map((e) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'moment';
      btn.dataset.kind = e.kind;
      btn.innerHTML = `<span class="moment-mark" aria-hidden="true"></span><span class="moment-time">${formatTime(e.time)}</span><span>${esc(e.label)}</span>`;
      btn.addEventListener('click', () => {
        seek(e.time);
        document.getElementById('stage')?.scrollIntoView({ block: 'center' });
      });
      li.append(btn);
      return li;
    }),
  );
  host.hidden = false;
}

/* ---------------------------------------------------------------------------------------------- Customizer */

/*
 * "Make it yours": every control writes one public property or switch on the hero player, and the snippet shows
 * the CSS a host would write to get the same result.
 */
export function initCustomizer(root: HTMLElement): void {
  const form = document.querySelector<HTMLFormElement>('[data-customizer]');
  if (!form) return;
  const out = form.querySelector<HTMLElement>('[data-snippet]')!;

  const apply = () => {
    const data = new FormData(form);
    const accent = String(data.get('accent') ?? '#38e1ff');
    const radius = Number(data.get('radius') ?? 4);
    root.style.setProperty('--media-accent-color', accent);
    root.style.setProperty('--media-border-radius', `${radius}px`);
    root.closest<HTMLElement>('.stage')?.style.setProperty('--stage-radius', `${radius}px`);
    root.dataset.hud = data.get('hud') ? 'on' : 'off';
    root.dataset.keyhints = data.get('keyhints') ? 'on' : 'off';
    root.dataset.toasts = data.get('toasts') ? 'on' : 'off';
    form.querySelector('[data-radius-value]')!.textContent = `${radius}px`;
    const off = ['hud', 'toasts', 'keyhints'].filter((k) => !data.get(k)).map((k) => `data-${k}="off"`);
    out.textContent = `.sightline {
  --media-accent-color: ${accent};
  --media-border-radius: ${radius}px;
}${off.length ? `

<!-- on the player root -->
${off.join(' ')}` : ''}`;
  };

  form.addEventListener('input', apply);
  form.addEventListener('submit', (e) => e.preventDefault());
  apply();
}
