import {
  combineCIdentifiers,
  isValidCIdentifier,
  normalizeCIdentifier,
} from './c-identifier';
import {
  analyzeBaseChrOccupancy,
  collectReservedPhysicalTileIndices,
  createPatternTableSlots,
  encodePatternTableSlots,
  isSpritePatternTable,
  NES_CHR_ROM_TILE_COUNT,
  NES_CHR_ROM_SIZE,
  NES_PATTERN_TABLE_TILE_COUNT,
  patternTablePhysicalRange,
  type BaseChrOccupancy,
  type ChrRegion,
  type PatternTableSlot,
  type SpritePatternTable,
} from './chr-pattern-table';
import type { QuantizationMode } from './quantization-settings';
import type { IndexedImage } from './types';

export const ANIMATION_METADATA_FORMAT = 'png2chr-studio-animation';
export const ANIMATION_METADATA_VERSION = 5;
export const NES_SPRITE_FLIP_HORIZONTAL = 0x40;
export const NES_SPRITE_FLIP_VERTICAL = 0x80;
export const DEFAULT_ANIMATION_PATTERN_TABLE: SpritePatternTable = 0;

const TILE_SIZE = 8;
const BYTES_PER_TILE = 16;

import type { TilePixelOverrides } from './pixel-overrides';
import {
  extractFrameTile,
  extractLogicalAnimationFrames,
  isTransparentTilePixels,
  transparentTile,
  type ExtractLogicalAnimationFrameOptions,
  type ExtractLogicalAnimationFramesOptions,
  type ExtractLogicalMetaspriteTilesOptions,
  type ExtractLogicalMetaspriteTilesResult,
  type LogicalAnimationFrame,
  type LogicalMetaspriteTile,
} from './metasprite-extraction';

export {
  extractFrameTile,
  extractLogicalAnimationFrames,
  isTransparentTilePixels,
  transparentTile,
  type ExtractLogicalAnimationFrameOptions,
  type ExtractLogicalAnimationFramesOptions,
  type ExtractLogicalMetaspriteTilesOptions,
  type ExtractLogicalMetaspriteTilesResult,
  type LogicalAnimationFrame,
  type LogicalMetaspriteTile,
};

import {
  AnimationModelError,
  type AnimationModelErrorCode,
} from './animation-error';
import {
  allocateSpritesheetChr,
  decodeOamAttributes,
  encodeOamAttributes,
  findTileMatch,
  type AllocateSpritesheetChrOptions,
  type AllocateSpritesheetChrResult,
  type FlipTransform,
  type MetaspritePhysicalAssignment,
  type TileMatch,
  type TileReuse,
} from './chr-spritesheet-allocation';

export {
  AnimationModelError,
  type AnimationModelErrorCode,
  allocateSpritesheetChr,
  decodeOamAttributes,
  encodeOamAttributes,
  findTileMatch,
  type AllocateSpritesheetChrOptions,
  type AllocateSpritesheetChrResult,
  type FlipTransform,
  type MetaspritePhysicalAssignment,
  type TileMatch,
  type TileReuse,
};

export type AnimationPlayback = 'loop' | 'once';
export type AnimationCategory = 'idle' | 'movement';
export type AnimationDirection = 'left' | 'right';

export interface AnimationDefinitionInput {
  /** Stable identity of the editor animation that produced this definition. */
  readonly id?: string;
  /** Stable logical asset identifier. */
  readonly assetId?: string;
  readonly name: string;
  readonly entity?: string;
  readonly sourceImageName?: string;
  readonly image?: IndexedImage;
  readonly paletteIndex?: number | null;
  readonly quantizationMode?: QuantizationMode;
  readonly pixelOverrides?: TilePixelOverrides;
  readonly frameWidth?: number;
  readonly frameHeight?: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly frameIndices: readonly number[];
  readonly frameDuration: number;
  readonly frameDurations?: readonly number[];
  readonly framePalettes?: readonly (number | null)[];
  readonly playback?: AnimationPlayback;
  readonly allowHorizontalFlip?: boolean;
  readonly allowVerticalFlip?: boolean;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly category?: AnimationCategory;
  readonly direction?: AnimationDirection;
  readonly exportMirroredDirection?: boolean;
}

