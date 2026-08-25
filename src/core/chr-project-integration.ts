/**
 * Domain integration layer for CHR Editor.
 * Maps physical CHR tile edits (indices 0..511) to their single canonical source of truth:
 * - Animation spritesheet: updates `animation.pixelOverrides`
 * - Tileset / Playfield: updates `project.pixelOverrides`
 * - Base CHR: updates 16-byte planar tile in `destinationChr`
 * - Empty Slot: materializes 16-byte planar tile in `destinationChr` (Base CHR)
 */

import type { AnimationProjectModel } from './animation-model';
import {
  baseChrPhysicalStart,
  classifyChrSlots,
  collectPhysicalTileReferences,
  NES_CHR_ROM_TILE_COUNT,
  NES_PATTERN_TABLE_TILE_COUNT,
  patternTableForPhysicalTile,
  type ChrTileReference,
  type SpritePatternTable,
} from './chr-pattern-table';
import {
  decodeChrTileToPixels,
  encodeChrTileFromPixels,
  validateTilePixels,
} from './chr-tile-editor';
import { extractTiles } from './tile-extraction';
import type { ColorDistanceMode } from './color-distance';
import { mapImageToNesPalettes, type NesPaletteSet } from './nes-palette';
import {
  getTileKey,
  type SingleTileOverrides,
  type TilePixelOverrides,
} from './pixel-overrides';
import type { IndexedImage, Tile } from './types';
import type { AnimationItemSetting, ProjectMode } from '../ui/types';

export interface AnimationTileEditTarget {
  readonly type: 'animation';
  readonly animationId: string;
  readonly animationName: string;
  readonly entity?: string;
  readonly frameIndex: number;
  readonly tileX: number;
  readonly tileY: number;
}

export interface PlayfieldTileEditTarget {
  readonly type: 'playfield';
  readonly tileIndex: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly column: number;
  readonly row: number;
}

export interface TilesetTileEditTarget {
  readonly type: 'tileset';
  readonly tileIndex: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly column: number;
  readonly row: number;
}

export interface BaseChrTileEditTarget {
  readonly type: 'base';
  readonly physicalIndex: number;
  readonly byteOffsetInBaseChr: number;
  readonly destinationPatternTable: SpritePatternTable;
}

export interface EmptySlotTileEditTarget {
  readonly type: 'empty';
  readonly physicalIndex: number;
  readonly patternTable: SpritePatternTable;
}

export interface UnmappedTileEditTarget {
  readonly type: 'unmapped';
  readonly physicalIndex: number;
  readonly reason: string;
}

export type TileEditTarget =
  | AnimationTileEditTarget
  | PlayfieldTileEditTarget
  | TilesetTileEditTarget
  | BaseChrTileEditTarget
  | EmptySlotTileEditTarget
  | UnmappedTileEditTarget;

export interface ResolveTileEditOriginOptions {
  readonly physicalIndex: number;
  readonly mode?: ProjectMode;
  readonly animationModel?: AnimationProjectModel | null;
  readonly animations?: readonly AnimationItemSetting[];
  readonly selectedAnimationId?: string | null;
  readonly baseChr?: Uint8Array | null;
  readonly baseChrName?: string | null;
  readonly destinationPatternTable?: SpritePatternTable;
  readonly tiles?: readonly Tile[];
  readonly playfieldNametable?: Uint8Array | null;
  readonly deduplicationEnabled?: boolean;
  readonly flipDeduplicationEnabled?: boolean;
  readonly finalChrBytes?: Uint8Array | null;
}

/**
 * Resolves the canonical editing target for a physical CHR-ROM tile index (0..511).
 */
