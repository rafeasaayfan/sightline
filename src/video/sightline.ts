/*
 * Sightline behaviour: event timeline, highlight navigation, event toasts and the HUD.
 *
 * Events come from a WebVTT track on the media: <track kind="metadata" label="events" src="events.vtt">. Each cue's
 * text is `kind|label|team`, where kind is elim, clutch, obj or round and the optional team is a or b (the side that
 * scored, for team colours). Without that track the skin is an ordinary player: no markers, highlight buttons
 * disabled, no kill feed.
 */

import { sightlineIcons } from './icons';

export type Layout = 'split' | 'stage';

export type EventKind = 'highlight' | 'objective' | 'round';

export interface MatchEvent {
  time: number;
  kind: EventKind;
  /** The cue's kind as written: elim, clutch, obj or round. */
  type: string;
  label: string;
  /** The side that scored: a (first team) or b (second team), when the cue says. */
  team?: 'a' | 'b';
}

export interface Team {
  name: string;
  score: number;
}

export interface Scoreboard {
  round: number;
  clock: string;
  teams: [Team, Team];
}

const KIND: Record<string, EventKind> = { elim: 'highlight', clutch: 'highlight', obj: 'objective', round: 'round' };
const TOAST_MS = 5200;

interface State {
  root: HTMLElement;
  media?: HTMLMediaElement;
  events: MatchEvent[];
  last: number;
  toastTimer?: number;
  focusIndex: number;
  /** An instant replay in progress: where it started, where it hands back, and the rate to restore. */
  replay?: { from: number; until: number; rate: number };
}

const states = new WeakMap<HTMLElement, State>();

/** Format seconds as m:ss or h:mm:ss, matching the player's clocks. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

function findMedia(root: HTMLElement): HTMLMediaElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('*')].find(
    (el): el is HTMLMediaElement => 'currentTime' in el && 'textTracks' in el && !el.localName.startsWith('media-'),
  );
}

function eventsTrack(media: HTMLMediaElement): TextTrack | undefined {
  return [...media.textTracks].find((t) => t.kind === 'metadata' && t.label === 'events');
}

function parseCues(track: TextTrack): MatchEvent[] {
  return [...(track.cues ?? [])]
    .map((cue): MatchEvent | null => {
      const text = (cue as VTTCue).text.trim();
      const [type = '', ...rest] = text.split('|');
      const kind = KIND[type.trim().toLowerCase()];
      const last = rest.length > 1 ? rest[rest.length - 1]!.trim().toLowerCase() : '';
      const team: 'a' | 'b' | undefined = last === 'a' || last === 'b' ? last : undefined;
      if (team) rest.pop();
      if (!kind) return null;
      const event: MatchEvent = { time: cue.startTime, kind, type: type.trim().toLowerCase(), label: rest.join('|').trim() };
      if (team) event.team = team;
      return event;
    })
    .filter((e): e is MatchEvent => !!e && !!e.label)
    .sort((a, b) => a.time - b.time);
}

/* ---------------------------------------------------------------------------------------------- Markers */

function renderMarkers(state: State): void {
  const { root, media, events } = state;
  const layer = root.querySelector<HTMLElement>('.sl-markers');
  const duration = media?.duration ?? NaN;
  if (!layer) return;

  layer.replaceChildren();
  const usable = Number.isFinite(duration) && duration > 0 ? events.filter((e) => e.time <= duration) : [];
  layer.hidden = usable.length === 0;

  let round = 1;
  usable.forEach((event, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sl-marker';
    button.dataset.kind = event.kind;
    button.dataset.type = event.type;
    if (event.team) button.dataset.team = event.team;
    button.dataset.index = String(index);
    button.style.setProperty('--sl-at', `${(event.time / duration) * 100}%`);
    button.tabIndex = index === state.focusIndex ? 0 : -1;
    button.setAttribute('aria-label', `${event.label}, ${formatTime(event.time)}. Press Enter to jump.`);
    const pin = document.createElement('span');
    pin.className = 'sl-marker-pin';
    pin.setAttribute('aria-hidden', 'true');
    if (event.kind === 'round') pin.textContent = `R${(round += 1)}`;
    else pin.innerHTML = glyph(event.type);
    button.append(pin);
    layer.append(button);
  });
  stack(state);
  markPast(state);

  for (const button of root.querySelectorAll<HTMLButtonElement>('.sl-prev, .sl-next')) {
    button.setAttribute('aria-disabled', String(usable.length === 0));
  }
  renderRounds(root, usable, duration);
  root.toggleAttribute('data-events', usable.length > 0);
  root.dispatchEvent(new CustomEvent('sightline:events', { detail: usable, bubbles: true }));
}

