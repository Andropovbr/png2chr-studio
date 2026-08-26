import { describe, expect, it } from 'vitest';
import { AnimationModelError } from './animation-error';
import {
  buildAnimationProjectModel,
  type AnimationDefinitionInput,
} from './animation-model';
import {
  buildChrAssetMappingIndex,
  getPhysicalSlotAttribution,
  getUsagesForLogicalKey,
} from './chr-asset-mapping';
import {
  collectReservedPhysicalTileIndices,
  createPatternTableSlots,
  encodePatternTableSlots,
  type ChrRegion,
  type PatternTableSlot,
} from './chr-pattern-table';
import {
  allocateSpritesheetChr,
  decodeOamAttributes,
  encodeOamAttributes,
  findTileMatch,
  NES_SPRITE_FLIP_HORIZONTAL,
  NES_SPRITE_FLIP_VERTICAL,
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

/**
 * Creates an asymmetric 8x8 tile pixel buffer where each transformation (none, H, V, HV) is distinct.
 */
function createAsymmetricTilePixels(): Uint8Array {
  const pixels = new Uint8Array(64);
  // Place distinct markers: top-left (color 1), top-right (color 2), bottom-left (color 3)
  pixels[0] = 1; // (0,0)
  pixels[1] = 1; // (1,0)
  pixels[7] = 2; // (7,0)
  pixels[56] = 3; // (0,7)
  return pixels;
}

function flipPixelsH(pixels: Uint8Array): Uint8Array {
  const result = new Uint8Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      result[y * 8 + (7 - x)] = pixels[y * 8 + x] ?? 0;
    }
  }
  return result;
}

function flipPixelsV(pixels: Uint8Array): Uint8Array {
  const result = new Uint8Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      result[(7 - y) * 8 + x] = pixels[y * 8 + x] ?? 0;
    }
  }
  return result;
}

function flipPixelsHV(pixels: Uint8Array): Uint8Array {
  return flipPixelsV(flipPixelsH(pixels));
}