export function resolveTileEditOrigin(
  options: ResolveTileEditOriginOptions,
): TileEditTarget {
  const physicalIndex = options.physicalIndex;
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= NES_CHR_ROM_TILE_COUNT
  ) {
    return {
      type: 'unmapped',
      physicalIndex,
      reason: `Physical tile index ${String(physicalIndex)} is out of NES CHR bounds (0..511).`,
    };
  }

  const mode = options.mode ?? 'tileset';
  const destPt = options.destinationPatternTable ?? 0;

  // 1. Check references in the current project
  const references = collectPhysicalTileReferences({
    physicalTileIndex: physicalIndex,
    mode,
    animationModel: options.animationModel,
    playfieldNametable: options.playfieldNametable,
    destinationPatternTable: destPt,
    tiles: options.tiles,
    deduplicationEnabled: options.deduplicationEnabled,
    flipDeduplicationEnabled: options.flipDeduplicationEnabled,
  });

  if (references.length > 0) {
    if (mode === 'animation') {
      const animRef =
        (options.selectedAnimationId
          ? references.find(
              (r): r is Extract<ChrTileReference, { type: 'animation' }> =>
                r.type === 'animation' &&
                r.animationId === options.selectedAnimationId,
            )
          : null) ??
        references.find(
          (r): r is Extract<ChrTileReference, { type: 'animation' }> =>
            r.type === 'animation',
        );

      if (animRef) {
        const animSetting = options.animations?.find(
          (a) =>
            a.id === animRef.animationId || a.name === animRef.animationName,
        );
        const frameWidth = animSetting?.frameWidth ?? 16;
        const frameHeight = animSetting?.frameHeight ?? 16;
        const imgWidth =
          animSetting?.source?.indexedImage.width ??
          animSetting?.source?.sourceImage.width ??
          128;
        const animColumns = Math.max(1, Math.floor(imgWidth / frameWidth));

        const sourceX = (animRef.frameIndex % animColumns) * frameWidth;
        const sourceY =
          Math.floor(animRef.frameIndex / animColumns) * frameHeight;
        const colOffset = animRef.sourceTileColumn ?? Math.floor(animRef.x / 8);
        const rowOffset = animRef.sourceTileRow ?? Math.floor(animRef.y / 8);
        const tileX = Math.floor(sourceX / 8) + colOffset;
        const tileY = Math.floor(sourceY / 8) + rowOffset;

        return {
          type: 'animation',
          animationId: animRef.animationId,
          animationName: animRef.animationName,
          entity: animRef.entity,
          frameIndex: animRef.frameIndex,
          tileX,
          tileY,
        };
      }
    }

    if (mode === 'playfield') {
      const pfRef = references.find(
        (r): r is Extract<ChrTileReference, { type: 'playfield' }> =>
          r.type === 'playfield',
      );
      if (pfRef) {
        return {
          type: 'playfield',
          tileIndex: pfRef.tileIndex,
          tileX: pfRef.column,
          tileY: pfRef.row,
          column: pfRef.column,
          row: pfRef.row,
        };
      }
    }

    if (mode === 'tileset') {
      const tsRef = references.find(
        (r): r is Extract<ChrTileReference, { type: 'tileset' }> =>
          r.type === 'tileset',
      );
      if (tsRef) {
        const matchedTile = options.tiles?.find(
          (t) => t.id === tsRef.tileIndex,
        );
        const tileX = matchedTile ? matchedTile.column : tsRef.tileIndex % 16;
        const tileY = matchedTile
          ? matchedTile.row
          : Math.floor(tsRef.tileIndex / 16);

        return {
          type: 'tileset',
          tileIndex: tsRef.tileIndex,
          tileX,
          tileY,
          column: tileX,
          row: tileY,
        };
      }
    }
  }

  // 2. No direct reference: inspect slot classification
  const classifications = classifyChrSlots({
    mode,
    animationModel: options.animationModel,
    baseChr: options.baseChr,
    baseChrName: options.baseChrName,
    destinationPatternTable: destPt,
    tiles: options.tiles,
    deduplicationEnabled: options.deduplicationEnabled,
    flipDeduplicationEnabled: options.flipDeduplicationEnabled,
    finalChrBytes: options.finalChrBytes,
  });

  const slot = classifications[physicalIndex];
  if (
    slot?.occupancy === 'base' &&
    options.baseChr &&
    options.baseChr.length > 0
  ) {
    const fileTileSlots = options.baseChr.length / 16;
    const start = baseChrPhysicalStart(fileTileSlots, destPt);
    const tileOffsetInBase = physicalIndex - start;
    if (tileOffsetInBase >= 0 && tileOffsetInBase < fileTileSlots) {
      return {
        type: 'base',
        physicalIndex,
        byteOffsetInBaseChr: tileOffsetInBase * 16,
        destinationPatternTable: destPt,
      };
    }
  }

  // 3. Fallback: Empty slot ready for materialization
  const patternTable = patternTableForPhysicalTile(physicalIndex);
  return {
    type: 'empty',
    physicalIndex,
    patternTable,
  };
}

