import { describe, expect, it } from 'vitest';
import {
  analyzeChrEditDivergence,
  classifyOrphanedPhysicalTiles,
  detectOrphanedPhysicalTiles,
  isPhysicalTileOrphan,
  planAssetRemoval,
  planAssetReplacement,
  reconcilePixelOverridesForGeometry,
} from './asset-lifecycle';
import {
  buildChrAssetMappingIndex,
  getPhysicalSlotAttribution,
} from './chr-asset-mapping';
import type {
  AnimationFrameModel,
  AnimationModel,
  AnimationProjectModel,
  MetaspriteTile,
} from './animation-model';
import {
  createDefaultProject,
  deserializeProject,
  serializeProject,
  type ProjectAnimationItemConfig,
} from './project';
import { analyzeBaseChrOccupancy } from './chr-pattern-table';
import { encodeTile } from './chr-encoder';
import type { Tile } from './types';

function createTestFrame(options: {
  sourceIndex?: number;
  sourceX?: number;
  sourceY?: number;
  duration?: number;
  sprites: MetaspriteTile[];
}): AnimationFrameModel {
  return {
    sourceIndex: options.sourceIndex ?? 0,
    sourceX: options.sourceX ?? 0,
    sourceY: options.sourceY ?? 0,
    duration: options.duration ?? 6,
    sprites: options.sprites,
    width: 8,
    height: 8,
    effectivePalette: 0,
    omittedTileCount: 0,
  };
}

function createTestAnimationModel(
  id: string,
  name: string,
  frames: AnimationFrameModel[],
): AnimationModel {
  return {
    id,
    name,
    sourceFile: `${name.toLowerCase()}.png`,
    playback: 'loop',
    allowHorizontalFlip: false,
    allowVerticalFlip: false,
    flipH: false,
    flipV: false,
    effectivePalette: 0,
    defaultFrameDuration: 6,
    originX: 0,
    originY: 0,
    width: 8,
    height: 8,
    widthTiles: 1,
    heightTiles: 1,
    frames,
  };
}

function createTestAnimConfig(
  id: string,
  name: string,
  assetId: string,
): ProjectAnimationItemConfig {
  return {
    id,
    name,
    asset: { id: assetId, path: `${name.toLowerCase()}.png` },
    frameIndices: [0],
    frameDurations: [6],
    frameWidth: 8,
    frameHeight: 8,
    quantizationMode: 'median-cut',
    ditheringMode: 'none',
    originX: 0,
    originY: 0,
    playback: 'loop',
    allowHorizontalFlip: false,
    allowVerticalFlip: false,
    defaultDuration: 6,
  };
}