export interface BuildAnimationModelOptions {
  readonly name: string;
  readonly symbolPrefix?: string;
  readonly sourceImageName?: string;
  readonly image?: IndexedImage;
  readonly defaultPaletteIndex?: number;
  readonly quantizationMode?: QuantizationMode;
  readonly frameWidth?: number;
  readonly frameHeight?: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly animations: readonly AnimationDefinitionInput[];
  readonly baseChr?: Uint8Array;
  readonly patternTable?: SpritePatternTable;
  readonly destinationPatternTable?: SpritePatternTable;
  readonly chrOutputName?: string;
  readonly flipDeduplication?: boolean;
  readonly spritePalette?: number;
  readonly chrRegions?: readonly ChrRegion[];
  readonly reservedIndices?: ReadonlySet<number>;
}

export interface MetaspriteTile {
  readonly x: number;
  readonly y: number;
  readonly tile: number;
  readonly physicalTileIndex: number;
  readonly attributes: number;
  readonly palette: number;
  readonly horizontalFlip: boolean;
  readonly verticalFlip: boolean;
  readonly reuse: TileReuse;
  readonly sourceTileColumn: number;
  readonly sourceTileRow: number;
}

export interface AnimationFrameModel {
  readonly sourceIndex: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly duration: number;
  readonly paletteIndex?: number | null;
  readonly effectivePalette: number;
  readonly width: number;
  readonly height: number;
  readonly omittedTileCount: number;
  readonly sprites: readonly MetaspriteTile[];
}

export interface AnimationModel {
  /** Stable identity of the source definition; generated variants share it. */
  readonly id?: string;
  readonly name: string;
  readonly entity?: string;
  readonly sourceFile: string;
  readonly playback: AnimationPlayback;
  readonly allowHorizontalFlip: boolean;
  readonly allowVerticalFlip: boolean;
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly paletteIndex?: number | null;
  readonly effectivePalette: number;
  readonly quantizationMode?: QuantizationMode;
  readonly defaultFrameDuration: number;
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly frames: readonly AnimationFrameModel[];
  readonly category?: AnimationCategory;
  readonly direction?: AnimationDirection | 'none';
  readonly generatedByHorizontalFlip?: boolean;
}

export interface AnimationChrStatistics {
  readonly physicalCapacityTiles: number;
  readonly baseOccupancy: BaseChrOccupancy;
  readonly patternTable: SpritePatternTable;
  readonly destinationPatternTable: SpritePatternTable;
  readonly patternTableCapacityTiles: number;
  readonly capacityTiles: number;
  /** Occupied raw base-CHR slots; retained for metadata compatibility. */
  readonly baseTileCount: number;
  /** Occupied base-CHR slots in the selected sprite pattern table. */
  readonly patternTableBaseTileCount: number;
  readonly reusedDestinationTiles: number;
  readonly reusedImportedTiles: number;
  readonly newTileCount: number;
  readonly appendedTileStart: number;
  /** Occupied tiles in each physical 4 KiB pattern table, ordered PT0/PT1. */
  readonly patternTableFinalTileCounts: readonly [number, number];
  /** Occupied tiles in the pattern table selected for sprite OAM bytes. */
  readonly patternTableFinalTileCount: number;
  /** Occupied tiles across both physical 4 KiB pattern tables. */
  readonly finalTileCount: number;
  readonly finalSizeBytes: number;
  readonly remainingTiles: number;
}

export interface AnimationProjectModel {
  readonly format: typeof ANIMATION_METADATA_FORMAT;
  readonly version: typeof ANIMATION_METADATA_VERSION;
  readonly name: string;
  readonly symbolPrefix: string;
  readonly symbolBase: string;
  readonly defaultPaletteIndex: number;
  readonly patternTable: SpritePatternTable;
  readonly destinationPatternTable: SpritePatternTable;
  readonly colorReduction?: QuantizationMode;
  readonly source?: {
    readonly image: string;
    readonly imageWidth: number;
    readonly imageHeight: number;
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly tileWidth: 8;
    readonly tileHeight: 8;
    readonly frameColumns: number;
    readonly frameRows: number;
  };
  readonly chr: AnimationChrStatistics & { readonly output: string };
  readonly origin?: { readonly x: number; readonly y: number };
  readonly animations: readonly AnimationModel[];
  readonly finalChr: Uint8Array;
}

function oppositeDirection(direction: AnimationDirection): AnimationDirection {
  return direction === 'left' ? 'right' : 'left';
}

function mirrorMetaspriteTileHorizontally(
  sprite: MetaspriteTile,
): MetaspriteTile {
  const attributes = sprite.attributes ^ NES_SPRITE_FLIP_HORIZONTAL;
  return {
    ...sprite,
    x: -sprite.x - TILE_SIZE,
    attributes,
    horizontalFlip: !sprite.horizontalFlip,
  };
}