describe('chr-spritesheet-allocation (Issues #95 & #96)', () => {
  describe('OAM Attribute Hardware Encoding & Decoding', () => {
    it('encodes palette 0..3 with no flip correctly', () => {
      expect(encodeOamAttributes(0, 0)).toBe(0x00);
      expect(encodeOamAttributes(0, 1)).toBe(0x01);
      expect(encodeOamAttributes(0, 2)).toBe(0x02);
      expect(encodeOamAttributes(0, 3)).toBe(0x03);
    });

    it('encodes palette 0..3 with horizontal flip (0x40) correctly', () => {
      expect(encodeOamAttributes(NES_SPRITE_FLIP_HORIZONTAL, 0)).toBe(0x40);
      expect(encodeOamAttributes(NES_SPRITE_FLIP_HORIZONTAL, 1)).toBe(0x41);
      expect(encodeOamAttributes(NES_SPRITE_FLIP_HORIZONTAL, 2)).toBe(0x42);
      expect(encodeOamAttributes(NES_SPRITE_FLIP_HORIZONTAL, 3)).toBe(0x43);
    });

    it('encodes palette 0..3 with vertical flip (0x80) correctly', () => {
      expect(encodeOamAttributes(NES_SPRITE_FLIP_VERTICAL, 0)).toBe(0x80);
      expect(encodeOamAttributes(NES_SPRITE_FLIP_VERTICAL, 1)).toBe(0x81);
      expect(encodeOamAttributes(NES_SPRITE_FLIP_VERTICAL, 2)).toBe(0x82);
      expect(encodeOamAttributes(NES_SPRITE_FLIP_VERTICAL, 3)).toBe(0x83);
    });

    it('encodes palette 0..3 with horizontal + vertical flip (0xC0) correctly', () => {
      const hvFlip = NES_SPRITE_FLIP_HORIZONTAL | NES_SPRITE_FLIP_VERTICAL;
      expect(encodeOamAttributes(hvFlip, 0)).toBe(0xc0);
      expect(encodeOamAttributes(hvFlip, 1)).toBe(0xc1);
      expect(encodeOamAttributes(hvFlip, 2)).toBe(0xc2);
      expect(encodeOamAttributes(hvFlip, 3)).toBe(0xc3);
    });

    it('encodes and decodes priority behind background flag (bit 5 / 0x20)', () => {
      const attr = encodeOamAttributes(NES_SPRITE_FLIP_HORIZONTAL, 2, true);
      expect(attr).toBe(0x62); // 0x40 | 0x20 | 0x02

      const decoded = decodeOamAttributes(attr);
      expect(decoded.horizontalFlip).toBe(true);
      expect(decoded.verticalFlip).toBe(false);
      expect(decoded.priorityBehindBackground).toBe(true);
      expect(decoded.paletteIndex).toBe(2);
    });

    it('decodes all flip and palette combinations cleanly', () => {
      const decodedNone = decodeOamAttributes(0x00);
      expect(decodedNone).toEqual({
        horizontalFlip: false,
        verticalFlip: false,
        priorityBehindBackground: false,
        paletteIndex: 0,
      });

      const decodedHV = decodeOamAttributes(0xc3);
      expect(decodedHV).toEqual({
        horizontalFlip: true,
        verticalFlip: true,
        priorityBehindBackground: false,
        paletteIndex: 3,
      });
    });
  });

  describe('Deduplication Precedence and Determinism (findTileMatch)', () => {
    it('prefers exact match over any flip match regardless of slot position', () => {
      const basePixels = createAsymmetricTilePixels();
      const hPixels = flipPixelsH(basePixels);

      const slots = createEmptySlots();
      // Slot 2 has H-flipped pixels
      slots[2] = {
        physicalTileIndex: 2,
        tile: { id: 2, column: 2, row: 0, pixels: hPixels },
        source: 'imported',
      };
      // Slot 10 has exact matching pixels
      slots[10] = {
        physicalTileIndex: 10,
        tile: { id: 10, column: 10, row: 0, pixels: basePixels },
        source: 'imported',
      };

      const match = findTileMatch(
        { id: 0, column: 0, row: 0, pixels: basePixels },
        slots,
        0,
        true,
      );

      // Exact match at slot 10 MUST win over H-flip at slot 2
      expect(match).toEqual({
        physicalTileIndex: 10,
        attributes: 0,
        transform: 'none',
      });
    });

    it('prefers H flip over V flip and HV flip regardless of slot position', () => {
      const basePixels = createAsymmetricTilePixels();
      const vPixels = flipPixelsV(basePixels);
      const hvPixels = flipPixelsHV(basePixels);

      const slots = createEmptySlots();
      // Slot 3 has HV-flipped pixels
      slots[3] = {
        physicalTileIndex: 3,
        tile: { id: 3, column: 3, row: 0, pixels: hvPixels },
        source: 'imported',
      };
      // Slot 5 has V-flipped pixels
      slots[5] = {
        physicalTileIndex: 5,
        tile: { id: 5, column: 5, row: 0, pixels: vPixels },
        source: 'imported',
      };
      // Slot 20 has base pixels (so candidate H-flipped will match slot 20 with H-flip)
      slots[20] = {
        physicalTileIndex: 20,
        tile: { id: 20, column: 20, row: 0, pixels: basePixels },
        source: 'imported',
      };

      const candidateH = flipPixelsH(basePixels);
      const match = findTileMatch(
        { id: 0, column: 0, row: 0, pixels: candidateH },
        slots,
        0,
        true,
      );

      // Candidate matches slot 20 with H-flip (attributes: 0x40).
      // Slot 5 with HV-flip (since candidateH flipped V is HV) has lower precedence than H-flip at slot 20.
      expect(match).toEqual({
        physicalTileIndex: 20,
        attributes: NES_SPRITE_FLIP_HORIZONTAL,
        transform: 'h',
      });
    });

    it('prefers V flip over HV flip regardless of slot position', () => {
      const basePixels = createAsymmetricTilePixels();
      const hPixels = flipPixelsH(basePixels);

      const slots = createEmptySlots();
      // Slot 2 has H-flipped pixels (candidate V-flipped matches slot 2 with HV flip)
      slots[2] = {
        physicalTileIndex: 2,
        tile: { id: 2, column: 2, row: 0, pixels: hPixels },
        source: 'imported',
      };
      // Slot 15 has base pixels (candidate V-flipped matches slot 15 with V flip)
      slots[15] = {
        physicalTileIndex: 15,
        tile: { id: 15, column: 15, row: 0, pixels: basePixels },
        source: 'imported',
      };

      const candidateV = flipPixelsV(basePixels);
      const match = findTileMatch(
        { id: 0, column: 0, row: 0, pixels: candidateV },
        slots,
        0,
        true,
      );

      // V-flip at slot 15 MUST win over HV-flip at slot 2
      expect(match).toEqual({
        physicalTileIndex: 15,
        attributes: NES_SPRITE_FLIP_VERTICAL,
        transform: 'v',
      });
    });

    it('resolves ties deterministically to lowest physical index in the same match tier', () => {
      const basePixels = createAsymmetricTilePixels();
      const slots = createEmptySlots();

      slots[15] = {
        physicalTileIndex: 15,
        tile: { id: 15, column: 15, row: 0, pixels: basePixels },
        source: 'imported',
      };
      slots[8] = {
        physicalTileIndex: 8,
        tile: { id: 8, column: 8, row: 0, pixels: basePixels },
        source: 'imported',
      };
      slots[22] = {
        physicalTileIndex: 22,
        tile: { id: 22, column: 22, row: 0, pixels: basePixels },
        source: 'imported',
      };

      const match = findTileMatch(
        { id: 0, column: 0, row: 0, pixels: basePixels },
        slots,
        0,
        true,
      );

      expect(match?.physicalTileIndex).toBe(8);
      expect(match?.transform).toBe('none');
    });

    it('ignores flip matches when flipDeduplication is false', () => {
      const basePixels = createAsymmetricTilePixels();
      const slots = createEmptySlots();
      slots[5] = {
        physicalTileIndex: 5,
        tile: { id: 5, column: 5, row: 0, pixels: basePixels },
        source: 'imported',
      };

      const candidateH = flipPixelsH(basePixels);
      const match = findTileMatch(
        { id: 0, column: 0, row: 0, pixels: candidateH },
        slots,
        0,
        false, // disabled
      );

      expect(match).toBeNull();
    });

    it('never matches slots outside the target pattern table', () => {
      const basePixels = createAsymmetricTilePixels();
      const slots = createEmptySlots();
      // Place in PT1 (slot 300)
      slots[300] = {
        physicalTileIndex: 300,
        tile: { id: 300, column: 0, row: 0, pixels: basePixels },
        source: 'imported',
      };

      // Search in PT0
      const matchPT0 = findTileMatch(
        { id: 0, column: 0, row: 0, pixels: basePixels },
        slots,
        0,
        true,
      );
      expect(matchPT0).toBeNull();

      // Search in PT1
      const matchPT1 = findTileMatch(
        { id: 0, column: 0, row: 0, pixels: basePixels },
        slots,
        1,
        true,
      );
      expect(matchPT1).toEqual({
        physicalTileIndex: 300,
        attributes: 0,
        transform: 'none',
      });
    });
  });

  describe('Base CHR Flip-Aware Matching', () => {
    it('replaces no Base CHR slots and reuses Base CHR with H, V, and HV flips', () => {
      const basePixels = createAsymmetricTilePixels();

      // Create Base CHR with basePixels at physical slot 0
      // 8x8 2bpp NES tile format: plane 0 (bytes 0..7), plane 1 (bytes 8..15)
      const baseChr = new Uint8Array(4096);
      for (let y = 0; y < 8; y += 1) {
        let p0 = 0;
        let p1 = 0;
        for (let x = 0; x < 8; x += 1) {
          const color = basePixels[y * 8 + x] ?? 0;
          if ((color & 1) !== 0) p0 |= 1 << (7 - x);
          if ((color & 2) !== 0) p1 |= 1 << (7 - x);
        }
        baseChr[y] = p0;
        baseChr[8 + y] = p1;
      }

      const initialSlots = createPatternTableSlots(baseChr, 0);

      // Create spritesheet with 4 tiles: [Exact, H-flip, V-flip, HV-flip]
      const hPixels = flipPixelsH(basePixels);
      const vPixels = flipPixelsV(basePixels);
      const hvPixels = flipPixelsHV(basePixels);

      const imagePixels = new Uint8Array(32 * 8);
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          imagePixels[y * 32 + x] = basePixels[y * 8 + x] ?? 0;
          imagePixels[y * 32 + 8 + x] = hPixels[y * 8 + x] ?? 0;
          imagePixels[y * 32 + 16 + x] = vPixels[y * 8 + x] ?? 0;
          imagePixels[y * 32 + 24 + x] = hvPixels[y * 8 + x] ?? 0;
        }
      }

      const image: IndexedImage = {
        width: 32,
        height: 8,
        pixels: imagePixels,
        colors: [
          { red: 0, green: 0, blue: 0 },
          { red: 255, green: 0, blue: 0 },
          { red: 0, green: 255, blue: 0 },
          { red: 0, green: 0, blue: 255 },
        ],
        transparentIndex: 0,
        colorCount: 4,
      };

      const logicalFrames = extractLogicalAnimationFrames({
        image,
        frameIndices: [0],
        defaultDuration: 5,
        frameWidth: 32,
        frameHeight: 8,
        assetId: 'base-chr-consumer',
      });

      const result = allocateSpritesheetChr({
        logicalFrames,
        initialSlots,
        patternTable: 0,
        flipDeduplication: true,
      });

      // All 4 candidate tiles reuse Base CHR slot 0!
      expect(result.newTileCount).toBe(0);
      expect(result.reusedDestinationTiles).toBe(4);
      expect(result.reusedImportedTiles).toBe(0);

      const assignments = result.frameAssignments[0];
      expect(assignments?.length).toBe(4);

      // Tile 0: exact
      expect(assignments?.[0]).toMatchObject({
        physicalTileIndex: 0,
        localTileIndex: 0,
        flipAttributes: 0,
        transform: 'none',
        reuse: 'destination',
      });

      // Tile 1: H flip
      expect(assignments?.[1]).toMatchObject({
        physicalTileIndex: 0,
        localTileIndex: 0,
        flipAttributes: NES_SPRITE_FLIP_HORIZONTAL,
        transform: 'h',
        reuse: 'destination',
      });

      // Tile 2: V flip
      expect(assignments?.[2]).toMatchObject({
        physicalTileIndex: 0,
        localTileIndex: 0,
        flipAttributes: NES_SPRITE_FLIP_VERTICAL,
        transform: 'v',
        reuse: 'destination',
      });

      // Tile 3: HV flip
      expect(assignments?.[3]).toMatchObject({
        physicalTileIndex: 0,
        localTileIndex: 0,
        flipAttributes: NES_SPRITE_FLIP_HORIZONTAL | NES_SPRITE_FLIP_VERTICAL,
        transform: 'hv',
        reuse: 'destination',
      });
    });
  });

  describe('Multi-Asset Sharing & LogicalTileKey Integrity', () => {
    it('shares physical slots across distinct assets without replacing origin and maintains distinct LogicalTileKeys', () => {
      let slots = createEmptySlots();
      const basePixels = createAsymmetricTilePixels();
      const hPixels = flipPixelsH(basePixels);

      // Asset 1: "hero" (width 8, height 8) -> allocates slot 0
      const heroImage: IndexedImage = {
        width: 8,
        height: 8,
        pixels: basePixels,
        colors: [
          { red: 0, green: 0, blue: 0 },
          { red: 255, green: 0, blue: 0 },
          { red: 0, green: 0, blue: 0 },
          { red: 0, green: 0, blue: 0 },
        ],
        transparentIndex: 0,
        colorCount: 4,
      };
      const heroFrames = extractLogicalAnimationFrames({
        image: heroImage,
        frameIndices: [0],
        defaultDuration: 6,
        frameWidth: 8,
        frameHeight: 8,
        assetId: 'hero',
      });

      const heroResult = allocateSpritesheetChr({
        logicalFrames: heroFrames,
        initialSlots: slots,
        patternTable: 0,
      });
      slots = heroResult.slots as PatternTableSlot[];
      expect(heroResult.newTileCount).toBe(1);
      expect(heroResult.frameAssignments[0]?.[0]?.logicalKey).toBe('hero:0:0');
      expect(heroResult.frameAssignments[0]?.[0]?.physicalTileIndex).toBe(0);

      // Asset 2: "enemy" (width 8, height 8) with H-flipped pixels -> reuses slot 0 via H-flip
      const enemyImage: IndexedImage = {
        width: 8,
        height: 8,
        pixels: hPixels,
        colors: [
          { red: 0, green: 0, blue: 0 },
          { red: 255, green: 0, blue: 0 },
          { red: 0, green: 0, blue: 0 },
          { red: 0, green: 0, blue: 0 },
        ],
        transparentIndex: 0,
        colorCount: 4,
      };
      const enemyFrames = extractLogicalAnimationFrames({
        image: enemyImage,
        frameIndices: [0],
        defaultDuration: 6,
        frameWidth: 8,
        frameHeight: 8,
        assetId: 'enemy',
      });

      const enemyResult = allocateSpritesheetChr({
        logicalFrames: enemyFrames,
        initialSlots: slots,
        patternTable: 0,
      });

      expect(enemyResult.newTileCount).toBe(0);
      expect(enemyResult.reusedImportedTiles).toBe(1);
      expect(enemyResult.frameAssignments[0]?.[0]?.logicalKey).toBe(
        'enemy:0:0',
      );
      expect(enemyResult.frameAssignments[0]?.[0]?.physicalTileIndex).toBe(0);
      expect(enemyResult.frameAssignments[0]?.[0]?.transform).toBe('h');
      expect(enemyResult.frameAssignments[0]?.[0]?.flipAttributes).toBe(
        NES_SPRITE_FLIP_HORIZONTAL,
      );
    });
  });

  describe('ChrAssetMappingIndex Integration', () => {
    it('builds ChrAssetMappingIndex registering primary origin from first allocator and sharing usages from flip consumers', () => {
      const basePixels = createAsymmetricTilePixels();
      const hPixels = flipPixelsH(basePixels);

      const anim1Image: IndexedImage = {
        width: 8,
        height: 8,
        pixels: basePixels,
        colors: [
          { red: 0, green: 0, blue: 0 },
          { red: 255, green: 0, blue: 0 },
          { red: 0, green: 255, blue: 0 },
          { red: 0, green: 0, blue: 255 },
        ],
        transparentIndex: 0,
        colorCount: 4,
      };

      const anim2Image: IndexedImage = {
        width: 8,
        height: 8,
        pixels: hPixels,
        colors: [
          { red: 0, green: 0, blue: 0 },
          { red: 255, green: 0, blue: 0 },
          { red: 0, green: 255, blue: 0 },
          { red: 0, green: 0, blue: 255 },
        ],
        transparentIndex: 0,
        colorCount: 4,
      };

      const animDefinitions: AnimationDefinitionInput[] = [
        {
          id: 'hero-anim',
          name: 'HeroWalk',
          image: anim1Image,
          frameIndices: [0],
          frameDuration: 6,
          frameWidth: 8,
          frameHeight: 8,
          paletteIndex: 1,
        },
        {
          id: 'enemy-anim',
          name: 'EnemyWalk',
          image: anim2Image,
          frameIndices: [0],
          frameDuration: 6,
          frameWidth: 8,
          frameHeight: 8,
          paletteIndex: 2,
        },
      ];

      const model = buildAnimationProjectModel({
        name: 'SharedProject',
        animations: animDefinitions,
        image: anim1Image,
        destinationPatternTable: 0,
        flipDeduplication: true,
      });

      // Build the bidirectional asset mapping index
      const mappingIndex = buildChrAssetMappingIndex({
        mode: 'animation',
        animationModel: model,
      });

      // Physical slot 0 was allocated by HeroWalk (origin) and reused by EnemyWalk (shared usage)
      const slotAttr = getPhysicalSlotAttribution(0, mappingIndex);
      expect(slotAttr).toBeDefined();
      expect(slotAttr?.isShared).toBe(true);
      expect(slotAttr?.usageCount).toBe(2);

      const origin = slotAttr?.origin;
      expect(origin?.primaryAssetId).toBe('hero-anim');
      expect(origin?.primaryAssetName).toBe('HeroWalk');
      expect(origin?.logicalKey).toBe('hero-anim:0:0');

      const usages = slotAttr?.usages ?? [];
      expect(usages.length).toBe(2);

      // Usage 1: hero (palette 1, no flip)
      const heroUsage = usages.find((u) => u.assetId === 'hero-anim');
      expect(heroUsage?.logicalKey).toBe('hero-anim:0:0');
      expect(heroUsage?.type).toBe('animation');
      if (heroUsage?.type === 'animation') {
        expect(heroUsage.horizontalFlip).toBe(false);
      }

      // Usage 2: enemy (palette 2, H-flip)
      const enemyUsage = usages.find((u) => u.assetId === 'enemy-anim');
      expect(enemyUsage?.logicalKey).toBe('enemy-anim:0:0');
      expect(enemyUsage?.type).toBe('animation');
      if (enemyUsage?.type === 'animation') {
        expect(enemyUsage.horizontalFlip).toBe(true);
      }

      // Reverse queries by LogicalTileKey
      const heroLogicalUsages = getUsagesForLogicalKey(
        'hero-anim:0:0',
        mappingIndex,
      );
      expect(heroLogicalUsages.length).toBe(1);
      expect(heroLogicalUsages[0]?.physicalTileIndex).toBe(0);

      const enemyLogicalUsages = getUsagesForLogicalKey(
        'enemy-anim:0:0',
        mappingIndex,
      );
      expect(enemyLogicalUsages.length).toBe(1);
      expect(enemyLogicalUsages[0]?.physicalTileIndex).toBe(0);
    });
  });

  describe('Decoupled Mirrored Animation Direction Interaction', () => {
    it('composes visual animation flip with allocation deduplication flip correctly', () => {
      // Create an animation whose sprite was deduplicated with H-flip
      const basePixels = createAsymmetricTilePixels();
      const hPixels = flipPixelsH(basePixels);

      // Frame 0 has basePixels (allocates slot 0)
      // Frame 1 has hPixels (deduplicates to slot 0 with H-flip)
      const imagePixels = new Uint8Array(16 * 8);
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          imagePixels[y * 16 + x] = basePixels[y * 8 + x] ?? 0;
          imagePixels[y * 16 + 8 + x] = hPixels[y * 8 + x] ?? 0;
        }
      }

      const image: IndexedImage = {
        width: 16,
        height: 8,
        pixels: imagePixels,
        colors: [
          { red: 0, green: 0, blue: 0 },
          { red: 255, green: 0, blue: 0 },
          { red: 0, green: 255, blue: 0 },
          { red: 0, green: 0, blue: 255 },
        ],
        transparentIndex: 0,
        colorCount: 4,
      };

      const model = buildAnimationProjectModel({
        name: 'Player',
        image,
        animations: [
          {
            id: 'player-walk',
            name: 'Walk',
            direction: 'right',
            category: 'movement',
            exportMirroredDirection: true,
            frameIndices: [0, 1],
            frameDuration: 4,
            frameWidth: 8,
            frameHeight: 8,
            paletteIndex: 1,
          },
        ],
        destinationPatternTable: 0,
        flipDeduplication: true,
      });

      // Model contains primary Walk_right and mirrored Walk_left
      expect(model.animations.length).toBe(2);
      const rightAnim = model.animations[0];
      const leftAnim = model.animations[1];

      expect(rightAnim?.name).toBe('Walk_right');
      expect(leftAnim?.name).toBe('Walk_left');

      // Right animation:
      // Frame 0 sprite: horizontalFlip = false, attributes = 0x01
      // Frame 1 sprite: horizontalFlip = true, attributes = 0x41
      expect(rightAnim?.frames[0]?.sprites[0]?.horizontalFlip).toBe(false);
      expect(rightAnim?.frames[0]?.sprites[0]?.attributes).toBe(0x01);
      expect(rightAnim?.frames[1]?.sprites[0]?.horizontalFlip).toBe(true);
      expect(rightAnim?.frames[1]?.sprites[0]?.attributes).toBe(0x41);

      // Left animation (mirrored):
      // Frame 0 sprite: horizontalFlip becomes true (0 XOR 1 = 1), attributes = 0x41
      // Frame 1 sprite: horizontalFlip becomes false (1 XOR 1 = 0), attributes = 0x01
      expect(leftAnim?.frames[0]?.sprites[0]?.horizontalFlip).toBe(true);
      expect(leftAnim?.frames[0]?.sprites[0]?.attributes).toBe(0x41);
      expect(leftAnim?.frames[1]?.sprites[0]?.horizontalFlip).toBe(false);
      expect(leftAnim?.frames[1]?.sprites[0]?.attributes).toBe(0x01);
    });
  });

  describe('Original PT0/PT1 & Capacity Tests from Issue #95', () => {
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

    it('skips reserved slots and allocates in first unreserved slot', () => {
      const regions: ChrRegion[] = [
        {
          id: 'res-1',
          name: 'HUD Reservation',
          patternTable: 0,
          startTile: 0,
          endTile: 3,
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

      expect(result.frameAssignments[0]?.[0]?.physicalTileIndex).toBe(4);
      expect(result.slots[0]?.tile).toBeNull();
      expect(result.slots[1]?.tile).toBeNull();
      expect(result.slots[2]?.tile).toBeNull();
      expect(result.slots[3]?.tile).toBeNull();
      expect(result.slots[4]?.tile).not.toBeNull();
    });

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

      initialSlots[0] = {
        physicalTileIndex: 0,
        tile: { id: 0, column: 0, row: 0, pixels: new Uint8Array(64).fill(1) },
        source: 'imported',
      };

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

      const image = createTestIndexedImage(8, 8, () => 3);
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

      expect(initialSlots[0].source).toBe('imported');
      for (let i = 1; i < 512; i += 1) {
        expect(initialSlots[i]?.tile).toBeNull();
      }
    });

    it('STRONG DETERMINISM: identical inputs produce identical binary results', () => {
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
});