/** The event glyph for a cue kind: skull for an elimination, crown for a clutch, flag for an objective. */
function glyph(type: string): string {
  return sightlineIcons[type === 'clutch' ? 'crown' : type === 'obj' ? 'flag' : 'skull'] ?? '';
}

/*
 * Pins that would overlap at this width rise onto a second tier, so every event stays visible and clickable.
 * Recomputed when the timeline resizes.
 */
function stack(state: State): void {
  const layer = state.root.querySelector<HTMLElement>('.sl-markers');
  if (!layer) return;
  const width = layer.getBoundingClientRect().width;
  if (!width) return;
  const PIN = 22;
  const ends = [-Infinity, -Infinity];
  for (const marker of layer.querySelectorAll<HTMLElement>('.sl-marker')) {
    const x = (parseFloat(marker.style.getPropertyValue('--sl-at')) / 100) * width;
    const tier = x - ends[0]! >= PIN ? 0 : x - ends[1]! >= PIN ? 1 : 0;
    ends[tier] = x;
    marker.dataset.tier = String(tier);
  }
}

/** Events already played read solid; upcoming ones read as outlines. */
function markPast(state: State): void {
  const now = state.media?.currentTime ?? 0;
  for (const marker of state.root.querySelectorAll<HTMLElement>('.sl-marker')) {
    const event = state.events[Number(marker.dataset.index)];
    marker.toggleAttribute('data-past', !!event && event.time <= now + 0.05);
  }
}

/** Shade alternate rounds on the timeline, so the bar reads as a map of the match. */
function renderRounds(root: HTMLElement, events: MatchEvent[], duration: number): void {
  const layer = root.querySelector<HTMLElement>('.sl-rounds');
  if (!layer) return;
  layer.replaceChildren();
  const starts = events.filter((e) => e.kind === 'round').map((e) => e.time);
  if (!starts.length || !Number.isFinite(duration)) return;
  const edges = [0, ...starts, duration];
  for (let i = 0; i < edges.length - 1; i++) {
    const band = document.createElement('span');
    band.className = 'sl-round-band';
    band.dataset.odd = String(i % 2 === 1);
    band.style.setProperty('--sl-from', `${(edges[i]! / duration) * 100}%`);
    band.style.setProperty('--sl-to', `${(edges[i + 1]! / duration) * 100}%`);
    layer.append(band);
    // A slanted cut where each new round begins: the bar reads as one segment per round.
    if (i > 0) {
      const gap = document.createElement('span');
      gap.className = 'sl-round-gap';
      gap.style.setProperty('--sl-at', `${(edges[i]! / duration) * 100}%`);
      layer.append(gap);
    }
  }
}

function showTip(state: State, marker: HTMLElement | null): void {
  const tip = state.root.querySelector<HTMLElement>('.sl-marker-tip');
  if (!tip) return;
  if (!marker) {
    tip.hidden = true;
    return;
  }
  const event = state.events[Number(marker.dataset.index)];
  if (!event) return;
  tip.querySelector('.sl-marker-tip-label')!.textContent = event.label;
  tip.querySelector('.sl-marker-tip-time')!.textContent = `${formatTime(event.time)} · press Enter to jump`;
  tip.style.setProperty('--sl-at', marker.style.getPropertyValue('--sl-at'));
  tip.dataset.kind = event.kind;
  tip.hidden = false;
}

function seek(state: State, time: number): void {
  if (!state.media) return;
  state.media.currentTime = time;
  state.last = time;
}

/* ---------------------------------------------------------------------------------------------- Highlights */

function step(root: HTMLElement, direction: 1 | -1): MatchEvent | undefined {
  const state = states.get(root);
  if (!state?.media || state.events.length === 0) return undefined;
  const now = state.media.currentTime;
  // Going back skips the event just passed, so repeated presses keep moving.
  const target =
    direction === 1
      ? state.events.find((e) => e.time > now + 0.5)
      : [...state.events].reverse().find((e) => e.time < now - 1.5);
  if (target) seek(state, target.time);
  return target;
}

/** Jump to the next highlight event; returns it, or undefined at the end. */
export const nextHighlight = (root: HTMLElement) => step(root, 1);
/** Jump to the previous highlight event. */
export const prevHighlight = (root: HTMLElement) => step(root, -1);
/** The events the skin parsed for this player. */
export const getEvents = (root: HTMLElement): MatchEvent[] => states.get(root)?.events ?? [];