export function mirrorAnimationFrameHorizontally(
  frame: AnimationFrameModel,
): AnimationFrameModel {
  return {
    ...frame,
    sprites: frame.sprites.map(mirrorMetaspriteTileHorizontally),
  };
}

function validateName(name: string): void {
  const containsControlCharacter = Array.from(name).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (
    !name.trim() ||
    containsControlCharacter ||
    normalizeCIdentifier(name).length === 0
  ) {
    throw new AnimationModelError('invalid-name');
  }
}

function defaultSymbolPrefix(sourceImageName: string): string {
  const fileName = sourceImageName.split(/[\\/]/).pop() ?? sourceImageName;
  const withoutExtension = fileName.replace(/\.[^.]*$/, '');
  return normalizeCIdentifier(withoutExtension) || 'asset';
}

export function buildAnimationProjectModel(
  options: BuildAnimationModelOptions,
): AnimationProjectModel {
  validateName(options.name);
  const fallbackSourceImageName =
    options.sourceImageName ??
    options.animations[0]?.sourceImageName ??
    'sprites.png';
  const symbolPrefix = normalizeCIdentifier(
    options.symbolPrefix ?? defaultSymbolPrefix(fallbackSourceImageName),
  );
  const symbolBase =
    symbolPrefix !== normalizeCIdentifier(options.name)
      ? combineCIdentifiers(symbolPrefix, options.name)
      : normalizeCIdentifier(options.name);
  if (
    symbolPrefix.length === 0 ||
    symbolBase.length === 0 ||
    !isValidCIdentifier(symbolBase)
  ) {
    throw new AnimationModelError('invalid-symbol-prefix');
  }
  if (options.animations.length === 0) {
    throw new AnimationModelError('no-selected-frames');
  }

  const patternTable = options.patternTable ?? DEFAULT_ANIMATION_PATTERN_TABLE;
  const destinationPatternTable =
    options.destinationPatternTable ?? DEFAULT_ANIMATION_PATTERN_TABLE;
  if (
    !isSpritePatternTable(patternTable) ||
    !isSpritePatternTable(destinationPatternTable)
  ) {
    throw new AnimationModelError('invalid-pattern-table', {
      patternTable: String(patternTable),
    });
  }

  const reservedIndices =
    options.reservedIndices ??
    (options.chrRegions
      ? collectReservedPhysicalTileIndices(options.chrRegions, patternTable)
      : undefined);

  const spritePalette = options.spritePalette ?? 0;
  if (
    !Number.isInteger(spritePalette) ||
    spritePalette < 0 ||
    spritePalette > 3
  ) {
    throw new AnimationModelError('invalid-sprite-palette');
  }
  const baseChr = options.baseChr ?? new Uint8Array();
  if (
    baseChr.length % BYTES_PER_TILE !== 0 ||
    baseChr.length > NES_CHR_ROM_SIZE
  ) {
    throw new AnimationModelError('invalid-destination-chr');
  }
  let slots = createPatternTableSlots(baseChr, destinationPatternTable);
  const baseOccupancy = analyzeBaseChrOccupancy(
    baseChr,
    destinationPatternTable,
  );
  const baseTileCount = baseOccupancy.occupiedTiles;
  const [patternTableStart, patternTableEnd] =
    patternTablePhysicalRange(patternTable);
  const patternTableBaseTileCount =
    baseOccupancy.patternTables[patternTable].occupiedTiles;

  const animationNames = new Set<string>();
  const animationIdentifiers = new Set<string>();

  for (const animation of options.animations) {
    validateName(animation.name);
    const trimmedName = animation.name.trim();
    const lowerName = trimmedName.toLowerCase();
    if (animationNames.has(lowerName)) {
      throw new AnimationModelError('duplicate-animation-name', {
        name: trimmedName,
      });
    }
    animationNames.add(lowerName);

    const identifier = normalizeCIdentifier(trimmedName);
    if (identifier.length === 0) {
      throw new AnimationModelError('invalid-name', { name: trimmedName });
    }
    if (animationIdentifiers.has(identifier)) {
      throw new AnimationModelError('duplicate-animation-identifier', {
        name: trimmedName,
        identifier,
      });
    }
    animationIdentifiers.add(identifier);

    const playbackVal = animation.playback as unknown;
    if (
      playbackVal !== undefined &&
      playbackVal !== 'loop' &&
      playbackVal !== 'once'
    ) {
      throw new AnimationModelError('invalid-playback', {
        playback: String(animation.playback),
      });
    }

    const animImage = animation.image ?? options.image;
    if (animImage === undefined) {
      throw new AnimationModelError('invalid-frame-grid');
    }

    const animFrameWidth = animation.frameWidth ?? options.frameWidth ?? 16;
    const animFrameHeight = animation.frameHeight ?? options.frameHeight ?? 16;

    if (
      animFrameWidth <= 0 ||
      animFrameHeight <= 0 ||
      animFrameWidth % TILE_SIZE !== 0 ||
      animFrameHeight % TILE_SIZE !== 0
    ) {
      throw new AnimationModelError('invalid-frame-dimensions');
    }
    if (
      animImage.width % animFrameWidth !== 0 ||
      animImage.height % animFrameHeight !== 0 ||
      animImage.pixels.length !== animImage.width * animImage.height
    ) {
      throw new AnimationModelError('invalid-frame-grid');
    }

    const animOriginX = animation.originX ?? options.originX ?? 0;
    const animOriginY = animation.originY ?? options.originY ?? 0;
    if (
      !Number.isInteger(animOriginX) ||
      !Number.isInteger(animOriginY) ||
      -animOriginX < -128 ||
      animFrameWidth - TILE_SIZE - animOriginX > 127 ||
      -animOriginY < -128 ||
      animFrameHeight - TILE_SIZE - animOriginY > 127
    ) {
      throw new AnimationModelError('invalid-origin');
    }

    if (
      animation.category === 'idle'
        ? animation.direction !== undefined ||
          animation.exportMirroredDirection === true
        : animation.exportMirroredDirection === true &&
          animation.direction === undefined
    ) {
      throw new AnimationModelError('invalid-animation-direction');
    }
    if (
      !Number.isInteger(animation.frameDuration) ||
      animation.frameDuration <= 0 ||
      animation.frameDuration > 255
    ) {
      throw new AnimationModelError('invalid-frame-duration');
    }
    if (
      animation.frameDurations !== undefined &&
      animation.frameDurations.length !== animation.frameIndices.length
    ) {
      throw new AnimationModelError('invalid-frame-duration');
    }
    for (const duration of animation.frameDurations ?? []) {
      if (!Number.isInteger(duration) || duration <= 0 || duration > 255) {
        throw new AnimationModelError('invalid-frame-duration');
      }
    }
    if (animation.frameIndices.length === 0) {
      throw new AnimationModelError('no-selected-frames');
    }

    const animColumns = animImage.width / animFrameWidth;
    const animRows = animImage.height / animFrameHeight;
    const animFrameCount = animColumns * animRows;

    for (const frameIndex of animation.frameIndices) {
      if (
        !Number.isInteger(frameIndex) ||
        frameIndex < 0 ||
        frameIndex >= animFrameCount
      ) {
        throw new AnimationModelError('invalid-frame-selection', {
          frameIndex,
        });
      }
    }
  }

  let reusedDestinationTiles = 0;
  let reusedImportedTiles = 0;
  let newTileCount = 0;
  let appendedTileStart = slots
    .slice(patternTableStart, patternTableEnd + 1)
    .findIndex((slot) => slot.tile === null);
  if (appendedTileStart < 0) appendedTileStart = NES_PATTERN_TABLE_TILE_COUNT;

  const baseAnimations = options.animations.map((animation): AnimationModel => {
    const allowHorizontalFlip =
      animation.allowHorizontalFlip ?? animation.flipH === true;
    const allowVerticalFlip =
      animation.allowVerticalFlip ?? animation.flipV === true;
    const playback = animation.playback ?? 'loop';
    const rawImage = animation.image ?? options.image;
    if (rawImage === undefined) {
      throw new AnimationModelError('invalid-frame-grid');
    }
    const animFrameWidth = animation.frameWidth ?? options.frameWidth ?? 16;
    const animFrameHeight = animation.frameHeight ?? options.frameHeight ?? 16;
    const animOriginX = animation.originX ?? options.originX ?? 0;
    const animOriginY = animation.originY ?? options.originY ?? 0;
    const animWidthTiles = animFrameWidth / TILE_SIZE;
    const animHeightTiles = animFrameHeight / TILE_SIZE;
    const sourceFile =
      animation.sourceImageName ??
      options.sourceImageName ??
      fallbackSourceImageName;

    const defaultPaletteIndex =
      options.defaultPaletteIndex ?? options.spritePalette ?? 0;
    const animPaletteIndex = animation.paletteIndex ?? null;
    const animEffectivePalette = animPaletteIndex ?? defaultPaletteIndex;

    const logicalFrames = extractLogicalAnimationFrames({
      image: rawImage,
      pixelOverrides: animation.pixelOverrides,
      frameIndices: animation.frameIndices,
      defaultDuration: animation.frameDuration,
      frameDurations: animation.frameDurations,
      framePalettes: animation.framePalettes,
      defaultPaletteIndex,
      paletteIndex: animPaletteIndex,
      frameWidth: animFrameWidth,
      frameHeight: animFrameHeight,
      originX: animOriginX,
      originY: animOriginY,
      assetId: animation.assetId ?? animation.id ?? animation.name,
    });

    const allocationResult = allocateSpritesheetChr({
      logicalFrames,
      initialSlots: slots,
      patternTable,
      reservedIndices,
      flipDeduplication: options.flipDeduplication ?? true,
    });

    slots = allocationResult.slots as PatternTableSlot[];
    reusedDestinationTiles += allocationResult.reusedDestinationTiles;
    reusedImportedTiles += allocationResult.reusedImportedTiles;
    newTileCount += allocationResult.newTileCount;

    const frames = logicalFrames.map(
      (logicalFrame, frameIndex): AnimationFrameModel => {
        const assignments = allocationResult.frameAssignments[frameIndex] ?? [];
        const sprites: MetaspriteTile[] = logicalFrame.sprites.map(
          (logicalSprite, spriteIndex) => {
            const assignment = assignments[spriteIndex];
            const flipAttributes = assignment?.flipAttributes ?? 0;
            const physicalTileIndex = assignment?.physicalTileIndex ?? 0;
            const tileIndex = assignment?.localTileIndex ?? 0;
            const reuse = assignment?.reuse ?? 'new';

            const finalFlipAttributes = flipAttributes;
            const finalAttributes = encodeOamAttributes(
              finalFlipAttributes,
              logicalFrame.effectivePalette,
            );
            const { horizontalFlip, verticalFlip } =
              decodeOamAttributes(finalAttributes);

            return {
              x: logicalSprite.x,
              y: logicalSprite.y,
              tile: tileIndex,
              physicalTileIndex,
              attributes: finalAttributes,
              palette: logicalFrame.effectivePalette,
              horizontalFlip,
              verticalFlip,
              reuse,
              sourceTileColumn: logicalSprite.sourceTileColumn,
              sourceTileRow: logicalSprite.sourceTileRow,
            };
          },
        );

        return {
          sourceIndex: logicalFrame.sourceIndex,
          sourceX: logicalFrame.sourceX,
          sourceY: logicalFrame.sourceY,
          duration: logicalFrame.duration,
          paletteIndex: logicalFrame.paletteIndex,
          effectivePalette: logicalFrame.effectivePalette,
          width: logicalFrame.width,
          height: logicalFrame.height,
          omittedTileCount: logicalFrame.omittedTileCount,
          sprites,
        };
      },
    );
    return {
      id: animation.id,
      name: animation.name,
      entity: animation.entity,
      sourceFile,
      playback,
      allowHorizontalFlip,
      allowVerticalFlip,
      flipH: allowHorizontalFlip,
      flipV: allowVerticalFlip,
      paletteIndex: animPaletteIndex,
      effectivePalette: animEffectivePalette,
      quantizationMode: animation.quantizationMode,
      category: animation.category,
      direction: animation.direction ?? 'none',
      generatedByHorizontalFlip: false,
      defaultFrameDuration: animation.frameDuration,
      originX: animOriginX,
      originY: animOriginY,
      width: animFrameWidth,
      height: animFrameHeight,
      widthTiles: animWidthTiles,
      heightTiles: animHeightTiles,
      frames,
    };
  });

  const animations = baseAnimations.flatMap((animation, index) => {
    const definition = options.animations[index];
    if (
      definition === undefined ||
      animation.category !== 'movement' ||
      definition.direction === undefined ||
      definition.exportMirroredDirection !== true
    ) {
      return [animation];
    }
    const baseDirection = definition.direction;
    const mirroredDirection = oppositeDirection(baseDirection);
    const mirroredFrames = animation.frames.map(
      (frame): AnimationFrameModel => ({
        ...frame,
        sprites: frame.sprites.map((sprite) => {
          const mirroredCol =
            animation.widthTiles - 1 - sprite.sourceTileColumn;
          const horizontalFlip = !sprite.horizontalFlip;
          const attributes =
            (sprite.attributes & ~NES_SPRITE_FLIP_HORIZONTAL) |
            (horizontalFlip ? NES_SPRITE_FLIP_HORIZONTAL : 0);
          return {
            ...sprite,
            x: mirroredCol * TILE_SIZE - animation.originX,
            attributes,
            horizontalFlip,
          };
        }),
      }),
    );
    const mirroredAnimation: AnimationModel = {
      ...animation,
      name: `${animation.name}_${mirroredDirection}`,
      direction: mirroredDirection,
      generatedByHorizontalFlip: true,
      frames: mirroredFrames,
    };
    const primaryAnimation: AnimationModel = {
      ...animation,
      name: `${animation.name}_${baseDirection}`,
      direction: baseDirection,
    };
    return [primaryAnimation, mirroredAnimation];
  });

  const countOccupiedTiles = (table: SpritePatternTable): number => {
    const [start, end] = patternTablePhysicalRange(table);
    return slots.slice(start, end + 1).filter((slot) => slot.tile !== null)
      .length;
  };
  const patternTableFinalTileCounts: [number, number] = [
    countOccupiedTiles(0),
    countOccupiedTiles(1),
  ];
  const finalTileCount =
    patternTableFinalTileCounts[0] + patternTableFinalTileCounts[1];
  const finalChr = encodePatternTableSlots(slots);
  const patternTableFinalTileCount = patternTableFinalTileCounts[patternTable];
  const remainingTiles =
    NES_PATTERN_TABLE_TILE_COUNT - patternTableFinalTileCount;
  const output = options.chrOutputName ?? `${symbolBase}.chr`;
  const defaultPaletteIndex =
    options.defaultPaletteIndex ?? options.spritePalette ?? 0;

  const sourceProp =
    options.image && options.frameWidth && options.frameHeight
      ? {
          image: fallbackSourceImageName,
          imageWidth: options.image.width,
          imageHeight: options.image.height,
          frameWidth: options.frameWidth,
          frameHeight: options.frameHeight,
          tileWidth: 8 as const,
          tileHeight: 8 as const,
          frameColumns: options.image.width / options.frameWidth,
          frameRows: options.image.height / options.frameHeight,
        }
      : undefined;

  return {
    format: ANIMATION_METADATA_FORMAT,
    version: ANIMATION_METADATA_VERSION,
    name: options.name,
    symbolPrefix,
    symbolBase,
    defaultPaletteIndex,
    patternTable,
    destinationPatternTable,
    colorReduction: options.quantizationMode,
    source: sourceProp,
    chr: {
      physicalCapacityTiles: NES_CHR_ROM_TILE_COUNT,
      baseOccupancy,
      patternTable,
      destinationPatternTable,
      patternTableCapacityTiles: NES_PATTERN_TABLE_TILE_COUNT,
      capacityTiles: NES_PATTERN_TABLE_TILE_COUNT,
      baseTileCount,
      patternTableBaseTileCount,
      reusedDestinationTiles,
      reusedImportedTiles,
      newTileCount,
      appendedTileStart,
      patternTableFinalTileCounts,
      patternTableFinalTileCount,
      finalTileCount,
      finalSizeBytes: NES_CHR_ROM_SIZE,
      remainingTiles,
      output,
    },
    origin: {
      x: options.originX ?? 0,
      y: options.originY ?? 0,
    },
    animations,
    finalChr,
  };
}

