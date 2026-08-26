import { describe, expect, it } from 'vitest';
import {
  buildChrAssetMappingIndex,
  calculateAssetChrMetrics,
  calculateProjectChrOwnershipMetrics,
  analyzeChrOwnershipDiagnostics,
  formatChrOwnershipDiagnosticMessage,
  getPhysicalSlotAttribution,
  type ChrAssetMappingIndex,
  type PhysicalSlotAttribution,
} from './chr-asset-mapping';
import { extractProjectAssets } from './asset-identity';
import { analyzeChrEditDivergence, planAssetRemoval } from './asset-lifecycle';
import {
  classifyChrSlots,
  collectReservedPhysicalTileIndices,
  NES_CHR_ROM_SIZE,
  type ChrRegion,
} from './chr-pattern-table';
import {
  buildAnimationProjectModel,
  type AnimationDefinitionInput,
} from './animation-model';
import {
  createDefaultProject,
  deserializeProject,
  serializeProject,
} from './project';
import type { IndexedImage, Tile } from './types';

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

function createSampleIndexedImage(
  width: number,
  height: number,
  filler: (x: number, y: number) => number = () => 1,
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

describe('Milestone 6 Final Quality Audit & End-to-End Invariants', () => {
  describe('1. Legacy Project Normalization & Persistence Roundtrip', () => {
    it('normalizes missing asset IDs deterministically and keeps them stable across save/reload', () => {
      const legacyJson = JSON.stringify({
        formatVersion: 1,
        name: 'Legacy Hero Quest',
        mode: 'animation',
        settings: {
          deduplicationEnabled: true,
          flipDeduplicationEnabled: true,
        },
        palette: {
          paletteSet: {
            backgroundSubpalettes: [
              { colors: [0, 1, 2, 3] },
              { colors: [0, 4, 5, 6] },
              { colors: [0, 7, 8, 9] },
              { colors: [0, 10, 11, 12] },
            ],
            spriteSubpalettes: [
              { colors: [0, 13, 14, 15] },
              { colors: [0, 16, 17, 18] },
              { colors: [0, 19, 20, 21] },
              { colors: [0, 22, 23, 24] },
            ],
          },
        },
        tileset: {
          asset: { path: 'tileset.png' },
        },
        playfield: {
          asset: { path: 'playfield.png' },
        },
        animation: {
          destinationChr: { path: 'base.chr' },
          animations: [
            {
              id: 'walk',
              name: 'Hero Walk',
              asset: { path: 'hero_walk.png' },
              frameWidth: 16,
              frameHeight: 16,
              playback: 'loop',
              allowHorizontalFlip: true,
              allowVerticalFlip: false,
              defaultDuration: 6,
              frameIndices: [0],
              frameDurations: [6],
            },
            {
              id: 'jump',
              name: 'Hero Jump',
              asset: { path: 'hero_jump.png' },
              frameWidth: 16,
              frameHeight: 16,
              playback: 'once',
              allowHorizontalFlip: true,
              allowVerticalFlip: false,
              defaultDuration: 6,
              frameIndices: [0],
              frameDurations: [6],
            },
          ],
        },
      });

      const firstPass = deserializeProject(legacyJson);
      expect(firstPass.success).toBe(true);
      if (!firstPass.success) return;

      const p1 = firstPass.project;
      expect(p1.tileset?.asset?.id).toBe('asset-tileset-default');
      expect(p1.playfield?.asset?.id).toBe('asset-playfield-default');
      expect(p1.animation?.destinationChr?.id).toBe('asset-base-chr-default');
      expect(p1.animation?.animations[0]?.asset?.id).toBe('asset-anim-walk');
      expect(p1.animation?.animations[1]?.asset?.id).toBe('asset-anim-jump');

      // Reserialize and reload
      const reserialized = serializeProject(p1);
      const secondPass = deserializeProject(reserialized);
      expect(secondPass.success).toBe(true);
      if (!secondPass.success) return;

      const p2 = secondPass.project;
      expect(p2.tileset?.asset?.id).toBe('asset-tileset-default');
      expect(p2.playfield?.asset?.id).toBe('asset-playfield-default');
      expect(p2.animation?.destinationChr?.id).toBe('asset-base-chr-default');
      expect(p2.animation?.animations[0]?.asset?.id).toBe('asset-anim-walk');
      expect(p2.animation?.animations[1]?.asset?.id).toBe('asset-anim-jump');
    });
  });

  describe('2. Derived State Boundaries (Never Persisted)', () => {
    it('verifies that ChrAssetMappingIndex, metrics, and diagnostics are never serialized into .p2c.json', () => {
      const project = createDefaultProject('Test Boundaries', 'animation');
      const serialized = serializeProject(project);

      expect(serialized).not.toContain('byPhysicalIndex');
      expect(serialized).not.toContain('physicalIndicesByAsset');
      expect(serialized).not.toContain('usagesByLogicalKey');
      expect(serialized).not.toContain('uniquePhysicalSlots');
      expect(serialized).not.toContain('primaryOwnedSlots');
      expect(serialized).not.toContain('orphanedPhysicalIndices');
      expect(serialized).not.toContain('transferredOrigins');
      expect(serialized).not.toContain('orphaned-project-tile');
    });
  });

  describe('3. Complex Multi-Asset Invariant & Metrics Audit', () => {
    it('computes exact mathematically truthful metrics without double-counting global occupancy', () => {
      // 1. Base CHR: 1 occupied tile at slot 0 ($0000)
      const baseChr = new Uint8Array(4096);
      baseChr[0] = 0x11; // non-zero -> occupied

      // 2. Tile patterns
      const sharedPattern = [1, 2, 3, 0];
      const imgShared = createSampleIndexedImage(
        8,
        8,
        (x, y) => sharedPattern[(y * 8 + x) % 4] ?? 0,
      );

      const animHero: AnimationDefinitionInput = {
        id: 'hero',
        name: 'Hero Walk',
        image: imgShared,
        frameWidth: 8,
        frameHeight: 8,
        frameIndices: [0],
        frameDuration: 6,
      };

      const animEnemy: AnimationDefinitionInput = {
        id: 'enemy',
        name: 'Enemy Walk',
        image: imgShared,
        frameWidth: 8,
        frameHeight: 8,
        frameIndices: [0],
        frameDuration: 6,
      };

      const animModel = buildAnimationProjectModel({
        name: 'Project',
        animations: [animHero, animEnemy],
        baseChr,
        patternTable: 0,
        destinationPatternTable: 0,
      });

      const mappingIndex = buildChrAssetMappingIndex({
        mode: 'animation',
        animationModel: animModel,
        baseChr,
        destinationPatternTable: 0,
        animations: [
          {
            id: 'hero',
            name: 'Hero Walk',
            asset: { id: 'asset-hero', name: 'Hero Sheet', path: 'hero.png' },
            frameWidth: 8,
            frameHeight: 8,
            playback: 'loop',
            allowHorizontalFlip: true,
            allowVerticalFlip: false,
            defaultDuration: 6,
            frameIndices: [0],
            frameDurations: [6],
          },
          {
            id: 'enemy',
            name: 'Enemy Walk',
            asset: {
              id: 'asset-enemy',
              name: 'Enemy Sheet',
              path: 'enemy.png',
            },
            frameWidth: 8,
            frameHeight: 8,
            playback: 'loop',
            allowHorizontalFlip: true,
            allowVerticalFlip: false,
            defaultDuration: 6,
            frameIndices: [0],
            frameDurations: [6],
          },
        ],
      });

      // Assert slot 0 is Base CHR
      const slot0 = getPhysicalSlotAttribution(0, mappingIndex);
      expect(slot0?.origin?.creationKind).toBe('base-chr');

      // Assert slot 1 is the shared tile between Hero and Enemy
      const slot1 = getPhysicalSlotAttribution(1, mappingIndex);
      expect(slot1?.isShared).toBe(true);
      expect(slot1?.usageCount).toBe(2);

      const heroMetrics = calculateAssetChrMetrics(
        { id: 'asset-hero', name: 'Hero Sheet' },
        mappingIndex,
      );
      const enemyMetrics = calculateAssetChrMetrics(
        { id: 'asset-enemy', name: 'Enemy Sheet' },
        mappingIndex,
      );

      // Hero metrics
      expect(heroMetrics.uniquePhysicalSlots).toBe(1);
      expect(heroMetrics.primaryOwnedSlots).toBe(1);
      expect(heroMetrics.consumedSlots).toBe(1);
      expect(heroMetrics.sharedSlots).toBe(1);
      expect(heroMetrics.crossAssetSharedSlots).toBe(1);
      expect(heroMetrics.exclusiveSlots).toBe(0);

      // Enemy metrics
      expect(enemyMetrics.uniquePhysicalSlots).toBe(1);
      expect(enemyMetrics.primaryOwnedSlots).toBe(0); // Hero allocated first
      expect(enemyMetrics.consumedSlots).toBe(1);
      expect(enemyMetrics.sharedSlots).toBe(1);
      expect(enemyMetrics.crossAssetSharedSlots).toBe(1);
      expect(enemyMetrics.exclusiveSlots).toBe(0);

      // Project metrics
      const projectMetrics = calculateProjectChrOwnershipMetrics({
        mappingIndex,
        activeAssets: [
          {
            id: 'asset-hero',
            name: 'Hero Sheet',
            kind: 'spritesheet',
            reference: { id: 'asset-hero', path: 'hero.png' },
          },
          {
            id: 'asset-enemy',
            name: 'Enemy Sheet',
            kind: 'spritesheet',
            reference: { id: 'asset-enemy', path: 'enemy.png' },
          },
        ],
      });

      // 1 Base CHR slot + 1 Project slot = 2 total physical slots occupied
      expect(projectMetrics.totalProjectOwnedSlots).toBe(1);
      expect(projectMetrics.totalActiveAssetsWithChr).toBe(3); // base-chr, hero, enemy
    });
  });

  describe('4. Lifecycle Reconciliation: Asset Removal & Origin Transfer', () => {
    it('transfers origin to surviving consumer when primary owner is removed', () => {
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
                    assetId: 'asset-owner',
                    tileIndex: 0,
                    physicalTileIndex: 0,
                  },
                  {
                    type: 'animation',
                    assetId: 'asset-survivor',
                    animationId: 'anim1',
                    animationName: 'Survivor Anim',
                    frameIndex: 0,
                    spriteIndex: 0,
                    x: 0,
                    y: 0,
                    horizontalFlip: false,
                    verticalFlip: false,
                    physicalTileIndex: 0,
                    logicalKey: 'asset-survivor:0:0',
                  },
                ]
              : [],
          usageCount: idx === 0 ? 2 : 0,
          isShared: idx === 0,
        }),
      );

      const mockIndex: ChrAssetMappingIndex = {
        byPhysicalIndex,
        physicalIndicesByAsset: new Map([
          ['asset-owner', new Set([0])],
          ['asset-survivor', new Set([0])],
        ]),
        usagesByLogicalKey: new Map(),
      };

      const plan = planAssetRemoval({
        mappingIndex: mockIndex,
        assetId: 'asset-owner',
      });

      expect(plan.releasedPhysicalIndices).toHaveLength(0); // Slot 0 still used by survivor!
      expect(plan.preservedSharedPhysicalIndices).toEqual([0]);
      expect(plan.transferredOrigins).toHaveLength(1);
      expect(plan.transferredOrigins[0]?.physicalIndex).toBe(0);
      expect(plan.transferredOrigins[0]?.newOrigin.primaryAssetId).toBe(
        'asset-survivor',
      );
    });
  });

  describe('5. Shared Tile CHR Editor Divergence', () => {
    it('correctly analyzes shared tile divergence before editing', () => {
      const byPhysicalIndex: PhysicalSlotAttribution[] = Array.from(
        { length: 512 },
        (_, idx) => ({
          physicalIndex: idx,
          patternTable: idx < 256 ? 0 : 1,
          localIndex: idx % 256,
          origin:
            idx === 0
              ? {
                  primaryAssetId: 'asset-hero',
                  creationKind: 'extracted',
                }
              : undefined,
          usages:
            idx === 0
              ? [
                  {
                    type: 'tileset',
                    assetId: 'asset-hero',
                    tileIndex: 0,
                    physicalTileIndex: 0,
                  },
                  {
                    type: 'tileset',
                    assetId: 'asset-enemy',
                    tileIndex: 1,
                    physicalTileIndex: 0,
                    logicalKey: 'asset-enemy:0:0',
                  },
                ]
              : [],
          usageCount: idx === 0 ? 2 : 0,
          isShared: idx === 0,
        }),
      );

      const mockIndex: ChrAssetMappingIndex = {
        byPhysicalIndex,
        physicalIndicesByAsset: new Map([
          ['asset-hero', new Set([0])],
          ['asset-enemy', new Set([0])],
        ]),
        usagesByLogicalKey: new Map(),
      };

      const divergence = analyzeChrEditDivergence({
        mappingIndex: mockIndex,
        physicalIndex: 0,
        targetAssetId: 'asset-hero',
      });

      expect(divergence.isShared).toBe(true);
      expect(divergence.targetAssetId).toBe('asset-hero');
      expect(divergence.survivingAssetIds).toEqual(['asset-enemy']);
      expect(divergence.willDivergeOnPixelChange).toBe(true);
    });
  });

  describe('6. Reservation Recovery Safety', () => {
    it('reveals reservation occupancy when allocated tile is removed', () => {
      const regions: ChrRegion[] = [
        {
          id: 'res-sprites',
          name: 'Dynamic Sprites',
          patternTable: 0,
          startTile: 16,
          endTile: 32,
          kind: 'reservation',
        },
      ];

      const reservedSet = collectReservedPhysicalTileIndices(regions);
      expect(reservedSet.has(16)).toBe(true);

      const classifications = classifyChrSlots({
        finalChrBytes: new Uint8Array(NES_CHR_ROM_SIZE),
        mode: 'tileset',
        chrRegions: regions,
      });

      expect(classifications[16]?.occupancy).toBe('reserved');
    });
  });

  describe('7. End-to-End Clean Diagnostics', () => {
    it('produces 0 diagnostics on a completely valid project', () => {
      const tileA = createPatternTile(0, [1, 2, 3, 0], 0, 0);
      const mappingIndex = buildChrAssetMappingIndex({
        mode: 'tileset',
        tiles: [tileA],
        tilesetAssetId: 'asset-valid',
      });

      const diags = analyzeChrOwnershipDiagnostics({
        mappingIndex,
        activeAssetIds: new Set(['asset-valid']),
      });

      expect(diags).toHaveLength(0);
    });
  });

  describe('8. Ownership & Integrity Diagnostics False-Positive Regressions and Deduplication', () => {
    it('Scenario 1: animation consuming own extracted tile produces 0 diagnostics', () => {
      const image = createSampleIndexedImage(
        16,
        16,
        (x, y) => ((x + y) % 3) + 1,
      );
      const animDef: AnimationDefinitionInput = {
        id: 'anim-hero',
        name: 'Hero Walk',
        image,
        frameIndices: [0],
        frameDuration: 6,
        frameWidth: 16,
        frameHeight: 16,
      };

      const animModel = buildAnimationProjectModel({
        name: 'hero',
        animations: [animDef],
      });

      const mockProjectView = {
        mode: 'animation' as const,
        animation: {
          destinationChrAssetId: null,
          destinationChrName: null,
          destinationChr: new Uint8Array(0),
          animations: [
            {
              id: 'anim-hero',
              name: 'Hero Walk',
              source: {
                assetId: 'asset-hero-sheet',
                fileName: 'hero.png',
              },
            },
          ],
        },
      };

      const activeAssets = extractProjectAssets(mockProjectView);
      expect(activeAssets).toHaveLength(1);
      expect(activeAssets[0]?.id).toBe('asset-hero-sheet');

      const mappingIndex = buildChrAssetMappingIndex({
        mode: 'animation',
        animationModel: animModel,
        animations: mockProjectView.animation.animations,
      });

      const diags = analyzeChrOwnershipDiagnostics({
        mappingIndex,
        activeAssets,
      });

      expect(diags).toHaveLength(0);
    });

    it('Scenario 2: animation consuming Base CHR produces 0 diagnostics', () => {
      // Base CHR with a non-empty tile at slot 0
      const baseChr = new Uint8Array(8192);
      baseChr[0] = 0xaa;
      baseChr[8] = 0x55;

      const image = createSampleIndexedImage(16, 16, () => 0); // Transparent/empty image
      const animDef: AnimationDefinitionInput = {
        id: 'anim-warrior',
        name: 'Warrior Idle',
        image,
        frameIndices: [0],
        frameDuration: 6,
        frameWidth: 16,
        frameHeight: 16,
      };

      const animModel = buildAnimationProjectModel({
        name: 'warrior',
        baseChr,
        animations: [animDef],
      });

      const mockProjectView = {
        mode: 'animation' as const,
        animation: {
          destinationChrAssetId: 'asset-base-chr-game',
          destinationChrName: 'game.chr',
          destinationChr: baseChr,
          animations: [
            {
              id: 'anim-warrior',
              name: 'Warrior Idle',
              source: {
                assetId: 'asset-warrior-sheet',
                fileName: 'warrior.png',
              },
            },
          ],
        },
      };

      const activeAssets = extractProjectAssets(mockProjectView);
      expect(activeAssets.map((a) => a.id)).toEqual([
        'asset-base-chr-game',
        'asset-warrior-sheet',
      ]);

      const mappingIndex = buildChrAssetMappingIndex({
        mode: 'animation',
        animationModel: animModel,
        baseChr,
        animations: mockProjectView.animation.animations,
      });

      const diags = analyzeChrOwnershipDiagnostics({
        mappingIndex,
        activeAssets,
      });

      expect(diags).toHaveLength(0);
    });

    it('Scenario 3: two animations sharing the same Base CHR tile produce 0 diagnostics', () => {
      const baseChr = new Uint8Array(8192);
      baseChr[0] = 0xff;

      const mockIndex: ChrAssetMappingIndex = {
        byPhysicalIndex: Array.from({ length: 512 }, (_, idx) => ({
          physicalIndex: idx,
          patternTable: idx < 256 ? 0 : 1,
          localIndex: idx % 256,
          origin:
            idx === 0
              ? {
                  primaryAssetId: 'asset-base-chr-1',
                  creationKind: 'base-chr',
                }
              : undefined,
          usages:
            idx === 0
              ? [
                  {
                    type: 'animation' as const,
                    assetId: 'asset-hero-sheet',
                    animationId: 'anim-hero',
                    animationName: 'Hero',
                    frameIndex: 0,
                    spriteIndex: 0,
                    x: 0,
                    y: 0,
                    horizontalFlip: false,
                    verticalFlip: false,
                    physicalTileIndex: 0,
                  },
                  {
                    type: 'animation' as const,
                    assetId: 'asset-enemy-sheet',
                    animationId: 'anim-enemy',
                    animationName: 'Enemy',
                    frameIndex: 0,
                    spriteIndex: 0,
                    x: 0,
                    y: 0,
                    horizontalFlip: false,
                    verticalFlip: false,
                    physicalTileIndex: 0,
                  },
                ]
              : [],
          usageCount: idx === 0 ? 2 : 0,
          isShared: idx === 0,
        })),
        physicalIndicesByAsset: new Map([
          ['asset-base-chr-1', new Set([0])],
          ['asset-hero-sheet', new Set([0])],
          ['asset-enemy-sheet', new Set([0])],
        ]),
        usagesByLogicalKey: new Map(),
      };

      const activeAssets = [
        {
          id: 'asset-base-chr-1',
          kind: 'base-chr' as const,
          name: 'Base CHR',
          reference: { id: 'asset-base-chr-1', path: 'base.chr' },
        },
        {
          id: 'asset-hero-sheet',
          kind: 'spritesheet' as const,
          name: 'Hero',
          reference: { id: 'asset-hero-sheet', path: 'hero.png' },
        },
        {
          id: 'asset-enemy-sheet',
          kind: 'spritesheet' as const,
          name: 'Enemy',
          reference: { id: 'asset-enemy-sheet', path: 'enemy.png' },
        },
      ];

      const diags = analyzeChrOwnershipDiagnostics({
        mappingIndex: mockIndex,
        activeAssets,
      });

      expect(diags).toHaveLength(0);
    });

    it('Scenario 4: truly non-existent asset produces diagnostic and deduplicates across usages on the same slot', () => {
      // Slot 12 has 4 distinct usages all referencing the deleted/missing asset 'asset-ghost'
      const mockIndex: ChrAssetMappingIndex = {
        byPhysicalIndex: Array.from({ length: 512 }, (_, idx) => ({
          physicalIndex: idx,
          patternTable: idx < 256 ? 0 : 1,
          localIndex: idx % 256,
          origin:
            idx === 12
              ? {
                  primaryAssetId: 'asset-valid',
                  creationKind: 'extracted',
                }
              : undefined,
          usages:
            idx === 12
              ? [
                  {
                    type: 'animation' as const,
                    assetId: 'asset-ghost',
                    animationId: 'anim-ghost',
                    animationName: 'Ghost',
                    frameIndex: 0,
                    spriteIndex: 0,
                    x: 0,
                    y: 0,
                    horizontalFlip: false,
                    verticalFlip: false,
                    physicalTileIndex: 12,
                    logicalKey: 'asset-ghost:0:0',
                  },
                  {
                    type: 'animation' as const,
                    assetId: 'asset-ghost',
                    animationId: 'anim-ghost',
                    animationName: 'Ghost',
                    frameIndex: 1,
                    spriteIndex: 0,
                    x: 0,
                    y: 0,
                    horizontalFlip: false,
                    verticalFlip: false,
                    physicalTileIndex: 12,
                    logicalKey: 'asset-ghost:2:0',
                  },
                  {
                    type: 'animation' as const,
                    assetId: 'asset-ghost',
                    animationId: 'anim-ghost',
                    animationName: 'Ghost',
                    frameIndex: 2,
                    spriteIndex: 1,
                    x: 8,
                    y: 0,
                    horizontalFlip: false,
                    verticalFlip: false,
                    physicalTileIndex: 12,
                    logicalKey: 'asset-ghost:4:0',
                  },
                  {
                    type: 'animation' as const,
                    assetId: 'asset-ghost',
                    animationId: 'anim-ghost',
                    animationName: 'Ghost',
                    frameIndex: 3,
                    spriteIndex: 0,
                    x: 0,
                    y: 0,
                    horizontalFlip: false,
                    verticalFlip: false,
                    physicalTileIndex: 12,
                    logicalKey: 'asset-ghost:6:0',
                  },
                ]
              : [],
          usageCount: idx === 12 ? 4 : 0,
          isShared: idx === 12,
        })),
        physicalIndicesByAsset: new Map([
          ['asset-valid', new Set([12])],
          ['asset-ghost', new Set([12])],
        ]),
        usagesByLogicalKey: new Map(),
      };

      const diags = analyzeChrOwnershipDiagnostics({
        mappingIndex: mockIndex,
        activeAssetIds: new Set(['asset-valid']),
      });

      // Must produce dangling usage, but EXACTLY 1 fact for slot 12 without repeating 4 times
      const dangling = diags.filter((d) => d.kind === 'dangling-asset-usage');
      expect(dangling).toHaveLength(1);
      const firstDangling = dangling[0];
      expect(firstDangling).toBeDefined();
      if (firstDangling) {
        expect(firstDangling.physicalIndex).toBe(12);
        expect(firstDangling.missingAssetId).toBe('asset-ghost');
        expect(firstDangling.usageType).toBe('animation');
        expect(formatChrOwnershipDiagnosticMessage(firstDangling)).toContain(
          'asset-ghost',
        );
      }
    });

    it('Scenario 5: background usage validation (valid produces 0 diagnostics, missing produces dangling error)', () => {
      const mockIndex: ChrAssetMappingIndex = {
        byPhysicalIndex: Array.from({ length: 512 }, (_, idx) => ({
          physicalIndex: idx,
          patternTable: idx < 256 ? 0 : 1,
          localIndex: idx % 256,
          origin:
            idx === 20
              ? {
                  primaryAssetId: 'asset-bg-overworld',
                  creationKind: 'extracted',
                }
              : undefined,
          usages:
            idx === 20
              ? [
                  {
                    type: 'background' as const,
                    assetId: 'asset-bg-overworld',
                    mapId: 'map-1',
                    column: 5,
                    row: 3,
                    nametableIndex: 3 * 32 + 5,
                    localTileIndex: 20,
                    physicalTileIndex: 20,
                  },
                ]
              : idx === 21
                ? [
                    {
                      type: 'background' as const,
                      assetId: 'asset-bg-deleted',
                      mapId: 'map-2',
                      column: 0,
                      row: 0,
                      nametableIndex: 0,
                      localTileIndex: 21,
                      physicalTileIndex: 21,
                    },
                  ]
                : [],
          usageCount: idx === 20 || idx === 21 ? 1 : 0,
          isShared: false,
        })),
        physicalIndicesByAsset: new Map([
          ['asset-bg-overworld', new Set([20])],
          ['asset-bg-deleted', new Set([21])],
        ]),
        usagesByLogicalKey: new Map(),
      };

      const diags = analyzeChrOwnershipDiagnostics({
        mappingIndex: mockIndex,
        activeAssetIds: new Set(['asset-bg-overworld']),
      });

      const dangling = diags.filter((d) => d.kind === 'dangling-asset-usage');
      expect(dangling).toHaveLength(1);
      expect(dangling[0]?.physicalIndex).toBe(21);
      expect(dangling[0]?.missingAssetId).toBe('asset-bg-deleted');
      expect(dangling[0]?.usageType).toBe('background');
    });

    it('Scenario 6: tileset usage validation (valid produces 0 diagnostics, missing produces dangling error)', () => {
      const mockIndex: ChrAssetMappingIndex = {
        byPhysicalIndex: Array.from({ length: 512 }, (_, idx) => ({
          physicalIndex: idx,
          patternTable: idx < 256 ? 0 : 1,
          localIndex: idx % 256,
          origin:
            idx === 30
              ? {
                  primaryAssetId: 'asset-tileset-valid',
                  creationKind: 'extracted',
                }
              : undefined,
          usages:
            idx === 30
              ? [
                  {
                    type: 'tileset' as const,
                    assetId: 'asset-tileset-valid',
                    tileIndex: 0,
                    physicalTileIndex: 30,
                  },
                ]
              : idx === 31
                ? [
                    {
                      type: 'tileset' as const,
                      assetId: 'asset-tileset-missing',
                      tileIndex: 1,
                      physicalTileIndex: 31,
                    },
                  ]
                : [],
          usageCount: idx === 30 || idx === 31 ? 1 : 0,
          isShared: false,
        })),
        physicalIndicesByAsset: new Map([
          ['asset-tileset-valid', new Set([30])],
          ['asset-tileset-missing', new Set([31])],
        ]),
        usagesByLogicalKey: new Map(),
      };

      const diags = analyzeChrOwnershipDiagnostics({
        mappingIndex: mockIndex,
        activeAssetIds: new Set(['asset-tileset-valid']),
      });

      const dangling = diags.filter((d) => d.kind === 'dangling-asset-usage');
      expect(dangling).toHaveLength(1);
      expect(dangling[0]?.physicalIndex).toBe(31);
      expect(dangling[0]?.missingAssetId).toBe('asset-tileset-missing');
      expect(dangling[0]?.usageType).toBe('tileset');
    });
  });
});
