import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import {
  formatTime,
  nextHighlight,
  prevHighlight,
  setAngle,
  setLayout,
  setMultiview,
  setScoreboard,
  setStageState,
  setSync,
  type MatchEvent,
  cut,
  type Layout,
} from '@/video/skin';
import { sightlineIcons } from '@/video/icons';
import { initCustomizer, renderSummary } from './sections';
import skinTemplate from '@/video/skin.html?raw';

/* ------------------------------------------------------------------------------------------------ Data */

interface Angle {
  id: number;
  label: string;
  short?: string;
  mux?: string;
  src?: string;
  mp4?: string;
  crop?: { scale?: number; origin?: string };
  poster?: string;
}

interface ScoreEntry {
  t: number;
  round: number;
  [team: string]: number;
}

interface Match {
  title: string;
  teams?: [string, string];
  footage?: string;
  footageUrl?: string;
  repo?: string;
  angles: Angle[];
  events?: string;
  scoreboard?: ScoreEntry[];
}

type MediaEl = HTMLMediaElement & { src: string };

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';
const SYNC_MS = 500;
const SEEK_DRIFT = 0.25;
const SWITCH_NOTICE_MS = 150;
const wide = matchMedia('(min-width: 640px)');

const srcOf = (a: Angle) => (a.mux ? `https://stream.mux.com/${a.mux}.m3u8` : (a.src ?? a.mp4 ?? ''));
const usesMux = (a: Angle) => !!a.mux;

function applyCrop(media: HTMLElement, angle: Angle): void {
  media.style.setProperty('--crop-scale', String(angle.crop?.scale ?? 1));
  media.style.setProperty('--crop-origin', angle.crop?.origin ?? '50% 50%');
}

/* ------------------------------------------------------------------------------------------------ Stage */

function createStage(slot: HTMLElement, match: Match, angle: Angle): { root: HTMLElement; media: MediaEl } {
  const events = match.events ? `<track kind="metadata" label="events" src="./${match.events}" default>` : '';
  const cors = usesMux(angle) ? ' crossorigin="anonymous"' : '';
  const media = `<mux-video src="${srcOf(angle)}" playsinline preload="auto"${cors}>${events}</mux-video>`;
  const player = document.createElement('video-player');
  // Reuse the poster the page already painted as the player's poster image, so the stage never repaints it.
  const painted = slot.querySelector<HTMLImageElement>('.stage-poster');
  player.innerHTML = skinTemplate.replace(MEDIA_PLACEHOLDER, media);
  player.setAttribute('poster', './poster.jpg');
  const posterImg = player.querySelector<HTMLImageElement>('.media-poster-image');
  if (painted && posterImg) {
    painted.className = posterImg.className;
    painted.removeAttribute('width');
    painted.removeAttribute('height');
    posterImg.replaceWith(painted);
  }
  slot.replaceChildren(player);

  const root = player.querySelector<HTMLElement>('.sightline')!;
  const el = player.querySelector<MediaEl>('mux-video')!;
  applyCrop(el, angle);
  return { root, media: el };
}

/* ------------------------------------------------------------------------------------------------ App */