export interface DeserializedAnimationEntry {
  readonly name: string;
  readonly sourceFile: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly originX: number;
  readonly originY: number;
  readonly playback: AnimationPlayback;
  readonly allowHorizontalFlip: boolean;
  readonly allowVerticalFlip: boolean;
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly paletteIndex?: number | null;
  readonly quantizationMode?: QuantizationMode;
  readonly defaultFrameDuration: number;
  readonly frameIndices: readonly number[];
  readonly frameDurations: readonly number[];
  readonly framePalettes?: readonly (number | null)[];
}

export interface DeserializedAnimationProject {
  readonly format: string;
  readonly version: number;
  readonly name: string;
  readonly symbolPrefix: string;
  readonly symbolBase: string;
  readonly defaultPaletteIndex: number;
  readonly patternTable: SpritePatternTable;
  readonly destinationPatternTable: SpritePatternTable;
  readonly colorReduction?: QuantizationMode;
  readonly source?: {
    readonly image: string;
    readonly frameWidth: number;
    readonly frameHeight: number;
  };
  readonly origin?: { readonly x: number; readonly y: number };
  readonly animations: readonly DeserializedAnimationEntry[];
}

interface RawFrameEntry {
  readonly source_index?: unknown;
  readonly sourceIndex?: unknown;
  readonly duration?: unknown;
  readonly palette_index?: unknown;
  readonly paletteIndex?: unknown;
}

