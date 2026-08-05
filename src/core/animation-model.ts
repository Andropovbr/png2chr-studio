import { decodeChr } from './chr-decoder';
import { encodeChr } from './chr-encoder';
import { tilePixelKey, transformedTileKey } from './tile-deduplication';
import type { IndexedImage, Tile } from './types';

export const ANIMATION_METADATA_FORMAT = 'png2chr-studio-animation';
export const ANIMATION_METADATA_VERSION = 2;
export const NES_SPRITE_FLIP_HORIZONTAL = 0x40;
export const NES_SPRITE_FLIP_VERTICAL = 0x80;
export const DEFAULT_ANIMATION_CHR_CAPACITY_TILES = 256;

const TILE_SIZE = 8;
const BYTES_PER_TILE = 16;

export type AnimationCategory = 'idle' | 'movement';
export type AnimationDirection = 'left' | 'right';
export type TileReuse = 'destination' | 'imported' | 'new';

export interface AnimationDefinitionInput {
  readonly name: string;
  readonly category: AnimationCategory;
  readonly frameIndices: readonly number[];
  readonly frameDuration: number;
  readonly frameDurations?: readonly number[];
  readonly direction?: AnimationDirection;
  readonly exportMirroredDirection?: boolean;
}

export interface BuildAnimationModelOptions {
  readonly name: string;
  readonly sourceImageName: string;
  readonly image: IndexedImage;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly animations: readonly AnimationDefinitionInput[];
  readonly baseChr?: Uint8Array;
  readonly chrOutputName?: string;
  readonly capacityTiles?: number;
  readonly flipDeduplication?: boolean;
  readonly spritePalette?: number;
  readonly originX?: number;
  readonly originY?: number;
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
  readonly category: AnimationCategory;
  readonly direction: AnimationDirection | 'none';
  readonly generatedByHorizontalFlip: boolean;
  readonly defaultFrameDuration: number;
  readonly width: number;
  readonly height: number;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly frames: readonly AnimationFrameModel[];
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
  readonly source: {
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
  readonly origin: { readonly x: number; readonly y: number };
  readonly animations: readonly AnimationModel[];
  readonly finalChr: Uint8Array;
}

export type AnimationModelErrorCode =
  | 'invalid-name'
  | 'invalid-frame-dimensions'
  | 'invalid-frame-grid'
  | 'invalid-frame-selection'
  | 'duplicate-frame-selection'
  | 'no-selected-frames'
  | 'invalid-frame-duration'
  | 'invalid-animation-direction'
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
  if (!name.trim() || containsControlCharacter) {
    throw new AnimationModelError('invalid-name');
  }
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
  const { image, frameWidth, frameHeight } = options;
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  if (
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    frameWidth % TILE_SIZE !== 0 ||
    frameHeight % TILE_SIZE !== 0
  ) {
    throw new AnimationModelError('invalid-frame-dimensions');
  }
  if (
    image.width % frameWidth !== 0 ||
    image.height % frameHeight !== 0 ||
    image.pixels.length !== image.width * image.height
  ) {
    throw new AnimationModelError('invalid-frame-grid');
  }
  if (
    !Number.isInteger(originX) ||
    !Number.isInteger(originY) ||
    -originX < -128 ||
    frameWidth - TILE_SIZE - originX > 127 ||
    -originY < -128 ||
    frameHeight - TILE_SIZE - originY > 127
  ) {
    throw new AnimationModelError('invalid-origin');
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

  const frameColumns = image.width / frameWidth;
  const frameRows = image.height / frameHeight;
  const frameCount = frameColumns * frameRows;
  const selected = new Set<number>();
  for (const animation of options.animations) {
    validateName(animation.name);
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
    for (const frameIndex of animation.frameIndices) {
      if (
        !Number.isInteger(frameIndex) ||
        frameIndex < 0 ||
        frameIndex >= frameCount
      ) {
        throw new AnimationModelError('invalid-frame-selection', {
          frameIndex,
        });
      }
      if (selected.has(frameIndex)) {
        throw new AnimationModelError('duplicate-frame-selection', {
          frameIndex,
        });
      }
      selected.add(frameIndex);
    }
  }

  const allocated: Tile[] = baseTiles.map((tile) => ({ ...tile }));
  let reusedDestinationTiles = 0;
  let reusedImportedTiles = 0;
  let newTileCount = 0;
  const widthTiles = frameWidth / TILE_SIZE;
  const heightTiles = frameHeight / TILE_SIZE;

  const baseAnimations = options.animations.map((animation): AnimationModel => {
    const frames = animation.frameIndices.map(
      (sourceIndex, frameOrder): AnimationFrameModel => {
        const sourceX = (sourceIndex % frameColumns) * frameWidth;
        const sourceY = Math.floor(sourceIndex / frameColumns) * frameHeight;
        const sprites: MetaspriteTile[] = [];
        let omittedTileCount = 0;
        for (let tileRow = 0; tileRow < heightTiles; tileRow += 1) {
          for (let tileColumn = 0; tileColumn < widthTiles; tileColumn += 1) {
            const candidate = extractFrameTile(
              image,
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
            sprites.push({
              x: tileColumn * TILE_SIZE - originX,
              y: tileRow * TILE_SIZE - originY,
              tile: tileIndex,
              attributes: spritePalette | flipAttributes,
              palette: spritePalette,
              horizontalFlip:
                (flipAttributes & NES_SPRITE_FLIP_HORIZONTAL) !== 0,
              verticalFlip: (flipAttributes & NES_SPRITE_FLIP_VERTICAL) !== 0,
              reuse,
              sourceTileColumn: tileColumn,
              sourceTileRow: tileRow,
            });
          }
        }
        return {
          sourceIndex,
          sourceX,
          sourceY,
          duration:
            animation.frameDurations?.[frameOrder] ?? animation.frameDuration,
          width: frameWidth,
          height: frameHeight,
          omittedTileCount,
          sprites,
        };
      },
    );
    return {
      name: animation.name,
      category: animation.category,
      direction: animation.direction ?? 'none',
      generatedByHorizontalFlip: false,
      defaultFrameDuration: animation.frameDuration,
      width: frameWidth,
      height: frameHeight,
      widthTiles,
      heightTiles,
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
    return [
      {
        ...animation,
        name: `${animation.name}_${baseDirection}`,
        direction: baseDirection,
      },
      {
        ...animation,
        name: `${animation.name}_${mirroredDirection}`,
        direction: mirroredDirection,
        generatedByHorizontalFlip: true,
        frames: animation.frames.map(mirrorAnimationFrameHorizontally),
      },
    ];
  });

  const appended = allocated.slice(baseTiles.length);
  const appendedBytes = encodeChr(appended);
  const finalChr = new Uint8Array(baseChr.length + appendedBytes.length);
  finalChr.set(baseChr);
  finalChr.set(appendedBytes, baseChr.length);
  const finalTileCount = allocated.length;

  return {
    format: ANIMATION_METADATA_FORMAT,
    version: ANIMATION_METADATA_VERSION,
    name: options.name.trim(),
    source: {
      image: options.sourceImageName,
      imageWidth: image.width,
      imageHeight: image.height,
      frameWidth,
      frameHeight,
      tileWidth: 8,
      tileHeight: 8,
      frameColumns,
      frameRows,
    },
    chr: {
      output: options.chrOutputName ?? `${options.name.trim()}.chr`,
      capacityTiles,
      baseTileCount: baseTiles.length,
      reusedDestinationTiles,
      reusedImportedTiles,
      newTileCount,
      appendedTileStart: baseTiles.length,
      finalTileCount,
      finalSizeBytes: finalChr.length,
      remainingTiles: capacityTiles - finalTileCount,
    },
    origin: { x: originX, y: originY },
    animations,
    finalChr,
  };
}