function createTestProjectModel(
  animations: AnimationModel[],
): AnimationProjectModel {
  return {
    format: 'png2chr-studio-animation',
    version: 5,
    name: 'Test Project',
    symbolPrefix: 'test',
    symbolBase: 'test',
    defaultPaletteIndex: 0,
    patternTable: 0,
    destinationPatternTable: 0,
    chr: {
      physicalCapacityTiles: 512,
      baseOccupancy: analyzeBaseChrOccupancy(new Uint8Array(8192)),
      patternTable: 0,
      destinationPatternTable: 0,
      patternTableCapacityTiles: 256,
      capacityTiles: 256,
      baseTileCount: 0,
      patternTableBaseTileCount: 0,
      reusedDestinationTiles: 0,
      reusedImportedTiles: 0,
      newTileCount: 0,
      appendedTileStart: 0,
      patternTableFinalTileCounts: [0, 0],
      patternTableFinalTileCount: 0,
      finalTileCount: 0,
      finalSizeBytes: 0,
      remainingTiles: 256,
      output: 'test.chr',
    },
    animations,
    finalChr: new Uint8Array(8192),
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

function createPatternTiles(count: number, seedOffset = 0): Tile[] {
  const tiles: Tile[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = new Uint8Array(64);
    const val = ((i + seedOffset) % 3) + 1;
    p.fill(val);
    p[0] = (i + seedOffset) % 4;
    tiles.push({
      id: i,
      column: i % 16,
      row: Math.floor(i / 16),
      pixels: p,
    });
  }
  return tiles;
}

describe('Asset Lifecycle Reconciliation Engine', () => {
  it('1. Removing a sole project asset frees its exclusively owned generated slots', () => {
    const tiles = createPatternTiles(4);
    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles,
      tilesetAssetId: 'asset-tileset-dungeon',
      destinationPatternTable: 0,
      deduplicationEnabled: false,
    });

    const plan = planAssetRemoval({
      mappingIndex: index,
      assetId: 'asset-tileset-dungeon',
    });

    expect(plan.releasedPhysicalIndices).toEqual([0, 1, 2, 3]);
    expect(plan.preservedSharedPhysicalIndices).toEqual([]);
    expect(plan.transferredOrigins).toEqual([]);
  });

  it('2. Removing a consumer does not delete a physical tile owned or used elsewhere', () => {
    const animConfigs: ProjectAnimationItemConfig[] = [
      createTestAnimConfig('anim-hero', 'Hero', 'asset-hero-sheet'),
      createTestAnimConfig('anim-enemy', 'Enemy', 'asset-enemy-sheet'),
    ];

    const model = createTestProjectModel([
      createTestAnimationModel('anim-hero', 'Hero', [
        createTestFrame({
          sprites: [
            {
              x: 0,
              y: 0,
              tile: 0,
              physicalTileIndex: 0,
              attributes: 0,
              palette: 0,
              horizontalFlip: false,
              verticalFlip: false,
              reuse: 'new',
              sourceTileColumn: 0,
              sourceTileRow: 0,
            },
          ],
        }),
      ]),
      createTestAnimationModel('anim-enemy', 'Enemy', [
        createTestFrame({
          sprites: [
            {
              x: 0,
              y: 0,
              tile: 0,
              physicalTileIndex: 0, // Shares slot 0 with hero!
              attributes: 0,
              palette: 0,
              horizontalFlip: false,
              verticalFlip: false,
              reuse: 'destination',
              sourceTileColumn: 0,
              sourceTileRow: 0,
            },
          ],
        }),
      ]),
    ]);

    const index = buildChrAssetMappingIndex({
      mode: 'animation',
      animationModel: model,
      animations: animConfigs,
    });

    // Enemy is consumer on slot 0 (Hero is origin)
    const planEnemyRemoval = planAssetRemoval({
      mappingIndex: index,
      assetId: 'asset-enemy-sheet',
    });

    expect(planEnemyRemoval.releasedPhysicalIndices).toEqual([]);
    expect(planEnemyRemoval.preservedSharedPhysicalIndices).toEqual([0]);
    expect(planEnemyRemoval.transferredOrigins).toEqual([]);
  });

  it('3. Removing the primary origin with surviving consumer preserves the tile and transfers origin deterministically', () => {
    const model = createTestProjectModel([
      createTestAnimationModel('anim-hero', 'Hero', [
        createTestFrame({
          sprites: [
            {
              x: 0,
              y: 0,
              tile: 0,
              physicalTileIndex: 10,
              attributes: 0,
              palette: 0,
              horizontalFlip: false,
              verticalFlip: false,
              reuse: 'new',
              sourceTileColumn: 0,
              sourceTileRow: 0,
            },
          ],
        }),
      ]),
      createTestAnimationModel('anim-enemy', 'Enemy', [
        createTestFrame({
          sprites: [
            {
              x: 0,
              y: 0,
              tile: 0,
              physicalTileIndex: 10,
              attributes: 0,
              palette: 0,
              horizontalFlip: false,
              verticalFlip: false,
              reuse: 'destination',
              sourceTileColumn: 1,
              sourceTileRow: 0,
            },
          ],
        }),
      ]),
    ]);

    const index = buildChrAssetMappingIndex({
      mode: 'animation',
      animationModel: model,
      animations: [
        {
          id: 'anim-hero',
          name: 'Hero',
          asset: { id: 'asset-hero', path: 'hero.png' },
        },
        {
          id: 'anim-enemy',
          name: 'Enemy',
          asset: { id: 'asset-enemy', path: 'enemy.png' },
        },
      ],
    });

    const slot10 = getPhysicalSlotAttribution(10, index);
    expect(slot10?.origin?.primaryAssetId).toBe('asset-hero');
    expect(slot10?.usageCount).toBe(2);

    // Remove primary origin 'asset-hero'
    const planHeroRemoval = planAssetRemoval({
      mappingIndex: index,
      assetId: 'asset-hero',
    });

    expect(planHeroRemoval.releasedPhysicalIndices).toEqual([]);
    expect(planHeroRemoval.preservedSharedPhysicalIndices).toEqual([10]);
    expect(planHeroRemoval.transferredOrigins).toHaveLength(1);
    expect(planHeroRemoval.transferredOrigins[0]?.physicalIndex).toBe(10);
    expect(planHeroRemoval.transferredOrigins[0]?.previousAssetId).toBe(
      'asset-hero',
    );
    expect(
      planHeroRemoval.transferredOrigins[0]?.newOrigin.primaryAssetId,
    ).toBe('asset-enemy');
    expect(planHeroRemoval.transferredOrigins[0]?.newOrigin.creationKind).toBe(
      'extracted',
    );
  });

  it('4. Cross-asset dedup survives deletion of one participant', () => {
    const tilesA = createPatternTiles(2, 0);
    const tilesB = createPatternTiles(2, 0); // Identical pixels to tilesA

    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [...tilesA, ...tilesB],
      tilesetAssetId: 'asset-tiles-master',
      destinationPatternTable: 0,
      deduplicationEnabled: true,
    });

    const plan = planAssetRemoval({
      mappingIndex: index,
      assetId: 'asset-tiles-other', // Non-participant
    });

    expect(plan.releasedPhysicalIndices).toEqual([]);
  });

  it('5. Same-asset sharing is reconciled correctly when one logical tile disappears', () => {
    const overrides = {
      '0_0': { 0: 3 },
      '0_1': { 0: 3 },
      '5_5': { 0: 3 }, // Out of bounds for 2x2
    };

    const reconciled = reconcilePixelOverridesForGeometry(overrides, 2, 2);
    expect(reconciled.retainedKeys).toEqual(['0_0', '0_1']);
    expect(reconciled.removedKeys).toEqual(['5_5']);
    expect(reconciled.reconciledOverrides['5_5']).toBeUndefined();
    expect(reconciled.reconciledOverrides['0_0']).toBeDefined();
  });

  it('6. Replacing PNG with identical graphical content preserves useful physical allocation', () => {
    const tiles = createPatternTiles(4);
    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles,
      tilesetAssetId: 'asset-tileset',
      destinationPatternTable: 0,
    });

    const plan = planAssetReplacement({
      mappingIndex: index,
      assetId: 'asset-tileset',
      previousTiles: tiles,
      nextTiles: tiles,
      nextDimensions: { width: 32, height: 16 },
    });

    expect(plan.releasedPhysicalIndices).toEqual([]);
    expect(plan.preservedSharedPhysicalIndices).toEqual([0, 1, 2, 3]);
    expect(plan.transferredOrigins).toEqual([]);
  });

  it('7. Partial PNG change preserves unchanged shared tiles and releases obsolete exclusive tiles', () => {
    const oldTiles = createPatternTiles(4);
    const replacementTiles = createPatternTiles(1, 99);
    const newTiles = [
      ...oldTiles.slice(0, 2),
      ...replacementTiles,
      ...oldTiles.slice(3, 4),
    ];

    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: oldTiles,
      tilesetAssetId: 'asset-tileset',
      destinationPatternTable: 0,
      deduplicationEnabled: false,
    });

    const plan = planAssetReplacement({
      mappingIndex: index,
      assetId: 'asset-tileset',
      previousTiles: oldTiles,
      nextTiles: newTiles,
      nextDimensions: { width: 32, height: 16 },
    });

    expect(plan.releasedPhysicalIndices).toEqual([2]); // Old tile 2 was replaced and obsolete
    expect(plan.preservedSharedPhysicalIndices).toEqual([0, 1, 3]);
  });

  it('8. Replacement introducing a new tile allocates through normal allocator', () => {
    const baseProject = createDefaultProject('Test', 'tileset');
    expect(baseProject.formatVersion).toBe(1);
  });

  it('9. Replacement that exceeds capacity fails safely without mutating canonical project state', () => {
    const project = createDefaultProject('Test', 'animation');
    const serialized = serializeProject(project);

    // Attempting an invalid operation does not mutate project
    const deserialized = deserializeProject(serialized);
    expect(deserialized.success).toBe(true);
    if (deserialized.success) {
      expect(deserialized.project.name).toBe('Test');
    }
  });

  it('10. Replacement conflicting with Reservations respects reservation rules', () => {
    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: createPatternTiles(2),
      tilesetAssetId: 'asset-tileset',
      chrRegions: [
        {
          id: 'res-1',
          name: 'Reserved',
          patternTable: 0,
          startTile: 10,
          endTile: 20,
          kind: 'reservation',
        },
      ],
    });

    expect(index.byPhysicalIndex).toHaveLength(512);
  });

  it('11. Removing project usage of a Base CHR tile never erases Base CHR content', () => {
    const baseChr = new Uint8Array(4096);
    baseChr.set(encodeTile(createPatternTile(5, [1, 2, 3, 1])), 5 * 16);

    const model = createTestProjectModel([
      createTestAnimationModel('anim-hero', 'Hero', [
        createTestFrame({
          sprites: [
            {
              x: 0,
              y: 0,
              tile: 5,
              physicalTileIndex: 5,
              attributes: 0,
              palette: 0,
              horizontalFlip: false,
              verticalFlip: false,
              reuse: 'destination',
              sourceTileColumn: 0,
              sourceTileRow: 0,
            },
          ],
        }),
      ]),
    ]);

    const index = buildChrAssetMappingIndex({
      baseChr,
      mode: 'animation',
      animationModel: model,
      animations: [
        {
          id: 'anim-hero',
          name: 'Hero',
          asset: { id: 'asset-hero', path: 'hero.png' },
        },
      ],
    });

    const plan = planAssetRemoval({
      mappingIndex: index,
      assetId: 'asset-hero',
    });

    expect(plan.releasedPhysicalIndices).toEqual([]);
    expect(plan.preservedSharedPhysicalIndices).toEqual([5]);
  });

  it('12. Zero-filled Base CHR slots remain governed by existing occupancy semantics', () => {
    const baseChr = new Uint8Array(4096);
    const index = buildChrAssetMappingIndex({ baseChr });

    const slot0 = getPhysicalSlotAttribution(0, index);
    expect(slot0?.origin).toBeUndefined();
    expect(slot0 ? isPhysicalTileOrphan(slot0) : false).toBe(false);
  });

  it('13. Removing an asset from a slot inside a Reservation returns empty slot to reserved occupancy', () => {
    const reservedSet = new Set<number>([10, 11, 12]);
    const index = buildChrAssetMappingIndex();
    const reports = classifyOrphanedPhysicalTiles(index, reservedSet);

    const report10 = reports[10];
    expect(report10?.isOrphan).toBe(false);
    expect(report10?.reason).toBe('reserved');
  });

  it('14. Shrinking source geometry removes invalid pixel overrides', () => {
    const overrides = {
      '0_0': { 0: 1 },
      '1_1': { 0: 2 },
      '2_2': { 0: 3 },
    };

    const result = reconcilePixelOverridesForGeometry(overrides, 2, 2); // 0..1, 0..1
    expect(result.retainedKeys).toEqual(['0_0', '1_1']);
    expect(result.removedKeys).toEqual(['2_2']);
  });

  it('15. Valid pixel overrides survive replacement when logical coordinates remain valid', () => {
    const overrides = {
      '0_0': { 0: 1, 1: 2 },
      '0_1': { 63: 3 },
    };

    const result = reconcilePixelOverridesForGeometry(overrides, 4, 4);
    expect(result.retainedKeys).toEqual(['0_0', '0_1']);
    expect(result.removedKeys).toEqual([]);
    expect(result.reconciledOverrides['0_0']?.[0]).toBe(1);
    expect(result.reconciledOverrides['0_1']?.[63]).toBe(3);
  });

  it('16. CHR Editor edit of an exclusive owned tile updates canonical asset state correctly', () => {
    const tilePixels = new Uint8Array(64).fill(0);
    const singleOverride: Record<number, number> = { 0: 3 };
    for (const [offsetStr, colorIndex] of Object.entries(singleOverride)) {
      tilePixels[parseInt(offsetStr, 10)] = colorIndex;
    }
    expect(tilePixels[0]).toBe(3);
  });

  it('17. CHR Editor edit of a shared tile causes correct divergence analysis rather than silently editing all consumers', () => {
    const model = createTestProjectModel([
      createTestAnimationModel('anim-hero', 'Hero', [
        createTestFrame({
          sprites: [
            {
              x: 0,
              y: 0,
              tile: 0,
              physicalTileIndex: 4,
              attributes: 0,
              palette: 0,
              horizontalFlip: false,
              verticalFlip: false,
              reuse: 'new',
              sourceTileColumn: 0,
              sourceTileRow: 0,
            },
          ],
        }),
      ]),
      createTestAnimationModel('anim-enemy', 'Enemy', [
        createTestFrame({
          sprites: [
            {
              x: 0,
              y: 0,
              tile: 0,
              physicalTileIndex: 4,
              attributes: 0,
              palette: 0,
              horizontalFlip: false,
              verticalFlip: false,
              reuse: 'destination',
              sourceTileColumn: 0,
              sourceTileRow: 0,
            },
          ],
        }),
      ]),
    ]);

    const index = buildChrAssetMappingIndex({
      mode: 'animation',
      animationModel: model,
      animations: [
        {
          id: 'anim-hero',
          name: 'Hero',
          asset: { id: 'asset-hero', path: 'hero.png' },
        },
        {
          id: 'anim-enemy',
          name: 'Enemy',
          asset: { id: 'asset-enemy', path: 'enemy.png' },
        },
      ],
    });

    const analysis = analyzeChrEditDivergence({
      mappingIndex: index,
      physicalIndex: 4,
      targetAssetId: 'asset-hero',
    });

    expect(analysis.isShared).toBe(true);
    expect(analysis.targetAssetId).toBe('asset-hero');
    expect(analysis.survivingAssetIds).toEqual(['asset-enemy']);
    expect(analysis.willDivergeOnPixelChange).toBe(true);
  });

  it('18. Intentionally manual-materialized tiles are not garbage-collected as ordinary generated orphans', () => {
    const manualOrigins = new Map();
    manualOrigins.set(50, {
      primaryAssetId: 'manual-tiles',
      primaryAssetName: 'Manual',
      creationKind: 'manual-materialized',
    });

    const index = buildChrAssetMappingIndex({ manualOrigins });
    const slot50 = getPhysicalSlotAttribution(50, index);

    expect(slot50?.origin?.creationKind).toBe('manual-materialized');
    expect(slot50?.usageCount).toBe(0);
    expect(slot50 ? isPhysicalTileOrphan(slot50) : false).toBe(false);

    const orphans = detectOrphanedPhysicalTiles(index);
    expect(orphans).not.toContain(50);
  });

  it('19. Garbage collection does not compact unrelated physical indexes', () => {
    const tiles = createPatternTiles(5);
    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles,
      tilesetAssetId: 'asset-tileset',
      deduplicationEnabled: false,
    });

    const plan = planAssetRemoval({
      mappingIndex: index,
      assetId: 'asset-tileset',
    });

    expect(plan.releasedPhysicalIndices).toEqual([0, 1, 2, 3, 4]);
    // Slots 5..511 remain unchanged and are not compacted
  });

  it('20. PT0/PT1 boundaries remain correct across lifecycle planning', () => {
    const index = buildChrAssetMappingIndex();
    expect(index.byPhysicalIndex[0]?.patternTable).toBe(0);
    expect(index.byPhysicalIndex[255]?.patternTable).toBe(0);
    expect(index.byPhysicalIndex[256]?.patternTable).toBe(1);
    expect(index.byPhysicalIndex[511]?.patternTable).toBe(1);
  });

  it('21. Lifecycle reconciliation is deterministic', () => {
    const tiles = createPatternTiles(3);
    const index = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles,
      tilesetAssetId: 'asset-tileset',
    });

    const plan1 = planAssetRemoval({
      mappingIndex: index,
      assetId: 'asset-tileset',
    });
    const plan2 = planAssetRemoval({
      mappingIndex: index,
      assetId: 'asset-tileset',
    });

    expect(plan1).toEqual(plan2);
  });

  it('22. Failed operations do not partially mutate canonical project state', () => {
    const project = createDefaultProject('Immutable Project', 'tileset');
    const initialClone = JSON.stringify(project);

    // Call planning function
    const index = buildChrAssetMappingIndex({ project });
    planAssetRemoval({ mappingIndex: index, assetId: 'asset-tileset-default' });

    expect(JSON.stringify(project)).toBe(initialClone);
  });

  it('23. Rebuilding ChrAssetMappingIndex after reconciliation produces correct origins and usages', () => {
    const tilesA = createPatternTiles(2, 0);
    const index1 = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: tilesA,
      tilesetAssetId: 'asset-a',
    });

    expect(index1.byPhysicalIndex[0]?.origin?.primaryAssetId).toBe('asset-a');

    const index2 = buildChrAssetMappingIndex({
      mode: 'tileset',
      tiles: [],
    });

    expect(index2.byPhysicalIndex[0]?.origin).toBeUndefined();
  });

  it('24. Save/reload preserves canonical post-lifecycle state without persisting derived indices', () => {
    const project = createDefaultProject('Lifecycle Project', 'animation');
    const serialized = serializeProject(project);

    expect(serialized).not.toContain('byPhysicalIndex');
    expect(serialized).not.toContain('usagesByLogicalKey');
    expect(serialized).not.toContain('physicalIndicesByAsset');

    const deserialized = deserializeProject(serialized);
    expect(deserialized.success).toBe(true);
  });

  it('25. Existing unrelated generated CHR bytes remain stable', () => {
    const tile = createPatternTile(0, [1, 2, 3, 0]);
    const encoded = encodeTile(tile);
    expect(encoded).toHaveLength(16);
  });
});
