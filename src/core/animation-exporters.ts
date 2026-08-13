import {
  NES_SPRITE_FLIP_HORIZONTAL,
  NES_SPRITE_FLIP_VERTICAL,
} from './animation-model';
import { normalizeCIdentifier } from './c-identifier';
import type { AnimationProjectModel, MetaspriteTile } from './animation-model';

export interface CAnimationExport {
  readonly headerFileName: string;
  readonly sourceFileName: string;
  readonly header: string;
  readonly source: string;
  readonly estimatedRomBytes: number;
}

export interface Ca65AnimationExport {
  readonly includeFileName: string;
  readonly sourceFileName: string;
  readonly include: string;
  readonly source: string;
  readonly estimatedRomBytes: number;
}

export const ANIMATION_PLAYBACK_LOOP = 0;
export const ANIMATION_PLAYBACK_ONCE = 1;
export const ANIMATION_ALLOW_H_FLIP = NES_SPRITE_FLIP_HORIZONTAL;
export const ANIMATION_ALLOW_V_FLIP = NES_SPRITE_FLIP_VERTICAL;

export function sanitizeCIdentifier(name: string): string {
  return normalizeCIdentifier(name) || 'animation';
}

function toPascalCase(name: string): string {
  const normalized = normalizeCIdentifier(name) || 'asset';
  return normalized
    .split('_')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

function hex(value: number): string {
  return `0x${value.toString(16).padStart(2, '0').toUpperCase()}`;
}

function asmHex(value: number): string {
  return `$${(value & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;
}

function signedByte(value: number): number {
  return value < 0 ? 0x100 + value : value;
}

function flatten(model: AnimationProjectModel): {
  sprites: MetaspriteTile[];
  frames: {
    spriteOffset: number;
    spriteCount: number;
    duration: number;
  }[];
  animations: {
    frameOffset: number;
    frameCount: number;
    widthTiles: number;
    heightTiles: number;
    playback: number;
    flags: number;
  }[];
} {
  const sprites: MetaspriteTile[] = [];
  const frames: {
    spriteOffset: number;
    spriteCount: number;
    duration: number;
  }[] = [];
  const animations: {
    frameOffset: number;
    frameCount: number;
    widthTiles: number;
    heightTiles: number;
    playback: number;
    flags: number;
  }[] = [];
  model.animations.forEach((animation) => {
    const frameOffset = frames.length;
    animation.frames.forEach((frame) => {
      const spriteOffset = sprites.length;
      sprites.push(...frame.sprites);
      frames.push({
        spriteOffset,
        spriteCount: frame.sprites.length,
        duration: frame.duration,
      });
    });
    const playback =
      animation.playback === 'once'
        ? ANIMATION_PLAYBACK_ONCE
        : ANIMATION_PLAYBACK_LOOP;
    const flags =
      (animation.allowHorizontalFlip ? ANIMATION_ALLOW_H_FLIP : 0) |
      (animation.allowVerticalFlip ? ANIMATION_ALLOW_V_FLIP : 0);
    animations.push({
      frameOffset,
      frameCount: animation.frames.length,
      widthTiles: animation.widthTiles,
      heightTiles: animation.heightTiles,
      playback,
      flags,
    });
  });
  return { sprites, frames, animations };
}

function estimatedRomBytes(model: AnimationProjectModel): number {
  const flat = flatten(model);
  return (
    Math.max(1, flat.sprites.length) * 4 +
    flat.frames.length * 4 +
    flat.animations.length * 7 +
    1
  );
}

export function serializeAnimationMetadata(
  model: AnimationProjectModel,
): string {
  const metadata = {
    format: model.format,
    version: model.version,
    name: model.name,
    symbol_prefix: model.symbolPrefix,
    symbol_base: model.symbolBase,
    default_palette_index: model.defaultPaletteIndex,
    pattern_table: model.patternTable,
    destination_pattern_table: model.destinationPatternTable,
    color_reduction: model.colorReduction ?? 'median-cut',
    source: model.source
      ? {
          image: model.source.image,
          image_width: model.source.imageWidth,
          image_height: model.source.imageHeight,
          frame_width: model.source.frameWidth,
          frame_height: model.source.frameHeight,
          tile_width: model.source.tileWidth,
          tile_height: model.source.tileHeight,
          frame_columns: model.source.frameColumns,
          frame_rows: model.source.frameRows,
        }
      : undefined,
    chr: {
      output: model.chr.output,
      physical_capacity_tiles: model.chr.physicalCapacityTiles,
      pattern_table: model.chr.patternTable,
      destination_pattern_table: model.chr.destinationPatternTable,
      pattern_table_capacity_tiles: model.chr.patternTableCapacityTiles,
      capacity_tiles: model.chr.capacityTiles,
      base_tile_count: model.chr.baseTileCount,
      pattern_table_base_tile_count: model.chr.patternTableBaseTileCount,
      reused_destination_tiles: model.chr.reusedDestinationTiles,
      reused_imported_tiles: model.chr.reusedImportedTiles,
      new_tile_count: model.chr.newTileCount,
      appended_tile_start: model.chr.appendedTileStart,
      final_tile_count: model.chr.finalTileCount,
      final_size_bytes: model.chr.finalSizeBytes,
      remaining_tiles: model.chr.remainingTiles,
    },
    attribute_flags: {
      flip_horizontal: NES_SPRITE_FLIP_HORIZONTAL,
      flip_vertical: NES_SPRITE_FLIP_VERTICAL,
      palette_mask: 0x03,
    },
    playback_constants: {
      loop: ANIMATION_PLAYBACK_LOOP,
      once: ANIMATION_PLAYBACK_ONCE,
    },
    animations: model.animations.map((animation) => ({
      name: animation.name,
      source_file: animation.sourceFile,
      palette_index: animation.paletteIndex,
      frame_width: animation.width,
      frame_height: animation.height,
      origin_x: animation.originX,
      origin_y: animation.originY,
      playback: animation.playback,
      allow_horizontal_flip: animation.allowHorizontalFlip,
      allow_vertical_flip: animation.allowVerticalFlip,
      default_frame_duration: animation.defaultFrameDuration,
      width: animation.width,
      height: animation.height,
      width_tiles: animation.widthTiles,
      height_tiles: animation.heightTiles,
      frames: animation.frames.map((frame) => ({
        source_index: frame.sourceIndex,
        source_x: frame.sourceX,
        source_y: frame.sourceY,
        duration: frame.duration,
        palette_index: frame.paletteIndex,
        width: frame.width,
        height: frame.height,
        omitted_tile_count: frame.omittedTileCount,
        sprites: frame.sprites.map((sprite) => ({
          x: sprite.x,
          y: sprite.y,
          tile: sprite.tile,
          physical_tile_index: sprite.physicalTileIndex,
          attributes: sprite.attributes,
          palette: sprite.palette,
          horizontal_flip: sprite.horizontalFlip,
          vertical_flip: sprite.verticalFlip,
          reuse: sprite.reuse,
          source_tile_column: sprite.sourceTileColumn,
          source_tile_row: sprite.sourceTileRow,
        })),
      })),
    })),
  };
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

export function generateCAnimationExport(
  model: AnimationProjectModel,
): CAnimationExport {
  const id = model.symbolBase;
  const idUpper = sanitizeCIdentifier(id).toUpperCase();
  const enumName = `${toPascalCase(id)}AnimationId`;
  const guard = `${id.toUpperCase()}_H`;
  const flat = flatten(model);
  const headerFileName = `${id}.h`;
  const sourceFileName = `${id}.c`;
  const enumEntries = model.animations.map(
    (anim, idx) =>
      `    ${idUpper}_ANIM_${sanitizeCIdentifier(anim.name).toUpperCase()} = ${String(idx)},`,
  );
  const header = `#ifndef ${guard}
#define ${guard}

#include <stdint.h>

#ifndef PNG2CHR_ANIMATION_FORMAT_CONSTANTS
#define PNG2CHR_ANIMATION_FORMAT_CONSTANTS
#define NES_SPRITE_FLIP_HORIZONTAL ${hex(NES_SPRITE_FLIP_HORIZONTAL)}
#define NES_SPRITE_FLIP_VERTICAL ${hex(NES_SPRITE_FLIP_VERTICAL)}
#define ANIMATION_PLAYBACK_LOOP ${String(ANIMATION_PLAYBACK_LOOP)}
#define ANIMATION_PLAYBACK_ONCE ${String(ANIMATION_PLAYBACK_ONCE)}
#define ANIMATION_ALLOW_H_FLIP ${hex(ANIMATION_ALLOW_H_FLIP)}
#define ANIMATION_ALLOW_V_FLIP ${hex(ANIMATION_ALLOW_V_FLIP)}
#endif

#ifndef PNG2CHR_ANIMATION_FORMAT_TYPES
#define PNG2CHR_ANIMATION_FORMAT_TYPES
typedef struct {
    int8_t x;
    int8_t y;
    uint8_t tile;
    uint8_t attributes;
} Png2ChrAnimationMetaspriteTile;

typedef struct {
    uint16_t sprite_offset;
    uint8_t sprite_count;
    uint8_t duration;
} Png2ChrAnimationFrame;

typedef struct {
    uint16_t frame_offset;
    uint8_t frame_count;
    uint8_t width_tiles;
    uint8_t height_tiles;
    uint8_t playback;
    uint8_t flags;
} Png2ChrAnimation;
#endif

typedef enum {
${enumEntries.join('\n')}
} ${enumName};

/* OAM tile bytes address this table; set PPUCTRL bit 3 to match it. */
#define ${idUpper}_SPRITE_PATTERN_TABLE ${String(model.patternTable)}

extern const Png2ChrAnimationMetaspriteTile ${id}_sprites[];
extern const Png2ChrAnimationFrame ${id}_frames[];
extern const Png2ChrAnimation ${id}_animations[];
extern const uint8_t ${id}_animation_count;
extern const uint8_t ${id}_sprite_pattern_table;

#endif
`;
  const spriteRows = flat.sprites.length
    ? flat.sprites.map(
        (sprite) =>
          `    { ${String(sprite.x)}, ${String(sprite.y)}, ${hex(sprite.tile)}, ${hex(sprite.attributes)} },`,
      )
    : ['    { 0, 0, 0x00, 0x00 }, /* sentinel; all frame counts are zero */'];
  const frameRows = flat.frames.length
    ? flat.frames.map(
        (frame) =>
          `    { ${String(frame.spriteOffset)}, ${String(frame.spriteCount)}, ${String(frame.duration)} },`,
      )
    : ['    { 0, 0, 0 },'];
  const animationRows = flat.animations.map(
    (animation) =>
      `    { ${String(animation.frameOffset)}, ${String(animation.frameCount)}, ${String(animation.widthTiles)}, ${String(animation.heightTiles)}, ${String(animation.playback)}, ${hex(animation.flags)} },`,
  );
  const source = `#include "${headerFileName}"

/* Sprite entry: signed x, signed y, local CHR tile index, NES OAM attributes. */
const Png2ChrAnimationMetaspriteTile ${id}_sprites[] = {
${spriteRows.join('\n')}
};

/* Frame entry: sprite-array offset, sprite count, duration in game frames. */
const Png2ChrAnimationFrame ${id}_frames[] = {
${frameRows.join('\n')}
};

/* Animation entry: frame offset, count, size, playback mode, flip flags. */
const Png2ChrAnimation ${id}_animations[] = {
${animationRows.join('\n')}
};

const uint8_t ${id}_animation_count = ${String(flat.animations.length)};
const uint8_t ${id}_sprite_pattern_table = ${String(model.patternTable)};
`;
  return {
    headerFileName,
    sourceFileName,
    header,
    source,
    estimatedRomBytes: estimatedRomBytes(model),
  };
}

export function generateCa65AnimationExport(
  model: AnimationProjectModel,
): Ca65AnimationExport {
  const id = model.symbolBase;
  const idUpper = sanitizeCIdentifier(id).toUpperCase();
  const flat = flatten(model);
  const includeFileName = `${id}.inc`;
  const sourceFileName = `${id}.s`;
  const constEntries = model.animations.map(
    (anim, idx) =>
      `${idUpper}_ANIM_${sanitizeCIdentifier(anim.name).toUpperCase()} = ${String(idx)}`,
  );
  const include = `; Generated by PNG2CHR Studio animation metadata v${String(model.version)}.
; Sprite entry (4 bytes): signed X, signed Y, local CHR tile, NES OAM attributes.
; Frame entry (4 bytes): sprite offset word, sprite count, duration.
; Animation entry (7 bytes): frame offset word, frame count, width tiles,
;                            height tiles, playback mode, flip flags.
.ifndef PNG2CHR_ANIMATION_FORMAT_CONSTANTS
PNG2CHR_ANIMATION_FORMAT_CONSTANTS = 1
NES_SPRITE_FLIP_HORIZONTAL = $40
NES_SPRITE_FLIP_VERTICAL = $80
ANIMATION_PLAYBACK_LOOP = ${String(ANIMATION_PLAYBACK_LOOP)}
ANIMATION_PLAYBACK_ONCE = ${String(ANIMATION_PLAYBACK_ONCE)}
ANIMATION_ALLOW_H_FLIP = $40
ANIMATION_ALLOW_V_FLIP = $80
.endif

${constEntries.join('\n')}

; OAM tile bytes are local to this table; set PPUCTRL bit 3 accordingly.
${idUpper}_SPRITE_PATTERN_TABLE = ${String(model.patternTable)}

.import ${id}_sprites
.import ${id}_frames
.import ${id}_animations
.import ${id}_animation_count
.import ${id}_sprite_pattern_table
`;
  const spriteRows = flat.sprites.length
    ? flat.sprites.map(
        (sprite) =>
          `    .byte ${asmHex(signedByte(sprite.x))}, ${asmHex(signedByte(sprite.y))}, ${asmHex(sprite.tile)}, ${asmHex(sprite.attributes)}`,
      )
    : ['    .byte $00, $00, $00, $00 ; sentinel'];
  const frameRows = flat.frames.map(
    (frame) =>
      `    .word ${String(frame.spriteOffset)}\n    .byte ${String(frame.spriteCount)}, ${String(frame.duration)}`,
  );
  const animationRows = flat.animations.map(
    (animation) =>
      `    .word ${String(animation.frameOffset)}\n    .byte ${String(animation.frameCount)}, ${String(animation.widthTiles)}, ${String(animation.heightTiles)}, ${String(animation.playback)}, ${asmHex(animation.flags)}`,
  );
  const source = `; Generated by PNG2CHR Studio animation metadata v${String(model.version)}.
.export ${id}_sprites
.export ${id}_frames
.export ${id}_animations
.export ${id}_animation_count
.export ${id}_sprite_pattern_table

.segment "RODATA"

${id}_sprites:
${spriteRows.join('\n')}

${id}_frames:
${frameRows.join('\n')}

${id}_animations:
${animationRows.join('\n')}

${id}_animation_count:
    .byte ${String(flat.animations.length)}

${id}_sprite_pattern_table:
    .byte ${String(model.patternTable)}
`;
  return {
    includeFileName,
    sourceFileName,
    include,
    source,
    estimatedRomBytes: estimatedRomBytes(model),
  };
}
