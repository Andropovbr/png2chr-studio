/**
 * Domain model and pure primitives for NES Background, Nametable, and Attribute Table operations.
 * Part of Milestone 8: Background Pipeline (Issue #108).
 *
 * Invariant: Logical != Physical.
 * The logical map grid references stable logical tile coordinates/keys,
 * while physical CHR indices (0..255) and physical Nametable buffers are
 * runtime-derived by CHR allocation resolution.
 */

import {
  BackgroundModelError,
  type BackgroundModelErrorCode,
} from './background-error';
import type { LogicalTileKey, ProjectAssetId } from './asset-identity';

export { BackgroundModelError, type BackgroundModelErrorCode };

/** Standard NES background horizontal resolution in 8x8 tiles (32 columns = 256 pixels). */
export const BACKGROUND_WIDTH_TILES = 32;

/** Standard NES background vertical resolution in 8x8 tiles (30 rows = 240 pixels). */
export const BACKGROUND_HEIGHT_TILES = 30;

/** Total 8x8 tile cells in a single-screen NES Nametable (32 * 30 = 960). */
export const BACKGROUND_TILE_COUNT = 32 * 30; // 960

/** Number of 16x16 pixel (2x2 tile) palette assignment columns in a 256 px screen (32 / 2 = 16). */
export const BACKGROUND_PALETTE_COLUMNS = 16;

/** Number of 16x16 pixel (2x2 tile) palette assignment rows in a 240 px screen (30 / 2 = 15). */
export const BACKGROUND_PALETTE_ROWS = 15;

/** Total 16x16 palette assignment entries for a standard 32x30 background (16 * 15 = 240). */
export const BACKGROUND_PALETTE_ASSIGNMENT_COUNT = 16 * 15; // 240

/** Standard size in bytes of a single-screen NES Nametable buffer. */
export const NAMETABLE_BYTE_COUNT = 960;

/** Standard size in bytes of an NES Attribute Table buffer. */
export const ATTRIBUTE_TABLE_BYTE_COUNT = 64;

/** Combined size in bytes of a Nametable (960 B) and its Attribute Table (64 B). */
export const FULL_MAP_BUFFER_BYTE_COUNT = 1024;

/** Number of attribute byte columns in a 256 px screen (256 / 32 = 8). */
export const ATTRIBUTE_TABLE_COLUMNS = 8;

/** Number of attribute byte rows in a 256 px height area (256 / 32 = 8). */
export const ATTRIBUTE_TABLE_ROWS = 8;

/** Maximum allowable tile index in a single NES Pattern Table (256 tiles). */
export const MAX_PATTERN_TABLE_TILES = 256;

/** Target Pattern Table selector for background rendering: 0 ($0000) or 1 ($1000). */
export type BackgroundPatternTable = 0 | 1;

/**
 * Logical 8x8 tile candidate cell in a background map before physical CHR resolution.
 */
export interface BackgroundMapCell {
  /** Canonical LogicalTileKey: `${assetId}:${tileX}:${tileY}`. */
  readonly logicalKey: LogicalTileKey;
  /** 0-based column coordinate in source asset grid. */
  readonly tileX: number;
  /** 0-based row coordinate in source asset grid. */
  readonly tileY: number;
  /** Optional sequential index in source catalog or frame. */
  readonly sourceTileIndex?: number;
}

/**
 * Canonical configuration and logical data definition of a Background Map.
 */
export interface BackgroundMapDefinition {
  /** Unique stable identifier for the background map. */
  readonly id: string;
  /** Display name of the map. */
  readonly name: string;
  /** Width in 8x8 tiles (Must be 32 in Milestone 8 MVP). */
  readonly widthTiles: number;
  /** Height in 8x8 tiles (Must be 30 in Milestone 8 MVP). */
  readonly heightTiles: number;
  /** Target Pattern Table for background rendering (0 or 1). */
  readonly patternTable: BackgroundPatternTable;
  /** Optional associated source asset ID. */
  readonly assetId?: ProjectAssetId;
  /**
   * 32x30 logical cell grid (exactly 960 items).
   * A `null` entry explicitly denotes an empty/unpopulated cell.
   */
  readonly cells: readonly (BackgroundMapCell | null)[];
  /**
   * 16x15 subpalette assignment grid (exactly 240 items, each 0..3).
   * Represents the subpalette allocated to each 16x16 pixel (2x2 tile) quadrant.
   */
  readonly paletteAssignments: readonly number[];
}