interface RawAnimationEntry {
  readonly name?: unknown;
  readonly source_file?: unknown;
  readonly sourceFile?: unknown;
  readonly palette_index?: unknown;
  readonly paletteIndex?: unknown;
  readonly quantization_mode?: unknown;
  readonly quantizationMode?: unknown;
  readonly color_reduction?: unknown;
  readonly colorReduction?: unknown;
  readonly frame_width?: unknown;
  readonly frameWidth?: unknown;
  readonly width?: unknown;
  readonly frame_height?: unknown;
  readonly frameHeight?: unknown;
  readonly height?: unknown;
  readonly origin_x?: unknown;
  readonly originX?: unknown;
  readonly origin_y?: unknown;
  readonly originY?: unknown;
  readonly playback?: unknown;
  readonly allow_horizontal_flip?: unknown;
  readonly allowHorizontalFlip?: unknown;
  readonly allow_vertical_flip?: unknown;
  readonly allowVerticalFlip?: unknown;
  readonly flip_h?: unknown;
  readonly flipH?: unknown;
  readonly generated_by_horizontal_flip?: unknown;
  readonly flip_v?: unknown;
  readonly flipV?: unknown;
  readonly default_frame_duration?: unknown;
  readonly defaultFrameDuration?: unknown;
  readonly frames?: readonly RawFrameEntry[];
}

