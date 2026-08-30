/**
 * Unified physical CHR allocation pipeline for Background Maps.
 *
 * Part of Milestone 8: Background Pipeline (Issue #109).
 * Transforms logical background map definitions into deterministic physical
 * CHR assignments respecting Base CHR, Pattern Tables (PT0/PT1), and CHR Reservations.
 *
 * Invariant: Logical != Physical.
 * Background maps persist purely logical references. Physical CHR slots and
 * Nametable bytes (0..255) are derived in runtime through this allocator.
 */

import { BackgroundModelError } from './background-error';
import {
  collectReservedPhysicalTileIndices,
  createPatternTableSlots,
  encodePatternTableSlots,
  findNextAvailableChrSlot,
  localPatternTableTileIndexFor,
  NES_CHR_ROM_TILE_COUNT,
  NES_PATTERN_TABLE_TILE_COUNT,
  patternTablePhysicalRange,
  type ChrRegion,
  type PatternTableSlot,
} from './chr-pattern-table';
import type { LogicalTileKey } from './asset-identity';
import { tilePixelKey } from './tile-deduplication';
import type { Tile } from './types';
import {
  BACKGROUND_TILE_COUNT,
  BACKGROUND_WIDTH_TILES,
  encodeBackgroundAttributeTable,
  encodeFullBackgroundMap,
  validateBackgroundMapDefinition,
  type BackgroundMapCell,
  type BackgroundMapDefinition,
  type BackgroundPatternTable,
  type ResolvedNametableCell,
} from './background-model';

export type BackgroundTileReuse = 'base' | 'project' | 'new' | 'empty';

/**
 * Resulting physical CHR assignment for a single 8x8 cell in the 32x30 background grid.
 */
export interface BackgroundPhysicalAssignment {
  readonly cellIndex: number; // 0..959
  readonly column: number; // 0..31
  readonly row: number; // 0..29
  readonly logicalKey: LogicalTileKey | null;
  readonly physicalTileIndex: number; // 0..511
  readonly localTileIndex: number; // 0..255
  readonly patternTable: BackgroundPatternTable;
  readonly reuse: BackgroundTileReuse;
}

/**
 * Options for allocating a logical background map into CHR pattern table slots.
 */
export interface AllocateBackgroundChrOptions {
  /** Logical background map definition. */
  readonly map: BackgroundMapDefinition;
  /** Initial pattern table slots (512 slots). */
  readonly initialSlots: readonly PatternTableSlot[];
  /** Resolver to obtain 64 pixel values (0..3) for a logical map cell. */
  readonly tilePixelsResolver?: (
    cell: BackgroundMapCell,
    cellIndex: number,
  ) => Uint8Array | Tile | null | undefined;
  /** Optional lookup map of LogicalTileKey -> Tile or 64-pixel Uint8Array. */
  readonly tileMap?: ReadonlyMap<LogicalTileKey, Tile | Uint8Array>;
  /** Set of physical tile indices blocked by CHR reservations. */
  readonly reservedIndices?: ReadonlySet<number>;
  /** Explicit local tile index (0..255) to assign to empty (null) cells. */
  readonly emptyCellTileIndex?: number;
  /** Explicit 64-pixel Tile or Uint8Array for empty (null) cells. Defaults to 64 zero pixels. */
  readonly emptyCellTile?: Tile | Uint8Array;
}

/**
 * Result of allocating logical background map cells into CHR memory.
 */
export interface AllocateBackgroundChrResult {
  /** Updated immutable array of 512 PatternTableSlots. */
  readonly slots: readonly PatternTableSlot[];
  /** Assignments for all 960 cells in sequential order (0..959). */
  readonly cellAssignments: readonly BackgroundPhysicalAssignment[];
  /** Compiled 960-byte physical Nametable buffer. */
  readonly nametable: Uint8Array;
  /** Metric: count of reused Base CHR tiles. */
  readonly reusedBaseTiles: number;
  /** Metric: count of reused existing project tiles. */
  readonly reusedProjectTiles: number;
  /** Metric: count of newly allocated slots. */
  readonly newTileCount: number;
  /** Metric: total unique physical tiles used by this background. */
  readonly uniqueTileCount: number;
}