/**
 * Resolved cell in a compiled Nametable ready for hardware display or export.
 */
export interface ResolvedNametableCell {
  readonly column: number; // 0..31
  readonly row: number; // 0..29
  readonly cellIndex: number; // 0..959
  readonly logicalKey: LogicalTileKey | null;
  readonly localTileIndex: number; // 0..255 (byte in Nametable)
  readonly physicalTileIndex?: number; // 0..511 (global slot in 8 KiB CHR)
  readonly paletteIndex: number; // 0..3
}

/**
 * Options for pure logical Nametable resolution via an external mapping callback/map.
 */
export interface ResolveLogicalNametableOptions {
  readonly map: BackgroundMapDefinition;
  /**
   * Resolves a non-null BackgroundMapCell to its local 8-bit tile index (0..255).
   * If a tile cannot be resolved, returning `undefined` or `null` triggers an error or uses `emptyCellTileIndex`.
   */
  readonly resolver: (
    cell: BackgroundMapCell,
    cellIndex: number,
    col: number,
    row: number,
  ) => number | undefined | null;
  /**
   * Local tile index (0..255) to use when resolving an empty (`null`) map cell or unassigned tile.
   * If not provided and an empty cell or unresolved tile is encountered, an error is thrown.
   */
  readonly emptyCellTileIndex?: number;
}

/**
 * Options for creating an empty background map.
 */
export interface CreateEmptyBackgroundMapOptions {
  readonly id?: string;
  readonly name?: string;
  readonly patternTable?: BackgroundPatternTable;
  readonly assetId?: ProjectAssetId;
}

/**
 * Validates background map dimensions (32x30 for Milestone 8 MVP).
 */
export function validateBackgroundDimensions(
  widthTiles: number,
  heightTiles: number,
): void {
  if (
    !Number.isInteger(widthTiles) ||
    !Number.isInteger(heightTiles) ||
    widthTiles !== BACKGROUND_WIDTH_TILES ||
    heightTiles !== BACKGROUND_HEIGHT_TILES
  ) {
    throw new BackgroundModelError('invalid-dimensions', {
      width: widthTiles,
      height: heightTiles,
      expectedWidth: BACKGROUND_WIDTH_TILES,
      expectedHeight: BACKGROUND_HEIGHT_TILES,
    });
  }
}

/**
 * Validates background palette assignments (exactly 240 entries, values 0..3).
 */
export function validateBackgroundPaletteAssignments(
  paletteAssignments: readonly number[],
): void {
  if (paletteAssignments.length !== BACKGROUND_PALETTE_ASSIGNMENT_COUNT) {
    throw new BackgroundModelError('invalid-palette-assignment-count', {
      length: paletteAssignments.length,
      expected: BACKGROUND_PALETTE_ASSIGNMENT_COUNT,
    });
  }

  for (let i = 0; i < paletteAssignments.length; i += 1) {
    const value = paletteAssignments[i];
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 3
    ) {
      throw new BackgroundModelError('invalid-palette-index', {
        index: i,
        value: String(value),
      });
    }
  }
}

/**
 * Validates a complete BackgroundMapDefinition data structure.
 */
export function validateBackgroundMapDefinition(
  map: BackgroundMapDefinition,
): void {
  if (typeof map.id !== 'string' || map.id.trim() === '') {
    throw new BackgroundModelError('invalid-map-id', { id: map.id });
  }

  if (typeof map.name !== 'string' || map.name.trim() === '') {
    throw new BackgroundModelError('invalid-map-name', { name: map.name });
  }

  validateBackgroundDimensions(map.widthTiles, map.heightTiles);

  if (map.patternTable !== 0 && (map.patternTable as number) !== 1) {
    throw new BackgroundModelError('invalid-pattern-table', {
      patternTable: String(map.patternTable),
    });
  }

  if (map.cells.length !== BACKGROUND_TILE_COUNT) {
    throw new BackgroundModelError('invalid-cell-count', {
      length: map.cells.length,
      expected: BACKGROUND_TILE_COUNT,
    });
  }

  for (let i = 0; i < map.cells.length; i += 1) {
    const cell = map.cells[i];
    if (cell !== null && cell !== undefined) {
      if (
        typeof cell.logicalKey !== 'string' ||
        cell.logicalKey.trim() === '' ||
        !Number.isInteger(cell.tileX) ||
        cell.tileX < 0 ||
        !Number.isInteger(cell.tileY) ||
        cell.tileY < 0
      ) {
        throw new BackgroundModelError('invalid-cell-reference', {
          cellIndex: i,
          logicalKey: cell.logicalKey,
          tileX: String(cell.tileX),
          tileY: String(cell.tileY),
        });
      }
    }
  }

  validateBackgroundPaletteAssignments(map.paletteAssignments);
}

