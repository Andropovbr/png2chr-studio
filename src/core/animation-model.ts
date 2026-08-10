import { decodeChr } from './chr-decoder';
import { encodeChr } from './chr-encoder';
import {
  combineCIdentifiers,
  isValidCIdentifier,
  normalizeCIdentifier,
} from './c-identifier';
import { tilePixelKey, transformedTileKey } from './tile-deduplication';
import type { IndexedImage, Tile } from './types';

export const ANIMATION_METADATA_FORMAT = 'png2chr-studio-animation';
export const ANIMATION_METADATA_VERSION = 4;
export const NES_SPRITE_FLIP_HORIZONTAL = 0x40;
export const NES_SPRITE_FLIP_VERTICAL = 0x80;
export const DEFAULT_ANIMATION_CHR_CAPACITY_TILES = 256;

const TILE_SIZE = 8;
const BYTES_PER_TILE = 16;

export type AnimationPlayback = 'loop' | 'once';
export type AnimationCategory = 'idle' | 'movement';
export type AnimationDirection = 'left' | 'right';
export type TileReuse = 'destination' | 'imported' | 'new';

export interface AnimationDefinitionInput {
  readonly name: string;
  readonly sourceImageName?: string;
  readonly image?: IndexedImage;
  readonly frameWidth?: number;
  readonly frameHeight?: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly frameIndices: readonly number[];
  readonly frameDuration: number;
  readonly frameDurations?: readonly number[];
  readonly playback?: AnimationPlayback;
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
  readonly frameWidth?: number;
  readonly frameHeight?: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly animations: readonly AnimationDefinitionInput[];
  readonly baseChr?: Uint8Array;
  readonly chrOutputName?: string;
  readonly capacityTiles?: number;
  readonly flipDeduplication?: boolean;
  readonly spritePalette?: number;
}

export interface MetaspriteTile {
  readonly x: number;
  readonly y: number;
  readonly tile: number;
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
  readonly width: number;
  readonly height: number;
  readonly omittedTileCount: number;
  readonly sprites: readonly MetaspriteTile[];
}