/* ---------------------------------------------------------------------------------------------- Toasts */

const FEED_MAX = 4;

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

/** Kill feed: game-style entries stacked at the top right. Eliminations read "A ⌖ B"; others show their label. */
function toast(state: State, event: MatchEvent): void {
  const { root } = state;
  if (root.dataset.toasts === 'off' || root.dataset.spoilers === 'on') return;
  const feed = root.querySelector<HTMLElement>('.sl-feed');
  if (!feed) return;
  const li = document.createElement('li');
  li.className = 'sl-feed-item';
  li.dataset.kind = event.kind;
  li.dataset.type = event.type;
  if (event.team) li.dataset.team = event.team;
  li.append(span('sl-feed-mark', ''));
  li.querySelector('.sl-feed-mark')!.innerHTML = glyph(event.type);
  const duel = /^[^·]+·\s*(?:1v\d\s*·\s*)?(.+?)\s*→\s*(.+)$/.exec(event.label);
  if (duel) {
    li.append(span('sl-feed-a', duel[1]!));
    li.insertAdjacentHTML(
      'beforeend',
      '<svg class="sl-feed-x" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 0v4M8 12v4M0 8h4M12 8h4" stroke="currentColor" stroke-width="1.6"/></svg>',
    );
    li.append(span('sl-visually-hidden', ' eliminated '), span('sl-feed-b', duel[2]!));
    li.classList.add('sl-feed-duel');
  } else {
    li.append(span('sl-feed-label', event.label));
  }
  li.append(span('sl-feed-time', formatTime(event.time)));
  li.querySelector('.sl-feed-mark')!.setAttribute('aria-hidden', 'true');
  feed.prepend(li);
  while (feed.children.length > FEED_MAX) feed.lastElementChild?.remove();
  window.setTimeout(() => {
    li.dataset.leaving = '';
    window.setTimeout(() => li.remove(), 420);
  }, TOAST_MS);
}

function onTime(state: State): void {
  const media = state.media;
  if (!media) return;
  const now = media.currentTime;
  const delta = now - state.last;
  // Only natural playback raises toasts; seeks and jumps stay quiet.
  if (!media.seeking && delta > 0 && delta < 1.5) {
    const crossed = state.events.filter((e) => e.time > state.last && e.time <= now);
    if (crossed.length) toast(state, crossed[crossed.length - 1]!);
  }
  if (state.replay && now >= state.replay.until) endReplay(state);
  if (Math.floor(now) !== Math.floor(state.last)) markPast(state);
  state.last = now;
}

/* ---------------------------------------------------------------------------------------------- HUD */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Show a scoreboard in the HUD, or hide it with null. */
export function setScoreboard(root: HTMLElement, board: Scoreboard | null): void {
  const score = root.querySelector<HTMLElement>('.sl-score');
  if (!score) return;
  score.hidden = !board;
  if (!board) return;
  const [a, b] = board.teams;
  const set = (sel: string, html: string) => {
    const el = score.querySelector<HTMLElement>(sel)!;
    if (el.innerHTML !== html) el.innerHTML = html;
  };
  set('.sl-score-round', `RND ${pad2(board.round)}`);
  set('.sl-score-clock', board.clock);
  set(
    '.sl-score-teams',
    `<span class="sl-team sl-team-a">${a.name}</span> ${a.score} <span class="sl-score-dot" aria-hidden="true">·</span> ${b.score} <span class="sl-team sl-team-b">${b.name}</span>`,
  );
  score.setAttribute('aria-label', `Round ${board.round}, ${a.name} ${a.score}, ${b.name} ${b.score}`);
}

/** Show the active angle label in the HUD, or hide it with null. */
export function setAngle(root: HTMLElement, label: string | null): void {
  const el = root.querySelector<HTMLElement>('.sl-angle');
  if (!el) return;
  el.hidden = !label;
  el.textContent = label ?? '';
}

/** Show the sync pill: 'ok' (in sync), 'drift' (correcting), or null to hide. */
export function setSync(root: HTMLElement, status: 'ok' | 'drift' | null): void {
  const el = root.querySelector<HTMLElement>('.sl-sync');
  if (!el) return;
  el.hidden = !status;
  if (status) el.dataset.status = status;
  el.setAttribute('aria-label', status === 'drift' ? 'Angles resyncing' : 'Angles in sync');
}

