# Vantage

Vantage is a [Video.js 10](https://videojs.org) skin for watching play, not films: esports, gameplay recordings and multi-camera sports. The main angle takes the stage and two more angles stay live beside it; click one, or press 1–3, and it swaps onto the stage at the same timestamp. The seek bar is an event timeline, with eliminations, objectives and round starts as markers you can tab to, and a broadcast-style HUD carries the scoreboard and the active angle.

It is an HTML skin styled with plain CSS, built from the Video.js Scaffold skin with `npx @videojs/cli skin create`. The design mockups are in `design/reference/`.

## What's where

- `src/`: the skin, and only the skin. It works on any video; with no events track it is an ordinary player.
  - `src/video/skin.html`, `skin.css`, `skin.ts`: markup, styles and element registration.
  - `src/video/vantage.ts`: event timeline, highlight navigation, toasts, HUD API.
  - `src/styles/themes/vantage.css`: tokens.
- `site/`: the public demo page (what you deploy and submit).
  - `site/public/match.json`: **the file you edit**: angles, Mux playback IDs, teams, scoreboard.
  - `site/public/events.vtt`: the match events.
  - `site/press/`: 1600×1000 screenshots for the submission.
- `apps/preview/`: the Video.js workbench for developing the skin.
- `design/`: mockups, the icon generator (`design/icons/generate.mjs`) and the contrast measurement (`design/contrast.mjs`, results in `design/contrast.md`).

## Set your Mux playback IDs

1. Upload each angle to Mux (Video → Assets → Create New Asset) with a **public** playback policy.
2. When an asset says Ready, copy its **Playback ID**.
3. In `site/public/match.json`, put each ID in its angle's `"mux"` field, and delete that angle's `"crop"` (crops only exist to fake three angles from one placeholder clip):

```json
{ "id": 1, "label": "Player 1 POV", "short": "Player 1", "mux": "YOUR_PLAYBACK_ID_1" }
```

When `mux` is set, the angle streams from `https://stream.mux.com/<id>.m3u8`, the footer credits Mux, and the timeline gets Mux's thumbnail previews. Leave `mux` empty to use `src` instead (any HLS or MP4 URL). One angle is enough; with a single angle the page is an ordinary player with no angles column.

Also update `"footage"` and `"footageUrl"` (the footer credit), `"teams"`, and `"repo"` (your public GitHub URL; the GitHub link appears when it is set).

`match.json` and `events.vtt` are plain files in the built site too, so you can edit them in `site/dist/` after building, without rebuilding.

## Edit the events

`site/public/events.vtt` is a WebVTT file. Each cue's start time is the moment; its text is `kind|label`:

```
00:03:12.000 --> 00:03:13.000
elim|Elimination · Player 2 → Azure 1
```

Kinds: `elim` and `clutch` (amber diamond), `obj` (cyan square), `round` (red tick). The scoreboard in `match.json` is a list of `{ "t": seconds, "round": n, "azure": score, "ember": score }` entries; use your team names in lower case as the keys.

## Develop

```sh
npm install
npm run dev          # skin workbench at http://localhost:5173
npm run site:dev     # demo page at http://localhost:5191
npm run typecheck
```

## Build and deploy the demo page

```sh
npm run site:build   # writes site/dist/
npm run site:preview # check the build at http://localhost:4191
```

`site/dist/` is a static folder with relative paths and an `.htaccess`, so it works at a domain root, in a subfolder, or on a subdomain.

- **Netlify:** drag the `site/dist` folder onto https://app.netlify.com/drop.
- **Shared hosting (cPanel):** create a subdomain (for example `vantage.yourdomain.com`), turn on free SSL (AutoSSL / Let's Encrypt), then upload the **contents** of `site/dist/` (including the hidden `.htaccess`) into the subdomain's folder with File Manager or FTP.

## Keyboard

Space or K play/pause · ←/→ seek 5s · ↑/↓ volume · M mute · F fullscreen · C captions · N / Shift+N next or previous highlight · 1–3 switch angle · ? shortcuts list · Esc closes menus.

## Credits

- Built on [Video.js 10](https://videojs.org) (`@videojs/html`), Apache-2.0. Started from the Video.js Scaffold skin via `@videojs/cli`.
- Type: Space Grotesk, Inter and JetBrains Mono, SIL Open Font License 1.1, self-hosted through Fontsource.
- Icons: drawn for Vantage by `design/icons/generate.mjs`.
- Placeholder footage: *Big Buck Bunny* © Blender Foundation, CC BY 3.0, streamed from Mux's public test streams.
- No game names, logos, characters or interface from any real game; team names are invented.

## Licence

[Apache-2.0](./LICENSE).
