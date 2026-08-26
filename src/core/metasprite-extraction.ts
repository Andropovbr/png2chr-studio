/**
 * Pure domain engine for extracting logical 8x8 metasprite tiles and frames
 * from sprite sheet images with hardware-compliant transparent cell omission.
 *
 * Part of Milestone 7: Sprite Sheet → CHR Integration (Issue #94).
 * This module is purely logical: it knows no physical CHR slots or pattern tables.
 */

import {
  createLogicalTileKey,
  type LogicalTileKey,
  type ProjectAssetId,
} from './asset-identity';
import {
  applyPixelOverridesToImage,
  type TilePixelOverrides,
} from './pixel-overrides';
import type { IndexedImage, Tile } from './types';

const TILE_SIZE = 8;
const PIXELS_PER_TILE = TILE_SIZE * TILE_SIZE; // 64

/**
 * Logical 8x8 cell candidate within a metasprite frame before physical CHR allocation.
 */
export interface LogicalMetaspriteTile {
  /** 8x8 pixel buffer (64 bytes, color indices 0..3). */
  readonly pixels: Uint8Array;
  /** 0-based column of the 8x8 cell inside the frame (0..widthTiles - 1). */
  readonly tileColumn: number;
  /** 0-based row of the 8x8 cell inside the frame (0..heightTiles - 1). */
  readonly tileRow: number;
  /** Absolute 8x8 tile column coordinate in the source spritesheet image. */
  readonly tileX: number;
  /** Absolute 8x8 tile row coordinate in the source spritesheet image. */
  readonly tileY: number;
  /** Canonical LogicalTileKey: `${assetId}:${tileX}:${tileY}`. */
  readonly logicalKey: LogicalTileKey;
  /** X coordinate in pixels relative to the animation origin anchor. */
  readonly x: number;
  /** Y coordinate in pixels relative to the animation origin anchor. */
  readonly y: number;
  /** Source tile column inside the frame grid (identical to tileColumn). */
  readonly sourceTileColumn: number;
  /** Source tile row inside the frame grid (identical to tileRow). */
  readonly sourceTileRow: number;
}

/**
 * Logical representation of an extracted animation frame containing visible metasprite tiles.
 */
export interface LogicalAnimationFrame {
  readonly sourceIndex: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly duration: number;
  readonly paletteIndex?: number | null;
  readonly effectivePalette: number;
  readonly width: number;
  readonly height: number;
  readonly omittedTileCount: number;
  readonly sprites: readonly LogicalMetaspriteTile[];
}

/**
 * Options for extracting logical metasprite tiles from a single frame grid.
 */
export interface ExtractLogicalMetaspriteTilesOptions {
  /** Effective indexed image of the spritesheet (with pixel overrides applied). */
  readonly image: IndexedImage;
  /** Top-left pixel X offset of the frame in the spritesheet. */
  readonly sourceX: number;
  /** Top-left pixel Y offset of the frame in the spritesheet. */
  readonly sourceY: number;
  /** Frame width in pixels (must be positive multiple of 8). */
  readonly frameWidth: number;
  /** Frame height in pixels (must be positive multiple of 8). */
  readonly frameHeight: number;
  /** Origin X anchor in pixels (default 0). */
  readonly originX?: number;
  /** Origin Y anchor in pixels (default 0). */
  readonly originY?: number;
  /** Stable logical asset identifier. */
  readonly assetId: ProjectAssetId;
}

/**
 * Result of extracting logical metasprite tiles from a single frame grid.
 */
export interface ExtractLogicalMetaspriteTilesResult {
  readonly sprites: readonly LogicalMetaspriteTile[];
  readonly omittedTileCount: number;
  readonly totalCellCount: number;
}

/**
 * Options for extracting a single logical animation frame.
 */
export interface ExtractLogicalAnimationFrameOptions {
  readonly image: IndexedImage;
  readonly sourceIndex: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly duration: number;
  readonly paletteIndex?: number | null;
  readonly effectivePalette: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly assetId: ProjectAssetId;
}

/**
 * Options for extracting all logical animation frames from an animation definition.
 */
export interface ExtractLogicalAnimationFramesOptions {
  /** Raw indexed image of the spritesheet. */
  readonly image: IndexedImage;
  /** Optional contextual pixel overrides to apply to the image. */
  readonly pixelOverrides?: TilePixelOverrides;
  /** List of frame indices to extract. */
  readonly frameIndices: readonly number[];
  /** Default duration for frames. */
  readonly defaultDuration: number;
  /** Optional per-frame durations. */
  readonly frameDurations?: readonly number[];
  /** Optional per-frame palette index overrides. */
  readonly framePalettes?: readonly (number | null)[];
  /** Default fallback palette index. */
  readonly defaultPaletteIndex?: number;
  /** Animation-level palette index override. */
  readonly paletteIndex?: number | null;
  /** Frame width in pixels. */
  readonly frameWidth: number;
  /** Frame height in pixels. */
  readonly frameHeight: number;
  /** Origin X anchor in pixels. */
  readonly originX?: number;
  /** Origin Y anchor in pixels. */
  readonly originY?: number;
  /** Stable logical asset ID. */
  readonly assetId: ProjectAssetId;
}

/**
 * Determines whether an 8x8 tile pixel buffer is 100% transparent (all pixels == 0).
 */
