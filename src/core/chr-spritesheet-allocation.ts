/**
 * Unified physical CHR allocation pipeline for spritesheets.
 *
 * Part of Milestone 7: Sprite Sheet → CHR Integration (Issue #95).
 * Transforms logical metasprite frames and tiles into deterministic physical
 * CHR assignments respecting Base CHR, Pattern Tables (PT0/PT1), and CHR Reservations.
 */

import { AnimationModelError } from './animation-error';
import {
  findNextAvailableChrSlot,
  localPatternTableTileIndex,
  NES_PATTERN_TABLE_TILE_COUNT,
  patternTablePhysicalRange,
  type PatternTableSlot,
  type SpritePatternTable,
} from './chr-pattern-table';
import type { LogicalTileKey } from './asset-identity';
import type { LogicalAnimationFrame } from './metasprite-extraction';
import { tilePixelKey, transformedTileKey } from './tile-deduplication';
import type { Tile } from './types';

export const NES_SPRITE_FLIP_HORIZONTAL = 0x40;
export const NES_SPRITE_FLIP_VERTICAL = 0x80;

export type TileReuse = 'destination' | 'imported' | 'new';
export type FlipTransform = 'none' | 'h' | 'v' | 'hv';

export interface TileMatch {
  readonly physicalTileIndex: number;
  readonly attributes: number;
  readonly transform: FlipTransform;
}

/**
 * Resulting physical CHR assignment for a single logical metasprite tile.
 */
export interface MetaspritePhysicalAssignment {
  readonly logicalKey: LogicalTileKey;
  readonly physicalTileIndex: number;
  readonly patternTable: SpritePatternTable;
  readonly localTileIndex: number;
  readonly flipAttributes: number;
  readonly transform: FlipTransform;
  readonly reuse: TileReuse;
}

/**
 * Encodes OAM sprite attribute byte according to NES hardware specifications.
 * Bit 7: Vertical Flip (0x80)
 * Bit 6: Horizontal Flip (0x40)
 * Bit 5: Priority (0 = in front of background, 1 = behind background)
 * Bits 1-0: Sprite Subpalette (0-3)
 */
export function encodeOamAttributes(
  flipAttributes: number,
  paletteIndex: number,
  priorityBehindBackground = false,
): number {
  const flip =
    flipAttributes & (NES_SPRITE_FLIP_HORIZONTAL | NES_SPRITE_FLIP_VERTICAL);
  const priority = priorityBehindBackground ? 0x20 : 0;
  const palette = paletteIndex & 0x03;
  return flip | priority | palette;
}

/**
 * Decodes an OAM sprite attribute byte into individual flags.
 */
export function decodeOamAttributes(attributes: number): {
  readonly horizontalFlip: boolean;
  readonly verticalFlip: boolean;
  readonly priorityBehindBackground: boolean;
  readonly paletteIndex: number;
} {
  return {
    horizontalFlip: (attributes & NES_SPRITE_FLIP_HORIZONTAL) !== 0,
    verticalFlip: (attributes & NES_SPRITE_FLIP_VERTICAL) !== 0,
    priorityBehindBackground: (attributes & 0x20) !== 0,
    paletteIndex: attributes & 0x03,
  };
}

/**
 * Options for allocating a series of logical animation frames into CHR pattern table slots.
 */
export interface AllocateSpritesheetChrOptions {
  /** Logical animation frames containing visible 8x8 metasprite tiles. */
  readonly logicalFrames: readonly LogicalAnimationFrame[];
  /** Initial pattern table slots (512 slots). */
  readonly initialSlots: readonly PatternTableSlot[];
  /** Target sprite pattern table for allocation (0 for PT0, 1 for PT1). */
  readonly patternTable: SpritePatternTable;
  /** Set of physical tile indices blocked by CHR reservations. */
  readonly reservedIndices?: ReadonlySet<number>;
  /** Enable flip-aware deduplication (default true). */
  readonly flipDeduplication?: boolean;
}

/**
 * Result of allocating logical metasprite frames into CHR memory.
 */
export interface AllocateSpritesheetChrResult {
  /** Updated immutable array of 512 PatternTableSlots. */
  readonly slots: readonly PatternTableSlot[];
  /** Physical assignments for each frame's sprites (aligned with logicalFrames[f].sprites). */
  readonly frameAssignments: readonly (readonly MetaspritePhysicalAssignment[])[];
  /** Metric: count of reused base CHR slots. */
  readonly reusedDestinationTiles: number;
  /** Metric: count of reused imported project tiles. */
  readonly reusedImportedTiles: number;
  /** Metric: count of newly allocated slots. */
  readonly newTileCount: number;
}

/**
 * Searches existing pattern table slots for an exact or flip-transformed pixel match.
 * Precedence:
 * 1. Exact match (attributes = 0, transform = 'none')
 * 2. Horizontal flip (attributes = 0x40, transform = 'h')
 * 3. Vertical flip (attributes = 0x80, transform = 'v')
 * 4. Horizontal + Vertical flip (attributes = 0xC0, transform = 'hv')
 *
 * Determinism: When multiple slots match in the same tier, the lowest physicalTileIndex wins.
 */
