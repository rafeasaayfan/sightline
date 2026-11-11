/*
 * Vantage behaviour: event timeline, highlight navigation, event toasts and the HUD.
 *
 * Events come from a WebVTT track on the media: <track kind="metadata" label="events" src="events.vtt">. Each cue's
 * text is `kind|label`, where kind is elim, clutch, obj or round. Without that track the skin is an ordinary player:
 * no markers, highlight buttons disabled, no toasts.
 */

export type EventKind = 'highlight' | 'objective' | 'round';

export interface MatchEvent {
  time: number;
  kind: EventKind;
  /** The cue's kind as written: elim, clutch, obj or round. */
  type: string;
  label: string;
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
const TOAST_MS = 3000;

interface State {
  root: HTMLElement;
  media?: HTMLMediaElement;
  events: MatchEvent[];
  last: number;
  toastTimer?: number;
  focusIndex: number;
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
    .map((cue) => {
      const text = (cue as VTTCue).text.trim();
      const [type = '', ...rest] = text.split('|');
      const kind = KIND[type.trim().toLowerCase()];
      return kind ? { time: cue.startTime, kind, type: type.trim().toLowerCase(), label: rest.join('|').trim() } : null;
    })
    .filter((e): e is MatchEvent => !!e && !!e.label)
    .sort((a, b) => a.time - b.time);
}

/* ---------------------------------------------------------------------------------------------- Markers */

function renderMarkers(state: State): void {
  const { root, media, events } = state;
  const layer = root.querySelector<HTMLElement>('.vt-markers');
  const duration = media?.duration ?? NaN;
  if (!layer) return;

  layer.replaceChildren();
  const usable = Number.isFinite(duration) && duration > 0 ? events.filter((e) => e.time <= duration) : [];
  layer.hidden = usable.length === 0;

  usable.forEach((event, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vt-marker';
    button.dataset.kind = event.kind;
    button.dataset.index = String(index);
    button.style.setProperty('--vt-at', `${(event.time / duration) * 100}%`);
    button.tabIndex = index === state.focusIndex ? 0 : -1;
    button.setAttribute('aria-label', `${event.label}, ${formatTime(event.time)}. Press Enter to jump.`);
    button.innerHTML = '<span class="vt-marker-shape" aria-hidden="true"></span>';
    layer.append(button);
  });

  for (const button of root.querySelectorAll<HTMLButtonElement>('.vt-prev, .vt-next')) {
    button.setAttribute('aria-disabled', String(usable.length === 0));
  }
  root.toggleAttribute('data-events', usable.length > 0);
  root.dispatchEvent(new CustomEvent('vantage:events', { detail: usable, bubbles: true }));
}

function showTip(state: State, marker: HTMLElement | null): void {
  const tip = state.root.querySelector<HTMLElement>('.vt-marker-tip');
  if (!tip) return;
  if (!marker) {
    tip.hidden = true;
    return;
  }
  const event = state.events[Number(marker.dataset.index)];
  if (!event) return;
  tip.querySelector('.vt-marker-tip-label')!.textContent = event.label;
  tip.querySelector('.vt-marker-tip-time')!.textContent = `${formatTime(event.time)} · press Enter to jump`;
  tip.style.setProperty('--vt-at', marker.style.getPropertyValue('--vt-at'));
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

function toast(state: State, event: MatchEvent): void {
  const { root } = state;
  if (root.dataset.toasts === 'off') return;
  const el = root.querySelector<HTMLElement>('.vt-toast');
  if (!el) return;
  el.dataset.kind = event.kind;
  el.querySelector('.vt-toast-label')!.textContent = event.label;
  el.querySelector('.vt-toast-time')!.textContent = formatTime(event.time);
  el.hidden = false;
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    el.hidden = true;
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
  state.last = now;
}

/* ---------------------------------------------------------------------------------------------- HUD */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Show a scoreboard in the HUD, or hide it with null. */
export function setScoreboard(root: HTMLElement, board: Scoreboard | null): void {
  const score = root.querySelector<HTMLElement>('.vt-score');
  if (!score) return;
  score.hidden = !board;
  if (!board) return;
  const [a, b] = board.teams;
  const set = (sel: string, html: string) => {
    const el = score.querySelector<HTMLElement>(sel)!;
    if (el.innerHTML !== html) el.innerHTML = html;
  };
  set('.vt-score-round', `RND ${pad2(board.round)}`);
  set('.vt-score-clock', board.clock);
  set(
    '.vt-score-teams',
    `<span class="vt-team vt-team-a">${a.name}</span> ${a.score} <span class="vt-score-dot" aria-hidden="true">·</span> ${b.score} <span class="vt-team vt-team-b">${b.name}</span>`,
  );
  score.setAttribute('aria-label', `Round ${board.round}, ${a.name} ${a.score}, ${b.name} ${b.score}`);
}

/** Show the active angle label in the HUD, or hide it with null. */
export function setAngle(root: HTMLElement, label: string | null): void {
  const el = root.querySelector<HTMLElement>('.vt-angle');
  if (!el) return;
  el.hidden = !label;
  el.textContent = label ?? '';
}

/** Show the sync pill: 'ok' (in sync), 'drift' (correcting), or null to hide. */
export function setSync(root: HTMLElement, status: 'ok' | 'drift' | null): void {
  const el = root.querySelector<HTMLElement>('.vt-sync');
  if (!el) return;
  el.hidden = !status;
  if (status) el.dataset.status = status;
  el.setAttribute('aria-label', status === 'drift' ? 'Angles resyncing' : 'Angles in sync');
}

/** Show a stage message: switching angles, or an angle that failed. Null clears it. */
export function setStageState(root: HTMLElement, state: { kind: 'switching' | 'unavailable'; text: string } | null): void {
  const el = root.querySelector<HTMLElement>('.vt-state');
  if (!el) return;
  el.hidden = !state;
  el.dataset.kind = state?.kind ?? '';
  el.textContent = state?.text ?? '';
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

  root.querySelector('.vt-prev')?.addEventListener('click', () => prevHighlight(root));
  root.querySelector('.vt-next')?.addEventListener('click', () => nextHighlight(root));

  // Markers: one tab stop, arrows move between them, Enter or click jumps.
  const layer = root.querySelector<HTMLElement>('.vt-markers');
  if (layer) {
    layer.addEventListener('click', (e) => {
      const marker = (e.target as Element).closest<HTMLElement>('.vt-marker');
      const event = marker && state.events[Number(marker.dataset.index)];
      if (event) seek(state, event.time);
    });
    layer.addEventListener('keydown', (e) => {
      const markers = [...layer.querySelectorAll<HTMLElement>('.vt-marker')];
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
      layer.addEventListener(type, (e) => showTip(state, (e.target as Element).closest<HTMLElement>('.vt-marker')));
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
      root.querySelector<HTMLElement>('.vt-help')?.click();
    }
  });

  // Settings: event toasts on or off.
  root.querySelector('.vt-menu-toasts')?.addEventListener('checked-change', (e) => {
    const checked = (e.currentTarget as HTMLElement & { checked?: boolean }).checked;
    root.dataset.toasts = checked === false ? 'off' : 'on';
    if (checked === false) root.querySelector<HTMLElement>('.vt-toast')?.setAttribute('hidden', '');
  });

  // Settings: layout. The page owns layout; the skin reports the choice and shows the item when the page opts in
  // with data-layout on the player root.
  const layout = root.querySelector<HTMLElement & { value?: string }>('.vt-layout-group');
  layout?.addEventListener('value-change', () => {
    const value = layout.value === 'stage' ? 'stage' : 'split';
    root.dataset.layout = value;
    root.querySelector('.vt-layout-value')!.textContent = value === 'stage' ? 'Stage only' : '70 / 30';
    root.dispatchEvent(new CustomEvent('vantage:layout', { detail: value, bubbles: true }));
  });
}

/** Reflect a layout chosen outside the menu (the page's own layout button) in the settings menu. */
export function setLayout(root: HTMLElement, value: 'split' | 'stage'): void {
  root.dataset.layout = value;
  const layout = root.querySelector<HTMLElement & { value?: string }>('.vt-layout-group');
  if (layout && layout.value !== value) layout.value = value;
  const label = root.querySelector('.vt-layout-value');
  if (label) label.textContent = value === 'stage' ? 'Stage only' : '70 / 30';
}

/*
 * Controls never hide while a control has keyboard focus (WCAG 2.4.11): while focus-visible sits inside them, hold
 * them with the documented visibility="always", and hand back to "auto" when focus leaves.
 */
document.addEventListener('focusin', (event) => {
  const target = event.target as Element | null;
  const controls = target?.closest?.('.vantage media-controls');
  if (controls && target?.matches(':focus-visible')) controls.setAttribute('visibility', 'always');
});
document.addEventListener('focusout', (event) => {
  const controls = (event.target as Element | null)?.closest?.('.vantage media-controls');
  const next = event.relatedTarget as Node | null;
  if (controls && !(next && controls.contains(next))) controls.setAttribute('visibility', 'auto');
});

/** Set up every Vantage player on the page, now and as new ones mount. */
function scan(): void {
  for (const root of document.querySelectorAll<HTMLElement>('.vantage')) setup(root);
}

new MutationObserver((records) => {
  if (records.some((r) => [...r.addedNodes].some((n) => n instanceof Element && (n.matches('.vantage') || n.querySelector('.vantage'))))) scan();
}).observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });
else scan();
