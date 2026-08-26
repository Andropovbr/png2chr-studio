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

export interface TileMatch {
  readonly physicalTileIndex: number;
  readonly attributes: number;
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
  readonly reuse: TileReuse;
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
 */
export function findTileMatch(
  candidate: Tile,
  slots: readonly PatternTableSlot[],
  patternTable: SpritePatternTable,
  flipDeduplication: boolean,
): TileMatch | null {
  const candidateKey = tilePixelKey(candidate);
  const [start, end] = patternTablePhysicalRange(patternTable);

  // 1. Exact match pass
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
      return { physicalTileIndex, attributes: 0 };
    }
  }

  if (!flipDeduplication) return null;

  // 2. Flip match pass (H, V, H+V)
  const flips = [
    [true, false, NES_SPRITE_FLIP_HORIZONTAL],
    [false, true, NES_SPRITE_FLIP_VERTICAL],
    [true, true, NES_SPRITE_FLIP_HORIZONTAL | NES_SPRITE_FLIP_VERTICAL],
  ] as const;

  for (
    let physicalTileIndex = start;
    physicalTileIndex <= end;
    physicalTileIndex += 1
  ) {
    const existing = slots[physicalTileIndex]?.tile;
    if (existing === undefined || existing === null) continue;
    for (const [horizontal, vertical, attributes] of flips) {
      if (transformedTileKey(existing, horizontal, vertical) === candidateKey) {
        return { physicalTileIndex, attributes };
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
      let reuse: TileReuse;

      if (match !== null) {
        physicalTileIndex = match.physicalTileIndex;
        flipAttributes = match.attributes;
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
