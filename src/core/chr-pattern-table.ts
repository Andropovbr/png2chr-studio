import { decodeChrTile } from './chr-decoder';
import { encodeTile } from './chr-encoder';
import type { Tile } from './types';

export const NES_PATTERN_TABLE_TILE_COUNT = 256;
export const NES_PATTERN_TABLE_SIZE = NES_PATTERN_TABLE_TILE_COUNT * 16;
export const NES_CHR_ROM_TILE_COUNT = NES_PATTERN_TABLE_TILE_COUNT * 2;
export const NES_CHR_ROM_SIZE = NES_CHR_ROM_TILE_COUNT * 16;

export type SpritePatternTable = 0 | 1;
export type PatternTableTileSource = 'destination' | 'imported';

export interface PatternTableSlot {
  readonly physicalTileIndex: number;
  readonly tile: Tile | null;
  readonly source: PatternTableTileSource | null;
}

export interface PatternTableOccupancy {
  readonly patternTable: SpritePatternTable;
  readonly capacityTiles: number;
  readonly occupiedTiles: number;
  readonly freeTiles: number;
}

export interface BaseChrOccupancy {
  readonly fileSizeBytes: number;
  readonly fileTileSlots: number;
  readonly physicalCapacityTiles: number;
  readonly occupiedTiles: number;
  readonly freeTiles: number;
  readonly patternTables: readonly [
    PatternTableOccupancy,
    PatternTableOccupancy,
  ];
}

export function isSpritePatternTable(
  value: number,
): value is SpritePatternTable {
  return value === 0 || value === 1;
}

export function physicalTileIndex(
  patternTable: SpritePatternTable,
  localTileIndex: number,
): number {
  if (
    !Number.isInteger(localTileIndex) ||
    localTileIndex < 0 ||
    localTileIndex >= NES_PATTERN_TABLE_TILE_COUNT
  ) {
    throw new RangeError('Pattern-table tile index must be between 0 and 255.');
  }
  return patternTable * NES_PATTERN_TABLE_TILE_COUNT + localTileIndex;
}

export function localPatternTableTileIndex(physicalIndex: number): number {
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= NES_CHR_ROM_TILE_COUNT
  ) {
    throw new RangeError('Physical CHR tile index must be between 0 and 511.');
  }
  return physicalIndex % NES_PATTERN_TABLE_TILE_COUNT;
}

export function patternTableForPhysicalTile(
  physicalIndex: number,
): SpritePatternTable {
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= NES_CHR_ROM_TILE_COUNT
  ) {
    throw new RangeError('Physical CHR tile index must be between 0 and 511.');
  }
  return physicalIndex < NES_PATTERN_TABLE_TILE_COUNT ? 0 : 1;
}

export function patternTablePhysicalRange(
  patternTable: SpritePatternTable,
): readonly [number, number] {
  const start = patternTable * NES_PATTERN_TABLE_TILE_COUNT;
  return [start, start + NES_PATTERN_TABLE_TILE_COUNT - 1];
}

export interface TileAddressingMetadata {
  readonly physicalIndex: number;
  readonly physicalIndexHex: string;
  readonly localIndex: number;
  readonly localIndexHex: string;
  readonly patternTable: SpritePatternTable;
  readonly patternTableAddress: string;
  readonly patternTableLabel: string;
  readonly tileCol: number;
  readonly tileRow: number;
  readonly startByteOffset: number;
  readonly startByteOffsetHex: string;
  readonly plane0Offset: number;
  readonly plane0OffsetHex: string;
  readonly plane1Offset: number;
  readonly plane1OffsetHex: string;
}

export function tileStartByteOffset(physicalIndex: number): number {
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= NES_CHR_ROM_TILE_COUNT
  ) {
    throw new RangeError('Physical CHR tile index must be between 0 and 511.');
  }
  return physicalIndex * 16;
}

export function tileBitplaneOffsets(physicalIndex: number): {
  readonly plane0: number;
  readonly plane1: number;
} {
  const start = tileStartByteOffset(physicalIndex);
  return {
    plane0: start,
    plane1: start + 8,
  };
}

export function computeTileAddressingMetadata(
  physicalIndex: number,
): TileAddressingMetadata {
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= NES_CHR_ROM_TILE_COUNT
  ) {
    throw new RangeError('Physical CHR tile index must be between 0 and 511.');
  }

  const localIndex = localPatternTableTileIndex(physicalIndex);
  const patternTable = patternTableForPhysicalTile(physicalIndex);
  const tileCol = localIndex % 16;
  const tileRow = Math.floor(localIndex / 16);
  const startByteOffset = physicalIndex * 16;
  const plane0Offset = startByteOffset;
  const plane1Offset = startByteOffset + 8;
  const ptAddress = patternTable === 0 ? '$0000' : '$1000';

  return {
    physicalIndex,
    physicalIndexHex: `$${physicalIndex.toString(16).toUpperCase().padStart(3, '0')}`,
    localIndex,
    localIndexHex: `$${localIndex.toString(16).toUpperCase().padStart(2, '0')}`,
    patternTable,
    patternTableAddress: ptAddress,
    patternTableLabel: `PT${String(patternTable)} (${ptAddress})`,
    tileCol,
    tileRow,
    startByteOffset,
    startByteOffsetHex: `$${startByteOffset.toString(16).toUpperCase().padStart(4, '0')}`,
    plane0Offset,
    plane0OffsetHex: `$${plane0Offset.toString(16).toUpperCase().padStart(4, '0')}`,
    plane1Offset,
    plane1OffsetHex: `$${plane1Offset.toString(16).toUpperCase().padStart(4, '0')}`,
  };
}