/**
 * Options for building a compiled BackgroundProjectModel.
 */
export interface BuildBackgroundProjectModelOptions {
  readonly map: BackgroundMapDefinition;
  readonly initialSlots?: readonly PatternTableSlot[];
  readonly baseChr?: Uint8Array | null;
  readonly chrRegions?: readonly ChrRegion[];
  readonly reservedIndices?: ReadonlySet<number>;
  readonly tilePixelsResolver?: (
    cell: BackgroundMapCell,
    cellIndex: number,
  ) => Uint8Array | Tile | null | undefined;
  readonly tileMap?: ReadonlyMap<LogicalTileKey, Tile | Uint8Array>;
  readonly emptyCellTileIndex?: number;
  readonly emptyCellTile?: Tile | Uint8Array;
}

/**
 * Authoritative compiled physical model for a Background Map.
 */
export interface BackgroundProjectModel {
  readonly map: BackgroundMapDefinition;
  readonly patternTable: BackgroundPatternTable;
  readonly nametable: Uint8Array; // 960 bytes
  readonly attributeTable: Uint8Array; // 64 bytes
  readonly fullMapBuffer: Uint8Array; // 1024 bytes (960B + 64B)
  readonly resolvedCells: readonly ResolvedNametableCell[];
  readonly slots: readonly PatternTableSlot[];
  readonly finalChr: Uint8Array; // 8192 bytes
  readonly reusedBaseTiles: number;
  readonly reusedProjectTiles: number;
  readonly newTileCount: number;
  readonly uniqueTileCount: number;
}

/**
 * Helper to normalize raw pixel representations into a standard 64-pixel Tile object.
 */
function normalizeTileCandidate(
  candidate: Tile | Uint8Array,
  tileX = 0,
  tileY = 0,
): Tile {
  if ('pixels' in candidate) {
    if (candidate.pixels.length !== 64) {
      throw new BackgroundModelError('invalid-dimensions', {
        reason: 'Tile must contain exactly 64 pixels',
        pixelCount: candidate.pixels.length,
      });
    }
    return candidate;
  }

  if (candidate.length !== 64) {
    throw new BackgroundModelError('invalid-dimensions', {
      reason: 'Tile pixel array must contain exactly 64 pixels',
      pixelCount: candidate.length,
    });
  }

  return {
    id: 0,
    column: tileX,
    row: tileY,
    pixels: candidate,
  };
}

/**
 * Searches existing pattern table slots for an exact pixel match (ExactMatch only).
 * Backgrounds on the NES do not support hardware flips.
 *
 * Determinism: When multiple slots match, the lowest physicalTileIndex wins.
 */
export function findExactTileMatch(
  candidate: Tile,
  slots: readonly PatternTableSlot[],
  patternTable: BackgroundPatternTable,
): number | null {
  const candidateKey = tilePixelKey(candidate);
  const [start, end] = patternTablePhysicalRange(patternTable);

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
      return physicalTileIndex;
    }
  }

  return null;
}

/**
 * Allocates logical background map candidate tiles to physical CHR pattern table slots.
 * Guarantees transaction atomicity: if capacity overflows or an error occurs,
 * input slots remain completely unmutated.
 */
