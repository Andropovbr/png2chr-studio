import { describe, expect, it } from 'vitest';

import { encodeChr } from './chr-encoder';
import {
  createPatternTableSlots,
  encodePatternTableSlots,
  localPatternTableTileIndex,
  NES_CHR_ROM_SIZE,
  patternTableForPhysicalTile,
  patternTablePhysicalRange,
  physicalTileIndex,
} from './chr-pattern-table';
import type { Tile } from './types';

function tile(value: number): Tile {
  return {
    id: 0,
    column: 0,
    row: 0,
    pixels: new Uint8Array(64).fill(value),
  };
}

describe('NES sprite pattern tables', () => {
  it.each([
    [0, 0, 0],
    [0, 255, 255],
    [1, 0, 256],
    [1, 255, 511],
  ] as const)(
    'maps pattern table %i local tile %i to physical tile %i',
    (patternTable, localIndex, expectedPhysicalIndex) => {
      expect(physicalTileIndex(patternTable, localIndex)).toBe(
        expectedPhysicalIndex,
      );
      expect(localPatternTableTileIndex(expectedPhysicalIndex)).toBe(
        localIndex,
      );
      expect(patternTableForPhysicalTile(expectedPhysicalIndex)).toBe(
        patternTable,
      );
    },
  );

  it('defines two independent physical ranges', () => {
    expect(patternTablePhysicalRange(0)).toEqual([0, 255]);
    expect(patternTablePhysicalRange(1)).toEqual([256, 511]);
  });

  it('places a 4 KiB base CHR in the configured pattern table', () => {
    const base = encodeChr(Array.from({ length: 256 }, () => tile(1)));
    const slots = createPatternTableSlots(base, 1);

    expect(slots[0]?.tile).toBeNull();
    expect(slots[255]?.tile).toBeNull();
    expect(slots[256]?.source).toBe('destination');
    expect(slots[511]?.source).toBe('destination');
  });

  it('preserves physical positions when encoding all 512 CHR slots', () => {
    const base = encodeChr([tile(1)]);
    const slots = createPatternTableSlots(base, 1);
    const chr = encodePatternTableSlots(slots);

    expect(chr).toHaveLength(NES_CHR_ROM_SIZE);
    expect(chr.slice(0, 16)).toEqual(new Uint8Array(16));
    expect(chr.slice(256 * 16, 257 * 16)).toEqual(base);
  });
});