export function isTransparentTilePixels(pixels: Uint8Array): boolean {
  for (const pixel of pixels) {
    if (pixel !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * Determines whether a Tile structure is 100% transparent.
 */
export function transparentTile(tile: Pick<Tile, 'pixels'>): boolean {
  return isTransparentTilePixels(tile.pixels);
}

/**
 * Extracts 8x8 pixels from an indexed image at the given pixel coordinates.
 */
export function extractFrameTilePixels(
  image: IndexedImage,
  startX: number,
  startY: number,
): Uint8Array {
  const pixels = new Uint8Array(PIXELS_PER_TILE);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    const srcRowStart = (startY + y) * image.width + startX;
    pixels.set(
      image.pixels.slice(srcRowStart, srcRowStart + TILE_SIZE),
      y * TILE_SIZE,
    );
  }
  return pixels;
}

/**
 * Extracts a Tile object from an indexed image at the specified frame cell position.
 */
export function extractFrameTile(
  image: IndexedImage,
  frameX: number,
  frameY: number,
  tileColumn: number,
  tileRow: number,
): Tile {
  const startX = frameX + tileColumn * TILE_SIZE;
  const startY = frameY + tileRow * TILE_SIZE;
  const pixels = extractFrameTilePixels(image, startX, startY);
  return {
    id: 0,
    column: tileColumn,
    row: tileRow,
    pixels,
  };
}

/**
 * Extracts all visible logical 8x8 cells from a frame, omitting 100% transparent cells.
 */
export function extractLogicalMetaspriteTiles(
  options: ExtractLogicalMetaspriteTilesOptions,
): ExtractLogicalMetaspriteTilesResult {
  const {
    image,
    sourceX,
    sourceY,
    frameWidth,
    frameHeight,
    originX = 0,
    originY = 0,
    assetId,
  } = options;

  const widthTiles = Math.max(1, Math.floor(frameWidth / TILE_SIZE));
  const heightTiles = Math.max(1, Math.floor(frameHeight / TILE_SIZE));
  const totalCellCount = widthTiles * heightTiles;

  const baseTileX = Math.floor(sourceX / TILE_SIZE);
  const baseTileY = Math.floor(sourceY / TILE_SIZE);

  const sprites: LogicalMetaspriteTile[] = [];
  let omittedTileCount = 0;

  for (let tileRow = 0; tileRow < heightTiles; tileRow += 1) {
    for (let tileColumn = 0; tileColumn < widthTiles; tileColumn += 1) {
      const tile = extractFrameTile(
        image,
        sourceX,
        sourceY,
        tileColumn,
        tileRow,
      );

      if (transparentTile(tile)) {
        omittedTileCount += 1;
        continue;
      }

      const tileX = baseTileX + tileColumn;
      const tileY = baseTileY + tileRow;
      const logicalKey = createLogicalTileKey(assetId, tileX, tileY);

      sprites.push({
        pixels: tile.pixels,
        tileColumn,
        tileRow,
        tileX,
        tileY,
        logicalKey,
        x: tileColumn * TILE_SIZE - originX,
        y: tileRow * TILE_SIZE - originY,
        sourceTileColumn: tileColumn,
        sourceTileRow: tileRow,
      });
    }
  }

  return {
    sprites: Object.freeze(sprites),
    omittedTileCount,
    totalCellCount,
  };
}

/**
 * Extracts a single logical animation frame from an indexed image.
 */
export function extractLogicalAnimationFrame(
  options: ExtractLogicalAnimationFrameOptions,
): LogicalAnimationFrame {
  const {
    image,
    sourceIndex,
    sourceX,
    sourceY,
    duration,
    paletteIndex,
    effectivePalette,
    frameWidth,
    frameHeight,
    originX = 0,
    originY = 0,
    assetId,
  } = options;

  const { sprites, omittedTileCount } = extractLogicalMetaspriteTiles({
    image,
    sourceX,
    sourceY,
    frameWidth,
    frameHeight,
    originX,
    originY,
    assetId,
  });

  return {
    sourceIndex,
    sourceX,
    sourceY,
    duration,
    paletteIndex,
    effectivePalette,
    width: frameWidth,
    height: frameHeight,
    omittedTileCount,
    sprites,
  };
}

/**
 * Extracts all logical animation frames for an animation definition with pixel overrides applied.
 */
export function extractLogicalAnimationFrames(
  options: ExtractLogicalAnimationFramesOptions,
): readonly LogicalAnimationFrame[] {
  const {
    image,
    pixelOverrides,
    frameIndices,
    defaultDuration,
    frameDurations,
    framePalettes,
    defaultPaletteIndex = 0,
    paletteIndex = null,
    frameWidth,
    frameHeight,
    originX = 0,
    originY = 0,
    assetId,
  } = options;

  const effectiveImage = pixelOverrides
    ? applyPixelOverridesToImage(image, pixelOverrides)
    : image;

  const animColumns = Math.max(
    1,
    Math.floor(effectiveImage.width / frameWidth),
  );

  return Object.freeze(
    frameIndices.map((sourceIndex, frameOrder): LogicalAnimationFrame => {
      const sourceX = (sourceIndex % animColumns) * frameWidth;
      const sourceY = Math.floor(sourceIndex / animColumns) * frameHeight;
      const framePaletteOverride = framePalettes?.[frameOrder] ?? null;
      const frameEffectivePalette =
        framePaletteOverride ?? paletteIndex ?? defaultPaletteIndex;
      const duration = frameDurations?.[frameOrder] ?? defaultDuration;

      return extractLogicalAnimationFrame({
        image: effectiveImage,
        sourceIndex,
        sourceX,
        sourceY,
        duration,
        paletteIndex: framePaletteOverride,
        effectivePalette: frameEffectivePalette,
        frameWidth,
        frameHeight,
        originX,
        originY,
        assetId,
      });
    }),
  );
}
