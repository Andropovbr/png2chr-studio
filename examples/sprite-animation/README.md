# Sprite animation export example

This directory illustrates the files produced by animation mode for an asset configured with multiple animations (`idle`, `movement_right`, `movement_left`). Each animation can have its own source PNG spritesheet, frame dimensions, origin, playback mode (`loop` or `once`), and flip flags.

The example uses `hero` as its symbol prefix and `animation` as its asset name, producing the shared `hero_animation` filename and symbol base. The example starts with a destination CHR containing two tiles. New tiles are appended at indexes `$02` and `$03`. Repeated artwork reuses those indexes, and flipped tiles demonstrate the NES horizontal (`$40`) and vertical (`$80`) OAM attribute flags. Transparent 8x8 cells are omitted from metasprite definitions. Individual frame durations are measured in game frames.

- `hero_animation.json` is the portable, versioned metadata (v4).
- `hero_animation.h` and `hero_animation.c` are the cc65-friendly C export.
- `hero_animation.inc` and `hero_animation.s` are the ca65 export.
- `hero_animation.chr` would be the final binary CHR selected by `chr.output`.

All tile indexes are absolute positions in the final consolidated CHR.
