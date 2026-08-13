import { decodeChr } from './chr-decoder';
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

export function createPatternTableSlots(
  baseChr: Uint8Array,
  destinationPatternTable: SpritePatternTable = 0,
): PatternTableSlot[] {
  if (baseChr.length % 16 !== 0 || baseChr.length > NES_CHR_ROM_SIZE) {
    throw new RangeError(
      'CHR base must contain at most 8 KiB of complete tiles.',
    );
  }
  const baseTiles = baseChr.length === 0 ? [] : decodeChr(baseChr);
  const slots = Array.from(
    { length: NES_CHR_ROM_TILE_COUNT },
    (_, physicalIndex): PatternTableSlot => ({
      physicalTileIndex: physicalIndex,
      tile: null,
      source: null,
    }),
  );
  const start =
    baseTiles.length <= NES_PATTERN_TABLE_TILE_COUNT
      ? physicalTileIndex(destinationPatternTable, 0)
      : 0;

  baseTiles.forEach((tile, index) => {
    const physicalIndex = start + index;
    const slot = slots[physicalIndex];
    if (slot === undefined) {
      throw new RangeError('CHR base does not fit in the physical CHR-ROM.');
    }
    slots[physicalIndex] = {
      physicalTileIndex: physicalIndex,
      tile: { ...tile, id: physicalIndex },
      source: 'destination',
    };
  });
  return slots;
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