function validateBaseChr(baseChr: Uint8Array): void {
  if (baseChr.length % 16 !== 0 || baseChr.length > NES_CHR_ROM_SIZE) {
    throw new RangeError(
      'CHR base must contain at most 8 KiB of complete tiles.',
    );
  }
}

function baseChrPhysicalStart(
  fileTileSlots: number,
  destinationPatternTable: SpritePatternTable,
): number {
  return fileTileSlots <= NES_PATTERN_TABLE_TILE_COUNT
    ? physicalTileIndex(destinationPatternTable, 0)
    : 0;
}

function rawChrTileOccupied(baseChr: Uint8Array, tileIndex: number): boolean {
  const encodedStart = tileIndex * 16;
  return baseChr
    .subarray(encodedStart, encodedStart + 16)
    .some((byte) => byte !== 0);
}

export function createPatternTableSlots(
  baseChr: Uint8Array,
  destinationPatternTable: SpritePatternTable = 0,
): PatternTableSlot[] {
  validateBaseChr(baseChr);
  const fileTileSlots = baseChr.length / 16;
  const slots = Array.from(
    { length: NES_CHR_ROM_TILE_COUNT },
    (_, physicalIndex): PatternTableSlot => ({
      physicalTileIndex: physicalIndex,
      tile: null,
      source: null,
    }),
  );
  const start = baseChrPhysicalStart(fileTileSlots, destinationPatternTable);

  for (let index = 0; index < fileTileSlots; index += 1) {
    const physicalIndex = start + index;
    const slot = slots[physicalIndex];
    if (slot === undefined) {
      throw new RangeError('CHR base does not fit in the physical CHR-ROM.');
    }
    // Raw CHR files have no ownership metadata. Until managed projects can
    // express reservations, a sixteen-byte zero tile is the fallback marker
    // for a free slot. Its physical index remains untouched.
    if (!rawChrTileOccupied(baseChr, index)) continue;
    const encodedStart = index * 16;
    const tile = decodeChrTile(
      baseChr.subarray(encodedStart, encodedStart + 16),
      index,
      index % 16,
      Math.floor(index / 16),
    );
    slots[physicalIndex] = {
      physicalTileIndex: physicalIndex,
      tile: { ...tile, id: physicalIndex },
      source: 'destination',
    };
  }
  return slots;
}

function summarizePatternTableOccupancy(
  patternTable: SpritePatternTable,
  occupiedTiles: number,
): PatternTableOccupancy {
  return {
    patternTable,
    capacityTiles: NES_PATTERN_TABLE_TILE_COUNT,
    occupiedTiles,
    freeTiles: NES_PATTERN_TABLE_TILE_COUNT - occupiedTiles,
  };
}

export function analyzeBaseChrOccupancy(
  baseChr: Uint8Array,
  destinationPatternTable: SpritePatternTable = 0,
): BaseChrOccupancy {
  validateBaseChr(baseChr);
  const fileTileSlots = baseChr.length / 16;
  const start = baseChrPhysicalStart(fileTileSlots, destinationPatternTable);
  const occupiedByPatternTable: [number, number] = [0, 0];
  for (let index = 0; index < fileTileSlots; index += 1) {
    if (!rawChrTileOccupied(baseChr, index)) continue;
    const patternTable = patternTableForPhysicalTile(start + index);
    occupiedByPatternTable[patternTable] += 1;
  }
  const patternTable0 = summarizePatternTableOccupancy(
    0,
    occupiedByPatternTable[0],
  );
  const patternTable1 = summarizePatternTableOccupancy(
    1,
    occupiedByPatternTable[1],
  );
  const occupiedTiles =
    patternTable0.occupiedTiles + patternTable1.occupiedTiles;
  return {
    fileSizeBytes: baseChr.length,
    fileTileSlots,
    physicalCapacityTiles: NES_CHR_ROM_TILE_COUNT,
    occupiedTiles,
    freeTiles: NES_CHR_ROM_TILE_COUNT - occupiedTiles,
    patternTables: [patternTable0, patternTable1],
  };
}

export function encodePatternTableSlots(
  slots: readonly PatternTableSlot[],
): Uint8Array {
  if (slots.length !== NES_CHR_ROM_TILE_COUNT) {
    throw new RangeError('A complete NES CHR-ROM has exactly 512 tile slots.');
  }
  const bytes = new Uint8Array(NES_CHR_ROM_SIZE);
  slots.forEach((slot, physicalIndex) => {
    if (slot.tile !== null) {
      bytes.set(encodeTile(slot.tile), physicalIndex * 16);
    }
  });
  return bytes;
}
