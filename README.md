# Sightline

Sightline is a [Video.js 10](https://videojs.org) skin for watching play, not films: esports, gameplay recordings and multi-camera sports. The main POV takes the stage and two more angles stay live beside it; click one, or press 1–3, and it swaps onto the stage at the same timestamp. The seek bar is an event lane: every kill, clutch, objective and round is a pin with its own glyph in the colour of the side that scored, and hovering shows the frame. A kill feed, a broadcast HUD, instant replay (R), multiview fullscreen (W), moment links and a spoiler-free mode are built for people watching a match.

It is an HTML skin styled with plain CSS, built from the Video.js Scaffold skin with `npx @videojs/cli skin create`. The design mockups are in `design/reference/`.

## The demo page

A full-width console around the player: the stage and its two angles on top (split layout, the angles exactly the stage's height), the control panel docked under them, layout and share controls above, the match recap below. In the stage layout it is an ordinary overlay player. Then four numbered sections: 01 Built for spectators, 02 Make it yours (live accent, radius and HUD switches), 03 Accessibility, 04 Install.

## What's where

- `src/`: the skin, and only the skin. It works on any video; with no events track it is an ordinary player.
  - `src/video/skin.html`, `skin.css`, `skin.ts`: markup, styles and element registration.
  - `src/video/sightline.ts`: event lane, highlights, kill feed, instant replay, HUD API.
  - `src/styles/themes/sightline.css`: tokens.
- `site/`: the public demo page (what you deploy and submit).
  - `site/public/match.json`: **the file you edit**: angles, Mux playback IDs, teams, scoreboard.
  - `site/public/events.vtt`: the match events.
  - `site/public/storyboards/`, `site/public/posters/`: seek-bar thumbnails and posters for the local angles (`design/match/storyboards.mjs`).
  - `site/press/`: 1600×1000 screenshots for the submission.
- `apps/preview/`: the Video.js workbench for developing the skin.
- `design/`: mockups, the icon generator (`design/icons/generate.mjs`) and the contrast measurement (`design/contrast.mjs`, results in `design/contrast.md`).

## The demo match

`design/match/script.mjs` scripts a four-round 4v4 (who eliminates whom and when, objective captures, a 1v3 clutch); `sim.js` draws it from three cameras; `record.mjs` records each camera to `site/public/media/angle1-3.mp4` and writes `events.vtt` and the scoreboard. `sound.mjs` synthesizes the soundtrack from the same script and muxes it in, and `storyboards.mjs` makes the seek-bar thumbnails and posters:

```sh
npm i --no-save playwright-core ffmpeg-static
FFMPEG="$(node -p "require('ffmpeg-static')")" node design/match/record.mjs --views p1
# then --views p2 and --views overview
node design/match/sound.mjs --mux
node design/match/storyboards.mjs
```

## Set your Mux playback IDs

1. Upload each angle to Mux (Video → Assets → Create New Asset) with a **public** playback policy.
2. When an asset says Ready, copy its **Playback ID**.
3. In `site/public/match.json`, put each ID in its angle's `"mux"` field (upload `site/public/media/angle1.mp4` as angle 1, and so on, or your own recordings):

```json
{ "id": 1, "label": "Player 1 POV", "short": "Player 1", "mux": "YOUR_PLAYBACK_ID_1" }
```

When `mux` is set, the angle streams from `https://stream.mux.com/<id>.m3u8`, the footer credits Mux, and the timeline gets Mux's thumbnail previews. Leave `mux` empty to use `src` instead (any HLS or MP4 URL). One angle is enough; with a single angle the page is an ordinary player with no angles column.

Also update `"footage"` and `"footageUrl"` (the footer credit), `"teams"`, and `"repo"` (your public GitHub URL; the GitHub link appears when it is set).

`match.json` and `events.vtt` are plain files in the built site too, so you can edit them in `site/dist/` after building, without rebuilding.

## Edit the events

`site/public/events.vtt` is a WebVTT file. Each cue's start time is the moment; its text is `kind|label|team`:

```
00:03:12.000 --> 00:03:13.000
elim|Elimination · Player 2 → Azure 1|b
```

Kinds: `elim` (skull), `clutch` (crown, filled), `obj` (flag), `round` (a tag and a gap in the line). The optional team is `a` or `b`, the side that scored, which colours the pin and the kill feed. The scoreboard in `match.json` is a list of `{ "t": seconds, "round": n, "azure": score, "ember": score }` entries; use your team names in lower case as the keys.

## Develop

```sh
npm install
npm run dev          # the website, opens http://localhost:5191
npm run workbench    # the bare skin workbench at http://localhost:5173
npm run typecheck
```

## Build and deploy the demo page

```sh
npm run site:build   # writes site/dist/
npm run site:preview # check the build at http://localhost:4191
```

`site/dist/` is a static folder with relative paths and an `.htaccess`, so it works at a domain root, in a subfolder, or on a subdomain.

- **Netlify:** drag the `site/dist` folder onto https://app.netlify.com/drop.
- **Shared hosting (cPanel):** create a subdomain (for example `sightline.yourdomain.com`), turn on free SSL (AutoSSL / Let's Encrypt), then upload the **contents** of `site/dist/` (including the hidden `.htaccess`) into the subdomain's folder with File Manager or FTP.

## Keyboard

Space or K play/pause · ←/→ seek 5s · ↑/↓ volume · M mute · F fullscreen · C captions · N / Shift+N next or previous highlight · R instant replay · 1–3 switch angle · W multiview fullscreen · ? shortcuts list · Esc closes menus.

## Using the skin in your own page

Without anything else it is an overlay player. A host page can add more:

- `data-docked` on the player root docks the control panel under the picture; put a side column (for angles) in an element with the class `sl-side` inside the root. In fullscreen the side column floats on the picture and the controls return over it; with `data-layout="stage"` the player is an ordinary overlay player.
- `<track kind="metadata" label="thumbnails" src="storyboard.vtt">` on the media gives seek-bar thumbnails.
- `data-multiview` shows the multiview button; it dispatches `sightline:multiview` for the page to handle.
- The API exported from `src/video/skin`: `setScoreboard`, `setAngle`, `setSync`, `setStageState`, `setLayout`, `setMultiview`, `instantReplay`, `nextHighlight`, `prevHighlight`, `getEvents`, `cut`. Events: `sightline:events`, `sightline:layout`, `sightline:spoilers`, `sightline:multiview`.

## Credits

- Built on [Video.js 10](https://videojs.org) (`@videojs/html`), Apache-2.0. Started from the Video.js Scaffold skin via `@videojs/cli`.
- Type: Barlow Condensed, Inter and JetBrains Mono, SIL Open Font License 1.1, self-hosted through Fontsource.
- Icons: drawn for Sightline by `design/icons/generate.mjs`.
- Footage and sound: an original top-down match between two invented teams, rendered by `design/match/` (three cameras: Player 1 POV, Player 2 POV, map overview), with a soundtrack synthesized from code. Its events and scoreboard come from the same script, so the timeline, the kill feed and every gunshot match the picture.
- No game names, logos, characters or interface from any real game; team names are invented.

## Licence

[Apache-2.0](./LICENSE).