export interface ApplyTileEditOptions {
  readonly physicalIndex: number;
  readonly newPixels: Uint8Array;
  readonly target: TileEditTarget;
  readonly mode?: ProjectMode;
  readonly animations?: readonly AnimationItemSetting[];
  readonly baseChr?: Uint8Array | null;
  readonly baseChrName?: string | null;
  readonly destinationPatternTable?: SpritePatternTable;
  readonly indexedImage?: IndexedImage | null;
  readonly pixelOverrides?: Uint8Array;
  readonly paletteSet?: NesPaletteSet;
  readonly paletteAssignments?: Uint8Array;
  readonly paletteRegionSize?: number;
  readonly colorDistanceMode?: ColorDistanceMode;
}

export interface ApplyTileEditResult {
  readonly success: boolean;
  readonly updatedAnimations?: readonly AnimationItemSetting[];
  readonly updatedDestinationChr?: Uint8Array;
  readonly updatedDestinationChrName?: string | null;
  readonly updatedDestinationPatternTable?: SpritePatternTable;
  readonly updatedPixelOverrides?: Uint8Array;
  readonly updatedTiles?: readonly Tile[];
  readonly errorMessage?: string;
}

/**
 * Applies edited 8x8 tile pixels to the project's single source of truth based on target resolution.
 */
