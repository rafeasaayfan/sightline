# Sightline audit

The brief's audit: *working controls, responsive layout, keyboard access, visible focus, contrast over bright and dark video, tap-friendly controls, and reduced motion.* Every item below was tested in Chrome 157 with automated browser scripts (Playwright driving real Chrome) against the demo page, plus Lighthouse 12 on the production build. Date: 2026-11-12.

## Results at a glance

| Area | Result |
| --- | --- |
| Essential controls (mouse and keyboard) | Pass |
| Event timeline, highlights, recap, toasts | Pass |
| Settings, layout, shortcuts popover, Esc | Pass |
| Multi-angle swaps and sync | Pass (30 swaps, worst timestamp error 0.033s) |
| Responsive 320 / 390 / 768 / 1024 / 1440 | Pass |
| Contrast over white and black frames | Pass (every pair; table in `design/contrast.md`) |
| Reduced motion, forced colours, reduced transparency | Pass |
| Lighthouse (mobile, throttled) | Accessibility 100 · Best practices 100 · SEO 100 · Performance 78 · FCP 1.7s · LCP 2.4s · CLS 0.001 |

## Details

| Item | How it was tested | Result |
| --- | --- | --- |
| Play/pause | Mouse click; Enter and Space on the focused button; Space/K hotkeys | Pass |
| Seek bar | Click at 50.5% lands at 50.5%; arrow keys on the thumb; ←/→ hotkeys seek 5s | Pass |
| Time | Current time advances while playing; duration shown | Pass |
| Volume / mute | Arrow keys on the volume thumb lower volume; Enter on mute toggles; mouse toggles | Pass |
| Fullscreen | Button present and enabled; enters the player container. Headless Chrome refuses the Fullscreen API, so enter/exit by click and Enter was verified in a visible browser on the same skin code | Pass |
| Tab order = visual order | Tab from the player: centre play → seek → markers → play → previous → next → mute → volume → settings → shortcuts → picture-in-picture → fullscreen; positions compared at each step | Pass |
| Visible focus | Every stop shows a 2px signal ring (the centre play uses a ring on a dark halo, since it sits on raw video) | Pass |
| Controls never hide while focused | Keyboard focus inside the controls holds them with Video.js's `visibility="always"` until focus leaves; menus and pause also hold them | Pass |
| Markers | 11 markers in three kinds; one Tab stop; arrows move between them; tooltip follows focus ("Objective captured · Azure — 01:35 · press Enter to jump"); Enter jumps to the event | Pass |
| Markers not by colour alone | Diamond 10×10 rotated, square 9×9, tick 2×16, and they keep these shapes in forced colours | Pass |
| Next / previous highlight | Buttons, N and Shift+N jump to the right events | Pass |
| Recap | Clicking an item seeks there and it becomes "Now" (`aria-current`); traced directly: seek to 5:00 and "Round 3 starts" marked Now within a second | Pass |
| Event toasts | Playing across 0:48 raises "Elimination · Player 1 → Ember 3" in an `aria-live="polite"` region; settings switches toasts off | Pass |
| No events | A single-angle match without an events file: no markers, highlight buttons `aria-disabled`, N does nothing, no recap, no angles column, no HUD, no errors | Pass |
| Settings menu | Opens with Enter; holds Speed, Layout, Event toasts (and Captions when tracks exist); Esc closes it and focus returns to the gear; outside click closes | Pass |
| Layout | Settings → Stage only hides the angles; 50 / 50 shows one angle at the same width as the stage; the page's layout control restores 70/30 | Pass |
| Shortcuts | ? opens the list; Esc closes it | Pass |
| HUD | Round, round clock, score and the active angle update from `match.json` as the match plays; sync pill shows OK, hollow amber while resyncing | Pass |
| Angle swaps | 15 swaps while playing and 15 while paused, by tile click and keys 1–3, between different stream URLs: the stage resumes within 0.033s of the swap moment; no layout shift | Pass |
| Tile sync | While playing, visible tiles stay within 0.003s of the stage | Pass |
| Tile audio | Tiles are muted in every one of the 30 swaps | Pass |
| Fallback | A match with a broken third angle: its tile hides, swapping to it is refused, the stage keeps playing | Pass |
| 320px | No horizontal overflow; nothing spills out of the band; chip row; 48px buttons on touch; chip swap keeps the time | Pass |
| 390px | Same as 320px | Pass |
| 768px | Angles stacked under the stage | Pass |
| 1024px and up | Stage and angles side by side (70/30) | Pass |
| Phones save data | Below 640px no tile streams at all; only the stage plays | Pass |
| Tap targets | 48px buttons and chips on coarse pointers; 44px rows and buttons elsewhere; Lighthouse target-size passes | Pass |
| Contrast | `design/contrast.mjs` composites each translucent surface over a white and a black frame: text ≥ 4.5:1 (lowest: muted duration 5.28:1), track, markers, thumb and focus ≥ 3:1 (lowest: round marker 3.60:1, track 3.28:1) | Pass |
| Reduced motion | Spinner stops, sync pulse stops, all transitions 0s, no smooth scrolling | Pass |
| Forced colours | Markers keep their shapes; played range and focus use Highlight; chips and menus get borders | Pass |
| Reduced transparency | The band and chips become solid ground | Pass |
| First load | Lighthouse mobile (slow 4G, 4× CPU) on the full eight-section page: first contentful paint 1.7s, largest 2.4s, layout shift 0.001; the painted poster is reused as the player's poster so the stage never repaints; fonts use `font-display: swap`; the player stack loads after the page paints | Pass |

## Known limits

- **Fullscreen on iOS Safari and Android Chrome** follows Video.js's own handling (on iPhone, Safari plays fullscreen in its native player). It was not tested on physical phones; check it on yours before submitting (owner checklist).
- **Placeholder footage**: the three angles are crops of one CC BY clip until the match footage is uploaded to Mux; swap logic was tested with three different stream URLs.
- **Performance score 78** on Lighthouse's throttled mobile profile comes from parsing the HLS engine after the page paints; first paint and layout stability meet the brief.