export async function start(): Promise<void> {
  // ?match=other.json loads another match file from the same folder.
  const file = new URLSearchParams(location.search).get('match')?.replace(/[^\w.-]/g, '') || 'match.json';
  const match = (await fetch(`./${file}`, { cache: 'no-cache' }).then((r) => r.json())) as Match;
  const angles = match.angles.filter((a) => srcOf(a));
  const [teamA, teamB] = match.teams ?? ['Azure', 'Ember'];

  document.querySelector('[data-match-title]')!.textContent = match.title;
  const footage = document.querySelector<HTMLAnchorElement>('[data-footage]')!;
  footage.textContent = match.footage ?? 'Footage';
  footage.href = match.footageUrl ?? '#';
  document.querySelector<HTMLElement>('[data-mux]')!.hidden = !angles.some(usesMux);
  const repo = document.querySelector<HTMLAnchorElement>('[data-repo-link]')!;
  repo.hidden = !match.repo;
  repo.href = match.repo ?? '#';

  const arena = document.querySelector<HTMLElement>('.arena')!;
  const { root, media: master } = createStage(document.querySelector('[data-stage]')!, match, angles[0]!);
  let stageAngle = angles[0]!;

  // The page docks the controls under the picture and gives the player a side column for the angles.
  root.setAttribute('data-docked', '');
  const side = document.querySelector<HTMLElement>('[data-angles-column]')!;
  side.classList.add('sl-side');
  root.querySelector('media-controls')!.after(side);

  // One source: an ordinary player, no angles column.
  if (angles.length < 2) arena.dataset.single = '';
  else root.setAttribute('data-angles', '');
  root.setAttribute('data-layout', 'split');
  setAngle(root, angles.length > 1 ? `Angle ${stageAngle.id} · ${stageAngle.label}` : null);

  /* ---------------------------------------------------------------- Tiles and chips */

  const tilesEl = document.querySelector<HTMLElement>('[data-tiles]')!;
  const chipsEl = document.querySelector<HTMLElement>('[data-chips]')!;
  const tiles = new Map<number, { button: HTMLButtonElement; media?: MediaEl; clock: HTMLElement; failed: boolean }>();

  for (const angle of angles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tile';
    button.dataset.angle = String(angle.id);
    button.setAttribute('aria-label', `Switch to angle ${angle.id}, ${angle.label}`);
    button.setAttribute('aria-keyshortcuts', String(angle.id));
    button.innerHTML = `
      <span class="tile-video"></span>
      <span class="chip tile-label"><span class="tile-num">${angle.id}</span>${angle.label}</span>
      <span class="pill tile-muted"><span class="dot" aria-hidden="true"></span>Muted</span>
      <span class="tile-clock">00:00</span>`;
    button.addEventListener('click', () => swapTo(angle));
    tilesEl.append(button);
    tiles.set(angle.id, { button, clock: button.querySelector('.tile-clock')!, failed: false });

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'angle-chip';
    chip.dataset.angle = String(angle.id);
    chip.innerHTML = `<span class="visually-hidden">Angle </span><span class="angle-chip-num">${angle.id}</span><span class="angle-chip-label">${angle.short ?? angle.label}</span>`;
    chip.addEventListener('click', () => swapTo(angle));
    chipsEl.append(chip);
  }

  /** Tiles play only on wide screens with the angles column showing; phones stream the stage alone. */
  const tilesActive = () => wide.matches && arena.dataset.layout !== 'stage' && angles.length > 1;

  function ensureTileMedia(angle: Angle): MediaEl | undefined {
    const tile = tiles.get(angle.id)!;
    if (tile.failed) return undefined;
    if (!tile.media) {
      const m = document.createElement('mux-video') as unknown as MediaEl;
      m.muted = true;
      m.setAttribute('muted', '');
      m.setAttribute('playsinline', '');
      m.setAttribute('preload', 'auto');
      m.setAttribute('poster', angle.poster ?? './poster.jpg');
      m.setAttribute('aria-hidden', 'true');
      m.tabIndex = -1;
      m.src = srcOf(angle);
      applyCrop(m, angle);
      m.addEventListener('error', () => {
        tile.failed = true;
        tile.button.hidden = true;
        setStageState(root, { kind: 'unavailable', text: `Angle ${angle.id} unavailable · staying on Angle ${stageAngle.id}` });
        window.setTimeout(() => setStageState(root, null), 3000);
      });
      m.addEventListener('loadedmetadata', () => follow(m, true));
      // Each tile gets its own bare player: Video.js media attach to the nearest player, and the tiles sit inside the
      // stage's player now, so without this they would take over its controls.
      const holder = document.createElement('video-player');
      holder.append(m as unknown as Node);
      tile.button.querySelector('.tile-video')!.append(holder);
      tile.media = m;
    }
    return tile.media;
  }

  function renderAngles(): void {
    for (const angle of angles) {
      const onStage = angle.id === stageAngle.id;
      const tile = tiles.get(angle.id)!;
      tile.button.hidden = onStage || tile.failed;
      const chip = chipsEl.querySelector<HTMLButtonElement>(`[data-angle="${angle.id}"]`)!;
      chip.setAttribute('aria-pressed', String(onStage));
      if (!onStage && tilesActive()) {
        const m = ensureTileMedia(angle);
        if (m) follow(m, true);
      } else {
        tile.media?.pause();
      }
    }
  }

  /** Keep one tile on the master clock: mirror play state and rate; seek when far, nudge speed when close. */
  function follow(m: MediaEl, hard = false): number {
    if (!tilesActive()) return 0;
    const drift = m.currentTime - master.currentTime;
    if (hard || Math.abs(drift) > SEEK_DRIFT) {
      if (Math.abs(drift) > 0.05) m.currentTime = master.currentTime;
      m.playbackRate = master.playbackRate;
    } else {
      m.playbackRate = master.playbackRate * Math.min(1.03, Math.max(0.97, 1 - drift));
    }
    if (master.paused && !m.paused) m.pause();
    if (!master.paused && m.paused) void m.play().catch(() => undefined);
    return Math.abs(drift);
  }

  function syncAll(hard = false): void {
    let worst = 0;
    for (const angle of angles) {
      if (angle.id === stageAngle.id) continue;
      const m = tiles.get(angle.id)?.media;
      if (m && !tiles.get(angle.id)!.failed && m.readyState >= 1) worst = Math.max(worst, follow(m, hard));
    }
    setSync(root, tilesActive() ? (worst > SEEK_DRIFT ? 'drift' : 'ok') : null);
  }

  for (const type of ['play', 'pause', 'seeked', 'ratechange'] as const) master.addEventListener(type, () => syncAll(true));
  window.setInterval(() => syncAll(), SYNC_MS);

  /* ---------------------------------------------------------------- Swap */

  let swapping = false;

  async function swapTo(angle: Angle): Promise<void> {
    if (swapping || angle.id === stageAngle.id || tiles.get(angle.id)?.failed) return;
    swapping = true;
    const previous = stageAngle;
    const t = master.currentTime;
    const wasPlaying = !master.paused;
    const notice = window.setTimeout(
      () => setStageState(root, { kind: 'switching', text: `Switching to Angle ${angle.id}…` }),
      SWITCH_NOTICE_MS,
    );

    try {
      if (srcOf(angle) !== master.src) {
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            master.removeEventListener('loadedmetadata', done);
            master.removeEventListener('error', fail);
            resolve();
          };
          const fail = () => {
            master.removeEventListener('loadedmetadata', done);
            reject(new Error('source failed'));
          };
          master.addEventListener('loadedmetadata', done, { once: true });
          master.addEventListener('error', fail, { once: true });
          if (usesMux(angle)) master.setAttribute('crossorigin', 'anonymous');
          master.src = srcOf(angle);
        });
        master.currentTime = t;
        if (wasPlaying) await master.play().catch(() => undefined);
      }
      applyCrop(master, angle);
      stageAngle = angle;
      setAngle(root, `Angle ${angle.id} · ${angle.label}`);
      setStageState(root, null);
      cut(root);
    } catch {
      // Stay on the angle that works and say so.
      if (master.src !== srcOf(previous)) {
        master.src = srcOf(previous);
        master.addEventListener('loadedmetadata', () => {
          master.currentTime = t;
          if (wasPlaying) void master.play().catch(() => undefined);
        }, { once: true });
      }
      tiles.get(angle.id)!.failed = true;
      setStageState(root, { kind: 'unavailable', text: `Angle ${angle.id} unavailable · staying on Angle ${previous.id}` });
      window.setTimeout(() => setStageState(root, null), 3000);
    } finally {
      window.clearTimeout(notice);
      swapping = false;
      renderAngles();
      syncAll(true);
    }
  }

  /* ---------------------------------------------------------------- Layout */

  const layoutButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-layout-option]')];
  function applyLayout(value: Layout): void {
    arena.dataset.layout = value;
    // Stage only is an ordinary player: no multiview there.
    root.toggleAttribute('data-multiview', canWatch && value !== 'stage');
    watchButton.hidden = !canWatch || value === 'stage';
    for (const b of layoutButtons) b.setAttribute('aria-pressed', String(b.dataset.layoutOption === value));
    setLayout(root, value);
    renderAngles();
    syncAll(true);
  }
  for (const b of layoutButtons) b.addEventListener('click', () => applyLayout(b.dataset.layoutOption as Layout));
  root.addEventListener('sightline:layout', (e) => applyLayout((e as CustomEvent<Layout>).detail));
  wide.addEventListener('change', () => {
    renderAngles();
    syncAll(true);
  });

  /* ---------------------------------------------------------------- Multiview fullscreen: the arena alone, edge to edge */

  const canWatch = angles.length > 1 && document.fullscreenEnabled;
  const watching = () => document.fullscreenElement === arena;
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelector<HTMLElement>('[data-watch-title]')!.textContent = match.title;
  document.querySelector<HTMLElement>('[data-console-title]')!.textContent = match.title;
  const watchButton = document.querySelector<HTMLButtonElement>('[data-watch]')!;
  watchButton.hidden = !canWatch;
  if (canWatch) root.setAttribute('data-multiview', '');

  async function toggleWatch(): Promise<void> {
    if (!canWatch || (arena.dataset.layout === 'stage' && !watching())) return;
    if (watching()) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    // The skin may be in its own (stage-only) fullscreen; leave it first.
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    await arena.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  }

  document.addEventListener('fullscreenchange', () => {
    const on = watching();
    const was = arena.hasAttribute('data-watch');
    if (on === was) return;
    arena.toggleAttribute('data-watch', on);
    setMultiview(root, on);
    watchButton.setAttribute('aria-pressed', String(on));
    // Closing animates the arena back into the page; opening animates in CSS on :fullscreen.
    if (!on && !calm.matches) {
      arena.setAttribute('data-watch-closing', '');
      window.setTimeout(() => arena.removeAttribute('data-watch-closing'), 520);
    }
    if (on) root.querySelector<HTMLElement>('.sl-play')?.focus({ preventScroll: true });
    renderAngles();
    syncAll(true);
  });
  watchButton.addEventListener('click', () => void toggleWatch());
  document.querySelector('[data-watch-close]')!.addEventListener('click', () => void toggleWatch());
  root.addEventListener('sightline:multiview', () => void toggleWatch());

  /* ---------------------------------------------------------------- Moment links: ?t=95&angle=2 */

  const shareButton = document.querySelector<HTMLButtonElement>('[data-share]')!;
  const shareLabel = shareButton.querySelector<HTMLElement>('[data-share-label]')!;
  const shareStatus = document.querySelector<HTMLElement>('[data-share-status]')!;
  shareButton.addEventListener('click', async () => {
    const url = new URL(location.href);
    url.hash = '';
    url.searchParams.set('t', String(Math.floor(master.currentTime)));
    url.searchParams.set('angle', String(stageAngle.id));
    let text = `Link to ${formatTime(master.currentTime)} copied`;
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      history.replaceState(null, '', url);
      text = `Link to ${formatTime(master.currentTime)} is in the address bar`;
    }
    shareLabel.textContent = text;
    shareStatus.textContent = text;
    window.setTimeout(() => (shareLabel.textContent = 'Copy link to this moment'), 2400);
  });

  const params = new URLSearchParams(location.search);
  const startAt = Number(params.get('t'));
  const startAngle = angles.find((a) => String(a.id) === params.get('angle'));
  if (startAt > 0 || startAngle) {
    const jump = () => {
      if (startAt > 0 && Number.isFinite(master.duration)) master.currentTime = Math.min(startAt, master.duration - 1);
      if (startAngle && startAngle.id !== stageAngle.id) void swapTo(startAngle);
    };
    if (master.readyState >= 1) jump();
    else master.addEventListener('loadedmetadata', jump, { once: true });
  }

  /* ---------------------------------------------------------------- Spoiler-free: the page hides the recap and summary too */

  root.addEventListener('sightline:spoilers', (e) => {
    document.documentElement.toggleAttribute('data-spoilers', (e as CustomEvent<boolean>).detail);
  });

  /* ---------------------------------------------------------------- Keys: 1–3 anywhere on the page, N when outside the player */

  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (target.isContentEditable || /^(input|textarea|select)$/i.test(target.localName)) return;
    if (target.closest('[role="menu"], [popover]')) return;
    const angle = angles.find((a) => String(a.id) === e.key);
    if (angle) {
      e.preventDefault();
      void swapTo(angle);
      return;
    }
    // W outside the player opens multiview too (inside, the skin handles it).
    if (e.key.toLowerCase() === 'w' && !e.shiftKey && !root.contains(target)) {
      e.preventDefault();
      void toggleWatch();
      return;
    }
    // Inside the player the skin handles N itself.
    if (e.key.toLowerCase() === 'n' && !root.contains(target)) {
      e.preventDefault();
      if (e.shiftKey) prevHighlight(root);
      else nextHighlight(root);
    }
  });

  /* ---------------------------------------------------------------- Scoreboard, clocks and recap */

  const board = [...(match.scoreboard ?? [])].sort((a, b) => a.t - b.t);
  const recap = document.querySelector<HTMLOListElement>('[data-recap]')!;
  // Hide the recap only for a match without an events file; an empty list while cues load would shift the page.
  recap.closest('section')!.hidden = !match.events;
  let events: MatchEvent[] = [];

  function renderRecap(): void {
    recap.replaceChildren(
      ...events.map((event, index) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recap-item';
        button.dataset.kind = event.kind;
        button.dataset.type = event.type;
        if (event.team) button.dataset.team = event.team;
        button.dataset.index = String(index);
        button.style.setProperty('--i', String(index));
        const mark = event.kind === 'round' ? '' : (sightlineIcons[event.type === 'clutch' ? 'crown' : event.type === 'obj' ? 'flag' : 'skull'] ?? '');
        button.innerHTML = `<span class="recap-mark" aria-hidden="true">${mark}</span><span class="recap-time">${formatTime(event.time)}</span><span class="recap-label">${event.label}</span><span class="recap-now" aria-hidden="true">Now</span>`;
        button.addEventListener('click', () => {
          master.currentTime = event.time;
        });
        li.append(button);
        return li;
      }),
    );
  }

  // The recap rail: edge fades show where more events are; the arrows page it; the current event stays in view.
  const rail = document.querySelector<HTMLElement>('[data-recap-rail]')!;
  const edges = () => {
    const max = recap.scrollWidth - recap.clientWidth;
    rail.toggleAttribute('data-more-start', recap.scrollLeft > 4);
    rail.toggleAttribute('data-more-end', recap.scrollLeft < max - 4);
  };
  recap.addEventListener('scroll', edges, { passive: true });
  new ResizeObserver(edges).observe(recap);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-recap-step]')) {
    button.addEventListener('click', () => {
      recap.scrollBy({ left: Number(button.dataset.recapStep) * recap.clientWidth * 0.8, behavior: calm.matches ? 'auto' : 'smooth' });
    });
  }
  const keepInView = (item: HTMLElement) => {
    if (getComputedStyle(recap).flexDirection === 'column') return;
    const left = item.offsetLeft - recap.offsetLeft;
    if (left < recap.scrollLeft || left + item.offsetWidth > recap.scrollLeft + recap.clientWidth) {
      recap.scrollTo({ left: left - 24, behavior: calm.matches ? 'auto' : 'smooth' });
    }
  };

  root.addEventListener('sightline:events', (e) => {
    events = (e as CustomEvent<MatchEvent[]>).detail;
    renderRecap();
    renderSummary({ match, events, teams: [teamA, teamB], duration: master.duration, seek: (t) => (master.currentTime = t) });
    tick();
  });


  function tick(): void {
    const t = master.currentTime;

    if (board.length) {
      const entry = [...board].reverse().find((b) => b.t <= t) ?? board[0]!;
      const roundStart = board.find((b) => b.round === entry.round)?.t ?? 0;
      setScoreboard(root, {
        round: entry.round,
        clock: formatTime(t - roundStart),
        teams: [
          { name: teamA, score: entry[teamA.toLowerCase()] ?? 0 },
          { name: teamB, score: entry[teamB.toLowerCase()] ?? 0 },
        ],
      });
    }

    const clock = formatTime(t);
    for (const tile of tiles.values()) tile.clock.textContent = clock;

    // The latest event at or before now is "now" in the recap.
    let now = -1;
    events.forEach((event, i) => {
      if (event.time <= t + 0.25) now = i;
    });
    for (const button of recap.querySelectorAll<HTMLElement>('.recap-item')) {
      const current = Number(button.dataset.index) === now;
      if (button.hasAttribute('data-now') === current) continue;
      button.toggleAttribute('data-now', current);
      if (current) {
        button.setAttribute('aria-current', 'true');
        keepInView(button);
      } else button.removeAttribute('aria-current');
    }
  }

  initCustomizer(root);
  master.addEventListener('timeupdate', tick);
  master.addEventListener('seeked', tick);
  tick();
  renderAngles();
}