/**
 * Creates a default 16x15 palette assignments buffer initialized to subpalette 0.
 */
export function createEmptyBackgroundPaletteAssignments(): Uint8Array {
  return new Uint8Array(BACKGROUND_PALETTE_ASSIGNMENT_COUNT);
}

/**
 * Creates a default 32x30 cell array with 960 empty (`null`) cells.
 */
export function createEmptyBackgroundCells(): (BackgroundMapCell | null)[] {
  return new Array<BackgroundMapCell | null>(BACKGROUND_TILE_COUNT).fill(null);
}

/**
 * Creates a valid, initialized empty BackgroundMapDefinition.
 */
export function createEmptyBackgroundMap(
  options: CreateEmptyBackgroundMapOptions = {},
): BackgroundMapDefinition {
  return {
    id: options.id ?? 'bg_map_default',
    name: options.name ?? 'New Background',
    widthTiles: BACKGROUND_WIDTH_TILES,
    heightTiles: BACKGROUND_HEIGHT_TILES,
    patternTable: options.patternTable ?? 0,
    assetId: options.assetId,
    cells: createEmptyBackgroundCells(),
    paletteAssignments: Array.from(createEmptyBackgroundPaletteAssignments()),
  };
}

/**
 * Packs 16x15 subpalette assignments (240 entries, values 0..3)
 * into exactly 64 bytes of NES Attribute Table format.
 *
 * Hardware Organization:
 * - 64 bytes total (8 rows x 8 columns).
 * - Each byte controls a 32x32 pixel area (4x4 tiles of 8x8).
 * - 4 quadrants per byte (each 16x16 pixels / 2x2 tiles of 8x8):
 *   - Top-Left (TL): bits 0-1
 *   - Top-Right (TR): bits 2-3
 *   - Bottom-Left (BL): bits 4-5
 *   - Bottom-Right (BR): bits 6-7
 * - Bottom padding: For attribute row 7, the visible screen ends at row 14 (240 px),
 *   so quadrant row 15 is outside the screen and padded deterministically with 0.
 */
export function encodeBackgroundAttributeTable(
  paletteAssignments: readonly number[],
): Uint8Array {
  validateBackgroundPaletteAssignments(paletteAssignments);

  const bytes = new Uint8Array(ATTRIBUTE_TABLE_BYTE_COUNT);

  for (
    let attributeRow = 0;
    attributeRow < ATTRIBUTE_TABLE_ROWS;
    attributeRow += 1
  ) {
    for (
      let attributeColumn = 0;
      attributeColumn < ATTRIBUTE_TABLE_COLUMNS;
      attributeColumn += 1
    ) {
      let value = 0;

      for (let quadrantY = 0; quadrantY < 2; quadrantY += 1) {
        for (let quadrantX = 0; quadrantX < 2; quadrantX += 1) {
          const regionColumn = attributeColumn * 2 + quadrantX;
          const regionRow = attributeRow * 2 + quadrantY;

          const paletteIndex =
            regionRow < BACKGROUND_PALETTE_ROWS
              ? (paletteAssignments[
                  regionRow * BACKGROUND_PALETTE_COLUMNS + regionColumn
                ] ?? 0)
              : 0;

          const shift = quadrantY * 4 + quadrantX * 2;
          value |= (paletteIndex & 0x03) << shift;
        }
      }

      bytes[attributeRow * ATTRIBUTE_TABLE_COLUMNS + attributeColumn] = value;
    }
  }

  return bytes;
}

/**
 * Unpacks 64 bytes of NES Attribute Table into a 16x15 grid of subpalette assignments (240 entries).
 */