/** Show a stage message: switching angles, or an angle that failed. Null clears it. */
export function setStageState(root: HTMLElement, state: { kind: 'switching' | 'unavailable'; text: string } | null): void {
  const el = root.querySelector<HTMLElement>('.sl-state');
  if (!el) return;
  el.hidden = !state;
  el.dataset.kind = state?.kind ?? '';
  el.textContent = state?.text ?? '';
}

/* ---------------------------------------------------------------------------------------------- Instant replay */

const REPLAY_SECONDS = 8;
const REPLAY_RATE = 0.5;

/** Replay the last 8 seconds at half speed, then carry on at the normal rate from where it started. */
export function instantReplay(root: HTMLElement): void {
  const state = states.get(root);
  const media = state?.media;
  if (!state || !media || !Number.isFinite(media.duration)) return;
  if (state.replay) endReplay(state);
  const until = media.currentTime;
  const from = Math.max(0, until - REPLAY_SECONDS);
  state.replay = { from, until, rate: media.playbackRate };
  media.currentTime = from;
  state.last = from;
  media.playbackRate = REPLAY_RATE;
  void media.play().catch(() => undefined);
  root.toggleAttribute('data-replay', true);
  const badge = root.querySelector<HTMLElement>('.sl-replay-badge');
  if (badge) {
    badge.textContent = `Instant replay · ${REPLAY_RATE}×`;
    badge.hidden = false;
  }
}

function endReplay(state: State): void {
  if (!state.replay) return;
  const { rate } = state.replay;
  state.replay = undefined;
  if (state.media) state.media.playbackRate = rate;
  state.root.removeAttribute('data-replay');
  const badge = state.root.querySelector<HTMLElement>('.sl-replay-badge');
  if (badge) badge.hidden = true;
}

/** Reflect the page's multiview fullscreen state on the button. */
export function setMultiview(root: HTMLElement, on: boolean): void {
  root.querySelector<HTMLElement>('.sl-multiview')?.setAttribute('aria-pressed', String(on));
  root.toggleAttribute('data-multiview-on', on);
}

/* ---------------------------------------------------------------------------------------------- Wiring */

const editable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.localName));

function attachMedia(state: State, media: HTMLMediaElement): void {
  if (state.media === media) return;
  state.media = media;

  const refresh = () => {
    const track = eventsTrack(media);
    if (track && track.mode === 'disabled') track.mode = 'hidden';
    state.events = track ? parseCues(track) : [];
    renderMarkers(state);
  };

  const watchTrack = (track: TextTrack | undefined) => {
    if (!track) return;
    if (track.mode === 'disabled') track.mode = 'hidden';
    track.addEventListener('cuechange', () => {
      if ((track.cues?.length ?? 0) !== state.events.length) refresh();
    });
  };

  media.textTracks.addEventListener('addtrack', (e) => {
    const t = (e as TrackEvent).track as TextTrack | null;
    if (t?.kind === 'metadata' && t.label === 'events') {
      watchTrack(t);
      refresh();
    }
  });
  watchTrack(eventsTrack(media));

  // Cues arrive when the track element loads.
  for (const el of media.querySelectorAll('track')) el.addEventListener('load', refresh);
  media.addEventListener('loadedmetadata', refresh);
  media.addEventListener('durationchange', refresh);
  media.addEventListener('timeupdate', () => onTime(state));
  media.addEventListener('seeked', () => {
    state.last = media.currentTime;
    markPast(state);
  });
  // A pause, or a seek that isn't the replay's own, ends an instant replay.
  media.addEventListener('pause', () => endReplay(state));
  media.addEventListener('seeking', () => {
    if (state.replay && Math.abs(media.currentTime - state.replay.from) > 0.3) endReplay(state);
  });
  attachQuality(state, media);
  refresh();
}

/* --------------------------------------------------------------------------------------------- Quality (HLS) */

/** The parts of an hls.js instance the skin reads. Video.js's HLS media expose it as `engine`. */
interface HlsEngine {
  levels: { width?: number; height?: number; bitrate?: number; details?: unknown }[];
  audioTracks?: unknown[];
  bandwidthEstimate?: number;
  manualLevel: number;
  nextLevel: number;
  currentLevel: number;
  trigger(event: string, data: unknown): void;
  on(event: string, listener: (event: string, data: any) => void): void;
  off(event: string, listener: (event: string, data: any) => void): void;
}

const STANDARD_SIZES = [144, 240, 360, 480, 540, 720, 1080, 1440, 2160, 4320];

