import {
  NES_SPRITE_FLIP_HORIZONTAL,
  NES_SPRITE_FLIP_VERTICAL,
} from './animation-model';
import { normalizeCIdentifier } from './c-identifier';
import { padChrRom } from './chr-rom';
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

const ANIMATION_DIRECTION_NONE = 0;
const ANIMATION_DIRECTION_LEFT = 1;
const ANIMATION_DIRECTION_RIGHT = 2;
const ANIMATION_DIRECTION_MASK = 0x03;
const ANIMATION_GENERATED_HORIZONTAL_FLIP = 0x80;

function animationDirectionFlags(
  animation: AnimationProjectModel['animations'][number],
): number {
  const direction =
    animation.direction === 'left'
      ? ANIMATION_DIRECTION_LEFT
      : animation.direction === 'right'
        ? ANIMATION_DIRECTION_RIGHT
        : ANIMATION_DIRECTION_NONE;
  return (
    direction |
    (animation.generatedByHorizontalFlip
      ? ANIMATION_GENERATED_HORIZONTAL_FLIP
      : 0)
  );
}

export function sanitizeCIdentifier(name: string): string {
  return normalizeCIdentifier(name) || 'animation';
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
    category: number;
    directionFlags: number;
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
    category: number;
    directionFlags: number;
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
    animations.push({
      frameOffset,
      frameCount: animation.frames.length,
      widthTiles: animation.widthTiles,
      heightTiles: animation.heightTiles,
      category: animation.category === 'idle' ? 0 : 1,
      directionFlags: animationDirectionFlags(animation),
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
    source: {
      image: model.source.image,
      image_width: model.source.imageWidth,
      image_height: model.source.imageHeight,
      frame_width: model.source.frameWidth,
      frame_height: model.source.frameHeight,
      tile_width: model.source.tileWidth,
      tile_height: model.source.tileHeight,
      frame_columns: model.source.frameColumns,
      frame_rows: model.source.frameRows,
    },
    chr: {
      output: model.chr.output,
      capacity_tiles: model.chr.capacityTiles,
      base_tile_count: model.chr.baseTileCount,
      reused_destination_tiles: model.chr.reusedDestinationTiles,
      reused_imported_tiles: model.chr.reusedImportedTiles,
      new_tile_count: model.chr.newTileCount,
      appended_tile_start: model.chr.appendedTileStart,
      final_tile_count: model.chr.finalTileCount,
      final_size_bytes: padChrRom(model.finalChr).length,
      remaining_tiles: model.chr.remainingTiles,
    },
    attribute_flags: {
      flip_horizontal: NES_SPRITE_FLIP_HORIZONTAL,
      flip_vertical: NES_SPRITE_FLIP_VERTICAL,
      palette_mask: 0x03,
    },
    animation_flags: {
      direction_mask: ANIMATION_DIRECTION_MASK,
      direction_none: ANIMATION_DIRECTION_NONE,
      direction_left: ANIMATION_DIRECTION_LEFT,
      direction_right: ANIMATION_DIRECTION_RIGHT,
      generated_horizontal_flip: ANIMATION_GENERATED_HORIZONTAL_FLIP,
    },
    origin: model.origin,
    animations: model.animations.map((animation) => ({
      name: animation.name,
      type: animation.category,
      direction: animation.direction,
      generated_by_horizontal_flip: animation.generatedByHorizontalFlip,
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
        width: frame.width,
        height: frame.height,
        omitted_tile_count: frame.omittedTileCount,
        sprites: frame.sprites.map((sprite) => ({
          x: sprite.x,
          y: sprite.y,
          tile: sprite.tile,
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
  const guard = `${id.toUpperCase()}_H`;
  const flat = flatten(model);
  const headerFileName = `${id}.h`;
  const sourceFileName = `${id}.c`;
  const header = `#ifndef ${guard}
#define ${guard}

#include <stdint.h>

#ifndef PNG2CHR_ANIMATION_FORMAT_CONSTANTS
#define PNG2CHR_ANIMATION_FORMAT_CONSTANTS
#define NES_SPRITE_FLIP_HORIZONTAL ${hex(NES_SPRITE_FLIP_HORIZONTAL)}
#define NES_SPRITE_FLIP_VERTICAL ${hex(NES_SPRITE_FLIP_VERTICAL)}
#define ANIMATION_TYPE_IDLE 0
#define ANIMATION_TYPE_MOVEMENT 1
#define ANIMATION_DIRECTION_NONE ${hex(ANIMATION_DIRECTION_NONE)}
#define ANIMATION_DIRECTION_LEFT ${hex(ANIMATION_DIRECTION_LEFT)}
#define ANIMATION_DIRECTION_RIGHT ${hex(ANIMATION_DIRECTION_RIGHT)}
#define ANIMATION_DIRECTION_MASK ${hex(ANIMATION_DIRECTION_MASK)}
#define ANIMATION_GENERATED_H_FLIP ${hex(ANIMATION_GENERATED_HORIZONTAL_FLIP)}
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
    uint8_t type;
    uint8_t direction_flags;
} Png2ChrAnimation;
#endif

extern const Png2ChrAnimationMetaspriteTile ${id}_sprites[];
extern const Png2ChrAnimationFrame ${id}_frames[];
extern const Png2ChrAnimation ${id}_animations[];
extern const uint8_t ${id}_animation_count;

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
      `    { ${String(animation.frameOffset)}, ${String(animation.frameCount)}, ${String(animation.widthTiles)}, ${String(animation.heightTiles)}, ${String(animation.category)}, ${hex(animation.directionFlags)} },`,
  );
  const source = `#include "${headerFileName}"

/* Sprite entry: signed x, signed y, CHR tile index, NES OAM attributes. */
const Png2ChrAnimationMetaspriteTile ${id}_sprites[] = {
${spriteRows.join('\n')}
};

/* Frame entry: sprite-array offset, sprite count, duration in game frames. */
const Png2ChrAnimationFrame ${id}_frames[] = {
${frameRows.join('\n')}
};

/* Animation entry: frame offset, count, size, type, direction/flip flags. */
const Png2ChrAnimation ${id}_animations[] = {
${animationRows.join('\n')}
};

const uint8_t ${id}_animation_count = ${String(flat.animations.length)};
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
  const flat = flatten(model);
  const includeFileName = `${id}.inc`;
  const sourceFileName = `${id}.s`;
  const include = `; Generated by PNG2CHR Studio animation metadata v${String(model.version)}.
; Sprite entry (4 bytes): signed X, signed Y, CHR tile, NES OAM attributes.
; Frame entry (4 bytes): sprite offset word, sprite count, duration.
; Animation entry (7 bytes): frame offset word, frame count, width tiles,
;                            height tiles, type, direction/flip flags.
.ifndef PNG2CHR_ANIMATION_FORMAT_CONSTANTS
PNG2CHR_ANIMATION_FORMAT_CONSTANTS = 1
NES_SPRITE_FLIP_HORIZONTAL = $40
NES_SPRITE_FLIP_VERTICAL = $80
ANIMATION_TYPE_IDLE = 0
ANIMATION_TYPE_MOVEMENT = 1
ANIMATION_DIRECTION_NONE = ${asmHex(ANIMATION_DIRECTION_NONE)}
ANIMATION_DIRECTION_LEFT = ${asmHex(ANIMATION_DIRECTION_LEFT)}
ANIMATION_DIRECTION_RIGHT = ${asmHex(ANIMATION_DIRECTION_RIGHT)}
ANIMATION_DIRECTION_MASK = ${asmHex(ANIMATION_DIRECTION_MASK)}
ANIMATION_GENERATED_H_FLIP = ${asmHex(ANIMATION_GENERATED_HORIZONTAL_FLIP)}
.endif

.import ${id}_sprites
.import ${id}_frames
.import ${id}_animations
.import ${id}_animation_count
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
      `    .word ${String(animation.frameOffset)}\n    .byte ${String(animation.frameCount)}, ${String(animation.widthTiles)}, ${String(animation.heightTiles)}, ${String(animation.category)}, ${asmHex(animation.directionFlags)}`,
  );
  const source = `; Generated by PNG2CHR Studio animation metadata v${String(model.version)}.
.export ${id}_sprites
.export ${id}_frames
.export ${id}_animations
.export ${id}_animation_count

.segment "RODATA"

${id}_sprites:
${spriteRows.join('\n')}

${id}_frames:
${frameRows.join('\n')}

${id}_animations:
${animationRows.join('\n')}

${id}_animation_count:
    .byte ${String(flat.animations.length)}
`;
  return {
    includeFileName,
    sourceFileName,
    include,
    source,
    estimatedRomBytes: estimatedRomBytes(model),
  };
}
