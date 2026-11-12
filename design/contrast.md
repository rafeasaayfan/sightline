# Contrast

Measured by `node design/contrast.mjs` over the worst footage: a pure white frame and a pure black frame behind every translucent surface. Text needs 4.5:1 (WCAG 1.4.3); icons, slider parts, markers and focus rings need 3:1 (WCAG 1.4.11). The same compositing model was checked against rendered pixels on the earlier skin and matched within one level per channel.

| Pair | Over white frame | Over black frame | Needs | Result |
| --- | --- | --- | --- | --- |
| Clock (text) on the band, top of the time row | 10.68:1 | 18.08:1 | 4.5:1 | Pass |
| Duration (muted) on the band, top of the time row | 5.28:1 | 8.94:1 | 4.5:1 | Pass |
| Key hints (muted) on the band | 8.16:1 | 8.84:1 | 4.5:1 | Pass |
| HUD chip text on its 86% chip | 11.00:1 | 17.05:1 | 4.5:1 | Pass |
| HUD sync label (muted) on its chip | 5.44:1 | 8.43:1 | 4.5:1 | Pass |
| Team name (signal) on its chip | 7.66:1 | 11.87:1 | 4.5:1 | Pass |
| Team name (amber) on its chip | 6.57:1 | 10.18:1 | 4.5:1 | Pass |
| Angle chip: ink on signal | 12.40:1 | 12.40:1 | 4.5:1 | Pass |
| Tile label on its 90% chip | 12.60:1 | 16.92:1 | 4.5:1 | Pass |
| Toast text on its 92% surface | 13.43:1 | 16.86:1 | 4.5:1 | Pass |
| Menu and tooltip text on surface | 16.60:1 | 16.60:1 | 4.5:1 | Pass |
| Menu hint (muted) on surface | 8.21:1 | 8.21:1 | 4.5:1 | Pass |
| Marker tooltip: ink on white card | 17.82:1 | 17.82:1 | 4.5:1 | Pass |
| Icons on the band | 16.50:1 | 17.88:1 | 3:1 | Pass |
| Timeline track (white 40%) on the band | 3.28:1 | 3.77:1 | 3:1 | Pass |
| Played vs unplayed (the white thumb marks the boundary) | 2.26:1 | 3.33:1 | shape cue | Boundary carried by the thumb and halo |
| Thumb (white) on the played range | 1.44:1 | 1.44:1 | shape cue | Boundary carried by the thumb and halo |
| Thumb (white) on the band | 10.68:1 | 18.08:1 | 3:1 | Pass |
| Docked panel: clock and icons | 14.91:1 | 16.59:1 | 4.5:1 | Pass |
| Docked panel: key hints (muted) | 7.37:1 | 8.20:1 | 4.5:1 | Pass |
| Docked panel: timeline line (white 40%) | 3.75:1 | 3.83:1 | 3:1 | Pass |
| Event pin glyph, played (signal) on its plate | 11.58:1 | 12.36:1 | 3:1 | Pass |
| Event pin glyph, played (amber) on its plate | 9.94:1 | 10.61:1 | 3:1 | Pass |
| Event pin glyph, upcoming (signal 70%) on its plate | 6.18:1 | 6.40:1 | 3:1 | Pass |
| Event pin glyph, upcoming (amber 70%) on its plate | 5.40:1 | 5.58:1 | 3:1 | Pass |
| Clutch pin: ink on its filled plate | 12.40:1 | 12.40:1 | 3:1 | Pass |
| Round tag text (white 75%) on its plate | 9.67:1 | 10.09:1 | 4.5:1 | Pass |
| Clip outline (white 85%) on the band | 8.94:1 | 14.17:1 | 3:1 | Pass |
| Kill feed names on the feed surface | 13.43:1 | 16.86:1 | 4.5:1 | Pass |
| Focus ring (signal) on the band | 11.48:1 | 12.44:1 | 3:1 | Pass |
| Focus ring (signal) on its dark halo over video | 12.40:1 | 12.40:1 | 3:1 | Pass |