/** A rendition's nominal size (1080 for 1920×1080), worked out the way Video.js labels its quality menu. */
function renditionSize(level: { width?: number; height?: number } | undefined): number {
  const w = level?.width ?? 0;
  const h = level?.height ?? 0;
  if (w && h && w > h && w * 9 > h * 16) {
    const wide = Math.round((w * 9) / 16);
    return STANDARD_SIZES.includes(wide) ? wide : h;
  }
  return w && h ? Math.min(w, h) : h || w;
}

const tierOf = (size: number) => (size >= 4320 ? '8K' : size >= 2160 ? '4K' : size >= 1080 ? 'HD' : '');
const qualityName = (size: number) => `${size}p${tierOf(size) ? ` ${tierOf(size)}` : ''}`;

/**
 * Quality on HLS streams. A chosen quality loads behind the picture: the old one keeps playing while a pill says the
 * new one is loading, and the pill clears the moment the new quality is on screen. To get there quickly without a
 * stall, the stretch ahead that is buffered in another quality is dropped from the first segment boundary a couple
 * of seconds out (hls.js alone would play up to its whole forward buffer in the old quality first), and hls.js
 * refills it in the chosen one. Parts already watched in another quality get the same treatment when playback
 * returns to them. The gear wears an HD (or 4K) badge while such a rendition plays.
 */
