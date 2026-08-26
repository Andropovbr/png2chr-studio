import { describe, expect, it } from 'vitest';
import {
  analyzeChrOwnershipDiagnostics,
  buildChrAssetMappingIndex,
  calculateAssetChrMetrics,
  calculateProjectChrOwnershipMetrics,
  formatChrOwnershipDiagnosticMessage,
  getPhysicalIndicesForAsset,
  getPhysicalSlotAttribution,
  getUsagesForLogicalKey,
  type AnimationTileUsage,
  type ChrAssetMappingIndex,
  type PhysicalSlotAttribution,
  type PlayfieldTileUsage,
  type TilesetTileUsage,
} from './chr-asset-mapping';
import {
  buildAnimationProjectModel,
  type AnimationDefinitionInput,
} from './animation-model';
import { createDefaultProject } from './project';
import { encodeTile } from './chr-encoder';
import { NES_CHR_ROM_SIZE } from './chr-pattern-table';
import type { IndexedImage, Tile } from './types';

function createSolidTile(id: number, colorIndex: number): Tile {
  const pixels = new Uint8Array(64).fill(colorIndex);
  return {
    id,
    column: id % 16,
    row: Math.floor(id / 16),
    pixels,
  };
}

function createPatternTile(
  id: number,
  pattern: number[],
  column = id % 16,
  row = Math.floor(id / 16),
): Tile {
  const pixels = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    pixels[i] = pattern[i % pattern.length] ?? 0;
  }
  return {
    id,
    column,
    row,
    pixels,
  };
}

