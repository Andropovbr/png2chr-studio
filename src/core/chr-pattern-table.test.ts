import { describe, expect, it } from 'vitest';

import type { AnimationProjectModel } from './animation-model';
import { encodeChr, encodeTile } from './chr-encoder';
import {
  analyzeBaseChrOccupancy,
  classifyChrSlots,
  classifyHeatmapBucket,
  calculateTileUsageDiagnostics,
  calculateChrUsageHeatmapSummary,
  collectAnimationPhysicalTileUsage,
  collectChrHighlightTileIndices,
  collectEntityPhysicalTileUsage,
  collectFramePhysicalTileUsage,
  collectPhysicalTileReferences,
  buildPhysicalTileReferenceIndex,
  composeChrWithAllocatedTiles,
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
  validateChrRegion,
  chrRegionPhysicalRange,
  isPhysicalTileInRegion,
  isLocalTileInRegion,
  doChrRegionsOverlap,
  getChrRegionOverlapRange,
  findChrRegionOverlaps,
  collectReservedPhysicalTileIndices,
  collectReservedLocalTileIndices,
  isChrSlotAvailableForAllocation,
  findNextAvailableChrSlot,
  formatTileIndexHex,
  formatTileRangeHex,
  formatConsecutiveTileRanges,
  calculatePatternTableCapacity,
  calculateChrRegionCapacity,
  analyzeChrRegionDiagnostics,
  findChrRegionsForPhysicalTile,
  findChrRegionsForLocalTile,
  sanitizeRegionColor,
  buildChrSlotRegionIndex,
  type ChrRegion,
  type ChrSlotClassification,
  type PatternTableSlot,
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

  it('preserves a materialized PT1 slot while allocating derived tiles into free slots', () => {
    const base = new Uint8Array(NES_CHR_ROM_SIZE);
    base[256 * 16] = 0x80;

    const composed = composeChrWithAllocatedTiles(base, 0, [tile(2)]);

    expect(composed).toHaveLength(NES_CHR_ROM_SIZE);
    expect(composed[256 * 16]).toBe(0x80);
    expect(composed.subarray(0, 16).some((byte) => byte !== 0)).toBe(true);
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

  describe('classifyChrSlots', () => {
    it('classifies all 512 slots as empty when project has no tiles or base CHR', () => {
      const slots = classifyChrSlots({ mode: 'tileset', tiles: [] });
      expect(slots).toHaveLength(512);
      expect(slots.every((s) => s.occupancy === 'empty')).toBe(true);
      expect(slots[0]?.localIndex).toBe(0);
      expect(slots[0]?.patternTable).toBe(0);
      expect(slots[256]?.localIndex).toBe(0);
      expect(slots[256]?.patternTable).toBe(1);
    });

    it('classifies an intentionally allocated blank tile (16 zero bytes) as project, NOT empty', () => {
      const blankTile: Tile = {
        id: 0,
        column: 0,
        row: 0,
        pixels: new Uint8Array(64).fill(0), // all zero pixels = 16 zero bytes in 2bpp
      };

      const slots = classifyChrSlots({
        mode: 'tileset',
        tiles: [blankTile],
      });

      expect(slots).toHaveLength(512);
      // Slot 0 is allocated for the project
      expect(slots[0]?.occupancy).toBe('project');
      expect(slots[0]?.attribution).toContain('Tile #0');
      // Slots 1..511 are unallocated free slots
      expect(slots.slice(1).every((s) => s.occupancy === 'empty')).toBe(true);
    });

    it('accurately distinguishes Base CHR slots from inserted project tiles', () => {
      const baseChr = new Uint8Array(4096);
      baseChr[0] = 0x55; // slot 0 in PT1 has data
      baseChr[16] = 0xaa; // slot 1 in PT1 has data

      const projectTile: Tile = {
        id: 0,
        column: 1,
        row: 1,
        pixels: new Uint8Array(64).fill(2),
      };

      const slots = classifyChrSlots({
        mode: 'tileset',
        baseChr,
        baseChrName: 'custom_base.chr',
        destinationPatternTable: 1,
        tiles: [projectTile],
      });

      // PT0: Slot 0 receives the imported project tile
      expect(slots[0]?.occupancy).toBe('project');
      expect(slots[0]?.patternTable).toBe(0);
      // Other slots in PT0 are empty
      expect(slots.slice(1, 256).every((s) => s.occupancy === 'empty')).toBe(
        true,
      );

      // PT1: Slots 256 and 257 contain base CHR data
      expect(slots[256]?.occupancy).toBe('base');
      expect(slots[256]?.attribution).toContain('custom_base.chr');
      expect(slots[257]?.occupancy).toBe('base');
      expect(slots[257]?.attribution).toContain('custom_base.chr');

      // Rest of PT1 is empty
      expect(slots.slice(258, 512).every((s) => s.occupancy === 'empty')).toBe(
        true,
      );
    });

    it('classifies frame-referenced tiles in animation mode with frame attribution', () => {
      const animationModel = {
        animations: [
          {
            name: 'walk',
            frames: [
              {
                sprites: [{ physicalTileIndex: 4 }, { physicalTileIndex: 5 }],
              },
              {
                sprites: [{ physicalTileIndex: 5 }, { physicalTileIndex: 6 }],
              },
            ],
          },
        ],
      };

      const slots = classifyChrSlots({
        mode: 'animation',
        animationModel,
      });

      expect(slots[4]?.occupancy).toBe('project');
      expect(slots[4]?.attribution).toBe('walk (#0)');

      expect(slots[5]?.occupancy).toBe('project');
      expect(slots[5]?.attribution).toBe('walk (#0), walk (#1)');

      expect(slots[6]?.occupancy).toBe('project');
      expect(slots[6]?.attribution).toBe('walk (#1)');

      expect(slots[0]?.occupancy).toBe('empty');
      expect(slots[7]?.occupancy).toBe('empty');
    });
  });

  describe('collectFramePhysicalTileUsage', () => {
    it('returns empty set when animation model or animations are missing', () => {
      expect(collectFramePhysicalTileUsage(null)).toEqual(new Set());
      expect(collectFramePhysicalTileUsage({ animations: [] })).toEqual(
        new Set(),
      );
    });

    it('collects unique physical tile indexes from a frame and handles duplicate/flipped sprite references', () => {
      const animationModel = {
        animations: [
          {
            id: 'anim-1',
            name: 'Hero_walk',
            frames: [
              {
                sprites: [
                  { physicalTileIndex: 5 },
                  { physicalTileIndex: 6 },
                  { physicalTileIndex: 5 }, // duplicate (e.g. reused or H-flipped)
                  { physicalTileIndex: 260 }, // PT1 physical tile
                ],
              },
            ],
          },
        ],
      };

      const result = collectFramePhysicalTileUsage(animationModel, 'anim-1', 0);
      expect(result).toEqual(new Set([5, 6, 260]));
      expect(result.size).toBe(3);
    });

    it('gracefully handles out-of-range frame index by defaulting or returning empty set', () => {
      const animationModel = {
        animations: [
          {
            id: 'anim-1',
            name: 'Hero_walk',
            frames: [
              {
                sprites: [{ physicalTileIndex: 10 }],
              },
            ],
          },
        ],
      };

      expect(
        collectFramePhysicalTileUsage(animationModel, 'anim-1', 99),
      ).toEqual(new Set());
    });
  });

  describe('collectAnimationPhysicalTileUsage', () => {
    it('collects the union of all physical tiles across multiple frames of an animation', () => {
      const animationModel = {
        animations: [
          {
            id: 'anim-walk',
            name: 'Hero_walk',
            frames: [
              {
                sprites: [
                  { physicalTileIndex: 1 },
                  { physicalTileIndex: 2 },
                  { physicalTileIndex: 3 },
                ],
              },
              {
                sprites: [
                  { physicalTileIndex: 2 },
                  { physicalTileIndex: 3 },
                  { physicalTileIndex: 4 },
                ],
              },
            ],
          },
        ],
      };

      const result = collectAnimationPhysicalTileUsage(
        animationModel,
        'anim-walk',
      );
      expect(result).toEqual(new Set([1, 2, 3, 4]));
      expect(result.size).toBe(4);
    });
  });

  describe('collectEntityPhysicalTileUsage', () => {
    it('collects union across animations belonging to the same entity and isolates other entities', () => {
      const animationModel = {
        animations: [
          {
            id: 'hero-walk',
            name: 'Hero_walk',
            entity: 'Hero',
            frames: [
              {
                sprites: [{ physicalTileIndex: 10 }, { physicalTileIndex: 11 }],
              },
            ],
          },
          {
            id: 'hero-attack',
            name: 'Hero_attack',
            entity: 'Hero',
            frames: [
              {
                sprites: [{ physicalTileIndex: 11 }, { physicalTileIndex: 12 }],
              },
            ],
          },
          {
            id: 'bat-fly',
            name: 'Bat_fly',
            entity: 'Bat',
            frames: [
              {
                sprites: [{ physicalTileIndex: 50 }, { physicalTileIndex: 51 }],
              },
            ],
          },
        ],
      };

      const heroResult = collectEntityPhysicalTileUsage(animationModel, 'Hero');
      expect(heroResult).toEqual(new Set([10, 11, 12]));

      const batResult = collectEntityPhysicalTileUsage(animationModel, 'Bat');
      expect(batResult).toEqual(new Set([50, 51]));
    });
  });

  describe('collectChrHighlightTileIndices', () => {
    it('returns empty set for scope "none"', () => {
      expect(collectChrHighlightTileIndices({ scope: 'none' })).toEqual(
        new Set(),
      );
    });

    it('collects base and project slots from classifications for "base" and "all" scopes', () => {
      const classifications = [
        {
          physicalIndex: 0,
          localIndex: 0,
          patternTable: 0 as const,
          occupancy: 'project' as const,
        },
        {
          physicalIndex: 1,
          localIndex: 1,
          patternTable: 0 as const,
          occupancy: 'base' as const,
        },
        {
          physicalIndex: 2,
          localIndex: 2,
          patternTable: 0 as const,
          occupancy: 'empty' as const,
        },
      ];

      expect(
        collectChrHighlightTileIndices({
          scope: 'base',
          classifications,
        }),
      ).toEqual(new Set([1]));

      expect(
        collectChrHighlightTileIndices({
          scope: 'all',
          classifications,
        }),
      ).toEqual(new Set([0]));
    });
  });

  describe('collectPhysicalTileReferences and buildPhysicalTileReferenceIndex', () => {
    const animationModel = {
      animations: [
        {
          id: 'hero-walk',
          name: 'Hero_walk',
          entity: 'Hero',
          frames: [
            {
              sprites: [
                {
                  physicalTileIndex: 5,
                  tile: 5,
                  x: 0,
                  y: 0,
                  horizontalFlip: false,
                  verticalFlip: false,
                },
                {
                  physicalTileIndex: 6,
                  tile: 6,
                  x: 8,
                  y: 0,
                  horizontalFlip: false,
                  verticalFlip: false,
                },
              ],
            },
            {
              sprites: [
                {
                  physicalTileIndex: 5,
                  tile: 5,
                  x: 8,
                  y: 16,
                  horizontalFlip: true,
                  verticalFlip: false,
                },
                {
                  physicalTileIndex: 260,
                  tile: 4,
                  x: 0,
                  y: 16,
                  horizontalFlip: false,
                  verticalFlip: false,
                },
              ],
            },
          ],
        },
        {
          id: 'hero-attack',
          name: 'Hero_attack',
          entity: 'Hero',
          frames: [
            {
              sprites: [
                {
                  physicalTileIndex: 5,
                  tile: 5,
                  x: 0,
                  y: 0,
                  horizontalFlip: false,
                  verticalFlip: false,
                },
              ],
            },
          ],
        },
      ],
    } as unknown as AnimationProjectModel;

    it('collects all logical animation references to a shared physical tile across frames and animations', () => {
      const refs = collectPhysicalTileReferences({
        physicalTileIndex: 5,
        animationModel,
      });

      expect(refs.length).toBe(3);
      expect(refs[0]).toEqual({
        type: 'animation',
        entity: 'Hero',
        animationId: 'hero-walk',
        animationName: 'Hero_walk',
        frameIndex: 0,
        spriteIndex: 0,
        x: 0,
        y: 0,
        horizontalFlip: false,
        verticalFlip: false,
        physicalTileIndex: 5,
      });
      expect(refs[1]).toEqual({
        type: 'animation',
        entity: 'Hero',
        animationId: 'hero-walk',
        animationName: 'Hero_walk',
        frameIndex: 1,
        spriteIndex: 0,
        x: 8,
        y: 16,
        horizontalFlip: true,
        verticalFlip: false,
        physicalTileIndex: 5,
      });
      expect(refs[2]).toEqual({
        type: 'animation',
        entity: 'Hero',
        animationId: 'hero-attack',
        animationName: 'Hero_attack',
        frameIndex: 0,
        spriteIndex: 0,
        x: 0,
        y: 0,
        horizontalFlip: false,
        verticalFlip: false,
        physicalTileIndex: 5,
      });
    });

    it('collects PT1 physical tile references (>= 256) correctly', () => {
      const refs = collectPhysicalTileReferences({
        physicalTileIndex: 260,
        animationModel,
      });

      expect(refs.length).toBe(1);
      expect(refs[0]).toEqual({
        type: 'animation',
        entity: 'Hero',
        animationId: 'hero-walk',
        animationName: 'Hero_walk',
        frameIndex: 1,
        spriteIndex: 1,
        x: 0,
        y: 16,
        horizontalFlip: false,
        verticalFlip: false,
        physicalTileIndex: 260,
      });
    });

    it('returns empty array for an unreferenced or out-of-range physical tile', () => {
      expect(
        collectPhysicalTileReferences({
          physicalTileIndex: 100,
          animationModel,
        }),
      ).toEqual([]);

      expect(
        collectPhysicalTileReferences({
          physicalTileIndex: 999,
          animationModel,
        }),
      ).toEqual([]);
    });

    it('collects playfield nametable cell references', () => {
      const nametable = new Uint8Array(960);
      nametable[0] = 10; // (0,0) -> tile 10
      nametable[33] = 10; // (1,1) -> tile 10
      nametable[100] = 20;

      const refs = collectPhysicalTileReferences({
        physicalTileIndex: 10,
        mode: 'playfield',
        playfieldNametable: nametable,
        destinationPatternTable: 0,
      });

      expect(refs.length).toBe(2);
      expect(refs[0]).toEqual({
        type: 'playfield',
        column: 0,
        row: 0,
        nametableIndex: 0,
        tileIndex: 10,
        physicalTileIndex: 10,
      });
      expect(refs[1]).toEqual({
        type: 'playfield',
        column: 1,
        row: 1,
        nametableIndex: 33,
        tileIndex: 10,
        physicalTileIndex: 10,
      });
    });

    it('builds a full physical tile reference index map', () => {
      const index = buildPhysicalTileReferenceIndex({
        animationModel,
      });

      expect(index.get(5)?.length).toBe(3);
      expect(index.get(6)?.length).toBe(1);
      expect(index.get(260)?.length).toBe(1);
      expect(index.get(99)).toBeUndefined();
    });
  });

  describe('classifyHeatmapBucket', () => {
    it('classifies reference counts into discrete predictable buckets', () => {
      expect(classifyHeatmapBucket(0)).toBe('unused');
      expect(classifyHeatmapBucket(-1)).toBe('unused');
      expect(classifyHeatmapBucket(1)).toBe('single');
      expect(classifyHeatmapBucket(2)).toBe('moderate');
      expect(classifyHeatmapBucket(3)).toBe('moderate');
      expect(classifyHeatmapBucket(4)).toBe('high');
      expect(classifyHeatmapBucket(7)).toBe('high');
      expect(classifyHeatmapBucket(8)).toBe('very-high');
      expect(classifyHeatmapBucket(50)).toBe('very-high');
    });
  });

  describe('calculateTileUsageDiagnostics and calculateChrUsageHeatmapSummary', () => {
    const complexAnimationModel = {
      animations: [
        {
          id: 'hero-walk',
          name: 'Hero_walk',
          entity: 'Hero',
          frames: [
            {
              sprites: [
                {
                  physicalTileIndex: 12,
                  tile: 12,
                  x: 0,
                  y: 0,
                  horizontalFlip: false,
                  verticalFlip: false,
                },
                {
                  physicalTileIndex: 12, // same frame, second occurrence!
                  tile: 12,
                  x: 8,
                  y: 0,
                  horizontalFlip: true,
                  verticalFlip: false,
                },
                {
                  physicalTileIndex: 15,
                  tile: 15,
                  x: 0,
                  y: 8,
                  horizontalFlip: false,
                  verticalFlip: false,
                },
              ],
            },
            {
              sprites: [
                {
                  physicalTileIndex: 12, // second frame
                  tile: 12,
                  x: 0,
                  y: 0,
                  horizontalFlip: false,
                  verticalFlip: false,
                },
              ],
            },
          ],
        },
        {
          id: 'enemy-walk',
          name: 'Enemy_walk',
          entity: 'Enemy',
          frames: [
            {
              sprites: [
                {
                  physicalTileIndex: 12, // shared tile across entities!
                  tile: 12,
                  x: 0,
                  y: 0,
                  horizontalFlip: false,
                  verticalFlip: false,
                },
                {
                  physicalTileIndex: 268, // PT1 tile ($1000 + 12 = physical 268)
                  tile: 12,
                  x: 8,
                  y: 0,
                  horizontalFlip: false,
                  verticalFlip: false,
                },
              ],
            },
          ],
        },
      ],
    } as unknown as AnimationProjectModel;

    it('derives accurate reference counts, frame counts, animation counts, and entity counts', () => {
      const diagnostics = calculateTileUsageDiagnostics({
        animationModel: complexAnimationModel,
      });

      expect(diagnostics.length).toBe(512);

      // Tile 12 is used 4 times total:
      // Hero_walk frame 0 (2 times)
      // Hero_walk frame 1 (1 time)
      // Enemy_walk frame 0 (1 time)
      const tile12 = diagnostics[12];
      expect(tile12).toBeDefined();
      expect(tile12?.referenceCount).toBe(4);
      expect(tile12?.frameCount).toBe(3); // 3 distinct (anim, frame) pairs
      expect(tile12?.animationCount).toBe(2); // Hero_walk, Enemy_walk
      expect(tile12?.entityCount).toBe(2); // Hero, Enemy
      expect(tile12?.resourceCount).toBe(2);
      expect(tile12?.bucket).toBe('high'); // 4 refs -> 'high'

      // Tile 15 is used once in Hero_walk
      const tile15 = diagnostics[15];
      expect(tile15?.referenceCount).toBe(1);
      expect(tile15?.frameCount).toBe(1);
      expect(tile15?.animationCount).toBe(1);
      expect(tile15?.entityCount).toBe(1);
      expect(tile15?.bucket).toBe('single');

      // Tile 268 is in PT1 (independent of PT0 tile 12!)
      const tile268 = diagnostics[268];
      expect(tile268?.referenceCount).toBe(1);
      expect(tile268?.animationCount).toBe(1);
      expect(tile268?.bucket).toBe('single');

      // Tile 0 is unreferenced
      const tile0 = diagnostics[0];
      expect(tile0?.referenceCount).toBe(0);
      expect(tile0?.frameCount).toBe(0);
      expect(tile0?.bucket).toBe('unused');
    });

    it('calculates comprehensive project reuse summary metrics', () => {
      const diagnostics = calculateTileUsageDiagnostics({
        animationModel: complexAnimationModel,
      });

      // Classify slots to verify unreferenced occupied tiles
      const mockClassifications: ChrSlotClassification[] = Array.from(
        { length: 512 },
        (_, i) => ({
          physicalIndex: i,
          localIndex: i % 256,
          patternTable: i < 256 ? 0 : 1,
          occupancy:
            i === 12 || i === 15 || i === 268 || i === 50 ? 'project' : 'empty',
        }),
      );

      const summary = calculateChrUsageHeatmapSummary(
        diagnostics,
        mockClassifications,
      );

      // Tile 12 (4 refs) + Tile 15 (1 ref) + Tile 268 (1 ref) = 6 total references
      expect(summary.totalReferences).toBe(6);
      expect(summary.referencedTileCount).toBe(3);
      expect(summary.reusedTileCount).toBe(1); // tile 12 (4 refs >= 2)
      expect(summary.unreferencedOccupiedTileCount).toBe(1); // tile 50 is project occupied but has 0 refs!
      expect(summary.maxReferenceCount).toBe(4);
      expect(summary.mostReferencedTileIndex).toBe(12);
      expect(summary.averageReuseRatio).toBe(2); // 6 / 3 = 2.0
    });
  });

  describe('ChrRegion domain model and validation', () => {
    it('validates a correct organizational region on PT0', () => {
      const result = validateChrRegion({
        id: 'reg-player',
        name: 'Player Sprites',
        patternTable: 0,
        startTile: 0,
        endTile: 31,
        kind: 'region',
        notes: 'Main player animation frames',
        color: '#00E5FF',
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.region).toEqual({
          id: 'reg-player',
          name: 'Player Sprites',
          patternTable: 0,
          startTile: 0,
          endTile: 31,
          kind: 'region',
          notes: 'Main player animation frames',
          color: '#00E5FF',
        });
      }
    });

    it('validates a correct reservation on PT1 with full table range $00..$FF', () => {
      const result = validateChrRegion({
        id: 'res-dynamic',
        name: 'Dynamic Effects Bank',
        patternTable: 1,
        startTile: 0,
        endTile: 255,
        kind: 'reservation',
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.region.patternTable).toBe(1);
        expect(result.region.startTile).toBe(0);
        expect(result.region.endTile).toBe(255);
        expect(result.region.kind).toBe('reservation');
      }
    });

    it('validates single-tile boundary regions at $00 and $FF', () => {
      const firstTile = validateChrRegion({
        id: 'reg-0',
        name: 'Zero Tile',
        patternTable: 0,
        startTile: 0,
        endTile: 0,
        kind: 'region',
      });
      expect(firstTile.valid).toBe(true);

      const lastTile = validateChrRegion({
        id: 'reg-255',
        name: 'Last Tile',
        patternTable: 1,
        startTile: 255,
        endTile: 255,
        kind: 'reservation',
      });
      expect(lastTile.valid).toBe(true);
    });

    it('trims whitespace on id and name', () => {
      const result = validateChrRegion({
        id: '  reg-trimmed  ',
        name: '   Trimmed Name   ',
        patternTable: 0,
        startTile: 10,
        endTile: 20,
        kind: 'region',
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.region.id).toBe('reg-trimmed');
        expect(result.region.name).toBe('Trimmed Name');
      }
    });

    it('rejects invalid inputs and returns descriptive validation errors', () => {
      // Non-object
      expect(validateChrRegion(null).valid).toBe(false);
      expect(validateChrRegion('not-an-object').valid).toBe(false);
      expect(validateChrRegion([]).valid).toBe(false);

      // Empty id
      const emptyId = validateChrRegion({
        id: '   ',
        name: 'Name',
        patternTable: 0,
        startTile: 0,
        endTile: 10,
        kind: 'region',
      });
      expect(emptyId.valid).toBe(false);
      if (!emptyId.valid) {
        expect(emptyId.errors.some((e) => e.field === 'id')).toBe(true);
      }

      // Empty name
      const emptyName = validateChrRegion({
        id: 'reg-1',
        name: '',
        patternTable: 0,
        startTile: 0,
        endTile: 10,
        kind: 'region',
      });
      expect(emptyName.valid).toBe(false);
      if (!emptyName.valid) {
        expect(emptyName.errors.some((e) => e.field === 'name')).toBe(true);
      }

      // Invalid pattern table
      const invalidPt = validateChrRegion({
        id: 'reg-1',
        name: 'Name',
        patternTable: 2,
        startTile: 0,
        endTile: 10,
        kind: 'region',
      });
      expect(invalidPt.valid).toBe(false);
      if (!invalidPt.valid) {
        expect(invalidPt.errors.some((e) => e.field === 'patternTable')).toBe(
          true,
        );
      }

      // Negative startTile
      const negativeStart = validateChrRegion({
        id: 'reg-1',
        name: 'Name',
        patternTable: 0,
        startTile: -1,
        endTile: 10,
        kind: 'region',
      });
      expect(negativeStart.valid).toBe(false);

      // End tile > 255
      const overflowEnd = validateChrRegion({
        id: 'reg-1',
        name: 'Name',
        patternTable: 0,
        startTile: 0,
        endTile: 256,
        kind: 'region',
      });
      expect(overflowEnd.valid).toBe(false);

      // Start > End
      const startAfterEnd = validateChrRegion({
        id: 'reg-1',
        name: 'Name',
        patternTable: 0,
        startTile: 50,
        endTile: 20,
        kind: 'region',
      });
      expect(startAfterEnd.valid).toBe(false);
      if (!startAfterEnd.valid) {
        expect(
          startAfterEnd.errors.some((e) => e.code === 'start-after-end'),
        ).toBe(true);
      }

      // Invalid kind
      const invalidKind = validateChrRegion({
        id: 'reg-1',
        name: 'Name',
        patternTable: 0,
        startTile: 0,
        endTile: 10,
        kind: 'custom-kind',
      });
      expect(invalidKind.valid).toBe(false);
    });
  });

  describe('ChrRegion range helpers and overlap detection', () => {
    const regPt0A: ChrRegion = {
      id: 'pt0-a',
      name: 'PT0 A',
      patternTable: 0,
      startTile: 0,
      endTile: 31, // $00..$1F -> physical 0..31
      kind: 'region',
    };

    const regPt0B: ChrRegion = {
      id: 'pt0-b',
      name: 'PT0 B',
      patternTable: 0,
      startTile: 31,
      endTile: 63, // $1F..$3F -> physical 31..63 (overlaps at 31 / $1F!)
      kind: 'region',
    };

    const regPt0C: ChrRegion = {
      id: 'pt0-c',
      name: 'PT0 C',
      patternTable: 0,
      startTile: 64,
      endTile: 127, // $40..$7F -> physical 64..127
      kind: 'reservation',
    };

    const regPt1A: ChrRegion = {
      id: 'pt1-a',
      name: 'PT1 A',
      patternTable: 1,
      startTile: 0,
      endTile: 31, // PT1 $00..$1F -> physical 256..287
      kind: 'reservation',
    };

    it('calculates exact physical range for PT0 and PT1 regions', () => {
      expect(chrRegionPhysicalRange(regPt0A)).toEqual([0, 31]);
      expect(chrRegionPhysicalRange(regPt0C)).toEqual([64, 127]);
      expect(chrRegionPhysicalRange(regPt1A)).toEqual([256, 287]);
    });

    it('tests tile containment with isPhysicalTileInRegion and isLocalTileInRegion', () => {
      expect(isPhysicalTileInRegion(0, regPt0A)).toBe(true);
      expect(isPhysicalTileInRegion(31, regPt0A)).toBe(true);
      expect(isPhysicalTileInRegion(32, regPt0A)).toBe(false);
      expect(isPhysicalTileInRegion(256, regPt0A)).toBe(false);

      expect(isPhysicalTileInRegion(256, regPt1A)).toBe(true);
      expect(isPhysicalTileInRegion(287, regPt1A)).toBe(true);
      expect(isPhysicalTileInRegion(288, regPt1A)).toBe(false);

      expect(isLocalTileInRegion(0, 15, regPt0A)).toBe(true);
      expect(isLocalTileInRegion(1, 15, regPt0A)).toBe(false); // Wrong PT
      expect(isLocalTileInRegion(1, 15, regPt1A)).toBe(true);
    });

    it('detects boundary inclusive overlaps on the same pattern table', () => {
      // regPt0A ($00..$1F) and regPt0B ($1F..$3F) overlap at tile 31 ($1F)
      expect(doChrRegionsOverlap(regPt0A, regPt0B)).toBe(true);
      expect(getChrRegionOverlapRange(regPt0A, regPt0B)).toEqual([31, 31]);
    });

    it('confirms adjacent non-overlapping intervals do not overlap', () => {
      // regPt0B ($1F..$63) and regPt0C ($64..$127) are adjacent without overlap
      expect(doChrRegionsOverlap(regPt0B, regPt0C)).toBe(false);
      expect(getChrRegionOverlapRange(regPt0B, regPt0C)).toBeNull();
    });

    it('confirms identical ranges in different pattern tables do not overlap', () => {
      // regPt0A (PT0 $00..$1F) and regPt1A (PT1 $00..$1F) do NOT overlap
      expect(doChrRegionsOverlap(regPt0A, regPt1A)).toBe(false);
      expect(getChrRegionOverlapRange(regPt0A, regPt1A)).toBeNull();
    });

    it('finds all overlapping pairs across a collection of regions', () => {
      const overlaps = findChrRegionOverlaps([
        regPt0A,
        regPt0B,
        regPt0C,
        regPt1A,
      ]);
      expect(overlaps).toHaveLength(1);
      expect(overlaps[0]?.regionA.id).toBe('pt0-a');
      expect(overlaps[0]?.regionB.id).toBe('pt0-b');
      expect(overlaps[0]?.overlapStartTile).toBe(31);
      expect(overlaps[0]?.overlapEndTile).toBe(31);
    });

    it('collects reserved physical indices ignoring non-reservation regions', () => {
      const regions: ChrRegion[] = [regPt0A, regPt0B, regPt0C, regPt1A];

      const allReserved = collectReservedPhysicalTileIndices(regions);
      // regPt0C has 64 tiles (64..127) + regPt1A has 32 tiles (256..287) = 96 reserved tiles
      expect(allReserved.size).toBe(96);
      expect(allReserved.has(0)).toBe(false); // regPt0A is a 'region', not a 'reservation'
      expect(allReserved.has(64)).toBe(true); // regPt0C is a reservation
      expect(allReserved.has(127)).toBe(true);
      expect(allReserved.has(256)).toBe(true); // regPt1A is a reservation
      expect(allReserved.has(287)).toBe(true);

      const pt0Reserved = collectReservedPhysicalTileIndices(regions, 0);
      expect(pt0Reserved.size).toBe(64);
      expect(pt0Reserved.has(256)).toBe(false);

      const pt1LocalReserved = collectReservedLocalTileIndices(regions, 1);
      expect(pt1LocalReserved.size).toBe(32);
      expect(pt1LocalReserved.has(0)).toBe(true);
      expect(pt1LocalReserved.has(31)).toBe(true);
      expect(pt1LocalReserved.has(32)).toBe(false);
    });
  });

  describe('Reservation-aware slot allocation and CHR composition', () => {
    it('isChrSlotAvailableForAllocation evaluates slot eligibility accurately', () => {
      const emptySlot = { physicalTileIndex: 5, tile: null, source: null };
      const occupiedSlot = {
        physicalTileIndex: 5,
        tile: tile(1),
        source: 'imported' as const,
      };
      const reservedSet = new Set<number>([5, 6, 7]);

      // Empty unreserved slot is available
      expect(isChrSlotAvailableForAllocation(emptySlot)).toBe(true);
      expect(isChrSlotAvailableForAllocation(emptySlot, new Set([1, 2]))).toBe(
        true,
      );

      // Occupied slot is NOT available
      expect(isChrSlotAvailableForAllocation(occupiedSlot)).toBe(false);

      // Empty reserved slot is NOT available
      expect(isChrSlotAvailableForAllocation(emptySlot, reservedSet)).toBe(
        false,
      );

      // Null/undefined slot
      expect(isChrSlotAvailableForAllocation(null)).toBe(false);
      expect(isChrSlotAvailableForAllocation(undefined)).toBe(false);
    });

    it('findNextAvailableChrSlot skips occupied and reserved slots in pattern table', () => {
      const slots: PatternTableSlot[] = Array.from({ length: 512 }, (_, i) => ({
        physicalTileIndex: i,
        tile: null,
        source: null,
      }));

      // Occupy slot 0
      slots[0] = { physicalTileIndex: 0, tile: tile(1), source: 'destination' };

      // Reserve slots 1..3
      const reserved = new Set([1, 2, 3]);

      // Next available slot in PT0 should be 4
      const nextSlot = findNextAvailableChrSlot(slots, {
        patternTable: 0,
        reservedIndices: reserved,
      });

      expect(nextSlot).toBeDefined();
      expect(nextSlot?.physicalTileIndex).toBe(4);
    });

    it('composeChrWithAllocatedTiles without reservations produces baseline output', () => {
      const base = new Uint8Array(NES_CHR_ROM_SIZE);
      const tiles = [tile(1), tile(2), tile(3)];

      const composedDefault = composeChrWithAllocatedTiles(base, 0, tiles);
      const composedWithEmptyRegions = composeChrWithAllocatedTiles(
        base,
        0,
        tiles,
        [],
      );
      const composedWithNonReservations = composeChrWithAllocatedTiles(
        base,
        0,
        tiles,
        [
          {
            id: 'reg-info',
            name: 'Informational Region',
            patternTable: 0,
            startTile: 0,
            endTile: 10,
            kind: 'region',
          },
        ],
      );

      expect(composedDefault).toEqual(composedWithEmptyRegions);
      expect(composedDefault).toEqual(composedWithNonReservations);

      // Slots 0, 1, 2 contain tiles 1, 2, 3
      expect(composedDefault.subarray(0, 16)).toEqual(encodeTile(tile(1)));
      expect(composedDefault.subarray(16, 32)).toEqual(encodeTile(tile(2)));
      expect(composedDefault.subarray(32, 48)).toEqual(encodeTile(tile(3)));
    });

    it('composeChrWithAllocatedTiles skips reserved ranges in PT0 and PT1', () => {
      const base = new Uint8Array(NES_CHR_ROM_SIZE);
      const tiles = [tile(1), tile(2)];

      // Reserve PT0 $00..$03 (tiles 0..3)
      const reservations: ChrRegion[] = [
        {
          id: 'res-pt0',
          name: 'Reserved Header',
          patternTable: 0,
          startTile: 0,
          endTile: 3,
          kind: 'reservation',
        },
      ];

      const composed = composeChrWithAllocatedTiles(
        base,
        0,
        tiles,
        reservations,
      );

      // Slots 0..3 are empty (zero bytes)
      expect(composed.subarray(0, 64)).toEqual(new Uint8Array(64));

      // Tile 1 is placed at physical slot 4 (byte offset 64..79)
      expect(composed.subarray(64, 80)).toEqual(encodeTile(tile(1)));

      // Tile 2 is placed at physical slot 5 (byte offset 80..95)
      expect(composed.subarray(80, 96)).toEqual(encodeTile(tile(2)));
    });

    it('composeChrWithAllocatedTiles preserves Base CHR graphics inside and outside reservations', () => {
      const base = new Uint8Array(NES_CHR_ROM_SIZE);
      // Place existing Base CHR tile at slot 0 ($00) and slot 10 ($0A)
      base.set(encodeTile(tile(3)), 0); // Slot 0
      base.set(encodeTile(tile(2)), 10 * 16); // Slot 10

      // Reservation covering $00..$05
      const reservations: ChrRegion[] = [
        {
          id: 'res-overlap-base',
          name: 'Base Overlap Zone',
          patternTable: 0,
          startTile: 0,
          endTile: 5,
          kind: 'reservation',
        },
      ];

      const newTiles = [tile(1), tile(2)];
      const composed = composeChrWithAllocatedTiles(
        base,
        0,
        newTiles,
        reservations,
      );

      // Base CHR at slot 0 is preserved intact!
      expect(composed.subarray(0, 16)).toEqual(encodeTile(tile(3)));

      // Slots 1..5 in reservation remain empty
      expect(composed.subarray(16, 6 * 16)).toEqual(new Uint8Array(5 * 16));

      // First new tile goes to slot 6 ($06)
      expect(composed.subarray(6 * 16, 7 * 16)).toEqual(encodeTile(tile(1)));

      // Second new tile goes to slot 7 ($07)
      expect(composed.subarray(7 * 16, 8 * 16)).toEqual(encodeTile(tile(2)));

      // Base CHR at slot 10 is preserved intact!
      expect(composed.subarray(10 * 16, 11 * 16)).toEqual(encodeTile(tile(2)));
    });

    it('classifyChrSlots marks unallocated reserved slots as reserved while preserving occupied slots', () => {
      const base = new Uint8Array(NES_CHR_ROM_SIZE);
      base.set(encodeTile(tile(3)), 0); // Base CHR at slot 0

      const reservations: ChrRegion[] = [
        {
          id: 'res-mixed',
          name: 'Mixed Zone',
          patternTable: 0,
          startTile: 0,
          endTile: 3, // $00..$03 (slots 0..3)
          kind: 'reservation',
        },
      ];

      const tiles = [tile(1)]; // Will allocate at slot 4

      const classifications = classifyChrSlots({
        mode: 'tileset',
        baseChr: base,
        destinationPatternTable: 0,
        tiles,
        chrRegions: reservations,
      });

      // Slot 0 has Base CHR data -> 'base' (occupied != reserved)
      expect(classifications[0]?.occupancy).toBe('base');

      // Slots 1, 2, 3 are empty inside reservation -> 'reserved'
      expect(classifications[1]?.occupancy).toBe('reserved');
      expect(classifications[2]?.occupancy).toBe('reserved');
      expect(classifications[3]?.occupancy).toBe('reserved');

      // Slot 4 has project tile -> 'project'
      expect(classifications[4]?.occupancy).toBe('project');

      // Slot 5 is empty outside reservation -> 'empty'
      expect(classifications[5]?.occupancy).toBe('empty');
    });
  });

  describe('CHR region formatting helpers', () => {
    it('formatTileIndexHex formats local index into $00..$FF', () => {
      expect(formatTileIndexHex(0)).toBe('$00');
      expect(formatTileIndexHex(15)).toBe('$0F');
      expect(formatTileIndexHex(16)).toBe('$10');
      expect(formatTileIndexHex(255)).toBe('$FF');
    });

    it('formatTileRangeHex formats ranges into $00-$0F or single tile $00', () => {
      expect(formatTileRangeHex(0, 0)).toBe('$00');
      expect(formatTileRangeHex(0, 15)).toBe('$00-$0F');
      expect(formatTileRangeHex(32, 63)).toBe('$20-$3F');
    });

    it('formatConsecutiveTileRanges aggregates sorted indices into comma-separated ranges', () => {
      expect(formatConsecutiveTileRanges([])).toBe('');
      expect(formatConsecutiveTileRanges([5])).toBe('$05');
      expect(formatConsecutiveTileRanges([0, 1, 2, 3])).toBe('$00-$03');
      expect(formatConsecutiveTileRanges([0, 1, 2, 5, 6, 10])).toBe(
        '$00-$02, $05-$06, $0A',
      );
      // Handles unordered duplicates
      expect(formatConsecutiveTileRanges([10, 2, 1, 0, 2, 5])).toBe(
        '$00-$02, $05, $0A',
      );
    });
  });

  describe('CHR region conflicts & capacity diagnostics (analyzeChrRegionDiagnostics)', () => {
    const makeEmptyClassifications = (): ChrSlotClassification[] =>
      Array.from({ length: 512 }, (_, i) => ({
        physicalIndex: i,
        localIndex: i % 256,
        patternTable: i < 256 ? 0 : 1,
        occupancy: 'empty',
      }));

    it('returns empty diagnostics when no regions are provided and capacity is normal', () => {
      const classifications = makeEmptyClassifications();
      const facts = analyzeChrRegionDiagnostics({
        chrRegions: [],
        classifications,
      });
      expect(facts).toEqual([]);
    });

    describe('Overlap Diagnostics', () => {
      it('detects Region + Region overlap with warning severity and stable ID', () => {
        const regA: ChrRegion = {
          id: 'player',
          name: 'Player',
          patternTable: 0,
          startTile: 0,
          endTile: 47, // $00..$2F
          kind: 'region',
        };
        const regB: ChrRegion = {
          id: 'enemies',
          name: 'Enemies',
          patternTable: 0,
          startTile: 32, // $20
          endTile: 95, // $5F
          kind: 'region',
        };

        const facts = analyzeChrRegionDiagnostics({
          chrRegions: [regA, regB],
          checkPatternTableCapacity: false,
        });

        expect(facts).toHaveLength(1);
        const fact = facts[0];
        expect(fact?.kind).toBe('region-overlap');
        if (fact?.kind === 'region-overlap') {
          expect(fact.severity).toBe('warning');
          expect(fact.overlapType).toBe('region-region');
          expect(fact.patternTable).toBe(0);
          expect(fact.overlapStartTile).toBe(32);
          expect(fact.overlapEndTile).toBe(47);
          expect(fact.id).toBe('chr-region-overlap:enemies:player');
        }
      });

      it('detects Reservation + Reservation overlap with warning severity (redundant)', () => {
        const resA: ChrRegion = {
          id: 'res-a',
          name: 'FX Bank A',
          patternTable: 1,
          startTile: 0,
          endTile: 15,
          kind: 'reservation',
        };
        const resB: ChrRegion = {
          id: 'res-b',
          name: 'FX Bank B',
          patternTable: 1,
          startTile: 10,
          endTile: 25,
          kind: 'reservation',
        };

        const facts = analyzeChrRegionDiagnostics({
          chrRegions: [resA, resB],
          checkPatternTableCapacity: false,
        });

        expect(facts).toHaveLength(1);
        const fact = facts[0];
        expect(fact?.kind).toBe('region-overlap');
        if (fact?.kind === 'region-overlap') {
          expect(fact.severity).toBe('warning');
          expect(fact.overlapType).toBe('reservation-reservation');
          expect(fact.id).toBe('chr-reservation-overlap:res-a:res-b');
        }
      });

      it('detects Region + Reservation mixed overlap with info severity', () => {
        const reg: ChrRegion = {
          id: 'player-zone',
          name: 'Player Zone',
          patternTable: 0,
          startTile: 0,
          endTile: 63, // $00..$3F
          kind: 'region',
        };
        const res: ChrRegion = {
          id: 'runtime-fx',
          name: 'Runtime FX',
          patternTable: 0,
          startTile: 48, // $30..$3F
          endTile: 63,
          kind: 'reservation',
        };

        const facts = analyzeChrRegionDiagnostics({
          chrRegions: [reg, res],
          checkPatternTableCapacity: false,
        });

        expect(facts).toHaveLength(1);
        const fact = facts[0];
        expect(fact?.kind).toBe('region-overlap');
        if (fact?.kind === 'region-overlap') {
          expect(fact.severity).toBe('info');
          expect(fact.overlapType).toBe('region-reservation');
          expect(fact.id).toBe(
            'chr-region-reservation-overlap:player-zone:runtime-fx',
          );
        }
      });

      it('does NOT report overlap across different pattern tables', () => {
        const regPt0: ChrRegion = {
          id: 'pt0-reg',
          name: 'PT0 Zone',
          patternTable: 0,
          startTile: 0,
          endTile: 31,
          kind: 'region',
        };
        const regPt1: ChrRegion = {
          id: 'pt1-reg',
          name: 'PT1 Zone',
          patternTable: 1,
          startTile: 0,
          endTile: 31,
          kind: 'region',
        };

        const facts = analyzeChrRegionDiagnostics({
          chrRegions: [regPt0, regPt1],
          checkPatternTableCapacity: false,
        });

        expect(facts).toEqual([]);
      });

      it('detects 1-tile single boundary overlap and complete containment', () => {
        // 1-tile overlap at tile 15
        const a: ChrRegion = {
          id: 'a',
          name: 'A',
          patternTable: 0,
          startTile: 0,
          endTile: 15,
          kind: 'region',
        };
        const b: ChrRegion = {
          id: 'b',
          name: 'B',
          patternTable: 0,
          startTile: 15,
          endTile: 30,
          kind: 'region',
        };
        const facts1 = analyzeChrRegionDiagnostics({
          chrRegions: [a, b],
          checkPatternTableCapacity: false,
        });
        expect(facts1).toHaveLength(1);
        if (facts1[0]?.kind === 'region-overlap') {
          expect(facts1[0].overlapStartTile).toBe(15);
          expect(facts1[0].overlapEndTile).toBe(15);
        }

        // Complete containment: parent contains child completely
        const parent: ChrRegion = {
          id: 'parent',
          name: 'Parent',
          patternTable: 0,
          startTile: 0,
          endTile: 63,
          kind: 'region',
        };
        const child: ChrRegion = {
          id: 'child',
          name: 'Child',
          patternTable: 0,
          startTile: 16,
          endTile: 32,
          kind: 'region',
        };
        const facts2 = analyzeChrRegionDiagnostics({
          chrRegions: [parent, child],
          checkPatternTableCapacity: false,
        });
        expect(facts2).toHaveLength(1);
        if (facts2[0]?.kind === 'region-overlap') {
          expect(facts2[0].overlapStartTile).toBe(16);
          expect(facts2[0].overlapEndTile).toBe(32);
        }
      });

      it('does NOT report overlap for adjacent non-overlapping intervals', () => {
        const a: ChrRegion = {
          id: 'a',
          name: 'A',
          patternTable: 0,
          startTile: 0,
          endTile: 15,
          kind: 'region',
        };
        const b: ChrRegion = {
          id: 'b',
          name: 'B',
          patternTable: 0,
          startTile: 16,
          endTile: 31,
          kind: 'region',
        };
        const facts = analyzeChrRegionDiagnostics({
          chrRegions: [a, b],
          checkPatternTableCapacity: false,
        });
        expect(facts).toEqual([]);
      });

      it('maintains stable deterministic IDs independent of array order', () => {
        const a: ChrRegion = {
          id: 'beta',
          name: 'Beta',
          patternTable: 0,
          startTile: 0,
          endTile: 10,
          kind: 'region',
        };
        const b: ChrRegion = {
          id: 'alpha',
          name: 'Alpha',
          patternTable: 0,
          startTile: 5,
          endTile: 15,
          kind: 'region',
        };

        const facts1 = analyzeChrRegionDiagnostics({
          chrRegions: [a, b],
          checkPatternTableCapacity: false,
        });
        const facts2 = analyzeChrRegionDiagnostics({
          chrRegions: [b, a],
          checkPatternTableCapacity: false,
        });

        expect(facts1[0]?.id).toBe('chr-region-overlap:alpha:beta');
        expect(facts2[0]?.id).toBe('chr-region-overlap:alpha:beta');
      });
    });

    describe('Reservations containing occupied content', () => {
      it('generates warning when reservation contains Base CHR or Project tiles', () => {
        const classifications = makeEmptyClassifications();
        // Place 3 occupied tiles in PT0 $20..$22 (physical slots 32..34)
        classifications[32] = {
          physicalIndex: 32,
          localIndex: 32,
          patternTable: 0,
          occupancy: 'base',
        };
        classifications[33] = {
          physicalIndex: 33,
          localIndex: 33,
          patternTable: 0,
          occupancy: 'project',
        };
        classifications[34] = {
          physicalIndex: 34,
          localIndex: 34,
          patternTable: 0,
          occupancy: 'base',
        };
        // Slots 35..63 are empty reserved
        for (let i = 35; i <= 63; i += 1) {
          classifications[i] = {
            physicalIndex: i,
            localIndex: i,
            patternTable: 0,
            occupancy: 'reserved',
          };
        }

        const res: ChrRegion = {
          id: 'runtime-bank',
          name: 'Runtime FX',
          patternTable: 0,
          startTile: 32, // $20
          endTile: 63, // $3F
          kind: 'reservation',
        };

        const facts = analyzeChrRegionDiagnostics({
          chrRegions: [res],
          classifications,
          checkPatternTableCapacity: false,
        });

        expect(facts).toHaveLength(1);
        const fact = facts[0];
        expect(fact?.kind).toBe('reservation-contains-occupied');
        if (fact?.kind === 'reservation-contains-occupied') {
          expect(fact.severity).toBe('warning');
          expect(fact.id).toBe('chr-reservation-occupied:runtime-bank');
          expect(fact.occupiedCount).toBe(3);
          expect(fact.occupiedTileIndices).toEqual([32, 33, 34]);
        }
      });

      it('does NOT generate warning when reservation is completely empty', () => {
        const classifications = makeEmptyClassifications();
        for (let i = 0; i <= 15; i += 1) {
          classifications[i] = {
            physicalIndex: i,
            localIndex: i,
            patternTable: 0,
            occupancy: 'reserved',
          };
        }

        const res: ChrRegion = {
          id: 'empty-res',
          name: 'Empty Header',
          patternTable: 0,
          startTile: 0,
          endTile: 15,
          kind: 'reservation',
        };

        const facts = analyzeChrRegionDiagnostics({
          chrRegions: [res],
          classifications,
          checkPatternTableCapacity: false,
        });

        expect(facts).toEqual([]);
      });
    });

    describe('Pattern Table Capacity calculations and diagnostics', () => {
      it('calculates Pattern Table capacity without double counting occupied slots inside reservations', () => {
        const classifications = makeEmptyClassifications();
        // Occupy 10 slots in PT0 (0..9)
        for (let i = 0; i < 10; i += 1) {
          classifications[i] = {
            physicalIndex: i,
            localIndex: i,
            patternTable: 0,
            occupancy: 'project',
          };
        }
        // Reserve 20 slots in PT0 (10..29) - all empty reserved
        for (let i = 10; i < 30; i += 1) {
          classifications[i] = {
            physicalIndex: i,
            localIndex: i,
            patternTable: 0,
            occupancy: 'reserved',
          };
        }
        // Remaining 226 slots in PT0 are 'empty'

        const capPt0 = calculatePatternTableCapacity(classifications, 0);
        expect(capPt0.totalOccupiedTiles).toBe(10);
        expect(capPt0.totalReservedEmptyTiles).toBe(20);
        expect(capPt0.totalEmptyTiles).toBe(226);
        expect(capPt0.availableSlots).toBe(226);
        expect(capPt0.isExhausted).toBe(false);
        expect(capPt0.isLowCapacity).toBe(false);

        // Sum must be exactly 256
        expect(
          capPt0.totalOccupiedTiles +
            capPt0.totalReservedEmptyTiles +
            capPt0.totalEmptyTiles,
        ).toBe(256);
      });

      it('emits pattern-table-exhausted error when availableSlots is 0', () => {
        const classifications = makeEmptyClassifications();
        // Fill entire PT0 with occupied slots
        for (let i = 0; i < 256; i += 1) {
          classifications[i] = {
            physicalIndex: i,
            localIndex: i,
            patternTable: 0,
            occupancy: 'project',
          };
        }

        const facts = analyzeChrRegionDiagnostics({
          classifications,
          checkPatternTableCapacity: true,
        });

        const pt0Exhausted = facts.find(
          (f) => f.kind === 'pattern-table-exhausted' && f.patternTable === 0,
        );
        expect(pt0Exhausted).toBeDefined();
        if (pt0Exhausted?.kind === 'pattern-table-exhausted') {
          expect(pt0Exhausted.severity).toBe('error');
          expect(pt0Exhausted.totalOccupied).toBe(256);
          expect(pt0Exhausted.totalReservedEmpty).toBe(0);
          expect(pt0Exhausted.id).toBe('chr-pattern-table-exhausted:0');
        }
      });

      it('emits pattern-table-low-capacity warning when availableSlots <= CHR_LOW_CAPACITY_THRESHOLD', () => {
        const classifications = makeEmptyClassifications();
        // Occupy 252 slots in PT1 (physical 256..507), leaving 4 empty slots (508..511)
        for (let i = 256; i <= 507; i += 1) {
          classifications[i] = {
            physicalIndex: i,
            localIndex: i - 256,
            patternTable: 1,
            occupancy: 'project',
          };
        }

        const facts = analyzeChrRegionDiagnostics({
          classifications,
          checkPatternTableCapacity: true,
        });

        const pt1Low = facts.find(
          (f) =>
            f.kind === 'pattern-table-low-capacity' && f.patternTable === 1,
        );
        expect(pt1Low).toBeDefined();
        if (pt1Low?.kind === 'pattern-table-low-capacity') {
          expect(pt1Low.severity).toBe('warning');
          expect(pt1Low.availableSlots).toBe(4);
          expect(pt1Low.id).toBe('chr-pattern-table-low-capacity:1');
        }
      });
    });

    describe('Region Capacity calculations', () => {
      it('calculates region capacity and detects full region', () => {
        const classifications = makeEmptyClassifications();
        // Occupy all 16 slots in PT0 $00..$0F
        for (let i = 0; i < 16; i += 1) {
          classifications[i] = {
            physicalIndex: i,
            localIndex: i,
            patternTable: 0,
            occupancy: 'project',
          };
        }

        const reg: ChrRegion = {
          id: 'player-sprites',
          name: 'Player Sprites',
          patternTable: 0,
          startTile: 0,
          endTile: 15,
          kind: 'region',
        };

        const cap = calculateChrRegionCapacity(reg, classifications);
        expect(cap.totalTiles).toBe(16);
        expect(cap.occupiedTiles).toBe(16);
        expect(cap.availableTiles).toBe(0);
        expect(cap.isFull).toBe(true);

        const facts = analyzeChrRegionDiagnostics({
          chrRegions: [reg],
          classifications,
          checkPatternTableCapacity: false,
        });

        const fullFact = facts.find((f) => f.kind === 'region-full');
        expect(fullFact).toBeDefined();
        if (fullFact?.kind === 'region-full') {
          expect(fullFact.severity).toBe('info');
          expect(fullFact.occupiedTiles).toBe(16);
          expect(fullFact.totalTiles).toBe(16);
          expect(fullFact.id).toBe('chr-region-full:player-sprites');
        }
      });
    });

    describe('findChrRegionsForPhysicalTile & findChrRegionsForLocalTile', () => {
      const reg0: ChrRegion = {
        id: 'reg-0',
        name: 'Player',
        patternTable: 0,
        startTile: 0,
        endTile: 31,
        kind: 'region',
      };
      const reg1: ChrRegion = {
        id: 'reg-1',
        name: 'Enemies',
        patternTable: 0,
        startTile: 20,
        endTile: 60,
        kind: 'region',
      };
      const regPt1: ChrRegion = {
        id: 'reg-pt1',
        name: 'Background',
        patternTable: 1,
        startTile: 0,
        endTile: 15,
        kind: 'reservation',
      };
      const regions = [reg0, reg1, regPt1];

      it('returns covering regions for physical tile indices', () => {
        // Physical index 10 (PT0 local 10): only reg0
        expect(findChrRegionsForPhysicalTile(10, regions)).toEqual([reg0]);

        // Physical index 25 (PT0 local 25): reg0 and reg1 (overlap)
        expect(findChrRegionsForPhysicalTile(25, regions)).toEqual([
          reg0,
          reg1,
        ]);

        // Physical index 256 (PT1 local 0): regPt1
        expect(findChrRegionsForPhysicalTile(256, regions)).toEqual([regPt1]);

        // Physical index 300 (PT1 local 44): none
        expect(findChrRegionsForPhysicalTile(300, regions)).toEqual([]);

        // Default empty regions
        expect(findChrRegionsForPhysicalTile(10)).toEqual([]);
      });

      it('returns covering regions for local tile indices with pattern table', () => {
        expect(findChrRegionsForLocalTile(0, 10, regions)).toEqual([reg0]);
        expect(findChrRegionsForLocalTile(0, 25, regions)).toEqual([
          reg0,
          reg1,
        ]);
        expect(findChrRegionsForLocalTile(1, 0, regions)).toEqual([regPt1]);
        expect(findChrRegionsForLocalTile(1, 100, regions)).toEqual([]);
        expect(findChrRegionsForLocalTile(0, 10)).toEqual([]);
      });
    });

    describe('sanitizeRegionColor', () => {
      it('accepts valid hex, rgb, and hsl colors', () => {
        expect(sanitizeRegionColor('#fff')).toBe('#fff');
        expect(sanitizeRegionColor('#38bdf8')).toBe('#38bdf8');
        expect(sanitizeRegionColor('#38bdf8aa')).toBe('#38bdf8aa');
        expect(sanitizeRegionColor('rgb(56, 189, 248)')).toBe(
          'rgb(56, 189, 248)',
        );
        expect(sanitizeRegionColor('rgba(56, 189, 248, 0.5)')).toBe(
          'rgba(56, 189, 248, 0.5)',
        );
        expect(sanitizeRegionColor('hsl(200, 80%, 50%)')).toBe(
          'hsl(200, 80%, 50%)',
        );
      });

      it('rejects invalid or unsafe strings', () => {
        expect(sanitizeRegionColor(undefined)).toBeUndefined();
        expect(sanitizeRegionColor(null)).toBeUndefined();
        expect(sanitizeRegionColor('')).toBeUndefined();
        expect(sanitizeRegionColor('url(evil.com)')).toBeUndefined();
        expect(sanitizeRegionColor('<script>')).toBeUndefined();
        expect(sanitizeRegionColor('not-a-color-123456789')).toBeUndefined();
      });
    });

    describe('buildChrSlotRegionIndex', () => {
      it('pre-computes accurate memberships across all 512 physical slots', () => {
        const reg0: ChrRegion = {
          id: 'reg-0',
          name: 'Player',
          patternTable: 0,
          startTile: 0,
          endTile: 15,
          kind: 'region',
          color: '#38bdf8',
        };
        const res0: ChrRegion = {
          id: 'res-0',
          name: 'Buffer',
          patternTable: 0,
          startTile: 10,
          endTile: 20,
          kind: 'reservation',
        };
        const reg1: ChrRegion = {
          id: 'reg-1',
          name: 'BG',
          patternTable: 1,
          startTile: 0,
          endTile: 7,
          kind: 'region',
        };

        const index = buildChrSlotRegionIndex([reg0, res0, reg1]);
        expect(index.length).toBe(512);

        // Slot 5 (PT0, local 5): in region Player, not in reservation
        expect(index[5]?.inRegion).toBe(true);
        expect(index[5]?.inReservation).toBe(false);
        expect(index[5]?.regions).toEqual([reg0]);
        expect(index[5]?.reservations).toEqual([]);
        expect(index[5]?.primaryColor).toBe('#38bdf8');

        // Slot 12 (PT0, local 12): in region Player AND reservation Buffer
        expect(index[12]?.inRegion).toBe(true);
        expect(index[12]?.inReservation).toBe(true);
        expect(index[12]?.regions).toEqual([reg0]);
        expect(index[12]?.reservations).toEqual([res0]);

        // Slot 18 (PT0, local 18): only in reservation Buffer
        expect(index[18]?.inRegion).toBe(false);
        expect(index[18]?.inReservation).toBe(true);

        // Slot 256 (PT1, local 0): in region BG
        expect(index[256]?.inRegion).toBe(true);
        expect(index[256]?.inReservation).toBe(false);
        expect(index[256]?.patternTable).toBe(1);
        expect(index[256]?.localIndex).toBe(0);

        // Slot 300 (PT1, local 44): empty
        expect(index[300]?.inRegion).toBe(false);
        expect(index[300]?.inReservation).toBe(false);
      });
    });
  });
});
