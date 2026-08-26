import { describe, expect, it } from 'vitest';
import {
  BackgroundModelError,
  createEmptyBackgroundMap,
  type BackgroundMapDefinition,
} from './background-model';
import {
  allocateBackgroundChr,
  buildBackgroundProjectModel,
} from './chr-background-allocation';
import {
  createPatternTableSlots,
  type ChrRegion,
  type PatternTableSlot,
} from './chr-pattern-table';
import {
  buildChrAssetMappingIndex,
  type BackgroundTileUsage,
} from './chr-asset-mapping';

describe('Milestone 8 (Issue #109): Background CHR Allocation & Pattern Table Integration', () => {
  function createTestPattern(fillValue: number): Uint8Array {
    return new Uint8Array(64).fill(fillValue);
  }

  function createAsymmetricPattern(seed = 1): Uint8Array {
    const pixels = new Uint8Array(64);
    pixels[0] = seed & 3;
    pixels[1] = (seed >> 2) & 3;
    pixels[2] = (seed >> 4) & 3;
    pixels[3] = (seed >> 6) & 3;
    pixels[4] = (seed >> 8) & 3;
    for (let i = 5; i < 64; i += 1) {
      pixels[i] = (i * 3 + seed) % 4;
    }
    return pixels;
  }

  function createFlippedPattern(
    source: Uint8Array,
    flipH: boolean,
    flipV: boolean,
  ): Uint8Array {
    const flipped = new Uint8Array(64);
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const srcRow = flipV ? 7 - row : row;
        const srcCol = flipH ? 7 - col : col;
        flipped[row * 8 + col] = source[srcRow * 8 + srcCol] ?? 0;
      }
    }
    return flipped;
  }

  function createEmptySlots(): PatternTableSlot[] {
    return createPatternTableSlots(new Uint8Array(0), 0);
  }

  describe('Pattern Table PT0 / PT1 Isolation', () => {
    it('allocates background tiles strictly in PT0 (physical slots 0..255) with local indices 0..255', () => {
      const tile1 = createAsymmetricPattern(1);
      const tile2 = createAsymmetricPattern(2);

      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_pt0', patternTable: 0 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i === 0) return { logicalKey: 'bg:0:0', tileX: 0, tileY: 0 };
          if (i === 1) return { logicalKey: 'bg:1:0', tileX: 1, tileY: 0 };
          return null;
        }),
      };

      const tileMap = new Map<string, Uint8Array>([
        ['bg:0:0', tile1],
        ['bg:1:0', tile2],
      ]);

      const result = buildBackgroundProjectModel({
        map,
        tileMap,
        emptyCellTileIndex: 0,
      });

      expect(result.patternTable).toBe(0);
      expect(result.resolvedCells[0]?.physicalTileIndex).toBe(0);
      expect(result.resolvedCells[0]?.localTileIndex).toBe(0);
      expect(result.resolvedCells[1]?.physicalTileIndex).toBe(1);
      expect(result.resolvedCells[1]?.localTileIndex).toBe(1);

      // Verify Nametable bytes
      expect(result.nametable[0]).toBe(0);
      expect(result.nametable[1]).toBe(1);
      expect(result.nametable[2]).toBe(0); // empty cell fallback
    });

    it('allocates background tiles strictly in PT1 (physical slots 256..511) with local indices 0..255', () => {
      const tile1 = createAsymmetricPattern(10);
      const tile2 = createAsymmetricPattern(20);

      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_pt1', patternTable: 1 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i === 0) return { logicalKey: 'bg:0:0', tileX: 0, tileY: 0 };
          if (i === 1) return { logicalKey: 'bg:1:0', tileX: 1, tileY: 0 };
          return null;
        }),
      };

      const tileMap = new Map<string, Uint8Array>([
        ['bg:0:0', tile1],
        ['bg:1:0', tile2],
      ]);

      const result = buildBackgroundProjectModel({
        map,
        tileMap,
        emptyCellTileIndex: 0,
      });

      expect(result.patternTable).toBe(1);
      // Physical slots are in PT1 (256..511)
      expect(result.resolvedCells[0]?.physicalTileIndex).toBe(256);
      expect(result.resolvedCells[1]?.physicalTileIndex).toBe(257);

      // Local tile indices stored in Nametable MUST be 0..255 for PPU compatibility
      expect(result.resolvedCells[0]?.localTileIndex).toBe(0);
      expect(result.resolvedCells[1]?.localTileIndex).toBe(1);
      expect(result.nametable[0]).toBe(0);
      expect(result.nametable[1]).toBe(1);

      // Verify slot occupancy in CHR
      expect(result.slots[256]?.tile).not.toBeNull();
      expect(result.slots[257]?.tile).not.toBeNull();
      expect(result.slots[0]?.tile).toBeNull(); // PT0 remains untouched
    });
  });

  describe('ExactMatch Deduplication (No Flips)', () => {
    it('deduplicates identical logical tiles into the exact same physical slot', () => {
      const pattern = createAsymmetricPattern(5);

      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_dedup', patternTable: 0 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i < 10)
            return { logicalKey: `bg:${String(i)}:0`, tileX: i, tileY: 0 };
          return null;
        }),
      };

      // All 10 cells share the identical pixel pattern
      const tileMap = new Map<string, Uint8Array>();
      for (let i = 0; i < 10; i += 1) {
        tileMap.set(`bg:${String(i)}:0`, pattern);
      }

      const result = buildBackgroundProjectModel({
        map,
        tileMap,
        emptyCellTileIndex: 0,
      });

      // 10 cells were processed, but only 1 unique physical tile was allocated
      expect(result.newTileCount).toBe(1);
      expect(result.reusedProjectTiles).toBe(9);
      expect(result.uniqueTileCount).toBe(1);

      for (let i = 0; i < 10; i += 1) {
        expect(result.resolvedCells[i]?.physicalTileIndex).toBe(0);
        expect(result.resolvedCells[i]?.localTileIndex).toBe(0);
        expect(result.nametable[i]).toBe(0);
      }
    });

    it('does NOT deduplicate horizontal, vertical, or HV flipped tiles (ExactMatch only)', () => {
      const basePattern = createAsymmetricPattern(7);
      const flippedH = createFlippedPattern(basePattern, true, false);
      const flippedV = createFlippedPattern(basePattern, false, true);
      const flippedHV = createFlippedPattern(basePattern, true, true);

      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_flips', patternTable: 0 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i === 0) return { logicalKey: 'bg:base', tileX: 0, tileY: 0 };
          if (i === 1) return { logicalKey: 'bg:flip_h', tileX: 1, tileY: 0 };
          if (i === 2) return { logicalKey: 'bg:flip_v', tileX: 2, tileY: 0 };
          if (i === 3) return { logicalKey: 'bg:flip_hv', tileX: 3, tileY: 0 };
          return null;
        }),
      };

      const tileMap = new Map<string, Uint8Array>([
        ['bg:base', basePattern],
        ['bg:flip_h', flippedH],
        ['bg:flip_v', flippedV],
        ['bg:flip_hv', flippedHV],
      ]);

      const result = buildBackgroundProjectModel({
        map,
        tileMap,
        emptyCellTileIndex: 0,
      });

      // All 4 flipped variations must be allocated as separate physical slots
      expect(result.newTileCount).toBe(4);
      expect(result.reusedProjectTiles).toBe(0);
      expect(result.resolvedCells[0]?.physicalTileIndex).toBe(0);
      expect(result.resolvedCells[1]?.physicalTileIndex).toBe(1);
      expect(result.resolvedCells[2]?.physicalTileIndex).toBe(2);
      expect(result.resolvedCells[3]?.physicalTileIndex).toBe(3);
    });
  });

  describe('Base CHR Reuse & Preservation', () => {
    it('reutilizes matching Base CHR slots without copying or overwriting', () => {
      const baseChr = new Uint8Array(4096);
      // Put a test pattern at Base CHR slot 5 (byte offset 5 * 16 = 80)
      const basePattern = createAsymmetricPattern(42);
      for (let row = 0; row < 8; row += 1) {
        let lowPlane = 0;
        let highPlane = 0;
        for (let col = 0; col < 8; col += 1) {
          const px = basePattern[row * 8 + col] ?? 0;
          lowPlane |= (px & 1) << (7 - col);
          highPlane |= ((px >> 1) & 1) << (7 - col);
        }
        baseChr[5 * 16 + row] = lowPlane;
        baseChr[5 * 16 + row + 8] = highPlane;
      }

      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_base_reuse', patternTable: 0 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i === 0)
            return { logicalKey: 'bg:match_base', tileX: 0, tileY: 0 };
          return null;
        }),
      };

      const result = buildBackgroundProjectModel({
        map,
        baseChr,
        tileMap: new Map([['bg:match_base', basePattern]]),
        emptyCellTileIndex: 0,
      });

      expect(result.reusedBaseTiles).toBe(1);
      expect(result.newTileCount).toBe(0);
      expect(result.resolvedCells[0]?.physicalTileIndex).toBe(5);
      expect(result.resolvedCells[0]?.localTileIndex).toBe(5);
      expect(result.nametable[0]).toBe(5);

      // Verify Base CHR slot provenance
      expect(result.slots[5]?.source).toBe('destination');
    });

    it('never overwrites non-matching Base CHR tiles and allocates in next free slot', () => {
      const baseChr = new Uint8Array(4096);
      // Slots 0, 1, 2 occupied in Base CHR with non-zero bytes
      baseChr[0 * 16] = 0xff;
      baseChr[1 * 16] = 0xaa;
      baseChr[2 * 16] = 0x55;

      const newTilePattern = createAsymmetricPattern(99);

      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_no_overwrite', patternTable: 0 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i === 0) return { logicalKey: 'bg:new_tile', tileX: 0, tileY: 0 };
          return null;
        }),
      };

      const result = buildBackgroundProjectModel({
        map,
        baseChr,
        tileMap: new Map([['bg:new_tile', newTilePattern]]),
        emptyCellTileIndex: 0,
      });

      // New tile must be placed at slot 3 (skipping occupied 0, 1, 2)
      expect(result.resolvedCells[0]?.physicalTileIndex).toBe(3);
      expect(result.slots[0]?.source).toBe('destination');
      expect(result.slots[1]?.source).toBe('destination');
      expect(result.slots[2]?.source).toBe('destination');
      expect(result.slots[3]?.source).toBe('imported');
    });
  });

  describe('CHR Reservations', () => {
    it('skips reserved physical slots and ranges during allocation', () => {
      const chrRegions: ChrRegion[] = [
        {
          id: 'res_1',
          name: 'Reserved Block',
          patternTable: 0,
          startTile: 0,
          endTile: 15,
          kind: 'reservation',
        },
        {
          id: 'res_2',
          name: 'Reserved Single Slot',
          patternTable: 0,
          startTile: 20,
          endTile: 20,
          kind: 'reservation',
        },
      ];

      const patternA = createAsymmetricPattern(1);
      const patternB = createAsymmetricPattern(2);

      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_res', patternTable: 0 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i === 0) return { logicalKey: 'bg:a', tileX: 0, tileY: 0 };
          if (i === 1) return { logicalKey: 'bg:b', tileX: 1, tileY: 0 };
          return null;
        }),
      };

      const result = buildBackgroundProjectModel({
        map,
        chrRegions,
        tileMap: new Map([
          ['bg:a', patternA],
          ['bg:b', patternB],
        ]),
        emptyCellTileIndex: 16,
      });

      // Must skip slots 0..15 and start allocating at slot 16
      expect(result.resolvedCells[0]?.physicalTileIndex).toBe(16);
      expect(result.resolvedCells[1]?.physicalTileIndex).toBe(17);

      // Verify reserved slots remain empty
      for (let i = 0; i <= 15; i += 1) {
        expect(result.slots[i]?.tile).toBeNull();
      }
    });

    it('throws background-capacity-overflow when reservations block needed slots', () => {
      // Reserve almost the entire Pattern Table 0 (slots 0..254), leaving only 1 slot (255)
      const chrRegions: ChrRegion[] = [
        {
          id: 'huge_reservation',
          name: 'Locked Area',
          patternTable: 0,
          startTile: 0,
          endTile: 254,
          kind: 'reservation',
        },
      ];

      // Try to allocate 2 unique tiles
      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_overflow_res', patternTable: 0 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i === 0) return { logicalKey: 'bg:1', tileX: 0, tileY: 0 };
          if (i === 1) return { logicalKey: 'bg:2', tileX: 1, tileY: 0 };
          return null;
        }),
      };

      expect(() => {
        buildBackgroundProjectModel({
          map,
          chrRegions,
          tileMap: new Map([
            ['bg:1', createAsymmetricPattern(1)],
            ['bg:2', createAsymmetricPattern(2)],
          ]),
          emptyCellTileIndex: 255,
        });
      }).toThrow(BackgroundModelError);
    });
  });

  describe('Capacity Diagnostics & Invariants', () => {
    it('allocates exactly 256 unique tiles in PT0 without throwing', () => {
      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_max_pt0', patternTable: 0 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i < 256) {
            return {
              logicalKey: `bg:${String(i)}`,
              tileX: i % 32,
              tileY: Math.floor(i / 32),
            };
          }
          return null;
        }),
      };

      const tileMap = new Map<string, Uint8Array>();
      for (let i = 0; i < 256; i += 1) {
        tileMap.set(`bg:${String(i)}`, createAsymmetricPattern(i));
      }

      const result = buildBackgroundProjectModel({
        map,
        tileMap,
        emptyCellTileIndex: 0,
      });

      expect(result.newTileCount).toBe(256);
      expect(result.uniqueTileCount).toBe(256);
      expect(result.resolvedCells[255]?.physicalTileIndex).toBe(255);
      expect(result.resolvedCells[255]?.localTileIndex).toBe(255);
    });

    it('throws background-capacity-overflow when requiring 257 unique tiles in a single PT', () => {
      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_overflow', patternTable: 0 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i < 257) {
            return {
              logicalKey: `bg:${String(i)}`,
              tileX: i % 32,
              tileY: Math.floor(i / 32),
            };
          }
          return null;
        }),
      };

      const tileMap = new Map<string, Uint8Array>();
      for (let i = 0; i < 257; i += 1) {
        tileMap.set(`bg:${String(i)}`, createAsymmetricPattern(i));
      }

      expect(() => {
        buildBackgroundProjectModel({
          map,
          tileMap,
          emptyCellTileIndex: 0,
        });
      }).toThrow(BackgroundModelError);
    });
  });

  describe('ChrAssetMappingIndex Integration', () => {
    it('registers background usages and physical origins in ChrAssetMappingIndex', () => {
      const patternA = createAsymmetricPattern(100);
      const patternB = createAsymmetricPattern(200);

      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({
          id: 'bg_map_overworld',
          name: 'Overworld Stage 1',
          patternTable: 0,
          assetId: 'asset-bg-tileset',
        }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i === 0 || i === 5)
            return { logicalKey: 'asset-bg-tileset:0:0', tileX: 0, tileY: 0 };
          if (i === 1)
            return { logicalKey: 'asset-bg-tileset:1:0', tileX: 1, tileY: 0 };
          return null;
        }),
      };

      const model = buildBackgroundProjectModel({
        map,
        tileMap: new Map([
          ['asset-bg-tileset:0:0', patternA],
          ['asset-bg-tileset:1:0', patternB],
        ]),
        emptyCellTileIndex: 255,
      });

      const mappingIndex = buildChrAssetMappingIndex({
        backgroundModel: model,
      });

      // Slot 0 holds patternA, used at cells 0 and 5
      const slot0 = mappingIndex.byPhysicalIndex[0];
      expect(slot0?.origin?.primaryAssetId).toBe('asset-bg-tileset');
      expect(slot0?.origin?.logicalKey).toBe('asset-bg-tileset:0:0');
      expect(slot0?.isShared).toBe(true);
      expect(slot0?.usageCount).toBe(2);

      const bgUsages =
        slot0?.usages.filter(
          (u): u is BackgroundTileUsage => u.type === 'background',
        ) ?? [];
      expect(bgUsages.length).toBe(2);
      expect(bgUsages[0]?.nametableIndex).toBe(0);
      expect(bgUsages[1]?.nametableIndex).toBe(5);
      expect(bgUsages[0]?.mapId).toBe('bg_map_overworld');

      // Slot 1 holds patternB, used at cell 1
      const slot1 = mappingIndex.byPhysicalIndex[1];
      expect(slot1?.origin?.primaryAssetId).toBe('asset-bg-tileset');
      expect(slot1?.isShared).toBe(false);
      expect(slot1?.usageCount).toBe(1);
    });
  });

  describe('Transaction Atomicity & Determinism', () => {
    it('guarantees atomicity: an overflow failure does not mutate the initial slots', () => {
      const initialSlots = createEmptySlots();
      // Put a sentinel in slot 0
      initialSlots[0] = {
        physicalTileIndex: 0,
        tile: { id: 0, column: 0, row: 0, pixels: createTestPattern(1) },
        source: 'imported',
      };

      // Reserve slots 1..255 (so next new tile will overflow)
      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_fail', patternTable: 0 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i === 0)
            return { logicalKey: 'bg:fail_tile', tileX: 0, tileY: 0 };
          return null;
        }),
      };

      expect(() => {
        allocateBackgroundChr({
          map,
          initialSlots,
          reservedIndices: new Set(
            Array.from({ length: 255 }, (_, i) => i + 1),
          ),
          tileMap: new Map([['bg:fail_tile', createAsymmetricPattern(99)]]),
        });
      }).toThrow(BackgroundModelError);

      // Verify initialSlots was NOT mutated
      expect(initialSlots[0].tile?.pixels[0]).toBe(1);
      for (let i = 1; i < 512; i += 1) {
        expect(initialSlots[i]?.tile).toBeNull();
      }
    });

    it('guarantees bit-for-bit repeatability across multiple allocation runs', () => {
      const map: BackgroundMapDefinition = {
        ...createEmptyBackgroundMap({ id: 'bg_repeat', patternTable: 1 }),
        cells: createEmptyBackgroundMap().cells.map((_, i) => {
          if (i % 3 === 0) return { logicalKey: 'bg:a', tileX: 0, tileY: 0 };
          if (i % 3 === 1) return { logicalKey: 'bg:b', tileX: 1, tileY: 0 };
          return null;
        }),
      };

      const tileMap = new Map([
        ['bg:a', createAsymmetricPattern(11)],
        ['bg:b', createAsymmetricPattern(22)],
      ]);

      const run1 = buildBackgroundProjectModel({
        map,
        tileMap,
        emptyCellTileIndex: 0,
      });
      const run2 = buildBackgroundProjectModel({
        map,
        tileMap,
        emptyCellTileIndex: 0,
      });

      expect(run1.nametable).toEqual(run2.nametable);
      expect(run1.attributeTable).toEqual(run2.attributeTable);
      expect(run1.fullMapBuffer).toEqual(run2.fullMapBuffer);
      expect(run1.finalChr).toEqual(run2.finalChr);
      expect(run1.uniqueTileCount).toBe(run2.uniqueTileCount);
    });
  });
});