function attachQuality(state: State, media: HTMLMediaElement): void {
  const { root } = state;
  const pill = root.querySelector<HTMLElement>('.sl-quality');
  const pillText = root.querySelector<HTMLElement>('.sl-quality-text');
  const badge = root.querySelector<HTMLElement>('.sl-hd');
  const badgeLabel = root.querySelector<HTMLElement>('.sl-hd-label');
  let engine: HlsEngine | undefined;
  let pending = -1; // the level being loaded, or -1
  let doneTimer = 0;
  let giveUp = 0;
  // What is buffered, segment by segment, and in which level: start (ms) → segment.
  const segments = new Map<number, { start: number; end: number; level: number }>();

  const showPill = (text: string, done: boolean) => {
    if (!pill || !pillText) return;
    window.clearTimeout(doneTimer);
    pillText.textContent = text;
    pill.toggleAttribute('data-done', done);
    pill.hidden = false;
    if (done) doneTimer = window.setTimeout(() => (pill.hidden = true), 1600);
  };

  const finish = (level: number) => {
    window.clearTimeout(giveUp);
    pending = -1;
    showPill(`Now in ${qualityName(renditionSize(engine?.levels[level]))}`, true);
  };

  const clear = () => {
    window.clearTimeout(giveUp);
    window.clearTimeout(doneTimer);
    pending = -1;
    if (pill) pill.hidden = true;
  };

  const load = (level: number) => {
    if (!engine?.levels[level]) return;
    pending = level;
    showPill(`Loading ${qualityName(renditionSize(engine.levels[level]))}`, false);
    window.clearTimeout(giveUp);
    giveUp = window.setTimeout(clear, 30000); // a stalled network shouldn't leave the pill up forever
  };

  // The badge shows the quality the viewer chose (pulsing until it is on screen); on Auto, the one playing.
  let playing = -1;
  const setBadge = () => {
    const chosen = engine && engine.manualLevel >= 0 ? engine.manualLevel : -1;
    const level = chosen >= 0 ? chosen : playing;
    const tier = tierOf(renditionSize(engine?.levels[level]));
    if (badge) {
      badge.hidden = !tier;
      badge.toggleAttribute('data-loading', !!tier && chosen >= 0 && playing !== chosen);
    }
    if (badgeLabel) badgeLabel.textContent = tier;
    root.toggleAttribute('data-hd', !!tier);
  };

  const onSwitched = (_: string, data: { level: number }) => {
    playing = data.level;
    setBadge();
    if (pending >= 0 && data.level === pending) finish(data.level);
  };

  // Drop the run of segments ahead that is buffered in another quality, starting at the first boundary the old
  // frames can reach while a new segment downloads (worked out from the measured bandwidth, as hls.js does), so the
  // picture never runs dry. hls.js refetches the gap in the chosen level; segments already in it are kept.
  const upgradeAhead = (chosen: number) => {
    if (!engine) return;
    const level = engine.levels[chosen];
    const bandwidth = engine.bandwidthEstimate || 1e6;
    const segment = [...segments.values()][0];
    const duration = segment ? segment.end - segment.start : 6;
    const fetch = 1 + ((level?.bitrate ?? 0) * duration) / bandwidth + (level?.details ? 0 : 1);
    const lead = media.paused ? 0.1 : Math.max(2.5, fetch * 1.5);
    const ahead = [...segments.values()].filter((g) => g.start >= media.currentTime + lead - 0.05).sort((a, b) => a.start - b.start);
    let from = -1;
    let to = -1;
    for (const g of ahead) {
      if (g.level === chosen) break;
      if (from < 0) from = g.start;
      else if (Math.abs(g.start - to) > 0.25) break; // a hole: stop at the end of this run
      to = g.end;
    }
    if (from < 0) return;
    for (const [key, g] of segments) if (g.start >= from - 0.05 && g.end <= to + 0.05) segments.delete(key);
    // With a separate audio rendition only the video buffer holds the old quality; otherwise both are one stream.
    engine.trigger('hlsBufferFlushing', { startOffset: from, endOffset: to, type: engine.audioTracks?.length ? 'video' : null });
  };

  // The segment now on screen. If the viewer picked a quality and this part is in another one, the old frames keep
  // playing while the stretch ahead is fetched again in the chosen quality.
  const onFragChanged = (_: string, data: { frag: { level: number; type?: string } }) => {
    if (!engine || (data.frag.type && data.frag.type !== 'main')) return;
    const chosen = engine.manualLevel;
    if (chosen < 0 || !engine.levels[chosen] || data.frag.level === chosen) return;
    if (pending !== chosen) load(chosen);
    upgradeAhead(chosen);
  };

  const onFragBuffered = (_: string, data: { frag: { level: number; start: number; duration: number; type?: string } }) => {
    const f = data.frag;
    if (f.type && f.type !== 'main') return;
    segments.set(Math.round(f.start * 1000), { start: f.start, end: f.start + f.duration, level: f.level });
    // Paused: nothing plays to confirm the switch, so the new quality buffered at the playhead is enough.
    if (pending >= 0 && f.level === pending && media.paused && media.currentTime >= f.start - 0.5 && media.currentTime < f.start + f.duration + 0.5) finish(f.level);
  };

  // hls.js starts loading another level. A manual pick (the viewer chose it in the menu) gets the pill; Auto's own
  // adaptive switches stay silent.
  const onSwitching = (_: string, data: { level: number }) => {
    if (!engine || engine.manualLevel < 0 || data.level !== engine.manualLevel) return;
    if (data.level === engine.currentLevel) {
      clear();
      return;
    }
    if (pending !== data.level) load(data.level);
    // After hls.js has scheduled its own switch, bring the new quality closer.
    const chosen = data.level;
    window.setTimeout(() => engine?.manualLevel === chosen && upgradeAhead(chosen), 0);
  };

  // The viewer picked a quality in the menu. Back to Auto clears the pill.
  const onRenditionChange = () => {
    queueMicrotask(() => {
      bind();
      if (engine && engine.manualLevel < 0) clear();
      setBadge();
    });
  };
  let renditions: EventTarget | undefined;

  const bind = () => {
    // Video.js may replace the renditions list with a new source; follow it.
    const list = (media as HTMLMediaElement & { videoRenditions?: EventTarget }).videoRenditions;
    if (list !== renditions) {
      renditions?.removeEventListener('change', onRenditionChange);
      renditions = list;
      renditions?.addEventListener('change', onRenditionChange);
    }
    const next = (media as HTMLMediaElement & { engine?: HlsEngine }).engine;
    if (next === engine || !next || typeof next.on !== 'function') return;
    if (engine) {
      engine.off('hlsLevelSwitching', onSwitching);
      engine.off('hlsLevelSwitched', onSwitched);
      engine.off('hlsFragChanged', onFragChanged);
      engine.off('hlsFragBuffered', onFragBuffered);
    }
    engine = next;
    engine.on('hlsLevelSwitching', onSwitching);
    engine.on('hlsLevelSwitched', onSwitched);
    engine.on('hlsFragChanged', onFragChanged);
    engine.on('hlsFragBuffered', onFragBuffered);
  };

  // A new source (an angle swap) starts over.
  media.addEventListener('loadstart', () => {
    clear();
    segments.clear();
    playing = -1;
    setBadge();
    bind();
  });
  media.addEventListener('loadedmetadata', bind);
  bind();
}

/* ------------------------------------------------------------------------------------------- Rotate (phones) */

type OrientationLock = ScreenOrientation & { lock?: (o: string) => Promise<void> };

/**
 * On phones in fullscreen, a button turns the picture to landscape (and back) with the Screen Orientation API.
 * Shown only where the browser can lock the orientation (Android Chrome and friends); iPhones play fullscreen in
 * Safari's own player, where turning the phone does the same job.
 */