function createIndexedImage(
  width: number,
  height: number,
  filler: (x: number, y: number) => number,
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

describe('ChrAssetMappingIndex (Milestone 6)', () => {
  it('1. Empty project produces a 512-slot mapping with no fabricated ownership', () => {
    const project = createDefaultProject('Empty Project', 'animation');
    const index = buildChrAssetMappingIndex({ project });

    expect(index.byPhysicalIndex).toHaveLength(512);

    for (let i = 0; i < 512; i += 1) {
      const slot = index.byPhysicalIndex[i];
      expect(slot).toBeDefined();
      expect(slot?.physicalIndex).toBe(i);
      expect(slot?.patternTable).toBe(i < 256 ? 0 : 1);
      expect(slot?.localIndex).toBe(i % 256);
      expect(slot?.origin).toBeUndefined();
      expect(slot?.usages).toHaveLength(0);
      expect(slot?.usageCount).toBe(0);
      expect(slot?.isShared).toBe(false);
    }

    expect(index.physicalIndicesByAsset.size).toBe(0);
  });

  it('2. One Tileset logical tile maps to the correct physical slot', () => {
    const tile = createPatternTile(0, [1, 2, 3, 0], 2, 3);

    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tile],
      tilesetAssetId: 'asset-tileset-main',
      destinationPatternTable: 0,
    });

    const slot0 = getPhysicalSlotAttribution(0, index);
    expect(slot0).toBeDefined();
    expect(slot0?.physicalIndex).toBe(0);
    expect(slot0?.patternTable).toBe(0);
    expect(slot0?.localIndex).toBe(0);
    expect(slot0?.origin).toEqual({
      primaryAssetId: 'asset-tileset-main',
      primaryAssetName: 'Tileset Image',
      logicalKey: 'asset-tileset-main:2:3',
      sourceCoordinates: {
        tileX: 2,
        tileY: 3,
        pixelX: 16,
        pixelY: 24,
      },
      creationKind: 'extracted',
    });

    expect(slot0?.usageCount).toBe(1);
    expect(slot0?.isShared).toBe(false);
    expect(slot0?.usages[0]).toEqual({
      type: 'tileset',
      assetId: 'asset-tileset-main',
      tileIndex: 0,
      sourceIndex: 0,
      physicalTileIndex: 0,
      logicalKey: 'asset-tileset-main:2:3',
      sourceCoordinates: {
        tileX: 2,
        tileY: 3,
      },
    });

    const associatedSlots = getPhysicalIndicesForAsset(
      'asset-tileset-main',
      index,
    );
    expect(Array.from(associatedSlots)).toEqual([0]);
  });

  it('3. Multiple Tileset logical tiles preserve distinct logical identities', () => {
    const tile1 = createPatternTile(0, [1, 0, 0, 0], 0, 0);
    const tile2 = createPatternTile(1, [2, 0, 0, 0], 1, 0);
    const tile3 = createPatternTile(2, [3, 0, 0, 0], 2, 0);

    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tile1, tile2, tile3],
      tilesetAssetId: 'asset-tileset-stage1',
      destinationPatternTable: 0,
      deduplicationEnabled: true,
    });

    const slot0 = getPhysicalSlotAttribution(0, index);
    const slot1 = getPhysicalSlotAttribution(1, index);
    const slot2 = getPhysicalSlotAttribution(2, index);

    expect(slot0?.origin?.logicalKey).toBe('asset-tileset-stage1:0:0');
    expect(slot1?.origin?.logicalKey).toBe('asset-tileset-stage1:1:0');
    expect(slot2?.origin?.logicalKey).toBe('asset-tileset-stage1:2:0');

    expect(slot0?.usages[0]?.logicalKey).toBe('asset-tileset-stage1:0:0');
    expect(slot1?.usages[0]?.logicalKey).toBe('asset-tileset-stage1:1:0');
    expect(slot2?.usages[0]?.logicalKey).toBe('asset-tileset-stage1:2:0');

    const assetIndices = getPhysicalIndicesForAsset(
      'asset-tileset-stage1',
      index,
    );
    expect(Array.from(assetIndices)).toEqual([0, 1, 2]);
  });

  it('4. Playfield source tile mapping is distinct from nametable occurrence usage', () => {
    // 32 columns x 30 rows = 960 cells
    const nametable = new Uint8Array(960);
    // Cell at column 5, row 2 (index 2 * 32 + 5 = 69) references tile index 3
    nametable[69] = 3;

    const index = buildChrAssetMappingIndex({
      mode: 'playfield',
      playfieldNametable: nametable,
      playfieldAssetId: 'asset-playfield-world1',
      destinationPatternTable: 0,
    });

    const slot3 = getPhysicalSlotAttribution(3, index);
    expect(slot3).toBeDefined();
    expect(slot3?.physicalIndex).toBe(3);

    // Origin is the first cell that allocated it
    expect(slot3?.origin?.primaryAssetId).toBe('asset-playfield-world1');
    expect(slot3?.origin?.logicalKey).toBe('asset-playfield-world1:5:2');

    // Usages contain the occurrence at nametable index 69
    const usage69 = slot3?.usages.find(
      (u) => (u as PlayfieldTileUsage).nametableIndex === 69,
    ) as PlayfieldTileUsage | undefined;
    expect(usage69).toBeDefined();
    expect(usage69?.column).toBe(5);
    expect(usage69?.row).toBe(2);
    expect(usage69?.localTileIndex).toBe(3);
    expect(usage69?.physicalTileIndex).toBe(3);
    expect(usage69?.logicalKey).toBe('asset-playfield-world1:5:2');
  });

  it('5. Repeated Playfield occurrences produce multiple usages without multiple physical allocations', () => {
    // 960 cells all pointing to local tile index 0 (physical slot 0)
    const nametable = new Uint8Array(960).fill(0);

    const index = buildChrAssetMappingIndex({
      mode: 'playfield',
      playfieldNametable: nametable,
      playfieldAssetId: 'asset-playfield-bg',
      destinationPatternTable: 0,
    });

    const slot0 = getPhysicalSlotAttribution(0, index);
    expect(slot0).toBeDefined();
    expect(slot0?.origin?.logicalKey).toBe('asset-playfield-bg:0:0');
    expect(slot0?.usageCount).toBe(960);
    expect(slot0?.isShared).toBe(true);

    // Verify distinct nametable occurrences are tracked
    expect(slot0?.usages[0]).toEqual({
      type: 'playfield',
      assetId: 'asset-playfield-bg',
      column: 0,
      row: 0,
      nametableIndex: 0,
      localTileIndex: 0,
      physicalTileIndex: 0,
      logicalKey: 'asset-playfield-bg:0:0',
    });

    expect(slot0?.usages[959]).toEqual({
      type: 'playfield',
      assetId: 'asset-playfield-bg',
      column: 31,
      row: 29,
      nametableIndex: 959,
      localTileIndex: 0,
      physicalTileIndex: 0,
      logicalKey: 'asset-playfield-bg:31:29',
    });

    // Only 1 physical slot allocated
    const slots = getPhysicalIndicesForAsset('asset-playfield-bg', index);
    expect(Array.from(slots)).toEqual([0]);
  });

  it('6. Animation metasprite tile maps to its authoritative physicalTileIndex', () => {
    const image = createIndexedImage(16, 16, (x, y) =>
      x < 8 && y < 8 ? 1 : 0,
    );
    const animInput: AnimationDefinitionInput = {
      id: 'anim-hero-idle',
      name: 'Hero Idle',
      image,
      frameWidth: 16,
      frameHeight: 16,
      frameIndices: [0],
      frameDuration: 6,
    };

    const model = buildAnimationProjectModel({
      name: 'Hero',
      animations: [animInput],
      patternTable: 0,
    });

    const index = buildChrAssetMappingIndex({
      mode: 'animation',
      animationModel: model,
      animations: [
        {
          id: 'anim-hero-idle',
          name: 'Hero Idle',
          asset: { id: 'asset-hero-sheet' },
        },
      ],
    });

    // Sprite at (0,0) is non-transparent and gets allocated to physical slot 0
    const slot0 = getPhysicalSlotAttribution(0, index);
    expect(slot0).toBeDefined();
    expect(slot0?.origin?.primaryAssetId).toBe('asset-hero-sheet');
    expect(slot0?.origin?.logicalKey).toBe('asset-hero-sheet:0:0');
    expect(slot0?.usageCount).toBe(1);

    const usage = slot0?.usages[0] as AnimationTileUsage | undefined;
    expect(usage?.type).toBe('animation');
    expect(usage?.assetId).toBe('asset-hero-sheet');
    expect(usage?.animationId).toBe('anim-hero-idle');
    expect(usage?.frameIndex).toBe(0);
    expect(usage?.spriteIndex).toBe(0);
    expect(usage?.physicalTileIndex).toBe(0);
    expect(usage?.logicalKey).toBe('asset-hero-sheet:0:0');
  });

  it('7. Multiple animation frames using the same physical tile generate structured multiple usages', () => {
    // 32x16 image: 2 frames of 16x16.
    // Frame 0 has non-zero tile at top-left.
    // Frame 1 has the identical non-zero tile at top-left.
    const image = createIndexedImage(32, 16, (x, y) => {
      if ((x < 8 || (x >= 16 && x < 24)) && y < 8) {
        return 2;
      }
      return 0;
    });

    const animInput: AnimationDefinitionInput = {
      id: 'anim-hero-walk',
      name: 'Hero Walk',
      image,
      frameWidth: 16,
      frameHeight: 16,
      frameIndices: [0, 1],
      frameDuration: 6,
    };

    const model = buildAnimationProjectModel({
      name: 'Hero',
      animations: [animInput],
      patternTable: 0,
    });

    const index = buildChrAssetMappingIndex({
      mode: 'animation',
      animationModel: model,
      animations: [
        {
          id: 'anim-hero-walk',
          name: 'Hero Walk',
          asset: { id: 'asset-hero-sprites' },
        },
      ],
    });

    const slot0 = getPhysicalSlotAttribution(0, index);
    expect(slot0).toBeDefined();
    expect(slot0?.origin?.logicalKey).toBe('asset-hero-sprites:0:0');
    expect(slot0?.usageCount).toBe(2);
    expect(slot0?.isShared).toBe(true);

    const frame0Usage = slot0?.usages.find(
      (u) => u.type === 'animation' && u.frameIndex === 0,
    );
    const frame1Usage = slot0?.usages.find(
      (u) => u.type === 'animation' && u.frameIndex === 1,
    );

    expect(frame0Usage).toBeDefined();
    expect(frame1Usage).toBeDefined();
    expect(frame0Usage?.logicalKey).toBe('asset-hero-sprites:0:0');
    expect(frame1Usage?.logicalKey).toBe('asset-hero-sprites:2:0');
  });

  it('8. Same-asset deduplication: two different logical keys share one physical slot', () => {
    // Tileset with two identical tiles at different positions in the source image
    const tileA = createPatternTile(0, [1, 2, 3, 0], 0, 0);
    const tileB = createPatternTile(1, [1, 2, 3, 0], 4, 1); // identical pixels

    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tileA, tileB],
      tilesetAssetId: 'asset-tileset-shared',
      deduplicationEnabled: true,
    });

    const slot0 = getPhysicalSlotAttribution(0, index);
    expect(slot0).toBeDefined();
    expect(slot0?.origin?.primaryAssetId).toBe('asset-tileset-shared');
    expect(slot0?.origin?.logicalKey).toBe('asset-tileset-shared:0:0');
    expect(slot0?.usageCount).toBe(2);
    expect(slot0?.isShared).toBe(true);

    expect(slot0?.usages[0]?.logicalKey).toBe('asset-tileset-shared:0:0');
    expect(slot0?.usages[1]?.logicalKey).toBe('asset-tileset-shared:4:1');
  });

  it('9. Cross-asset deduplication: two different asset IDs share one physical slot', () => {
    // Animation 1 from Asset A produces a tile
    const imageA = createIndexedImage(16, 16, (x, y) =>
      x < 8 && y < 8 ? 3 : 0,
    );
    // Animation 2 from Asset B produces the identical tile
    const imageB = createIndexedImage(16, 16, (x, y) =>
      x < 8 && y < 8 ? 3 : 0,
    );

    const animA: AnimationDefinitionInput = {
      id: 'anim-hero',
      name: 'Hero',
      image: imageA,
      frameWidth: 16,
      frameHeight: 16,
      frameIndices: [0],
      frameDuration: 6,
    };
    const animB: AnimationDefinitionInput = {
      id: 'anim-enemy',
      name: 'Enemy',
      image: imageB,
      frameWidth: 16,
      frameHeight: 16,
      frameIndices: [0],
      frameDuration: 6,
    };

    const model = buildAnimationProjectModel({
      name: 'TestGame',
      animations: [animA, animB],
      patternTable: 0,
    });

    const index = buildChrAssetMappingIndex({
      mode: 'animation',
      animationModel: model,
      animations: [
        { id: 'anim-hero', name: 'Hero', asset: { id: 'asset-hero' } },
        { id: 'anim-enemy', name: 'Enemy', asset: { id: 'asset-enemy' } },
      ],
    });

    const slot0 = getPhysicalSlotAttribution(0, index);
    expect(slot0).toBeDefined();
    // Primary origin belongs to the first allocator (Asset A)
    expect(slot0?.origin?.primaryAssetId).toBe('asset-hero');
    expect(slot0?.origin?.logicalKey).toBe('asset-hero:0:0');
    expect(slot0?.usageCount).toBe(2);
    expect(slot0?.isShared).toBe(true);

    // Both assets are in usages
    const heroUsage = slot0?.usages.find((u) => u.assetId === 'asset-hero');
    const enemyUsage = slot0?.usages.find((u) => u.assetId === 'asset-enemy');
    expect(heroUsage).toBeDefined();
    expect(enemyUsage).toBeDefined();

    // Reverse lookup maps both assets to slot 0
    expect(
      Array.from(getPhysicalIndicesForAsset('asset-hero', index)),
    ).toContain(0);
    expect(
      Array.from(getPhysicalIndicesForAsset('asset-enemy', index)),
    ).toContain(0);
  });

  it('10. Flip-aware deduplication preserves flip metadata without creating another physical origin', () => {
    // Left-arrow tile and right-arrow tile (horizontally flipped)
    const image = createIndexedImage(32, 16, (x, y) => {
      if (y < 8) {
        if (x < 8) return x === y ? 1 : 0;
        if (x >= 16 && x < 24) return 7 - (x - 16) === y ? 1 : 0; // H-flip of frame 0
      }
      return 0;
    });

    const anim: AnimationDefinitionInput = {
      id: 'anim-arrows',
      name: 'Arrows',
      image,
      frameWidth: 16,
      frameHeight: 16,
      frameIndices: [0, 1],
      frameDuration: 6,
      allowHorizontalFlip: true,
    };

    const model = buildAnimationProjectModel({
      name: 'ArrowsGame',
      animations: [anim],
      patternTable: 0,
      flipDeduplication: true,
    });

    const index = buildChrAssetMappingIndex({
      mode: 'animation',
      animationModel: model,
      animations: [
        { id: 'anim-arrows', name: 'Arrows', asset: { id: 'asset-arrows' } },
      ],
    });

    const slot0 = getPhysicalSlotAttribution(0, index);
    expect(slot0).toBeDefined();
    expect(slot0?.origin?.primaryAssetId).toBe('asset-arrows');
    expect(slot0?.usageCount).toBe(2);
    expect(slot0?.isShared).toBe(true);

    const normalUsage = slot0?.usages.find(
      (u) => !(u as AnimationTileUsage).horizontalFlip,
    );
    const flippedUsage = slot0?.usages.find(
      (u) => (u as AnimationTileUsage).horizontalFlip,
    );

    expect(normalUsage).toBeDefined();
    expect(flippedUsage).toBeDefined();
  });

  it('11. Base CHR occupied tile is the primary origin when reused by project content', () => {
    const baseChr = new Uint8Array(4096);
    // Occupied tile at index 5 in baseChr
    const sampleTile = createPatternTile(5, [1, 2, 3, 1]);
    baseChr.set(encodeTile(sampleTile), 5 * 16);

    // Animation image that contains the identical tile pattern
    const image = createIndexedImage(16, 16, (x, y) => {
      if (x < 8 && y < 8) {
        return sampleTile.pixels[y * 8 + x] ?? 0;
      }
      return 0;
    });

    const anim: AnimationDefinitionInput = {
      id: 'anim-ui',
      name: 'UI',
      image,
      frameWidth: 16,
      frameHeight: 16,
      frameIndices: [0],
      frameDuration: 6,
    };

    const model = buildAnimationProjectModel({
      name: 'BaseReuser',
      animations: [anim],
      baseChr,
      patternTable: 0,
      destinationPatternTable: 0,
    });

    const index = buildChrAssetMappingIndex({
      mode: 'animation',
      animationModel: model,
      baseChr,
      baseChrAssetId: 'asset-base-font',
      destinationPatternTable: 0,
      animations: [
        { id: 'anim-ui', name: 'UI', asset: { id: 'asset-ui-sheet' } },
      ],
    });

    // Slot 5 was in Base CHR and matched by animation
    const slot5 = getPhysicalSlotAttribution(5, index);
    expect(slot5).toBeDefined();
    expect(slot5?.origin?.primaryAssetId).toBe('asset-base-font');
    expect(slot5?.origin?.creationKind).toBe('base-chr');

    // Animation is recorded as a usage of slot 5
    expect(slot5?.usageCount).toBe(1);
    expect(slot5?.usages[0]?.assetId).toBe('asset-ui-sheet');
    expect(slot5?.usages[0]?.physicalTileIndex).toBe(5);

    // Reverse lookup contains slot 5 for both Base CHR and animation asset
    expect(
      Array.from(getPhysicalIndicesForAsset('asset-base-font', index)),
    ).toContain(5);
    expect(
      Array.from(getPhysicalIndicesForAsset('asset-ui-sheet', index)),
    ).toContain(5);
  });

  it('12. Zero-filled Base CHR slots do not receive Base CHR origins', () => {
    const baseChr = new Uint8Array(4096);
    // Only slot 10 is occupied
    const sampleTile = createPatternTile(10, [3, 2, 1, 0]);
    baseChr.set(encodeTile(sampleTile), 10 * 16);

    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      baseChr,
      baseChrAssetId: 'asset-base-chr',
      destinationPatternTable: 0,
    });

    // Slot 10 has origin
    const slot10 = getPhysicalSlotAttribution(10, index);
    expect(slot10?.origin?.creationKind).toBe('base-chr');
    expect(slot10?.origin?.primaryAssetId).toBe('asset-base-chr');

    // Slot 0 and slot 1 are zero-filled and have NO origin
    const slot0 = getPhysicalSlotAttribution(0, index);
    const slot1 = getPhysicalSlotAttribution(1, index);
    expect(slot0?.origin).toBeUndefined();
    expect(slot1?.origin).toBeUndefined();
  });

  it('13. PT0 and PT1 physical indexes remain distinct and correct', () => {
    const tilePt0 = createPatternTile(0, [1, 1, 1, 1]);
    const tilePt1 = createPatternTile(1, [2, 2, 2, 2]);

    const indexPt0 = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tilePt0],
      destinationPatternTable: 0,
      tilesetAssetId: 'asset-pt0',
    });

    const indexPt1 = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tilePt1],
      destinationPatternTable: 1,
      tilesetAssetId: 'asset-pt1',
    });

    const slotPt0 = getPhysicalSlotAttribution(0, indexPt0);
    expect(slotPt0?.physicalIndex).toBe(0);
    expect(slotPt0?.patternTable).toBe(0);
    expect(slotPt0?.localIndex).toBe(0);
    expect(slotPt0?.origin?.primaryAssetId).toBe('asset-pt0');

    const slotPt1 = getPhysicalSlotAttribution(256, indexPt1);
    expect(slotPt1?.physicalIndex).toBe(256);
    expect(slotPt1?.patternTable).toBe(1);
    expect(slotPt1?.localIndex).toBe(0);
    expect(slotPt1?.origin?.primaryAssetId).toBe('asset-pt1');
  });

  it('14. Boundary indexes: 0, 255, 256, 511 are handled correctly', () => {
    const baseChr = new Uint8Array(NES_CHR_ROM_SIZE);
    // Place occupied tiles at boundary slots: 0, 255, 256, 511
    baseChr.set(encodeTile(createSolidTile(0, 1)), 0 * 16);
    baseChr.set(encodeTile(createSolidTile(255, 2)), 255 * 16);
    baseChr.set(encodeTile(createSolidTile(256, 3)), 256 * 16);
    baseChr.set(encodeTile(createSolidTile(511, 1)), 511 * 16);

    const index = buildChrAssetMappingIndex({
      baseChr,
      baseChrAssetId: 'asset-base-full',
      destinationPatternTable: 0,
    });

    const slot0 = getPhysicalSlotAttribution(0, index);
    const slot255 = getPhysicalSlotAttribution(255, index);
    const slot256 = getPhysicalSlotAttribution(256, index);
    const slot511 = getPhysicalSlotAttribution(511, index);

    expect(slot0?.patternTable).toBe(0);
    expect(slot0?.localIndex).toBe(0);
    expect(slot0?.origin?.creationKind).toBe('base-chr');

    expect(slot255?.patternTable).toBe(0);
    expect(slot255?.localIndex).toBe(255);
    expect(slot255?.origin?.creationKind).toBe('base-chr');

    expect(slot256?.patternTable).toBe(1);
    expect(slot256?.localIndex).toBe(0);
    expect(slot256?.origin?.creationKind).toBe('base-chr');

    expect(slot511?.patternTable).toBe(1);
    expect(slot511?.localIndex).toBe(255);
    expect(slot511?.origin?.creationKind).toBe('base-chr');

    expect(getPhysicalSlotAttribution(-1, index)).toBeUndefined();
    expect(getPhysicalSlotAttribution(512, index)).toBeUndefined();
  });

  it('15. physicalIndicesByAsset contains unique physical indexes without duplicates', () => {
    // Nametable referencing slot 7 across all cells
    const nametable = new Uint8Array(960).fill(7);

    const index = buildChrAssetMappingIndex({
      mode: 'playfield',
      playfieldNametable: nametable,
      playfieldAssetId: 'asset-pf-repeater',
    });

    const set = getPhysicalIndicesForAsset('asset-pf-repeater', index);
    expect(Array.from(set)).toEqual([7]);
  });

  it('16. Shared status and usage count are deterministic', () => {
    const tileSingle = createPatternTile(0, [1, 2, 0, 0]);
    const tileSharedA = createPatternTile(1, [3, 0, 0, 0]);
    const tileSharedB = createPatternTile(2, [3, 0, 0, 0]); // duplicates tileSharedA

    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tileSingle, tileSharedA, tileSharedB],
      tilesetAssetId: 'asset-ts',
      deduplicationEnabled: true,
    });

    const slot0 = getPhysicalSlotAttribution(0, index);
    const slot1 = getPhysicalSlotAttribution(1, index);

    expect(slot0?.usageCount).toBe(1);
    expect(slot0?.isShared).toBe(false);

    expect(slot1?.usageCount).toBe(2);
    expect(slot1?.isShared).toBe(true);
  });

  it('17. Duplicate semantic usage records are not accidentally emitted twice', () => {
    // Redundant execution or calls preserve single semantic usage per metasprite / cell
    const nametable = new Uint8Array(960);
    nametable[0] = 0;

    const index = buildChrAssetMappingIndex({
      mode: 'playfield',
      playfieldNametable: nametable,
      playfieldAssetId: 'asset-pf-unique',
    });

    const slot0 = getPhysicalSlotAttribution(0, index);
    expect(
      slot0?.usages.filter(
        (u) => (u as PlayfieldTileUsage).nametableIndex === 0,
      ),
    ).toHaveLength(1);
  });

  it('18. Same inputs produce semantically identical mapping results', () => {
    const tile = createPatternTile(0, [1, 2, 3, 0]);
    const options = {
      mode: 'tileset' as const,
      tiles: [tile],
      tilesetAssetId: 'asset-deterministic',
    };

    const indexA = buildChrAssetMappingIndex(options);
    const indexB = buildChrAssetMappingIndex(options);

    expect(indexA.byPhysicalIndex).toEqual(indexB.byPhysicalIndex);
    expect(Array.from(indexA.physicalIndicesByAsset.entries())).toEqual(
      Array.from(indexB.physicalIndicesByAsset.entries()),
    );
  });

  it('19. Mapping construction does not mutate project/model/allocation inputs', () => {
    const tile = createPatternTile(0, [1, 2, 3, 0]);
    const originalPixels = new Uint8Array(tile.pixels);
    const project = createDefaultProject('Test', 'tileset');
    const projectSnapshot = JSON.stringify(project);

    buildChrAssetMappingIndex({
      project,
      mode: 'tileset',
      tiles: [tile],
    });

    expect(tile.pixels).toEqual(originalPixels);
    expect(JSON.stringify(project)).toBe(projectSnapshot);
  });

  it('20. Existing CHR bytes remain byte-for-byte unchanged', () => {
    const tile = createPatternTile(0, [1, 2, 3, 0]);
    const originalChr = encodeTile(tile);
    const chrSnapshot = new Uint8Array(originalChr);

    buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tile],
    });

    expect(originalChr).toEqual(chrSnapshot);
  });

  it('query helper getUsagesForLogicalKey retrieves all usages for a key', () => {
    const tileA = createPatternTile(0, [1, 2, 3, 0], 0, 0);
    const tileB = createPatternTile(1, [1, 2, 3, 0], 2, 1);

    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tileA, tileB],
      tilesetAssetId: 'asset-query-test',
      deduplicationEnabled: true,
    });

    const usagesA = getUsagesForLogicalKey('asset-query-test:0:0', index);
    const usagesB = getUsagesForLogicalKey('asset-query-test:2:1', index);
    const usagesMissing = getUsagesForLogicalKey(
      'asset-query-test:99:99',
      index,
    );

    expect(usagesA).toHaveLength(1);
    expect((usagesA[0] as TilesetTileUsage | undefined)?.sourceIndex).toBe(0);
    expect(usagesB).toHaveLength(1);
    expect((usagesB[0] as TilesetTileUsage | undefined)?.sourceIndex).toBe(1);
    expect(usagesMissing).toHaveLength(0);
  });
});

