# Vantage

Vantage is a [Video.js 10](https://videojs.org) skin for watching play, not films: esports, gameplay recordings and multi-camera sports. The main angle takes the stage and two more angles stay live beside it; click one, or press 1–3, and it swaps onto the stage at the same timestamp. The seek bar is an event timeline, with eliminations, objectives and round starts as markers you can tab to, and a broadcast-style HUD carries the scoreboard and the active angle.

It is an HTML skin styled with plain CSS, built from the Video.js Scaffold skin with `npx @videojs/cli skin create`. The visual reference is in `design/reference/`.

> Status: in development for the Video.js Skins Design Challenge.

## Develop

```sh
npm install
npm run dev
```

The workbench opens the skin in a slimmed-down version of the Video.js sandbox. Its options panel sets the player's width and aspect ratio, the color scheme, text direction, language, and playback options. The settings live in the URL, so a link such as `/?width=384&ratio=9:16` opens the workbench in that state, and `/preview.html#width=384&ratio=9:16` opens the preview alone. Change the media it plays in `apps/preview/src/frame/player`.

Before committing, run:

```sh
npm run typecheck
npm run build
```

## Where things live

- `src/`: the skin, and only the skin.
  - `src/video/`: the skin component and its parts.
  - `src/styles/`: theme tokens and shared styles the skin imports.
- `apps/preview/`: the workbench that previews the skin.
- `design/reference/`: the design mockups (desktop page, phone, controls and states).
- `skin.json`: what this skin is built from, including the Video.js version it was created with.

## Credits

- Built on [Video.js 10](https://videojs.org) (`@videojs/html`), Apache-2.0. Started from the Video.js Scaffold skin via `@videojs/cli`.
- Workbench demo media: NASA's *Cosmic Dawn* trailer, streamed from Mux, as shipped with the Video.js skin workbench.
- No game names, logos, characters or interface from any real game are used; team names are invented.

## Licence

[Apache-2.0](./LICENSE).