function setupRotate(root: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>('.sl-rotate');
  const orientation = screen.orientation as OrientationLock | undefined;
  if (!button || !orientation || typeof orientation.lock !== 'function') return;
  const touch = matchMedia('(pointer: coarse)');

  const inFullscreen = () => {
    const el = document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
    return !!el && (el === root || el.contains(root));
  };
  const landscape = () => orientation.type.startsWith('landscape');
  const label = () => button.setAttribute('aria-label', landscape() ? 'Rotate to portrait' : 'Rotate to landscape');

  const sync = () => {
    const show = touch.matches && inFullscreen();
    button.hidden = !show;
    if (show) label();
    else orientation.unlock?.();
  };

  button.addEventListener('click', () => {
    orientation
      .lock!(landscape() ? 'portrait' : 'landscape')
      .then(label)
      .catch(() => {
        button.hidden = true; // this browser refuses to lock: leave rotation to the phone
      });
  });
  orientation.addEventListener('change', label);
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
}

function setup(root: HTMLElement): void {
  if (states.has(root)) return;
  const state: State = { root, events: [], last: 0, focusIndex: 0 };
  states.set(root, state);

  const media = findMedia(root);
  if (media) attachMedia(state, media);
  new MutationObserver(() => {
    const m = findMedia(root);
    if (m) attachMedia(state, m);
  }).observe(root, { childList: true, subtree: true });

  setupRotate(root);
  root.querySelector('.sl-prev')?.addEventListener('click', () => prevHighlight(root));
  root.querySelector('.sl-next')?.addEventListener('click', () => nextHighlight(root));
  root.querySelector('.sl-replay')?.addEventListener('click', () => instantReplay(root));
  // Multiview belongs to the page (it owns the angles); the skin asks for it.
  root.querySelector('.sl-multiview')?.addEventListener('click', () =>
    root.dispatchEvent(new CustomEvent('sightline:multiview', { bubbles: true })),
  );
  const lane = root.querySelector<HTMLElement>('.sl-markers');
  if (lane) new ResizeObserver(() => stack(state)).observe(lane);

  // Markers: one tab stop, arrows move between them, Enter or click jumps.
  const layer = root.querySelector<HTMLElement>('.sl-markers');
  if (layer) {
    layer.addEventListener('click', (e) => {
      const marker = (e.target as Element).closest<HTMLElement>('.sl-marker');
      const event = marker && state.events[Number(marker.dataset.index)];
      if (event) seek(state, event.time);
    });
    layer.addEventListener('keydown', (e) => {
      const markers = [...layer.querySelectorAll<HTMLElement>('.sl-marker')];
      const current = markers.indexOf(document.activeElement as HTMLElement);
      if (current < 0) return;
      const keys: Record<string, number> = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: markers.length - 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      e.stopPropagation();
      const next = Math.max(0, Math.min(markers.length - 1, keys[e.key]!));
      markers[current]!.tabIndex = -1;
      markers[next]!.tabIndex = 0;
      markers[next]!.focus();
      state.focusIndex = next;
    });
    for (const type of ['pointerover', 'focusin'] as const) {
      layer.addEventListener(type, (e) => showTip(state, (e.target as Element).closest<HTMLElement>('.sl-marker')));
    }
    for (const type of ['pointerout', 'focusout'] as const) layer.addEventListener(type, () => showTip(state, null));
  }

  // N / Shift+N for highlights and ? for the shortcuts list, while focus is in the player.
  root.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || editable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === 'n') {
      e.preventDefault();
      if (e.shiftKey) prevHighlight(root);
      else nextHighlight(root);
    } else if (e.key === '?') {
      e.preventDefault();
      root.querySelector<HTMLElement>('.sl-help')?.click();
    } else if (e.key.toLowerCase() === 'r' && !e.shiftKey) {
      e.preventDefault();
      instantReplay(root);
    } else if (e.key.toLowerCase() === 'w' && !e.shiftKey && root.hasAttribute('data-multiview')) {
      e.preventDefault();
      root.querySelector<HTMLElement>('.sl-multiview')?.click();
    }
  });

  glide(root);
  // Menu items render after their groups fill in (speed rates, caption tracks), so glide again when they change.
  new MutationObserver(() => glide(root)).observe(root, { childList: true, subtree: true });

  // Settings: event toasts on or off.
  root.querySelector('.sl-menu-toasts')?.addEventListener('checked-change', (e) => {
    const checked = (e.currentTarget as HTMLElement & { checked?: boolean }).checked;
    root.dataset.toasts = checked === false ? 'off' : 'on';
    if (checked === false) root.querySelector('.sl-feed')?.replaceChildren();
  });

  // Settings: spoiler-free hides the score, the kill feed and the event markers.
  root.querySelector('.sl-menu-spoilers')?.addEventListener('checked-change', (e) => {
    const on = (e.currentTarget as HTMLElement & { checked?: boolean }).checked === true;
    root.dataset.spoilers = on ? 'on' : 'off';
    if (on) root.querySelector('.sl-feed')?.replaceChildren();
    root.dispatchEvent(new CustomEvent('sightline:spoilers', { detail: on, bubbles: true }));
  });

  // Settings: layout. The page owns layout; the skin reports the choice and shows the item when the page opts in
  // with data-layout on the player root.
  const layout = root.querySelector<HTMLElement & { value?: string }>('.sl-layout-group');
  layout?.addEventListener('value-change', () => {
    const value: Layout = layout.value === 'stage' ? 'stage' : 'split';
    root.dataset.layout = value;
    root.querySelector('.sl-layout-value')!.textContent = value === 'stage' ? 'Stage only' : 'Split';
    root.dispatchEvent(new CustomEvent('sightline:layout', { detail: value, bubbles: true }));
  });
}