export function findTileMatch(
  candidate: Tile,
  slots: readonly PatternTableSlot[],
  patternTable: SpritePatternTable,
  flipDeduplication: boolean,
): TileMatch | null {
  const candidateKey = tilePixelKey(candidate);
  const [start, end] = patternTablePhysicalRange(patternTable);

  // 1. Exact match pass (highest precedence)
  for (
    let physicalTileIndex = start;
    physicalTileIndex <= end;
    physicalTileIndex += 1
  ) {
    const existing = slots[physicalTileIndex]?.tile;
    if (
      existing !== null &&
      existing !== undefined &&
      tilePixelKey(existing) === candidateKey
    ) {
      return { physicalTileIndex, attributes: 0, transform: 'none' };
    }
  }

  if (!flipDeduplication) return null;

  // 2. Horizontal Flip pass (2nd precedence)
  for (
    let physicalTileIndex = start;
    physicalTileIndex <= end;
    physicalTileIndex += 1
  ) {
    const existing = slots[physicalTileIndex]?.tile;
    if (existing !== null && existing !== undefined) {
      if (transformedTileKey(existing, true, false) === candidateKey) {
        return {
          physicalTileIndex,
          attributes: NES_SPRITE_FLIP_HORIZONTAL,
          transform: 'h',
        };
      }
    }
  }

  // 3. Vertical Flip pass (3rd precedence)
  for (
    let physicalTileIndex = start;
    physicalTileIndex <= end;
    physicalTileIndex += 1
  ) {
    const existing = slots[physicalTileIndex]?.tile;
    if (existing !== null && existing !== undefined) {
      if (transformedTileKey(existing, false, true) === candidateKey) {
        return {
          physicalTileIndex,
          attributes: NES_SPRITE_FLIP_VERTICAL,
          transform: 'v',
        };
      }
    }
  }

  // 4. Horizontal + Vertical Flip pass (4th precedence)
  for (
    let physicalTileIndex = start;
    physicalTileIndex <= end;
    physicalTileIndex += 1
  ) {
    const existing = slots[physicalTileIndex]?.tile;
    if (existing !== null && existing !== undefined) {
      if (transformedTileKey(existing, true, true) === candidateKey) {
        return {
          physicalTileIndex,
          attributes: NES_SPRITE_FLIP_HORIZONTAL | NES_SPRITE_FLIP_VERTICAL,
          transform: 'hv',
        };
      }
    }
  }

  return null;
}

/**
 * Allocates logical metasprite candidate tiles to physical CHR pattern table slots.
 * Guarantees transaction atomicity: if capacity overflows, no partial mutation occurs.
 */
export function allocateSpritesheetChr(
  options: AllocateSpritesheetChrOptions,
): AllocateSpritesheetChrResult {
  const {
    logicalFrames,
    initialSlots,
    patternTable,
    reservedIndices,
    flipDeduplication = true,
  } = options;

  // Clone working slots array to guarantee atomic transactional semantics
  const workingSlots: PatternTableSlot[] = initialSlots.map((slot) => ({
    ...slot,
  }));

  let reusedDestinationTiles = 0;
  let reusedImportedTiles = 0;
  let newTileCount = 0;

  const frameAssignments: (readonly MetaspritePhysicalAssignment[])[] = [];

  for (const logicalFrame of logicalFrames) {
    const assignments: MetaspritePhysicalAssignment[] = [];

    for (const logicalSprite of logicalFrame.sprites) {
      const candidate: Tile = {
        id: 0,
        column: logicalSprite.tileColumn,
        row: logicalSprite.tileRow,
        pixels: logicalSprite.pixels,
      };

      const match = findTileMatch(
        candidate,
        workingSlots,
        patternTable,
        flipDeduplication,
      );

      let physicalTileIndex: number;
      let flipAttributes = 0;
      let transform: FlipTransform = 'none';
      let reuse: TileReuse;

      if (match !== null) {
        physicalTileIndex = match.physicalTileIndex;
        flipAttributes = match.attributes;
        transform = match.transform;
        reuse = workingSlots[physicalTileIndex]?.source ?? 'imported';
        if (reuse === 'destination') {
          reusedDestinationTiles += 1;
        } else {
          reusedImportedTiles += 1;
        }
      } else {
        const availableSlot = findNextAvailableChrSlot(workingSlots, {
          patternTable,
          reservedIndices,
        });

        if (availableSlot === undefined) {
          throw new AnimationModelError('pattern-table-capacity-overflow', {
            patternTable,
            capacityTiles: NES_PATTERN_TABLE_TILE_COUNT,
          });
        }

        physicalTileIndex = availableSlot.physicalTileIndex;
        workingSlots[physicalTileIndex] = {
          physicalTileIndex,
          tile: { ...candidate, id: physicalTileIndex },
          source: 'imported',
        };
        newTileCount += 1;
        reuse = 'new';
        transform = 'none';
      }

      const localTileIndex = localPatternTableTileIndex(physicalTileIndex);
      if (localTileIndex > 0xff) {
        throw new AnimationModelError('tile-index-overflow', {
          tileIndex: localTileIndex,
        });
      }

      assignments.push({
        logicalKey: logicalSprite.logicalKey,
        physicalTileIndex,
        patternTable,
        localTileIndex,
        flipAttributes,
        transform,
        reuse,
      });
    }

    frameAssignments.push(Object.freeze(assignments));
  }

  return {
    slots: Object.freeze(workingSlots),
    frameAssignments: Object.freeze(frameAssignments),
    reusedDestinationTiles,
    reusedImportedTiles,
    newTileCount,
  };
}
