import { describe, expect, it } from 'vitest';
import { AnimationModelError } from './animation-error';
import {
  collectReservedPhysicalTileIndices,
  createPatternTableSlots,
  encodePatternTableSlots,
  type ChrRegion,
  type PatternTableSlot,
} from './chr-pattern-table';
import {
  allocateSpritesheetChr,
  findTileMatch,
} from './chr-spritesheet-allocation';
import { extractLogicalAnimationFrames } from './metasprite-extraction';
import type { IndexedImage } from './types';

function createTestIndexedImage(
  width: number,
  height: number,
  filler: (x: number, y: number) => number = () => 0,
): IndexedImage {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = filler(x, y);
    }
  }
  return {
    width,
    height,
    pixels,
    colors: [
      { red: 0, green: 0, blue: 0 },
      { red: 255, green: 0, blue: 0 },
      { red: 0, green: 255, blue: 0 },
      { red: 0, green: 0, blue: 255 },
    ],
    transparentIndex: 0,
    colorCount: 4,
  };
}

function createEmptySlots(): PatternTableSlot[] {
  return Array.from({ length: 512 }, (_, physicalTileIndex) => ({
    physicalTileIndex,
    tile: null,
    source: null,
  }));
}

describe('chr-spritesheet-allocation (Issue #95)', () => {
  describe('PT0 and PT1 Allocation Boundaries', () => {
    it('allocates into PT0 (physical 0..255, local 0..255)', () => {
      const image = createTestIndexedImage(16, 16, (x, y) => {
        const tileCol = Math.floor(x / 8);
        const tileRow = Math.floor(y / 8);
        const tileIndex = tileRow * 2 + tileCol;
        if (tileIndex === 0) return 1;
        if (tileIndex === 1) return 2;
        if (tileIndex === 2) return 3;
        return x % 8 === 0 && y % 8 === 0 ? 1 : 2;
      });
      const logicalFrames = extractLogicalAnimationFrames({
        image,
        frameIndices: [0],
        defaultDuration: 5,
        frameWidth: 16,
        frameHeight: 16,
        assetId: 'hero-pt0',
      });

      const initialSlots = createEmptySlots();
      const result = allocateSpritesheetChr({
        logicalFrames,
        initialSlots,
        patternTable: 0,
      });

      expect(result.newTileCount).toBe(4);
      expect(result.frameAssignments.length).toBe(1);
      const assignments = result.frameAssignments[0];
      expect(assignments?.length).toBe(4);

      // Verify all assignments are within PT0 range
      assignments?.forEach((assignment, index) => {
        expect(assignment.patternTable).toBe(0);
        expect(assignment.physicalTileIndex).toBe(index);
        expect(assignment.localTileIndex).toBe(index);
        expect(assignment.reuse).toBe('new');
        expect(result.slots[assignment.physicalTileIndex]?.tile).not.toBeNull();
      });
    });

    it('allocates into PT1 (physical 256..511, local 0..255)', () => {
      const image = createTestIndexedImage(16, 16, (x, y) => {
        const tileCol = Math.floor(x / 8);
        const tileRow = Math.floor(y / 8);
        const tileIndex = tileRow * 2 + tileCol;
        if (tileIndex === 0) return 1;
        if (tileIndex === 1) return 2;
        if (tileIndex === 2) return 3;
        return x % 8 === 0 && y % 8 === 0 ? 1 : 2;
      });
      const logicalFrames = extractLogicalAnimationFrames({
        image,
        frameIndices: [0],
        defaultDuration: 5,
        frameWidth: 16,
        frameHeight: 16,
        assetId: 'hero-pt1',
      });

      const initialSlots = createEmptySlots();
      const result = allocateSpritesheetChr({
        logicalFrames,
        initialSlots,
        patternTable: 1,
      });

      expect(result.newTileCount).toBe(4);
      const assignments = result.frameAssignments[0];
      expect(assignments?.length).toBe(4);

      // Verify all assignments are strictly in PT1 physical range [256..511]
      assignments?.forEach((assignment, index) => {
        expect(assignment.patternTable).toBe(1);
        expect(assignment.physicalTileIndex).toBe(256 + index);
        expect(assignment.localTileIndex).toBe(index);
        expect(assignment.reuse).toBe('new');
        expect(result.slots[assignment.physicalTileIndex]?.tile).not.toBeNull();
      });
    });
  });

  describe('Base CHR Preservation and Reuse', () => {
    it('preserves Base CHR and allocates in available slots around it without overwrite', () => {
      // Create a Base CHR with 2 occupied tiles at physical slot 0 and 1
      const baseChr = new Uint8Array(4096);
      baseChr[0] = 0xff; // tile 0 has pixel data
      baseChr[16] = 0xaa; // tile 1 has pixel data

      const initialSlots = createPatternTableSlots(baseChr, 0);
      expect(initialSlots[0]?.source).toBe('destination');
      expect(initialSlots[1]?.source).toBe('destination');

      const image = createTestIndexedImage(16, 16, () => 2);
      const logicalFrames = extractLogicalAnimationFrames({
        image,
        frameIndices: [0],
        defaultDuration: 6,
        frameWidth: 16,
        frameHeight: 16,
        assetId: 'enemy',
      });

      const result = allocateSpritesheetChr({
        logicalFrames,
        initialSlots,
        patternTable: 0,
      });

      // Destination slots (0 and 1) were preserved intact
      expect(result.slots[0]?.source).toBe('destination');
      expect(result.slots[1]?.source).toBe('destination');

      // The new identical tiles from image are allocated starting at physical slot 2
      const assignments = result.frameAssignments[0];
      expect(assignments?.[0]?.physicalTileIndex).toBe(2);
      expect(assignments?.[0]?.reuse).toBe('new');

      // Due to deduplication, the other 3 identical cells reuse slot 2
      expect(assignments?.[1]?.physicalTileIndex).toBe(2);
      expect(assignments?.[1]?.reuse).toBe('imported');
      expect(assignments?.[2]?.physicalTileIndex).toBe(2);
      expect(assignments?.[2]?.reuse).toBe('imported');
      expect(assignments?.[3]?.physicalTileIndex).toBe(2);
      expect(assignments?.[3]?.reuse).toBe('imported');
    });

    it('reused destination tiles when candidate matches Base CHR tile pixels', () => {
      const baseChr = new Uint8Array(4096);
      // tile 0 has low plane with all 1s (color 1)
      for (let i = 0; i < 8; i += 1) baseChr[i] = 0xff;

      const initialSlots = createPatternTableSlots(baseChr, 0);

      // Create spritesheet with color 1 (exact match with tile 0)
      const image = createTestIndexedImage(8, 8, () => 1);
      const logicalFrames = extractLogicalAnimationFrames({
        image,
        frameIndices: [0],
        defaultDuration: 6,
        frameWidth: 8,
        frameHeight: 8,
        assetId: 'match-base',
      });

      const result = allocateSpritesheetChr({
        logicalFrames,
        initialSlots,
        patternTable: 0,
      });

      expect(result.reusedDestinationTiles).toBe(1);
      expect(result.newTileCount).toBe(0);
      expect(result.frameAssignments[0]?.[0]?.physicalTileIndex).toBe(0);
      expect(result.frameAssignments[0]?.[0]?.reuse).toBe('destination');
    });
  });

  describe('CHR Reservations & Blocking', () => {
    it('skips reserved slots and allocates in first unreserved slot', () => {
      const regions: ChrRegion[] = [
        {
          id: 'res-1',
          name: 'HUD Reservation',
          patternTable: 0,
          startTile: 0,
          endTile: 3, // blocks physical 0, 1, 2, 3
          kind: 'reservation',
        },
      ];

      const reservedIndices = collectReservedPhysicalTileIndices(regions);
      const initialSlots = createEmptySlots();

      const image = createTestIndexedImage(8, 8, () => 2);
      const logicalFrames = extractLogicalAnimationFrames({
        image,
        frameIndices: [0],
        defaultDuration: 4,
        frameWidth: 8,
        frameHeight: 8,
        assetId: 'sprite-after-res',
      });

      const result = allocateSpritesheetChr({
        logicalFrames,
        initialSlots,
        patternTable: 0,
        reservedIndices,
      });

      // Physical slots 0..3 were skipped; first allocated slot is 4
      expect(result.frameAssignments[0]?.[0]?.physicalTileIndex).toBe(4);
      expect(result.slots[0]?.tile).toBeNull();
      expect(result.slots[1]?.tile).toBeNull();
      expect(result.slots[2]?.tile).toBeNull();
      expect(result.slots[3]?.tile).toBeNull();
      expect(result.slots[4]?.tile).not.toBeNull();
    });

    it('handles multiple interleaved reservations across pattern table', () => {
      const regions: ChrRegion[] = [
        {
          id: 'res-start',
          name: 'Start Reservation',
          patternTable: 0,
          startTile: 0,
          endTile: 1,
          kind: 'reservation',
        },
        {
          id: 'res-mid',
          name: 'Middle Reservation',
          patternTable: 0,
          startTile: 3,
          endTile: 4,
          kind: 'reservation',
        },
      ];

      const reservedIndices = collectReservedPhysicalTileIndices(regions);
      const initialSlots = createEmptySlots();

      // 3 unique tiles
      const image = createTestIndexedImage(24, 8, (x) => Math.floor(x / 8) + 1);
      const logicalFrames = extractLogicalAnimationFrames({
        image,
        frameIndices: [0],
        defaultDuration: 4,
        frameWidth: 24,
        frameHeight: 8,
        assetId: 'interleaved',
      });

      const result = allocateSpritesheetChr({
        logicalFrames,
        initialSlots,
        patternTable: 0,
        reservedIndices,
      });

      // Tile 1 -> slot 2 (since 0, 1 reserved)
      // Tile 2 -> slot 5 (since 3, 4 reserved)
      // Tile 3 -> slot 6
      const assignments = result.frameAssignments[0];
      expect(assignments?.[0]?.physicalTileIndex).toBe(2);
      expect(assignments?.[1]?.physicalTileIndex).toBe(5);
      expect(assignments?.[2]?.physicalTileIndex).toBe(6);
    });
  });

  describe('Capacity Overflow & Atomicity', () => {
    it('throws pattern-table-capacity-overflow when capacity is exceeded', () => {
      const initialSlots = createEmptySlots();

      // Fill PT0 with 255 occupied tiles
      for (let i = 0; i < 255; i += 1) {
        initialSlots[i] = {
          physicalTileIndex: i,
          tile: {
            id: i,
            column: i % 16,
            row: Math.floor(i / 16),
            pixels: new Uint8Array(64).fill(1),
          },
          source: 'imported',
        };
      }

      // Slot 255 is free, but we request 2 new unique tiles
      const image = createTestIndexedImage(16, 8, (x) => Math.floor(x / 8) + 2);
      const logicalFrames = extractLogicalAnimationFrames({
        image,
        frameIndices: [0],
        defaultDuration: 4,
        frameWidth: 16,
        frameHeight: 8,
        assetId: 'overflow-test',
      });

      expect(() =>
        allocateSpritesheetChr({
          logicalFrames,
          initialSlots,
          patternTable: 0,
        }),
      ).toThrow(
        new AnimationModelError('pattern-table-capacity-overflow', {
          patternTable: 0,
          capacityTiles: 256,
        }),
      );
    });

    it('guarantees atomicity: capacity failure leaves input initialSlots completely unmutated', () => {
      const initialSlots = createEmptySlots();

      // Put one tile at slot 0
      initialSlots[0] = {
        physicalTileIndex: 0,
        tile: { id: 0, column: 0, row: 0, pixels: new Uint8Array(64).fill(1) },
        source: 'imported',
      };

      // Block all remaining slots 1..255 with reservations
      const regions: ChrRegion[] = [
        {
          id: 'res-all',
          name: 'Block rest',
          patternTable: 0,
          startTile: 1,
          endTile: 255,
          kind: 'reservation',
        },
      ];
      const reservedIndices = collectReservedPhysicalTileIndices(regions);

      const image = createTestIndexedImage(8, 8, () => 3); // Needs 1 new slot, none available in PT0
      const logicalFrames = extractLogicalAnimationFrames({
        image,
        frameIndices: [0],
        defaultDuration: 4,
        frameWidth: 8,
        frameHeight: 8,
        assetId: 'atomic-test',
      });

      expect(() =>
        allocateSpritesheetChr({
          logicalFrames,
          initialSlots,
          patternTable: 0,
          reservedIndices,
        }),
      ).toThrow(AnimationModelError);

      // Verify initialSlots was not mutated in any way
      expect(initialSlots[0].source).toBe('imported');
      for (let i = 1; i < 512; i += 1) {
        expect(initialSlots[i]?.tile).toBeNull();
      }
    });
  });

  describe('Multiple Animations Accumulative Allocation & Determinism', () => {
    it('supports accumulating multiple animations across consecutive allocation passes', () => {
      let slots = createEmptySlots();

      // Pass 1: Hero animation (2 unique tiles)
      const heroImage = createTestIndexedImage(
        16,
        8,
        (x) => Math.floor(x / 8) + 1,
      );
      const heroFrames = extractLogicalAnimationFrames({
        image: heroImage,
        frameIndices: [0],
        defaultDuration: 5,
        frameWidth: 16,
        frameHeight: 8,
        assetId: 'hero',
      });

      const heroResult = allocateSpritesheetChr({
        logicalFrames: heroFrames,
        initialSlots: slots,
        patternTable: 0,
      });

      slots = heroResult.slots as PatternTableSlot[];
      expect(heroResult.newTileCount).toBe(2);

      // Pass 2: Enemy animation (2 unique tiles, different from hero)
      const enemyImage = createTestIndexedImage(
        16,
        8,
        (x) => Math.floor(x / 8) + 3,
      );
      const enemyFrames = extractLogicalAnimationFrames({
        image: enemyImage,
        frameIndices: [0],
        defaultDuration: 5,
        frameWidth: 16,
        frameHeight: 8,
        assetId: 'enemy',
      });

      const enemyResult = allocateSpritesheetChr({
        logicalFrames: enemyFrames,
        initialSlots: slots,
        patternTable: 0,
      });

      slots = enemyResult.slots as PatternTableSlot[];
      expect(enemyResult.newTileCount).toBe(2);

      // Enemy gets slots 2 and 3 after hero's slots 0 and 1
      expect(enemyResult.frameAssignments[0]?.[0]?.physicalTileIndex).toBe(2);
      expect(enemyResult.frameAssignments[0]?.[1]?.physicalTileIndex).toBe(3);
    });

    it('STRONG DETERMINISM: identical inputs with Base CHR, reservations, and multiple animations produce identical binary results', () => {
      const runPipeline = () => {
        const baseChr = new Uint8Array(4096);
        baseChr[0] = 0x55;
        baseChr[16] = 0xaa;

        const regions: ChrRegion[] = [
          {
            id: 'res-mid',
            name: 'HUD',
            patternTable: 0,
            startTile: 5,
            endTile: 10,
            kind: 'reservation',
          },
        ];
        const reservedIndices = collectReservedPhysicalTileIndices(regions);

        let currentSlots = createPatternTableSlots(baseChr, 0);

        // Animation 1: Hero run
        const img1 = createTestIndexedImage(
          32,
          16,
          (x, y) => ((x * 3 + y * 7) % 3) + 1,
        );
        const frames1 = extractLogicalAnimationFrames({
          image: img1,
          frameIndices: [0, 1],
          defaultDuration: 6,
          frameWidth: 16,
          frameHeight: 16,
          assetId: 'hero-asset',
        });

        const res1 = allocateSpritesheetChr({
          logicalFrames: frames1,
          initialSlots: currentSlots,
          patternTable: 0,
          reservedIndices,
        });
        currentSlots = res1.slots as PatternTableSlot[];

        // Animation 2: Item pickup
        const img2 = createTestIndexedImage(
          16,
          16,
          (x, y) => ((x * 5 + y * 11) % 3) + 1,
        );
        const frames2 = extractLogicalAnimationFrames({
          image: img2,
          frameIndices: [0],
          defaultDuration: 4,
          frameWidth: 16,
          frameHeight: 16,
          assetId: 'item-asset',
        });

        const res2 = allocateSpritesheetChr({
          logicalFrames: frames2,
          initialSlots: currentSlots,
          patternTable: 0,
          reservedIndices,
        });
        currentSlots = res2.slots as PatternTableSlot[];

        const finalEncodedChr = encodePatternTableSlots(currentSlots);

        return {
          res1Assignments: res1.frameAssignments,
          res2Assignments: res2.frameAssignments,
          res1Metrics: {
            newTileCount: res1.newTileCount,
            reusedDestinationTiles: res1.reusedDestinationTiles,
            reusedImportedTiles: res1.reusedImportedTiles,
          },
          res2Metrics: {
            newTileCount: res2.newTileCount,
            reusedDestinationTiles: res2.reusedDestinationTiles,
            reusedImportedTiles: res2.reusedImportedTiles,
          },
          finalEncodedChr,
        };
      };

      const runA = runPipeline();
      const runB = runPipeline();

      expect(runA.res1Assignments).toEqual(runB.res1Assignments);
      expect(runA.res2Assignments).toEqual(runB.res2Assignments);
      expect(runA.res1Metrics).toEqual(runB.res1Metrics);
      expect(runA.res2Metrics).toEqual(runB.res2Metrics);
      expect(runA.finalEncodedChr).toEqual(runB.finalEncodedChr);
    });
  });

  describe('findTileMatch', () => {
    it('finds exact matching tile in target pattern table', () => {
      const slots = createEmptySlots();
      const tilePixels = new Uint8Array(64).fill(2);
      slots[10] = {
        physicalTileIndex: 10,
        tile: { id: 10, column: 10, row: 0, pixels: tilePixels },
        source: 'imported',
      };

      const match = findTileMatch(
        { id: 0, column: 0, row: 0, pixels: tilePixels },
        slots,
        0,
        false,
      );

      expect(match).toEqual({ physicalTileIndex: 10, attributes: 0 });
    });

    it('returns null when tile is not in target pattern table', () => {
      const slots = createEmptySlots();
      const tilePixels = new Uint8Array(64).fill(2);
      // Place in PT1 (slot 300)
      slots[300] = {
        physicalTileIndex: 300,
        tile: { id: 300, column: 0, row: 0, pixels: tilePixels },
        source: 'imported',
      };

      // Search in PT0
      const match = findTileMatch(
        { id: 0, column: 0, row: 0, pixels: tilePixels },
        slots,
        0,
        false,
      );

      expect(match).toBeNull();
    });
  });
});