/** Play the broadcast cut on the stage: a short sweep when the angle changes. Skipped under reduced motion. */
export function cut(root: HTMLElement): void {
  root.removeAttribute('data-cut');
  void root.offsetWidth;
  root.setAttribute('data-cut', '');
  window.setTimeout(() => root.removeAttribute('data-cut'), 420);
}

/*
 * Menus: one highlight glides between items as the pointer or the arrow keys move, instead of each row lighting
 * up on its own.
 */
function glide(root: HTMLElement): void {
  for (const content of root.querySelectorAll<HTMLElement>('.sl-menu-content')) {
    if (content.querySelector(':scope > .sl-glide')) continue;
    const bar = document.createElement('span');
    bar.className = 'sl-glide';
    bar.setAttribute('aria-hidden', 'true');
    content.prepend(bar);
    const moveTo = (item: HTMLElement | null) => {
      if (!item || item.parentElement === null) return;
      const box = item.getBoundingClientRect();
      const base = content.getBoundingClientRect();
      bar.style.translate = `0 ${box.top - base.top + content.scrollTop}px`;
      bar.style.height = `${box.height}px`;
      bar.dataset.on = '';
    };
    const itemOf = (t: EventTarget | null) => (t as Element | null)?.closest?.<HTMLElement>('[data-item]') ?? null;
    content.addEventListener('pointerover', (e) => moveTo(itemOf(e.target)));
    content.addEventListener('focusin', (e) => moveTo(itemOf(e.target)));
    content.addEventListener('pointerleave', () => {
      const focused = itemOf(document.activeElement);
      if (focused && content.contains(focused)) moveTo(focused);
      else delete bar.dataset.on;
    });
  }
}

/** Reflect a layout chosen outside the menu (the page's own layout button) in the settings menu. */
export function setLayout(root: HTMLElement, value: Layout): void {
  root.dataset.layout = value;
  const layout = root.querySelector<HTMLElement & { value?: string }>('.sl-layout-group');
  if (layout && layout.value !== value) layout.value = value;
  const label = root.querySelector('.sl-layout-value');
  if (label) label.textContent = value === 'stage' ? 'Stage only' : 'Split';
}

/*
 * Controls never hide while a control has keyboard focus (WCAG 2.4.11): while focus-visible sits inside them, hold
 * them with the documented visibility="always", and hand back to "auto" when focus leaves.
 */
document.addEventListener('focusin', (event) => {
  const target = event.target as Element | null;
  const controls = target?.closest?.('.sightline media-controls');
  if (controls && target?.matches(':focus-visible')) controls.setAttribute('visibility', 'always');
});
document.addEventListener('focusout', (event) => {
  const controls = (event.target as Element | null)?.closest?.('.sightline media-controls');
  const next = event.relatedTarget as Node | null;
  if (controls && !(next && controls.contains(next))) controls.setAttribute('visibility', 'auto');
});

/** Set up every Sightline player on the page, now and as new ones mount. */
function scan(): void {
  for (const root of document.querySelectorAll<HTMLElement>('.sightline')) setup(root);
}

new MutationObserver((records) => {
  if (records.some((r) => [...r.addedNodes].some((n) => n instanceof Element && (n.matches('.sightline') || n.querySelector('.sightline'))))) scan();
}).observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });
else scan();
