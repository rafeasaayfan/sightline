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
  renderHeat(root, usable, duration);
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

/*
 * Action intensity: a thin strip above the line that warms where the match is busiest. Each event adds a soft bump
 * (kills 1, objectives 1.4, clutches 2; rounds don't count), summed over a few seconds and normalised to the
 * busiest moment, then drawn as a gradient from clear through amber to red.
 */
const HEAT_WEIGHT: Record<string, number> = { elim: 1, obj: 1.4, clutch: 2 };
const HEAT_BINS = 160;
const HEAT_SIGMA = 4.5;

function renderHeat(root: HTMLElement, events: MatchEvent[], duration: number): void {
  const strip = root.querySelector<HTMLElement>('.sl-heat');
  if (!strip) return;
  const weighted = events.filter((e) => HEAT_WEIGHT[e.type]);
  strip.hidden = weighted.length === 0 || !Number.isFinite(duration) || duration <= 0;
  if (strip.hidden) return;
  const values: number[] = [];
  for (let i = 0; i <= HEAT_BINS; i++) {
    const t = (i / HEAT_BINS) * duration;
    let v = 0;
    for (const e of weighted) v += HEAT_WEIGHT[e.type]! * Math.exp(-(((t - e.time) / HEAT_SIGMA) ** 2));
    values.push(v);
  }
  const max = Math.max(...values) || 1;
  const mix = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
  const stops = values.map((raw, i) => {
    const v = raw / max;
    // Amber (255 176 32) warming to red (255 77 94) above 60%; transparent when quiet.
    const k = Math.max(0, (v - 0.6) / 0.4);
    const color = `rgb(255 ${mix(176, 77, k)} ${mix(32, 94, k)} / ${(Math.min(1, v * 1.15) * 0.95).toFixed(2)})`;
    return `${color} ${((i / HEAT_BINS) * 100).toFixed(2)}%`;
  });
  strip.style.backgroundImage = `linear-gradient(90deg, ${stops.join(', ')})`;
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

/**
 * Show a clip on the timeline: a marked range from start to end (seconds), or null to clear it. The host owns the
 * clip itself (marking, sharing, stopping at the end); the skin only draws it.
 */
export function setClip(root: HTMLElement, clip: { start: number; end: number } | null): void {
  const range = root.querySelector<HTMLElement>('.sl-clip-range');
  const duration = states.get(root)?.media?.duration ?? NaN;
  if (!range) return;
  range.hidden = !clip || !Number.isFinite(duration) || duration <= 0;
  if (range.hidden || !clip) return;
  const a = Math.max(0, Math.min(clip.start, clip.end));
  const b = Math.min(duration, Math.max(clip.start, clip.end));
  range.style.setProperty('--sl-from', `${(a / duration) * 100}%`);
  range.style.setProperty('--sl-to', `${(b / duration) * 100}%`);
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
  refresh();
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