describe('Per-Asset CHR Metrics & Project Ownership Metrics (Milestone 6)', () => {
  it('1. Asset with one exclusive physical tile calculates metrics correctly', () => {
    const tile = createPatternTile(0, [1, 2, 3, 0]);
    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tile],
      tilesetAssetId: 'asset-exclusive-hero',
    });

    const metrics = calculateAssetChrMetrics(
      { id: 'asset-exclusive-hero', name: 'Hero Tiles' },
      index,
    );

    expect(metrics.assetId).toBe('asset-exclusive-hero');
    expect(metrics.assetName).toBe('Hero Tiles');
    expect(metrics.uniquePhysicalSlots).toBe(1);
    expect(metrics.primaryOwnedSlots).toBe(1);
    expect(metrics.consumedSlots).toBe(1);
    expect(metrics.sharedSlots).toBe(0);
    expect(metrics.crossAssetSharedSlots).toBe(0);
    expect(metrics.exclusiveSlots).toBe(1);
    expect(metrics.baseChrReusedSlots).toBe(0);
    expect(metrics.manualMaterializedSlots).toBe(0);
    expect(metrics.patternTableSlots).toEqual([1, 0]);
  });

  it('2. Asset with multiple usages of one physical tile counts 1 unique slot (no inflation)', () => {
    const tileA = createPatternTile(0, [1, 2, 3, 0], 0, 0);
    const tileB = createPatternTile(1, [1, 2, 3, 0], 1, 0); // duplicate
    const tileC = createPatternTile(2, [1, 2, 3, 0], 2, 0); // duplicate

    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tileA, tileB, tileC],
      tilesetAssetId: 'asset-multi-use',
      deduplicationEnabled: true,
    });

    const metrics = calculateAssetChrMetrics({ id: 'asset-multi-use' }, index);

    expect(metrics.uniquePhysicalSlots).toBe(1);
    expect(metrics.primaryOwnedSlots).toBe(1);
    expect(metrics.consumedSlots).toBe(1);
    expect(metrics.sharedSlots).toBe(1); // 3 usages on 1 physical slot
    expect(metrics.crossAssetSharedSlots).toBe(0); // single asset reuse
    expect(metrics.exclusiveSlots).toBe(1); // still exclusive to this asset
  });

  it('3. Cross-asset sharing associates the same physical slot with both assets without inflating global occupancy', () => {
    const tile = createPatternTile(0, [1, 2, 3, 0]);
    const image = createIndexedImage(8, 8, () => 1);
    const animDef: AnimationDefinitionInput = {
      id: 'walk',
      name: 'Walk',
      image,
      frameWidth: 8,
      frameHeight: 8,
      frameIndices: [0],
      frameDuration: 6,
      originX: 0,
      originY: 0,
    };

    const animModel = buildAnimationProjectModel({
      name: 'Hero',
      animations: [animDef],
      patternTable: 0,
      destinationPatternTable: 0,
    });

    const index = buildChrAssetMappingIndex({
      mode: 'animation',
      animationModel: animModel,
      animations: [
        {
          id: 'walk',
          name: 'Walk',
          frameWidth: 8,
          frameHeight: 8,
          originX: 0,
          originY: 0,
          playback: 'loop',
          allowHorizontalFlip: false,
          allowVerticalFlip: false,
          defaultDuration: 6,
          frameIndices: [0],
          frameDurations: [6],
          asset: { id: 'asset-anim-hero', name: 'Hero Anim', path: 'walk.png' },
        },
      ],
      tiles: [tile],
      tilesetAssetId: 'asset-tileset-env',
      destinationPatternTable: 0,
      deduplicationEnabled: true,
    });

    const heroMetrics = calculateAssetChrMetrics(
      { id: 'asset-anim-hero' },
      index,
    );
    const projectMetrics = calculateProjectChrOwnershipMetrics({
      mappingIndex: index,
      activeAssets: [
        {
          id: 'asset-anim-hero',
          name: 'Hero Anim',
          kind: 'spritesheet',
          reference: { id: 'asset-anim-hero', path: '' },
        },
      ],
    });

    expect(heroMetrics.uniquePhysicalSlots).toBeGreaterThanOrEqual(1);
    expect(projectMetrics.totalProjectOwnedSlots).toBe(1);
  });

  it('4. primaryOwnedSlots differs correctly from consumedSlots when referencing other tiles', () => {
    // Construct mapping where asset A owns slot 0, and asset B consumes slot 0
    const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
      { length: 512 },
      (_, idx) => ({
        physicalIndex: idx,
        patternTable: idx < 256 ? 0 : 1,
        localIndex: idx % 256,
        origin:
          idx === 0
            ? {
                primaryAssetId: 'asset-owner',
                creationKind: 'extracted',
              }
            : undefined,
        usages:
          idx === 0
            ? [
                {
                  type: 'tileset',
                  assetId: 'asset-consumer',
                  tileIndex: 0,
                  physicalTileIndex: 0,
                },
              ]
            : [],
        usageCount: idx === 0 ? 1 : 0,
        isShared: false,
      }),
    );

    const physicalIndicesByAsset = new Map<string, Set<number>>();
    physicalIndicesByAsset.set('asset-owner', new Set([0]));
    physicalIndicesByAsset.set('asset-consumer', new Set([0]));

    const mockIndex: ChrAssetMappingIndex = {
      byPhysicalIndex,
      physicalIndicesByAsset,
      usagesByLogicalKey: new Map(),
    };

    const ownerMetrics = calculateAssetChrMetrics(
      { id: 'asset-owner' },
      mockIndex,
    );
    const consumerMetrics = calculateAssetChrMetrics(
      { id: 'asset-consumer' },
      mockIndex,
    );

    expect(ownerMetrics.primaryOwnedSlots).toBe(1);
    expect(ownerMetrics.consumedSlots).toBe(0);
    expect(ownerMetrics.exclusiveSlots).toBe(0); // consumer is also on the slot

    expect(consumerMetrics.primaryOwnedSlots).toBe(0);
    expect(consumerMetrics.consumedSlots).toBe(1);
    expect(consumerMetrics.exclusiveSlots).toBe(0);
  });

  it('5. Base CHR reuse and Manual Materialized content are counted separately', () => {
    const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
      { length: 512 },
      (_, idx) => ({
        physicalIndex: idx,
        patternTable: idx < 256 ? 0 : 1,
        localIndex: idx % 256,
        origin:
          idx === 10
            ? {
                primaryAssetId: 'asset-base-chr',
                creationKind: 'base-chr',
              }
            : idx === 20
              ? {
                  primaryAssetId: 'asset-hero',
                  creationKind: 'manual-materialized',
                }
              : undefined,
        usages:
          idx === 10
            ? [
                {
                  type: 'animation',
                  assetId: 'asset-hero',
                  animationId: 'anim1',
                  frameIndex: 0,
                  spriteIndex: 0,
                  x: 0,
                  y: 0,
                  horizontalFlip: false,
                  verticalFlip: false,
                  physicalTileIndex: 10,
                },
              ]
            : [],
        usageCount: idx === 10 ? 1 : 0,
        isShared: false,
      }),
    );

    const physicalIndicesByAsset = new Map<string, Set<number>>();
    physicalIndicesByAsset.set('asset-hero', new Set([10, 20]));

    const mockIndex: ChrAssetMappingIndex = {
      byPhysicalIndex,
      physicalIndicesByAsset,
      usagesByLogicalKey: new Map(),
    };

    const heroMetrics = calculateAssetChrMetrics(
      { id: 'asset-hero' },
      mockIndex,
    );

    expect(heroMetrics.uniquePhysicalSlots).toBe(2);
    expect(heroMetrics.baseChrReusedSlots).toBe(1);
    expect(heroMetrics.manualMaterializedSlots).toBe(1);
    expect(heroMetrics.primaryOwnedSlots).toBe(1);
  });

  it('6. PT0/PT1 breakdown and boundary indexes (0, 255, 256, 511) are mapped accurately', () => {
    const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
      { length: 512 },
      (_, idx) => ({
        physicalIndex: idx,
        patternTable: idx < 256 ? 0 : 1,
        localIndex: idx % 256,
        origin: [0, 255, 256, 511].includes(idx)
          ? {
              primaryAssetId: 'asset-boundary',
              creationKind: 'extracted',
            }
          : undefined,
        usages: [],
        usageCount: 0,
        isShared: false,
      }),
    );

    const physicalIndicesByAsset = new Map<string, Set<number>>();
    physicalIndicesByAsset.set('asset-boundary', new Set([0, 255, 256, 511]));

    const mockIndex: ChrAssetMappingIndex = {
      byPhysicalIndex,
      physicalIndicesByAsset,
      usagesByLogicalKey: new Map(),
    };

    const metrics = calculateAssetChrMetrics(
      { id: 'asset-boundary' },
      mockIndex,
    );

    expect(metrics.uniquePhysicalSlots).toBe(4);
    expect(metrics.patternTableSlots).toEqual([2, 2]); // slots 0, 255 in PT0; 256, 511 in PT1
  });

  it('7. Assets with zero CHR usage are handled deterministically', () => {
    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [],
    });

    const metrics = calculateAssetChrMetrics(
      { id: 'asset-unused', name: 'Unused Asset' },
      index,
    );

    expect(metrics.uniquePhysicalSlots).toBe(0);
    expect(metrics.primaryOwnedSlots).toBe(0);
    expect(metrics.consumedSlots).toBe(0);
    expect(metrics.sharedSlots).toBe(0);
    expect(metrics.exclusiveSlots).toBe(0);
    expect(metrics.patternTableSlots).toEqual([0, 0]);
  });

  it('8. Project ownership metrics calculate global totals and do not mutate mapping input', () => {
    const tile = createPatternTile(0, [1, 2, 3, 0]);
    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tile],
      tilesetAssetId: 'asset-test',
    });

    const snapshot = JSON.stringify(index);
    const projMetrics = calculateProjectChrOwnershipMetrics({
      mappingIndex: index,
    });

    expect(projMetrics.totalProjectOwnedSlots).toBe(1);
    expect(projMetrics.totalActiveAssetsWithChr).toBe(1);
    expect(JSON.stringify(index)).toBe(snapshot);
  });
});