export function decodeBackgroundAttributeTable(
  attributeTable: Uint8Array,
): Uint8Array {
  if (attributeTable.length !== ATTRIBUTE_TABLE_BYTE_COUNT) {
    throw new BackgroundModelError('invalid-dimensions', {
      length: attributeTable.length,
      expected: ATTRIBUTE_TABLE_BYTE_COUNT,
    });
  }

  const assignments = new Uint8Array(BACKGROUND_PALETTE_ASSIGNMENT_COUNT);

  for (let regionRow = 0; regionRow < BACKGROUND_PALETTE_ROWS; regionRow += 1) {
    for (
      let regionColumn = 0;
      regionColumn < BACKGROUND_PALETTE_COLUMNS;
      regionColumn += 1
    ) {
      const attributeColumn = Math.floor(regionColumn / 2);
      const attributeRow = Math.floor(regionRow / 2);
      const quadrantX = regionColumn % 2;
      const quadrantY = regionRow % 2;

      const attributeByte =
        attributeTable[
          attributeRow * ATTRIBUTE_TABLE_COLUMNS + attributeColumn
        ] ?? 0;
      const shift = quadrantY * 4 + quadrantX * 2;
      assignments[regionRow * BACKGROUND_PALETTE_COLUMNS + regionColumn] =
        (attributeByte >> shift) & 0x03;
    }
  }

  return assignments;
}

/**
 * Pure function to generate a 960-byte physical Nametable buffer from logical map cells
 * using an externally-provided tile index resolution function or fallback.
 */
export function resolveLogicalNametable(
  options: ResolveLogicalNametableOptions,
): Uint8Array {
  validateBackgroundMapDefinition(options.map);

  if (
    options.emptyCellTileIndex !== undefined &&
    (!Number.isInteger(options.emptyCellTileIndex) ||
      options.emptyCellTileIndex < 0 ||
      options.emptyCellTileIndex > 255)
  ) {
    throw new BackgroundModelError('invalid-tile-index', {
      tileIndex: String(options.emptyCellTileIndex),
      reason: 'empty-cell-fallback-out-of-bounds',
    });
  }

  const nametable = new Uint8Array(NAMETABLE_BYTE_COUNT);

  for (let i = 0; i < options.map.cells.length; i += 1) {
    const col = i % BACKGROUND_WIDTH_TILES;
    const row = Math.floor(i / BACKGROUND_WIDTH_TILES);
    const cell = options.map.cells[i];

    if (cell === null || cell === undefined) {
      if (options.emptyCellTileIndex !== undefined) {
        nametable[i] = options.emptyCellTileIndex;
      } else {
        throw new BackgroundModelError('unresolved-logical-tile', {
          cellIndex: i,
          col,
          row,
          reason: 'empty-cell-no-fallback',
        });
      }
      continue;
    }

    const resolved = options.resolver(cell, i, col, row);

    if (resolved === null || resolved === undefined) {
      if (options.emptyCellTileIndex !== undefined) {
        nametable[i] = options.emptyCellTileIndex;
      } else {
        throw new BackgroundModelError('unresolved-logical-tile', {
          cellIndex: i,
          col,
          row,
          logicalKey: cell.logicalKey,
        });
      }
      continue;
    }

    if (!Number.isInteger(resolved) || resolved < 0 || resolved > 255) {
      throw new BackgroundModelError('invalid-tile-index', {
        cellIndex: i,
        col,
        row,
        tileIndex: String(resolved),
      });
    }

    nametable[i] = resolved;
  }

  return nametable;
}

/**
 * Encodes a combined 1024-byte full background map buffer (960 B Nametable + 64 B Attribute Table).
 */
export function encodeFullBackgroundMap(
  nametable: Uint8Array,
  attributeTable: Uint8Array,
): Uint8Array {
  if (nametable.length !== NAMETABLE_BYTE_COUNT) {
    throw new BackgroundModelError('invalid-dimensions', {
      nametableLength: nametable.length,
      expected: NAMETABLE_BYTE_COUNT,
    });
  }
  if (attributeTable.length !== ATTRIBUTE_TABLE_BYTE_COUNT) {
    throw new BackgroundModelError('invalid-dimensions', {
      attributeTableLength: attributeTable.length,
      expected: ATTRIBUTE_TABLE_BYTE_COUNT,
    });
  }

  const fullBuffer = new Uint8Array(FULL_MAP_BUFFER_BYTE_COUNT);
  fullBuffer.set(nametable, 0);
  fullBuffer.set(attributeTable, NAMETABLE_BYTE_COUNT);
  return fullBuffer;
}
