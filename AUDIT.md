# Sightline audit

The challenge's audit: *working controls, responsive layout, keyboard access, visible focus, contrast over bright and dark video, tap-friendly controls, and reduced motion.* Every item below was tested in Chrome with automated browser scripts (Playwright driving real Chrome) against the demo page, plus Lighthouse 12 on the production build. Date: 2026-11-12.

## Results at a glance

| Area | Result |
| --- | --- |
| Essential controls (mouse and keyboard) | Pass |
| Event lane, highlights, recap, kill feed | Pass |
| Settings, layout, shortcuts popover, Esc | Pass |
| Multi-angle swaps and sync | Pass (30 swaps, the stage resumes within 0.25s of the swap moment) |
| Instant replay, spoiler-free, moment links, multiview fullscreen | Pass |
| Responsive 320 / 390 / 768 / 1024 / 1440 / 1600 | Pass |
| Contrast over white and black frames | Pass (31 pairs; table in `design/contrast.md`) |
| Reduced motion, forced colours, reduced transparency | Pass |
| Lighthouse, desktop | Performance 100 · Accessibility 100 · Best practices 100 · SEO 100 · FCP 0.4s · LCP 0.6s · TBT 30ms · CLS 0 |
| Lighthouse, mobile (slow 4G, 4× CPU) | Performance 92 · Accessibility 100 · Best practices 100 · SEO 100 · FCP 1.5s · LCP 3.0s · TBT 160ms · CLS 0.011 |

## Details

| Item | How it was tested | Result |
| --- | --- | --- |
| Play/pause | Mouse click; Enter and Space on the focused button; Space/K hotkeys | Pass |
| Seek bar | Click at 50.5% lands at 50.5%; arrow keys on the thumb; ←/→ hotkeys seek 5s; the knob is a 26px target, shown once the video has started (and on hover or focus) | Pass |
| Time | Current time advances while playing; duration shown | Pass |
| Volume / mute | Arrow keys on the volume thumb lower volume; Enter on mute toggles; mouse toggles | Pass |
| Fullscreen | Enters the player container; in the split layout the angles float on the picture and the controls return over it | Pass |
| Tab order = visual order | Centre play → seek → event pins → previous → play → next → instant replay → mute → volume → settings → shortcuts → picture-in-picture → multiview → fullscreen; positions compared at each step | Pass |
| Visible focus | Every stop shows a 2px signal ring (the centre play uses a ring on a dark halo, since it sits on raw video) | Pass |
| Controls never hide while focused | Keyboard focus inside the controls holds them with Video.js's `visibility="always"` until focus leaves; in the split layout the control panel is always shown | Pass |
| Event pins | 21 pins; one Tab stop; arrows move between them; the tooltip follows focus ("Elimination · Player 2 → Azure 2 — 00:17 · press Enter to jump"); Enter jumps to the event | Pass |
| Not by colour alone | Each kind has its own glyph (skull, crown, flag, round tag), kept in forced colours in system colours | Pass |
| Seek preview | Hovering the line shows that moment's frame from the angle's storyboard; the storyboard follows the angle on the stage | Pass |
| Next / previous highlight | Buttons, N and Shift+N jump to the right events | Pass |
| Instant replay | R rewinds 8s at half speed with a badge, then hands back at normal speed where it started | Pass |
| Recap | Clicking an item seeks there and it becomes "Now" (`aria-current`); the rail keeps the current event in view | Pass |
| Kill feed | Playing across an elimination adds an entry in an `aria-live="polite"` list; settings switches it off | Pass |
| Spoiler-free | Settings hides the score, the kill feed and the event pins, and the page blurs its recap | Pass |
| Moment links | "Copy link to this moment" copies `?t=&angle=`; opening it lands on that time and angle | Pass |
| No events | A single-angle match without an events file: no pins, highlight buttons `aria-disabled`, N does nothing, no recap, no angles column, no HUD, no errors | Pass |
| Settings menu | Opens with Enter; holds Speed, Quality (Auto plus each Mux rendition, shown only when the stream has more than one), Layout, Kill feed, Spoiler-free (and Captions when tracks exist); Esc closes it and focus returns to the gear | Pass |
| Quality switch | Picking a quality shows "Loading 720p" while the old quality keeps playing (no stall), then "Now in 720p"; seeking back into a part watched in another quality plays those frames while the chosen quality reloads; the gear wears an HD badge while 1080p plays | Pass |
| Phones (portrait and landscape) | No split view: the stage takes the full width and angle tabs sit under it; no multiview button. In fullscreen the angles stay closed and an angles button opens and closes them over the picture; the settings menu is more compact; the line keeps one width with the controls active or idle | Pass |
| Rotate (phones) | In fullscreen on a touch device a rotate button locks the screen to landscape (Screen Orientation API); hidden outside fullscreen and where the browser can't lock (iPhone uses Safari's own fullscreen player) | Pass |
| Layout | Split: stage and two angles at exactly the stage's height, controls docked under them. Stage only: an ordinary overlay player, no multiview | Pass |
| Multiview fullscreen | W or the page button fills the screen with the stage and its angles; swaps and layouts work inside; Esc or the close button exits | Pass |
| Shortcuts | ? opens the list; Esc closes it | Pass |
| HUD | Round, round clock, score and the active angle update from `match.json` as the match plays; sync pill shows OK, hollow amber while resyncing | Pass |
| Angle swaps | 15 swaps while playing and 15 while paused, by tile click and keys 1–3: the stage resumes within 0.25s of the swap moment (measured at the click or keypress); no layout shift | Pass |
| Tile sync and audio | While playing, visible tiles stay within 0.25s of the stage; tiles are muted in every swap | Pass |
| Fallback | A match with a broken third angle: its tile hides, swapping to it is refused, the stage keeps playing | Pass |
| 320px / 390px | No horizontal overflow; nothing spills out of the band; chip row; 48px buttons on touch; chip swap keeps the time | Pass |
| 768px / 1024px | Angles beside the stage; nothing spills out of the band | Pass |
| Phones save data | Below 640px no tile streams at all; only the stage plays | Pass |
| Tap targets | 48px buttons and chips on coarse pointers; Lighthouse target-size passes on desktop and mobile | Pass |
| Contrast | `design/contrast.mjs` composites each translucent surface over a white and a black frame: text ≥ 4.5:1 (lowest: muted duration 5.28:1); line, pins, knob and focus ≥ 3:1 (lowest: timeline line 3.28:1) | Pass |
| Reduced motion | Spinner and sync pulse stop, transitions 0s, no smooth scrolling, the frame and nav stop animating | Pass |
| Forced colours | Pins keep their glyphs; played range and focus use Highlight; chips and menus get borders | Pass |
| Reduced transparency | The band and chips become solid ground | Pass |
| First load | The display font is preloaded and the poster is reused as the player's poster: layout shift 0 on desktop, 0.013 on mobile | Pass |

## Known limits

- **Fullscreen on iOS Safari and Android Chrome** follows Video.js's own handling (on iPhone, Safari plays fullscreen in its native player). It was not tested on physical phones; check it on yours before submitting.
- **Mobile performance** is 92 on Lighthouse's throttled profile: the player stack (Video.js and the HLS engine) loads after the poster has painted, so it no longer delays the first paint; what remains is parsing that stack on a slow CPU.
- **Footage** is one round of Counter-Strike 2 gameplay recorded by the author (one minute; the aim cam and radar views are crops of the same recording). The game's own HUD is part of the picture, so its minimap and kill feed sit under the skin's scoreboard and kill feed.