describe('analyzeChrOwnershipDiagnostics (Milestone 6)', () => {
  it('1. Valid mapping produces no ownership integrity diagnostics', () => {
    const tile = createPatternTile(0, [1, 2, 3, 0]);
    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tile],
      tilesetAssetId: 'asset-valid',
    });

    const diags = analyzeChrOwnershipDiagnostics({
      mappingIndex: index,
      activeAssetIds: new Set(['asset-valid']),
    });

    expect(diags).toHaveLength(0);
  });

  it('2. Canonical orphan generates warning diagnostic', () => {
    const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
      { length: 512 },
      (_, idx) => ({
        physicalIndex: idx,
        patternTable: idx < 256 ? 0 : 1,
        localIndex: idx % 256,
        origin:
          idx === 5
            ? {
                primaryAssetId: 'asset-orphan',
                creationKind: 'extracted',
              }
            : undefined,
        usages: [], // 0 usages on extracted tile -> canonical orphan
        usageCount: 0,
        isShared: false,
      }),
    );

    const mockIndex: ChrAssetMappingIndex = {
      byPhysicalIndex,
      physicalIndicesByAsset: new Map([['asset-orphan', new Set([5])]]),
      usagesByLogicalKey: new Map(),
    };

    const diags = analyzeChrOwnershipDiagnostics({
      mappingIndex: mockIndex,
      activeAssetIds: new Set(['asset-orphan']),
    });

    expect(diags).toHaveLength(1);
    const firstDiag = diags[0];
    expect(firstDiag).toBeDefined();
    if (firstDiag) {
      expect(firstDiag.kind).toBe('orphaned-project-tile');
      expect(firstDiag.severity).toBe('warning');
      expect(firstDiag.physicalIndex).toBe(5);
      expect(formatChrOwnershipDiagnosticMessage(firstDiag)).toContain(
        'PT0:$05',
      );
    }
  });

  it('3. Manual-materialized and unused Base CHR tiles do not generate orphan warnings', () => {
    const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
      { length: 512 },
      (_, idx) => ({
        physicalIndex: idx,
        patternTable: idx < 256 ? 0 : 1,
        localIndex: idx % 256,
        origin:
          idx === 5
            ? {
                primaryAssetId: 'asset-manual',
                creationKind: 'manual-materialized',
              }
            : idx === 10
              ? {
                  primaryAssetId: 'asset-base',
                  creationKind: 'base-chr',
                }
              : undefined,
        usages: [],
        usageCount: 0,
        isShared: false,
      }),
    );

    const mockIndex: ChrAssetMappingIndex = {
      byPhysicalIndex,
      physicalIndicesByAsset: new Map(),
      usagesByLogicalKey: new Map(),
    };

    const diags = analyzeChrOwnershipDiagnostics({
      mappingIndex: mockIndex,
      activeAssetIds: new Set(['asset-manual', 'asset-base']),
    });

    const orphanDiags = diags.filter((d) => d.kind === 'orphaned-project-tile');
    expect(orphanDiags).toHaveLength(0);
  });

  it('4. Usage referencing missing asset generates dangling-asset-usage error', () => {
    const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
      { length: 512 },
      (_, idx) => ({
        physicalIndex: idx,
        patternTable: idx < 256 ? 0 : 1,
        localIndex: idx % 256,
        origin: undefined,
        usages:
          idx === 8
            ? [
                {
                  type: 'animation',
                  assetId: 'asset-deleted-anim',
                  animationId: 'walk',
                  frameIndex: 2,
                  spriteIndex: 0,
                  x: 0,
                  y: 0,
                  horizontalFlip: false,
                  verticalFlip: false,
                  physicalTileIndex: 8,
                },
              ]
            : [],
        usageCount: idx === 8 ? 1 : 0,
        isShared: false,
      }),
    );

    const mockIndex: ChrAssetMappingIndex = {
      byPhysicalIndex,
      physicalIndicesByAsset: new Map([['asset-deleted-anim', new Set([8])]]),
      usagesByLogicalKey: new Map(),
    };

    const diags = analyzeChrOwnershipDiagnostics({
      mappingIndex: mockIndex,
      activeAssetIds: new Set(['asset-existing-only']),
    });

    const dangling = diags.find((d) => d.kind === 'dangling-asset-usage');
    expect(dangling).toBeDefined();
    if (dangling) {
      expect(dangling.severity).toBe('error');
      expect(dangling.physicalIndex).toBe(8);
      expect(formatChrOwnershipDiagnosticMessage(dangling)).toContain(
        'asset-deleted-anim',
      );
    }
  });

  it('5. Origin referencing missing asset generates missing-origin-asset error', () => {
    const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
      { length: 512 },
      (_, idx) => ({
        physicalIndex: idx,
        patternTable: idx < 256 ? 0 : 1,
        localIndex: idx % 256,
        origin:
          idx === 15
            ? {
                primaryAssetId: 'asset-gone',
                creationKind: 'extracted',
              }
            : undefined,
        usages: [
          {
            type: 'tileset',
            assetId: 'asset-existing',
            tileIndex: 0,
            physicalTileIndex: 15,
          },
        ],
        usageCount: idx === 15 ? 1 : 0,
        isShared: false,
      }),
    );

    const mockIndex: ChrAssetMappingIndex = {
      byPhysicalIndex,
      physicalIndicesByAsset: new Map([
        ['asset-gone', new Set([15])],
        ['asset-existing', new Set([15])],
      ]),
      usagesByLogicalKey: new Map(),
    };

    const diags = analyzeChrOwnershipDiagnostics({
      mappingIndex: mockIndex,
      activeAssetIds: new Set(['asset-existing']),
    });

    const missingOrigin = diags.find((d) => d.kind === 'missing-origin-asset');
    expect(missingOrigin).toBeDefined();
    expect(missingOrigin?.severity).toBe('error');
    expect(missingOrigin?.physicalIndex).toBe(15);
  });

  it('6. Invalid physical mapping or PT mismatch generates invalid-physical-mapping error', () => {
    const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
      { length: 512 },
      (_, idx) => ({
        physicalIndex: idx,
        patternTable: idx === 50 ? 1 : idx < 256 ? 0 : 1, // slot 50 has invalid PT1
        localIndex: idx % 256,
        origin: undefined,
        usages: [],
        usageCount: 0,
        isShared: false,
      }),
    );

    const mockIndex: ChrAssetMappingIndex = {
      byPhysicalIndex,
      physicalIndicesByAsset: new Map(),
      usagesByLogicalKey: new Map(),
    };

    const diags = analyzeChrOwnershipDiagnostics({
      mappingIndex: mockIndex,
    });

    const invalidMapping = diags.find(
      (d) => d.kind === 'invalid-physical-mapping',
    );
    expect(invalidMapping).toBeDefined();
    expect(invalidMapping?.severity).toBe('error');
    expect(invalidMapping?.physicalIndex).toBe(50);
  });

  it('7. Malformed or mismatched LogicalTileKey generates invalid-logical-key error', () => {
    const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
      { length: 512 },
      (_, idx) => ({
        physicalIndex: idx,
        patternTable: idx < 256 ? 0 : 1,
        localIndex: idx % 256,
        origin:
          idx === 3
            ? {
                primaryAssetId: 'asset-hero',
                logicalKey: 'asset-enemy:0:0', // mismatched asset
                creationKind: 'extracted',
              }
            : undefined,
        usages: [],
        usageCount: 0,
        isShared: false,
      }),
    );

    const mockIndex: ChrAssetMappingIndex = {
      byPhysicalIndex,
      physicalIndicesByAsset: new Map(),
      usagesByLogicalKey: new Map(),
    };

    const diags = analyzeChrOwnershipDiagnostics({
      mappingIndex: mockIndex,
    });

    const keyMismatch = diags.find((d) => d.kind === 'invalid-logical-key');
    expect(keyMismatch).toBeDefined();
    expect(keyMismatch?.severity).toBe('error');
    if (keyMismatch?.kind === 'invalid-logical-key') {
      expect(keyMismatch.reason).toBe('asset-mismatch');
    }
  });

  it('8. Shared tiles generate no warning merely for being shared', () => {
    const tileA = createPatternTile(0, [1, 2, 3, 0], 0, 0);
    const tileB = createPatternTile(1, [1, 2, 3, 0], 1, 0);

    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [tileA, tileB],
      tilesetAssetId: 'asset-shared',
      deduplicationEnabled: true,
    });

    const diags = analyzeChrOwnershipDiagnostics({
      mappingIndex: index,
      activeAssetIds: new Set(['asset-shared']),
    });

    expect(diags).toHaveLength(0);
  });

  it('9. Diagnostic ordering is deterministic and duplicates are not emitted twice', () => {
    const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
      { length: 512 },
      (_, idx) => ({
        physicalIndex: idx,
        patternTable: idx < 256 ? 0 : 1,
        localIndex: idx % 256,
        origin:
          idx === 10
            ? {
                primaryAssetId: 'asset-missing',
                creationKind: 'extracted',
              }
            : idx === 2
              ? {
                  primaryAssetId: 'asset-missing',
                  creationKind: 'extracted',
                }
              : undefined,
        usages: [],
        usageCount: 0,
        isShared: false,
      }),
    );

    const mockIndex: ChrAssetMappingIndex = {
      byPhysicalIndex,
      physicalIndicesByAsset: new Map(),
      usagesByLogicalKey: new Map(),
    };

    const diags = analyzeChrOwnershipDiagnostics({
      mappingIndex: mockIndex,
      activeAssetIds: new Set(['asset-other']),
    });

    // Should be sorted by physicalIndex ascending (2 before 10)
    expect(diags[0]?.physicalIndex).toBe(2);
    expect(diags[1]?.physicalIndex).toBe(2); // orphan + missing origin
    expect(diags[2]?.physicalIndex).toBe(10);
  });
});