export function applyChrTileEdit(
  options: ApplyTileEditOptions,
): ApplyTileEditResult {
  validateTilePixels(options.newPixels);
  const target = options.target;

  if (target.type === 'unmapped') {
    return {
      success: false,
      errorMessage: target.reason,
    };
  }

  // --- Case 1: Animation Mode Tile ---
  if (target.type === 'animation') {
    const animations = options.animations ?? [];
    const animIndex = animations.findIndex(
      (a) => a.id === target.animationId || a.name === target.animationName,
    );

    if (animIndex < 0) {
      return {
        success: false,
        errorMessage: `Target animation '${target.animationName}' not found.`,
      };
    }

    const currentAnim = animations[animIndex];
    if (!currentAnim) {
      return {
        success: false,
        errorMessage: `Animation target at index ${String(animIndex)} is missing.`,
      };
    }

    const key = getTileKey(target.tileX, target.tileY);
    const tileOverrides: SingleTileOverrides = {};
    for (let i = 0; i < 64; i += 1) {
      tileOverrides[i] = options.newPixels[i] ?? 0;
    }

    const nextOverrides: TilePixelOverrides = {
      ...(currentAnim.pixelOverrides ?? {}),
      [key]: tileOverrides,
    };

    const updatedAnimations = animations.map((anim, idx) =>
      idx === animIndex ? { ...anim, pixelOverrides: nextOverrides } : anim,
    );

    return {
      success: true,
      updatedAnimations,
    };
  }

  // --- Case 2: Tileset / Playfield Tile ---
  if (target.type === 'tileset' || target.type === 'playfield') {
    const img = options.indexedImage;
    if (!img) {
      return {
        success: false,
        errorMessage: 'Project indexed image is not loaded.',
      };
    }

    const currentOverrides =
      options.pixelOverrides?.length === img.width * img.height
        ? options.pixelOverrides
        : new Uint8Array(img.width * img.height).fill(0xff);

    const nextOverrides = new Uint8Array(currentOverrides);
    const startX = target.tileX * 8;
    const startY = target.tileY * 8;

    for (let py = 0; py < 8; py += 1) {
      for (let px = 0; px < 8; px += 1) {
        const imgX = startX + px;
        const imgY = startY + py;
        if (imgX < img.width && imgY < img.height) {
          nextOverrides[imgY * img.width + imgX] =
            options.newPixels[py * 8 + px] ?? 0;
        }
      }
    }

    let updatedTiles: readonly Tile[] | undefined;
    if (
      options.paletteSet &&
      options.paletteAssignments &&
      options.paletteRegionSize
    ) {
      const mapped = mapImageToNesPalettes(
        img,
        options.paletteSet,
        options.paletteAssignments,
        options.paletteRegionSize,
        nextOverrides,
        false,
        options.colorDistanceMode ?? 'perceptual',
      );
      updatedTiles = extractTiles(mapped);
    }

    return {
      success: true,
      updatedPixelOverrides: nextOverrides,
      updatedTiles,
    };
  }

  // --- Case 3: Base CHR Tile ---
  if (target.type === 'base') {
    const currentBase = options.baseChr ?? new Uint8Array(0);
    const tileBytes = encodeChrTileFromPixels(options.newPixels);
    const nextBase = new Uint8Array(currentBase);

    if (
      target.byteOffsetInBaseChr < 0 ||
      target.byteOffsetInBaseChr + 16 > nextBase.length
    ) {
      return {
        success: false,
        errorMessage: `Byte offset ${String(target.byteOffsetInBaseChr)} out of Base CHR range.`,
      };
    }

    nextBase.set(tileBytes, target.byteOffsetInBaseChr);

    return {
      success: true,
      updatedDestinationChr: nextBase,
      updatedDestinationChrName: options.baseChrName,
      updatedDestinationPatternTable: options.destinationPatternTable,
    };
  }

  // --- Case 4: Empty Slot (Materialization into Base CHR) ---
  const tileBytes = encodeChrTileFromPixels(options.newPixels);
  const currentBase = options.baseChr ?? new Uint8Array(0);
  const currentDestPt = options.destinationPatternTable ?? 0;

  // Case 4.1: No Base CHR yet -> allocate 8 KiB (512 tiles)
  if (currentBase.length === 0) {
    const nextBase = new Uint8Array(NES_CHR_ROM_TILE_COUNT * 16);
    nextBase.set(tileBytes, target.physicalIndex * 16);
    return {
      success: true,
      updatedDestinationChr: nextBase,
      updatedDestinationChrName: options.baseChrName ?? 'custom.chr',
      updatedDestinationPatternTable: 0,
    };
  }

  // Case 4.2: 4 KiB Base CHR (256 tiles)
  if (currentBase.length === NES_PATTERN_TABLE_TILE_COUNT * 16) {
    const start = baseChrPhysicalStart(256, currentDestPt);
    const isWithinCurrentPt =
      target.physicalIndex >= start && target.physicalIndex < start + 256;

    if (isWithinCurrentPt) {
      const nextBase = new Uint8Array(currentBase);
      nextBase.set(tileBytes, (target.physicalIndex - start) * 16);
      return {
        success: true,
        updatedDestinationChr: nextBase,
        updatedDestinationChrName: options.baseChrName,
        updatedDestinationPatternTable: currentDestPt,
      };
    }

    // Slot is in the other Pattern Table -> Expand 4 KiB to full 8 KiB CHR
    const nextBase = new Uint8Array(NES_CHR_ROM_TILE_COUNT * 16);
    nextBase.set(currentBase, start * 16);
    nextBase.set(tileBytes, target.physicalIndex * 16);
    return {
      success: true,
      updatedDestinationChr: nextBase,
      updatedDestinationChrName: options.baseChrName ?? 'custom.chr',
      updatedDestinationPatternTable: 0,
    };
  }

  // Case 4.3: 8 KiB Base CHR (512 tiles)
  if (currentBase.length === NES_CHR_ROM_TILE_COUNT * 16) {
    const nextBase = new Uint8Array(currentBase);
    nextBase.set(tileBytes, target.physicalIndex * 16);
    return {
      success: true,
      updatedDestinationChr: nextBase,
      updatedDestinationChrName: options.baseChrName,
      updatedDestinationPatternTable: 0,
    };
  }

  // Fallback: Custom length buffer -> Expand to 8 KiB
  const nextBase = new Uint8Array(NES_CHR_ROM_TILE_COUNT * 16);
  nextBase.set(currentBase.subarray(0, Math.min(currentBase.length, 8192)));
  nextBase.set(tileBytes, target.physicalIndex * 16);
  return {
    success: true,
    updatedDestinationChr: nextBase,
    updatedDestinationChrName: options.baseChrName ?? 'custom.chr',
    updatedDestinationPatternTable: 0,
  };
}

/**
 * Extracts 64 pixel color indices (values 0..3) from the final 8 KiB CHR-ROM bytes for a physical index.
 */
export function extractTilePixelsFromChr(
  finalChrBytes: Uint8Array,
  physicalIndex: number,
): Uint8Array {
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= NES_CHR_ROM_TILE_COUNT
  ) {
    throw new RangeError(
      `Physical tile index ${String(physicalIndex)} out of bounds (0..511).`,
    );
  }

  const startByte = physicalIndex * 16;
  if (finalChrBytes.length < startByte + 16) {
    return new Uint8Array(64);
  }

  return decodeChrTileToPixels(
    finalChrBytes.subarray(startByte, startByte + 16),
  );
}