export function allocateBackgroundChr(
  options: AllocateBackgroundChrOptions,
): AllocateBackgroundChrResult {
  validateBackgroundMapDefinition(options.map);

  if (options.initialSlots.length !== NES_CHR_ROM_TILE_COUNT) {
    throw new BackgroundModelError('invalid-dimensions', {
      reason: 'Initial slots must contain exactly 512 entries',
      length: options.initialSlots.length,
    });
  }

  // Clone working slots array to guarantee atomic transactional semantics
  const workingSlots: PatternTableSlot[] = options.initialSlots.map((slot) => ({
    ...slot,
  }));

  const { patternTable } = options.map;
  const reservedIndices = options.reservedIndices;
  const defaultBlankTile: Tile = {
    id: 0,
    column: 0,
    row: 0,
    pixels: new Uint8Array(64),
  };

  let reusedBaseTiles = 0;
  let reusedProjectTiles = 0;
  let newTileCount = 0;
  const usedPhysicalIndices = new Set<number>();
  const cellAssignments: BackgroundPhysicalAssignment[] = [];

  for (let i = 0; i < BACKGROUND_TILE_COUNT; i += 1) {
    const col = i % BACKGROUND_WIDTH_TILES;
    const row = Math.floor(i / BACKGROUND_WIDTH_TILES);
    const cell = options.map.cells[i];

    if (cell === null || cell === undefined) {
      // Empty map cell handling
      if (options.emptyCellTileIndex !== undefined) {
        const localTileIndex = options.emptyCellTileIndex;
        if (
          !Number.isInteger(localTileIndex) ||
          localTileIndex < 0 ||
          localTileIndex > 255
        ) {
          throw new BackgroundModelError('invalid-tile-index', {
            cellIndex: i,
            tileIndex: String(localTileIndex),
            reason: 'emptyCellTileIndex out of 0..255 range',
          });
        }
        const physicalTileIndex = patternTable * 256 + localTileIndex;
        usedPhysicalIndices.add(physicalTileIndex);
        cellAssignments.push({
          cellIndex: i,
          column: col,
          row,
          logicalKey: null,
          physicalTileIndex,
          localTileIndex,
          patternTable,
          reuse: 'empty',
        });
        continue;
      }

      // Empty cell resolved as blank/transparent tile
      const candidate = normalizeTileCandidate(
        options.emptyCellTile ?? defaultBlankTile,
      );
      const match = findExactTileMatch(candidate, workingSlots, patternTable);

      let physicalTileIndex: number;
      let reuse: BackgroundTileReuse;

      if (match !== null) {
        physicalTileIndex = match;
        reuse =
          workingSlots[physicalTileIndex]?.source === 'destination'
            ? 'base'
            : 'project';
        if (reuse === 'base') {
          reusedBaseTiles += 1;
        } else {
          reusedProjectTiles += 1;
        }
      } else {
        const availableSlot = findNextAvailableChrSlot(workingSlots, {
          patternTable,
          reservedIndices,
        });

        if (availableSlot === undefined) {
          throw new BackgroundModelError('background-capacity-overflow', {
            patternTable,
            capacityTiles: NES_PATTERN_TABLE_TILE_COUNT,
            newTilesAllocated: newTileCount,
            reusedBaseTiles,
            reusedProjectTiles,
            cellIndex: i,
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

      const localTileIndex = localPatternTableTileIndexFor(
        physicalTileIndex,
        patternTable,
      );
      usedPhysicalIndices.add(physicalTileIndex);
      cellAssignments.push({
        cellIndex: i,
        column: col,
        row,
        logicalKey: null,
        physicalTileIndex,
        localTileIndex,
        patternTable,
        reuse,
      });
      continue;
    }

    // Non-null logical map cell
    let rawPixels: Uint8Array | Tile | null | undefined =
      options.tilePixelsResolver?.(cell, i);
    if (!rawPixels && options.tileMap) {
      rawPixels = options.tileMap.get(cell.logicalKey);
    }

    if (!rawPixels) {
      throw new BackgroundModelError('unresolved-logical-tile', {
        logicalKey: cell.logicalKey,
        cellIndex: i,
        column: col,
        row,
      });
    }

    const candidate = normalizeTileCandidate(rawPixels, cell.tileX, cell.tileY);
    const match = findExactTileMatch(candidate, workingSlots, patternTable);

    let physicalTileIndex: number;
    let reuse: BackgroundTileReuse;

    if (match !== null) {
      physicalTileIndex = match;
      reuse =
        workingSlots[physicalTileIndex]?.source === 'destination'
          ? 'base'
          : 'project';
      if (reuse === 'base') {
        reusedBaseTiles += 1;
      } else {
        reusedProjectTiles += 1;
      }
    } else {
      const availableSlot = findNextAvailableChrSlot(workingSlots, {
        patternTable,
        reservedIndices,
      });

      if (availableSlot === undefined) {
        throw new BackgroundModelError('background-capacity-overflow', {
          patternTable,
          capacityTiles: NES_PATTERN_TABLE_TILE_COUNT,
          newTilesAllocated: newTileCount,
          reusedBaseTiles,
          reusedProjectTiles,
          cellIndex: i,
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

    const localTileIndex = localPatternTableTileIndexFor(
      physicalTileIndex,
      patternTable,
    );
    if (localTileIndex < 0 || localTileIndex > 255) {
      throw new BackgroundModelError('invalid-tile-index', {
        cellIndex: i,
        tileIndex: String(localTileIndex),
      });
    }

    usedPhysicalIndices.add(physicalTileIndex);
    cellAssignments.push({
      cellIndex: i,
      column: col,
      row,
      logicalKey: cell.logicalKey,
      physicalTileIndex,
      localTileIndex,
      patternTable,
      reuse,
    });
  }

  const nametable = new Uint8Array(BACKGROUND_TILE_COUNT);
  for (let i = 0; i < BACKGROUND_TILE_COUNT; i += 1) {
    const assignment = cellAssignments[i];
    if (assignment) {
      nametable[i] = assignment.localTileIndex;
    }
  }

  return {
    slots: Object.freeze(workingSlots),
    cellAssignments: Object.freeze(cellAssignments),
    nametable,
    reusedBaseTiles,
    reusedProjectTiles,
    newTileCount,
    uniqueTileCount: usedPhysicalIndices.size,
  };
}

/**
 * Builds the complete, resolved BackgroundProjectModel for a background map.
 */
export function buildBackgroundProjectModel(
  options: BuildBackgroundProjectModelOptions,
): BackgroundProjectModel {
  const { map } = options;
  validateBackgroundMapDefinition(map);

  const initialSlots =
    options.initialSlots ??
    (options.baseChr
      ? createPatternTableSlots(options.baseChr, 0)
      : createPatternTableSlots(new Uint8Array(0), 0));

  const reservedIndices =
    options.reservedIndices ??
    (options.chrRegions
      ? collectReservedPhysicalTileIndices(options.chrRegions)
      : undefined);

  const allocation = allocateBackgroundChr({
    map,
    initialSlots,
    reservedIndices,
    tilePixelsResolver: options.tilePixelsResolver,
    tileMap: options.tileMap,
    emptyCellTileIndex: options.emptyCellTileIndex,
    emptyCellTile: options.emptyCellTile,
  });

  const resolvedCells: ResolvedNametableCell[] = [];
  for (const assignment of allocation.cellAssignments) {
    const paletteRow = Math.floor(assignment.row / 2);
    const paletteCol = Math.floor(assignment.column / 2);
    const paletteIndex =
      map.paletteAssignments[paletteRow * 16 + paletteCol] ?? 0;

    resolvedCells.push({
      column: assignment.column,
      row: assignment.row,
      cellIndex: assignment.cellIndex,
      logicalKey: assignment.logicalKey,
      localTileIndex: assignment.localTileIndex,
      physicalTileIndex: assignment.physicalTileIndex,
      paletteIndex,
    });
  }

  const attributeTable = encodeBackgroundAttributeTable(map.paletteAssignments);
  const fullMapBuffer = encodeFullBackgroundMap(
    allocation.nametable,
    attributeTable,
  );
  const finalChr = encodePatternTableSlots(allocation.slots);

  return {
    map,
    patternTable: map.patternTable,
    nametable: allocation.nametable,
    attributeTable,
    fullMapBuffer,
    resolvedCells: Object.freeze(resolvedCells),
    slots: allocation.slots,
    finalChr,
    reusedBaseTiles: allocation.reusedBaseTiles,
    reusedProjectTiles: allocation.reusedProjectTiles,
    newTileCount: allocation.newTileCount,
    uniqueTileCount: allocation.uniqueTileCount,
  };
}