interface RawSourceMetadata {
  readonly image?: unknown;
  readonly frame_width?: unknown;
  readonly frameWidth?: unknown;
  readonly frame_height?: unknown;
  readonly frameHeight?: unknown;
}

interface RawOriginMetadata {
  readonly x?: unknown;
  readonly y?: unknown;
}

interface RawMetadataProject {
  readonly format?: unknown;
  readonly version?: unknown;
  readonly name?: unknown;
  readonly symbol_prefix?: unknown;
  readonly symbolPrefix?: unknown;
  readonly symbol_base?: unknown;
  readonly symbolBase?: unknown;
  readonly default_palette_index?: unknown;
  readonly defaultPaletteIndex?: unknown;
  readonly pattern_table?: unknown;
  readonly patternTable?: unknown;
  readonly destination_pattern_table?: unknown;
  readonly destinationPatternTable?: unknown;
  readonly color_reduction?: unknown;
  readonly colorReduction?: unknown;
  readonly quantization_mode?: unknown;
  readonly quantizationMode?: unknown;
  readonly source?: RawSourceMetadata;
  readonly origin?: RawOriginMetadata;
  readonly animations?: readonly RawAnimationEntry[];
}

function asString(val: unknown, fallback: string): string {
  return typeof val === 'string' ? val : fallback;
}