export interface AnimationModel {
  readonly name: string;
  readonly sourceFile: string;
  readonly playback: AnimationPlayback;
  readonly flipH: boolean;
  readonly flipV: boolean;
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
  readonly capacityTiles: number;
  readonly baseTileCount: number;
  readonly reusedDestinationTiles: number;
  readonly reusedImportedTiles: number;
  readonly newTileCount: number;
  readonly appendedTileStart: number;
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

export type AnimationModelErrorCode =
  | 'invalid-name'
  | 'invalid-symbol-prefix'
  | 'invalid-frame-dimensions'
  | 'invalid-frame-grid'
  | 'invalid-frame-selection'
  | 'duplicate-frame-selection'
  | 'no-selected-frames'
  | 'invalid-frame-duration'
  | 'invalid-animation-direction'
  | 'duplicate-animation-name'
  | 'duplicate-animation-identifier'
  | 'invalid-playback'
  | 'invalid-origin'
  | 'invalid-sprite-palette'
  | 'invalid-destination-chr'
  | 'destination-capacity-overflow'
  | 'chr-capacity-overflow'
  | 'tile-index-overflow';

export class AnimationModelError extends Error {
  public constructor(
    public readonly code: AnimationModelErrorCode,
    public readonly details: Readonly<Record<string, number | string>> = {},
  ) {
    super(code);
    this.name = 'AnimationModelError';
  }
}

interface TileMatch {
  readonly index: number;
  readonly attributes: number;
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

function extractFrameTile(
  image: IndexedImage,
  frameX: number,
  frameY: number,
  tileColumn: number,
  tileRow: number,
): Tile {
  const pixels = new Uint8Array(TILE_SIZE * TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    const sourceStart =
      (frameY + tileRow * TILE_SIZE + y) * image.width +
      frameX +
      tileColumn * TILE_SIZE;
    pixels.set(image.pixels.slice(sourceStart, sourceStart + TILE_SIZE), y * 8);
  }
  return { id: 0, column: tileColumn, row: tileRow, pixels };
}

function transparentTile(tile: Tile): boolean {
  return tile.pixels.every((pixel) => pixel === 0);
}

function findTileMatch(
  candidate: Tile,
  allocated: readonly Tile[],
  flipDeduplication: boolean,
): TileMatch | null {
  const candidateKey = tilePixelKey(candidate);
  for (let index = 0; index < allocated.length; index += 1) {
    const existing = allocated[index];
    if (existing !== undefined && tilePixelKey(existing) === candidateKey) {
      return { index, attributes: 0 };
    }
  }
  if (!flipDeduplication) return null;

  const flips = [
    [true, false, NES_SPRITE_FLIP_HORIZONTAL],
    [false, true, NES_SPRITE_FLIP_VERTICAL],
    [true, true, NES_SPRITE_FLIP_HORIZONTAL | NES_SPRITE_FLIP_VERTICAL],
  ] as const;
  for (let index = 0; index < allocated.length; index += 1) {
    const existing = allocated[index];
    if (existing === undefined) continue;
    for (const [horizontal, vertical, attributes] of flips) {
      if (transformedTileKey(existing, horizontal, vertical) === candidateKey) {
        return { index, attributes };
      }
    }
  }
  return null;
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
  const symbolBase = combineCIdentifiers(symbolPrefix, options.name);
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

  const capacityTiles =
    options.capacityTiles ?? DEFAULT_ANIMATION_CHR_CAPACITY_TILES;
  if (
    !Number.isInteger(capacityTiles) ||
    capacityTiles <= 0 ||
    capacityTiles > 256
  ) {
    throw new AnimationModelError('tile-index-overflow', { capacityTiles });
  }
  const spritePalette = options.spritePalette ?? 0;
  if (
    !Number.isInteger(spritePalette) ||
    spritePalette < 0 ||
    spritePalette > 3
  ) {
    throw new AnimationModelError('invalid-sprite-palette');
  }
  const baseChr = options.baseChr ?? new Uint8Array();
  if (baseChr.length % BYTES_PER_TILE !== 0) {
    throw new AnimationModelError('invalid-destination-chr');
  }
  const baseTiles =
    baseChr.length === 0
      ? []
      : decodeChr(baseChr).map((tile, id) => ({ ...tile, id }));
  if (baseTiles.length > capacityTiles) {
    throw new AnimationModelError('destination-capacity-overflow', {
      baseTileCount: baseTiles.length,
      capacityTiles,
    });
  }

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

  const allocated: Tile[] = baseTiles.map((tile) => ({ ...tile }));
  let reusedDestinationTiles = 0;
  let reusedImportedTiles = 0;
  let newTileCount = 0;

  const baseAnimations = options.animations.map((animation): AnimationModel => {
    const animFlipH = animation.flipH === true;
    const animFlipV = animation.flipV === true;
    const playback = animation.playback ?? 'loop';
    const animImage = animation.image ?? options.image;
    if (animImage === undefined) {
      throw new AnimationModelError('invalid-frame-grid');
    }
    const animFrameWidth = animation.frameWidth ?? options.frameWidth ?? 16;
    const animFrameHeight = animation.frameHeight ?? options.frameHeight ?? 16;
    const animOriginX = animation.originX ?? options.originX ?? 0;
    const animOriginY = animation.originY ?? options.originY ?? 0;
    const animWidthTiles = animFrameWidth / TILE_SIZE;
    const animHeightTiles = animFrameHeight / TILE_SIZE;
    const animColumns = animImage.width / animFrameWidth;
    const sourceFile =
      animation.sourceImageName ??
      options.sourceImageName ??
      fallbackSourceImageName;

    const frames = animation.frameIndices.map(
      (sourceIndex, frameOrder): AnimationFrameModel => {
        const sourceX = (sourceIndex % animColumns) * animFrameWidth;
        const sourceY = Math.floor(sourceIndex / animColumns) * animFrameHeight;
        const sprites: MetaspriteTile[] = [];
        let omittedTileCount = 0;
        for (let tileRow = 0; tileRow < animHeightTiles; tileRow += 1) {
          for (
            let tileColumn = 0;
            tileColumn < animWidthTiles;
            tileColumn += 1
          ) {
            const candidate = extractFrameTile(
              animImage,
              sourceX,
              sourceY,
              tileColumn,
              tileRow,
            );
            if (transparentTile(candidate)) {
              omittedTileCount += 1;
              continue;
            }
            const match = findTileMatch(
              candidate,
              allocated,
              options.flipDeduplication ?? true,
            );
            let tileIndex: number;
            let flipAttributes = 0;
            let reuse: TileReuse;
            if (match !== null) {
              tileIndex = match.index;
              flipAttributes = match.attributes;
              reuse = tileIndex < baseTiles.length ? 'destination' : 'imported';
              if (reuse === 'destination') reusedDestinationTiles += 1;
              else reusedImportedTiles += 1;
            } else {
              tileIndex = allocated.length;
              if (tileIndex >= capacityTiles) {
                throw new AnimationModelError('chr-capacity-overflow', {
                  capacityTiles,
                });
              }
              allocated.push({ ...candidate, id: tileIndex });
              newTileCount += 1;
              reuse = 'new';
            }
            if (tileIndex > 0xff) {
              throw new AnimationModelError('tile-index-overflow', {
                tileIndex,
              });
            }

            const finalCol = animFlipH
              ? animWidthTiles - 1 - tileColumn
              : tileColumn;
            const finalRow = animFlipV
              ? animHeightTiles - 1 - tileRow
              : tileRow;
            const finalFlipAttributes =
              flipAttributes ^
              (animFlipH ? NES_SPRITE_FLIP_HORIZONTAL : 0) ^
              (animFlipV ? NES_SPRITE_FLIP_VERTICAL : 0);

            sprites.push({
              x: finalCol * TILE_SIZE - animOriginX,
              y: finalRow * TILE_SIZE - animOriginY,
              tile: tileIndex,
              attributes: spritePalette | finalFlipAttributes,
              palette: spritePalette,
              horizontalFlip:
                (finalFlipAttributes & NES_SPRITE_FLIP_HORIZONTAL) !== 0,
              verticalFlip:
                (finalFlipAttributes & NES_SPRITE_FLIP_VERTICAL) !== 0,
              reuse,
              sourceTileColumn: finalCol,
              sourceTileRow: finalRow,
            });
          }
        }
        return {
          sourceIndex,
          sourceX,
          sourceY,
          duration:
            animation.frameDurations?.[frameOrder] ?? animation.frameDuration,
          width: animFrameWidth,
          height: animFrameHeight,
          omittedTileCount,
          sprites,
        };
      },
    );
    return {
      name: animation.name,
      sourceFile,
      playback,
      flipH: animFlipH,
      flipV: animFlipV,
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

  const finalTileCount = allocated.length;
  const finalChr = encodeChr(allocated);
  const remainingTiles = capacityTiles - finalTileCount;
  const appendedTileStart = baseTiles.length;
  const output = options.chrOutputName ?? `${symbolBase}.chr`;

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
    source: sourceProp,
    chr: {
      capacityTiles,
      baseTileCount: baseTiles.length,
      reusedDestinationTiles,
      reusedImportedTiles,
      newTileCount,
      appendedTileStart,
      finalTileCount,
      finalSizeBytes: finalChr.length,
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
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly defaultFrameDuration: number;
  readonly frameIndices: readonly number[];
  readonly frameDurations: readonly number[];
}

export interface DeserializedAnimationProject {
  readonly format: string;
  readonly version: number;
  readonly name: string;
  readonly symbolPrefix: string;
  readonly symbolBase: string;
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
}

interface RawAnimationEntry {
  readonly name?: unknown;
  readonly source_file?: unknown;
  readonly sourceFile?: unknown;
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
  const symbolPrefix = asString(raw.symbol_prefix ?? raw.symbolPrefix, 'asset');
  const symbolBase = asString(raw.symbol_base ?? raw.symbolBase, 'asset');
  const source = raw.source;
  const origin = raw.origin;
  const rawAnimations: readonly RawAnimationEntry[] = Array.isArray(
    raw.animations,
  )
    ? raw.animations
    : [];

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
      const flipH = asBoolean(
        anim.flip_h ?? anim.flipH ?? anim.generated_by_horizontal_flip,
        false,
      );
      const flipV = asBoolean(anim.flip_v ?? anim.flipV, false);
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
      return {
        name: animName,
        sourceFile,
        frameWidth,
        frameHeight,
        originX,
        originY,
        playback,
        flipH,
        flipV,
        defaultFrameDuration: defaultDuration,
        frameIndices,
        frameDurations,
      };
    },
  );

  return {
    format: ANIMATION_METADATA_FORMAT,
    version,
    name,
    symbolPrefix,
    symbolBase,
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
