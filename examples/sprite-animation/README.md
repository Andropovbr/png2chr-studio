# Sprite animation export example

This directory illustrates the files produced by animation mode for a 32x32
sprite sheet divided into four 16x16 frames. Frames 0-1 form `idle`; frames 2-3
form `movement`.

The example starts with a destination CHR containing two tiles. Two new tiles
are appended at indexes `$02` and `$03`. Repeated artwork reuses those indexes,
and the final frame demonstrates the NES horizontal (`$40`) and vertical
(`$80`) OAM attribute flags. Transparent 8x8 cells are absent from the sprite
lists. The two idle frames use individual durations of 12 and 18 game frames.

- `hero_animation.json` is the portable, versioned metadata.
- `hero_animation.h` and `hero_animation.c` are the cc65-friendly C export.
- `hero_animation.inc` and `hero_animation.s` are the ca65 export.
- `hero.chr` would be the final binary CHR selected by `chr.output`; it is not
  checked in because this example focuses on the metadata layouts.

All tile indexes are absolute positions in the final concatenated CHR.
