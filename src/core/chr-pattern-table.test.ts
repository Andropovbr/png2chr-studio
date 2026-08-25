import { describe, expect, it } from 'vitest';

import type { AnimationProjectModel } from './animation-model';
import { encodeChr } from './chr-encoder';
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
  type ChrSlotClassification,
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
});
