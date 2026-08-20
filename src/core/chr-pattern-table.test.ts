import { describe, expect, it } from 'vitest';

import { encodeChr } from './chr-encoder';
import {
  analyzeBaseChrOccupancy,
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

  it('reports 14 occupied slots in an otherwise zero-filled 8 KiB CHR', () => {
    const base = new Uint8Array(NES_CHR_ROM_SIZE);
    for (let tileIndex = 0; tileIndex < 14; tileIndex += 1) {
      base[tileIndex * 16] = tileIndex + 1;
    }

    expect(analyzeBaseChrOccupancy(base)).toEqual({
      fileSizeBytes: 8192,
      fileTileSlots: 512,
      physicalCapacityTiles: 512,
      occupiedTiles: 14,
      freeTiles: 498,
      patternTables: [
        {
          patternTable: 0,
          capacityTiles: 256,
          occupiedTiles: 14,
          freeTiles: 242,
        },
        {
          patternTable: 1,
          capacityTiles: 256,
          occupiedTiles: 0,
          freeTiles: 256,
        },
      ],
    });
  });

  it('reports every slot occupied in a completely non-zero 8 KiB CHR', () => {
    const occupancy = analyzeBaseChrOccupancy(
      new Uint8Array(NES_CHR_ROM_SIZE).fill(0xff),
    );

    expect(occupancy).toMatchObject({
      occupiedTiles: 512,
      freeTiles: 0,
      patternTables: [
        { patternTable: 0, occupiedTiles: 256, freeTiles: 0 },
        { patternTable: 1, occupiedTiles: 256, freeTiles: 0 },
      ],
    });
  });

  it('reports every slot free in a zero-filled 8 KiB CHR', () => {
    const occupancy = analyzeBaseChrOccupancy(new Uint8Array(NES_CHR_ROM_SIZE));

    expect(occupancy).toMatchObject({
      occupiedTiles: 0,
      freeTiles: 512,
      patternTables: [
        { patternTable: 0, occupiedTiles: 0, freeTiles: 256 },
        { patternTable: 1, occupiedTiles: 0, freeTiles: 256 },
      ],
    });
  });

  it('tracks occupancy in pattern table 1 independently', () => {
    const base = new Uint8Array(NES_CHR_ROM_SIZE);
    for (let localIndex = 0; localIndex < 14; localIndex += 1) {
      base[(256 + localIndex) * 16] = localIndex + 1;
    }

    expect(analyzeBaseChrOccupancy(base).patternTables).toMatchObject([
      { patternTable: 0, occupiedTiles: 0, freeTiles: 256 },
      { patternTable: 1, occupiedTiles: 14, freeTiles: 242 },
    ]);
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
