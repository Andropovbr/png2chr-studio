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
  tileBitplaneOffsets,
  tileStartByteOffset,
  computeTileAddressingMetadata,
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

  describe('tile addressing and byte offset calculations', () => {
    it('calculates start byte offset for tiles in PT0 and PT1', () => {
      expect(tileStartByteOffset(0)).toBe(0x0000);
      expect(tileStartByteOffset(1)).toBe(0x0010);
      expect(tileStartByteOffset(255)).toBe(0x0ff0);
      expect(tileStartByteOffset(256)).toBe(0x1000);
      expect(tileStartByteOffset(511)).toBe(0x1ff0);
    });

    it('calculates bitplane 0 and bitplane 1 byte offsets', () => {
      expect(tileBitplaneOffsets(0)).toEqual({ plane0: 0, plane1: 8 });
      expect(tileBitplaneOffsets(1)).toEqual({ plane0: 16, plane1: 24 });
      expect(tileBitplaneOffsets(256)).toEqual({ plane0: 4096, plane1: 4104 });
      expect(tileBitplaneOffsets(511)).toEqual({ plane0: 8176, plane1: 8184 });
    });

    it('computes complete tile addressing metadata matching NES PPU specifications', () => {
      const meta0 = computeTileAddressingMetadata(0);
      expect(meta0).toEqual({
        physicalIndex: 0,
        physicalIndexHex: '$000',
        localIndex: 0,
        localIndexHex: '$00',
        patternTable: 0,
        patternTableAddress: '$0000',
        patternTableLabel: 'PT0 ($0000)',
        tileCol: 0,
        tileRow: 0,
        startByteOffset: 0,
        startByteOffsetHex: '$0000',
        plane0Offset: 0,
        plane0OffsetHex: '$0000',
        plane1Offset: 8,
        plane1OffsetHex: '$0008',
      });

      const meta26 = computeTileAddressingMetadata(26);
      expect(meta26).toEqual({
        physicalIndex: 26,
        physicalIndexHex: '$01A',
        localIndex: 26,
        localIndexHex: '$1A',
        patternTable: 0,
        patternTableAddress: '$0000',
        patternTableLabel: 'PT0 ($0000)',
        tileCol: 10,
        tileRow: 1,
        startByteOffset: 416,
        startByteOffsetHex: '$01A0',
        plane0Offset: 416,
        plane0OffsetHex: '$01A0',
        plane1Offset: 424,
        plane1OffsetHex: '$01A8',
      });

      const meta256 = computeTileAddressingMetadata(256);
      expect(meta256).toEqual({
        physicalIndex: 256,
        physicalIndexHex: '$100',
        localIndex: 0,
        localIndexHex: '$00',
        patternTable: 1,
        patternTableAddress: '$1000',
        patternTableLabel: 'PT1 ($1000)',
        tileCol: 0,
        tileRow: 0,
        startByteOffset: 4096,
        startByteOffsetHex: '$1000',
        plane0Offset: 4096,
        plane0OffsetHex: '$1000',
        plane1Offset: 4104,
        plane1OffsetHex: '$1008',
      });

      const meta511 = computeTileAddressingMetadata(511);
      expect(meta511).toEqual({
        physicalIndex: 511,
        physicalIndexHex: '$1FF',
        localIndex: 255,
        localIndexHex: '$FF',
        patternTable: 1,
        patternTableAddress: '$1000',
        patternTableLabel: 'PT1 ($1000)',
        tileCol: 15,
        tileRow: 15,
        startByteOffset: 8176,
        startByteOffsetHex: '$1FF0',
        plane0Offset: 8176,
        plane0OffsetHex: '$1FF0',
        plane1Offset: 8184,
        plane1OffsetHex: '$1FF8',
      });
    });

    it('rejects out of range indices for all tile calculation utilities', () => {
      expect(() => tileStartByteOffset(-1)).toThrow(RangeError);
      expect(() => tileStartByteOffset(512)).toThrow(RangeError);
      expect(() => tileBitplaneOffsets(-1)).toThrow(RangeError);
      expect(() => tileBitplaneOffsets(512)).toThrow(RangeError);
      expect(() => computeTileAddressingMetadata(-1)).toThrow(RangeError);
      expect(() => computeTileAddressingMetadata(512)).toThrow(RangeError);
      expect(() => computeTileAddressingMetadata(1.5)).toThrow(RangeError);
    });
  });
});