function asNumber(val: unknown, fallback: number): number {
  return typeof val === 'number' && !Number.isNaN(val) ? val : fallback;
}

function asBoolean(val: unknown, fallback: boolean): boolean {
  return typeof val === 'boolean' ? val : fallback;
}

export function deserializeAnimationMetadata(
  jsonText: string,
): DeserializedAnimationProject {
  const raw = JSON.parse(jsonText) as unknown as RawMetadataProject;

  if (raw.format !== ANIMATION_METADATA_FORMAT) {
    throw new Error('Unsupported animation metadata format');
  }
  const version = asNumber(raw.version, 1);
  const name = asString(raw.name, 'animation');
  const symbolPrefix = asString(raw.symbol_prefix ?? raw.symbolPrefix, name);
  const symbolBase = asString(raw.symbol_base ?? raw.symbolBase, name);
  const defaultPaletteIndex = asNumber(
    raw.default_palette_index ?? raw.defaultPaletteIndex,
    0,
  );
  const rawPatternTable = raw.pattern_table ?? raw.patternTable;
  const rawDestinationPatternTable =
    raw.destination_pattern_table ?? raw.destinationPatternTable;
  const patternTable: SpritePatternTable =
    rawPatternTable === 1 ? 1 : DEFAULT_ANIMATION_PATTERN_TABLE;
  const destinationPatternTable: SpritePatternTable =
    rawDestinationPatternTable === 1 ? 1 : DEFAULT_ANIMATION_PATTERN_TABLE;
  let colorReduction =
    (raw.color_reduction as QuantizationMode | undefined) ??
    (raw.colorReduction as QuantizationMode | undefined) ??
    (raw.quantization_mode as QuantizationMode | undefined) ??
    (raw.quantizationMode as QuantizationMode | undefined);
  const source = raw.source;
  const origin = raw.origin;
  const rawAnimations: readonly RawAnimationEntry[] = Array.isArray(
    raw.animations,
  )
    ? raw.animations
    : [];

  if (colorReduction === undefined && rawAnimations.length > 0) {
    for (const anim of rawAnimations) {
      const animMode =
        (anim.quantization_mode as QuantizationMode | undefined) ??
        (anim.quantizationMode as QuantizationMode | undefined) ??
        (anim.color_reduction as QuantizationMode | undefined) ??
        (anim.colorReduction as QuantizationMode | undefined);
      if (animMode !== undefined) {
        colorReduction = animMode;
        break;
      }
    }
  }

  const defaultImage = asString(source?.image, 'sprites.png');
  const defaultFrameWidth = asNumber(
    source?.frame_width ?? source?.frameWidth,
    16,
  );
  const defaultFrameHeight = asNumber(
    source?.frame_height ?? source?.frameHeight,
    16,
  );
  const defaultOriginX = asNumber(origin?.x, 0);
  const defaultOriginY = asNumber(origin?.y, 0);

  const animations: DeserializedAnimationEntry[] = rawAnimations.map(
    (anim: RawAnimationEntry): DeserializedAnimationEntry => {
      const animName = asString(anim.name, 'anim');
      const sourceFile = asString(
        anim.source_file ?? anim.sourceFile,
        defaultImage,
      );
      const paletteIndex =
        typeof anim.palette_index === 'number'
          ? anim.palette_index
          : typeof anim.paletteIndex === 'number'
            ? anim.paletteIndex
            : null;
      const frameWidth = asNumber(
        anim.frame_width ?? anim.frameWidth ?? anim.width,
        defaultFrameWidth,
      );
      const frameHeight = asNumber(
        anim.frame_height ?? anim.frameHeight ?? anim.height,
        defaultFrameHeight,
      );
      const originX = asNumber(anim.origin_x ?? anim.originX, defaultOriginX);
      const originY = asNumber(anim.origin_y ?? anim.originY, defaultOriginY);
      const playback: AnimationPlayback =
        anim.playback === 'once' ? 'once' : 'loop';
      const allowHorizontalFlip = asBoolean(
        anim.allow_horizontal_flip ??
          anim.allowHorizontalFlip ??
          anim.flip_h ??
          anim.flipH ??
          anim.generated_by_horizontal_flip,
        false,
      );
      const allowVerticalFlip = asBoolean(
        anim.allow_vertical_flip ??
          anim.allowVerticalFlip ??
          anim.flip_v ??
          anim.flipV,
        false,
      );
      const defaultDuration = asNumber(
        anim.default_frame_duration ?? anim.defaultFrameDuration,
        12,
      );
      const frames: readonly RawFrameEntry[] = Array.isArray(anim.frames)
        ? anim.frames
        : [];
      const frameIndices: number[] = frames.map((f: RawFrameEntry) =>
        asNumber(f.source_index ?? f.sourceIndex, 0),
      );
      const frameDurations: number[] = frames.map((f: RawFrameEntry) =>
        asNumber(f.duration, defaultDuration),
      );
      const framePalettes: (number | null)[] = frames.map(
        (f: RawFrameEntry) => {
          const p = f.palette_index ?? f.paletteIndex;
          return typeof p === 'number' ? p : null;
        },
      );
      const quantizationMode =
        (anim.quantization_mode as QuantizationMode | undefined) ??
        (anim.quantizationMode as QuantizationMode | undefined) ??
        (anim.color_reduction as QuantizationMode | undefined) ??
        (anim.colorReduction as QuantizationMode | undefined);
      return {
        name: animName,
        sourceFile,
        paletteIndex,
        frameWidth,
        frameHeight,
        originX,
        originY,
        playback,
        allowHorizontalFlip,
        allowVerticalFlip,
        flipH: allowHorizontalFlip,
        flipV: allowVerticalFlip,
        quantizationMode: quantizationMode ?? colorReduction,
        defaultFrameDuration: defaultDuration,
        frameIndices,
        frameDurations,
        framePalettes,
      };
    },
  );

  return {
    format: ANIMATION_METADATA_FORMAT,
    version,
    name,
    symbolPrefix,
    symbolBase,
    defaultPaletteIndex,
    patternTable,
    destinationPatternTable,
    colorReduction,
    source: source?.image
      ? {
          image: defaultImage,
          frameWidth: defaultFrameWidth,
          frameHeight: defaultFrameHeight,
        }
      : undefined,
    origin: {
      x: defaultOriginX,
      y: defaultOriginY,
    },
    animations,
  };
}
