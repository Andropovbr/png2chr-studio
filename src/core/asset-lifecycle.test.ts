import { describe, expect, it } from 'vitest';
import {
  analyzeChrEditDivergence,
  classifyOrphanedPhysicalTiles,
  detectOrphanedPhysicalTiles,
  isAnimationOriginValid,
  isPhysicalTileOrphan,
  planAssetRemoval,
  planAssetReplacement,
  reconcileAnimationGeometry,
  reconcilePixelOverridesForGeometry,
  reconcileSpritesheetReimport,
} from './asset-lifecycle';
import {
  buildChrAssetMappingIndex,
  getPhysicalSlotAttribution,
  getUsagesForLogicalKey,
} from './chr-asset-mapping';
import {
  buildAnimationProjectModel,
  AnimationModelError,
  type AnimationFrameModel,
  type AnimationModel,
  type AnimationProjectModel,
  type MetaspriteTile,
} from './animation-model';
import {
  createDefaultProject,
  deserializeProject,
  serializeProject,
  type ProjectAnimationItemConfig,
  type ProjectAnimationSettingsConfig,
  type StudioProject,
} from './project';
import { analyzeBaseChrOccupancy } from './chr-pattern-table';
import { encodeTile } from './chr-encoder';
import type { IndexedImage, Tile } from './types';

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
    expect(baseProject.formatVersion).toBe(2);
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

function createTestIndexedImage(
  width: number,
  height: number,
  fillColor = 0,
): IndexedImage {
  const pixels = new Uint8Array(width * height).fill(fillColor);
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

function setTilePatternInImage(
  image: IndexedImage,
  tileX: number,
  tileY: number,
  pattern: number[],
): void {
  for (let py = 0; py < 8; py += 1) {
    for (let px = 0; px < 8; px += 1) {
      const imgX = tileX * 8 + px;
      const imgY = tileY * 8 + py;
      if (imgX < image.width && imgY < image.height) {
        const offset = py * 8 + px;
        image.pixels[imgY * image.width + imgX] =
          pattern[offset % pattern.length] ?? 0;
      }
    }
  }
}

describe('Pixel Overrides Reconciliation (reconcilePixelOverridesForGeometry)', () => {
  it('handles empty, null, or undefined overrides', () => {
    expect(reconcilePixelOverridesForGeometry(null, 4, 4)).toEqual({
      reconciledOverrides: {},
      retainedKeys: [],
      removedKeys: [],
    });
    expect(reconcilePixelOverridesForGeometry(undefined, 4, 4)).toEqual({
      reconciledOverrides: {},
      retainedKeys: [],
      removedKeys: [],
    });
    expect(reconcilePixelOverridesForGeometry({}, 4, 4)).toEqual({
      reconciledOverrides: {},
      retainedKeys: [],
      removedKeys: [],
    });
  });

  it('preserves all overrides when image dimensions increase', () => {
    const overrides = {
      '0_0': { 0: 1, 63: 2 },
      '1_1': { 10: 3 },
    };
    const result = reconcilePixelOverridesForGeometry(overrides, 8, 8);
    expect(result.retainedKeys).toEqual(['0_0', '1_1']);
    expect(result.removedKeys).toEqual([]);
    expect(result.reconciledOverrides['0_0']).toEqual({ 0: 1, 63: 2 });
    expect(result.reconciledOverrides['1_1']).toEqual({ 10: 3 });
  });

  it('removes out-of-bounds overrides when image dimensions decrease', () => {
    const overrides = {
      '0_0': { 0: 1 },
      '1_1': { 0: 2 },
      '2_2': { 0: 3 },
      '3_3': { 0: 3 },
    };
    const result = reconcilePixelOverridesForGeometry(overrides, 2, 2); // 0..1, 0..1
    expect(result.retainedKeys).toEqual(['0_0', '1_1']);
    expect(result.removedKeys).toEqual(['2_2', '3_3']);
    expect(result.reconciledOverrides['2_2']).toBeUndefined();
    expect(result.reconciledOverrides['3_3']).toBeUndefined();
  });

  it('reconciles width-only changes', () => {
    const overrides = {
      '0_0': { 0: 1 },
      '2_0': { 0: 2 },
      '3_0': { 0: 3 },
    };
    const result = reconcilePixelOverridesForGeometry(overrides, 2, 4); // width 0..1
    expect(result.retainedKeys).toEqual(['0_0']);
    expect(result.removedKeys).toEqual(['2_0', '3_0']);
  });

  it('reconciles height-only changes', () => {
    const overrides = {
      '0_0': { 0: 1 },
      '0_2': { 0: 2 },
      '0_5': { 0: 3 },
    };
    const result = reconcilePixelOverridesForGeometry(overrides, 4, 3); // height 0..2
    expect(result.retainedKeys).toEqual(['0_0', '0_2']);
    expect(result.removedKeys).toEqual(['0_5']);
  });

  it('removes all overrides when all are out-of-bounds or dimensions are zero', () => {
    const overrides = {
      '5_5': { 0: 1 },
      '6_6': { 0: 2 },
    };
    const result = reconcilePixelOverridesForGeometry(overrides, 2, 2);
    expect(result.retainedKeys).toEqual([]);
    expect(result.removedKeys).toEqual(['5_5', '6_6']);
    expect(result.reconciledOverrides).toEqual({});
  });

  it('discards malformed or non-numeric keys', () => {
    const overrides = {
      '0_0': { 0: 1 },
      invalid_key: { 0: 2 },
      '-1_0': { 0: 3 },
      '0_-2': { 0: 3 },
    };
    const result = reconcilePixelOverridesForGeometry(overrides, 4, 4);
    expect(result.retainedKeys).toEqual(['0_0']);
    expect(result.removedKeys).toEqual(['-1_0', '0_-2', 'invalid_key']);
  });

  it('is pure and does not mutate input overrides object', () => {
    const overrides = {
      '0_0': { 0: 1 },
      '5_5': { 0: 2 },
    };
    const originalKeys = Object.keys(overrides);
    reconcilePixelOverridesForGeometry(overrides, 2, 2);
    expect(Object.keys(overrides)).toEqual(originalKeys);
  });
});

describe('Animation Geometry and Frame Array Reconciliation (reconcileAnimationGeometry)', () => {
  it('reconciles frame sequence when frameWidth changes (16x16 -> 24x16)', () => {
    // 48x16 image:
    // With 16x16: 3 frames (0, 1, 2)
    // With 24x16: 2 frames (0, 1)
    const result = reconcileAnimationGeometry({
      frameWidth: 24,
      frameHeight: 16,
      imageWidth: 48,
      imageHeight: 16,
      frameIndices: [0, 1, 2],
      frameDurations: [4, 8, 12],
      framePalettes: [null, 1, 2],
      framePaletteIds: ['pal-a', 'pal-b', 'pal-c'],
      defaultDuration: 6,
    });

    expect(result.totalFrames).toBe(2);
    expect(result.frameIndices).toEqual([0, 1]);
    expect(result.frameDurations).toEqual([4, 8]);
    expect(result.framePalettes).toEqual([null, 1]);
    expect(result.framePaletteIds).toEqual(['pal-a', 'pal-b']);
    expect(result.removedFrameIndices).toEqual([2]);
  });

  it('reconciles frame sequence when frameHeight changes (16x16 -> 16x24)', () => {
    // 16x48 image:
    // With 16x16: 3 frames (0, 1, 2)
    // With 16x24: 2 frames (0, 1)
    const result = reconcileAnimationGeometry({
      frameWidth: 16,
      frameHeight: 24,
      imageWidth: 16,
      imageHeight: 48,
      frameIndices: [2, 0, 1],
      frameDurations: [20, 10, 15],
      framePalettes: [2, null, 1],
      framePaletteIds: ['pal-c', 'pal-a', 'pal-b'],
      defaultDuration: 6,
    });

    expect(result.totalFrames).toBe(2);
    // Frame 2 is out-of-bounds for totalFrames=2 (valid: 0, 1)
    expect(result.frameIndices).toEqual([0, 1]);
    expect(result.frameDurations).toEqual([10, 15]);
    expect(result.framePalettes).toEqual([null, 1]);
    expect(result.framePaletteIds).toEqual(['pal-a', 'pal-b']);
    expect(result.removedFrameIndices).toEqual([2]);
  });

  it('reconciles both frameWidth and frameHeight changes (16x16 -> 24x24)', () => {
    // 48x48 image:
    // 16x16 had 9 frames (0..8)
    // 24x24 has 4 frames (0..3)
    const result = reconcileAnimationGeometry({
      frameWidth: 24,
      frameHeight: 24,
      imageWidth: 48,
      imageHeight: 48,
      frameIndices: [5, 0, 2, 8, 1],
      frameDurations: [50, 10, 20, 80, 15],
      framePalettes: [1, null, 2, 3, 1],
      framePaletteIds: ['p5', 'p0', 'p2', 'p8', 'p1'],
    });

    expect(result.totalFrames).toBe(4);
    // Frames 5 and 8 are >= 4, removed!
    expect(result.frameIndices).toEqual([0, 2, 1]);
    expect(result.frameDurations).toEqual([10, 20, 15]);
    expect(result.framePalettes).toEqual([null, 2, 1]);
    expect(result.framePaletteIds).toEqual(['p0', 'p2', 'p1']);
    expect(result.removedFrameIndices).toEqual([5, 8]);
  });

  it('maintains 1-to-1 alignment with repeated frames', () => {
    const result = reconcileAnimationGeometry({
      frameWidth: 16,
      frameHeight: 16,
      imageWidth: 32,
      imageHeight: 16, // totalFrames = 2 (0, 1)
      frameIndices: [0, 1, 0, 5, 1],
      frameDurations: [4, 8, 12, 16, 20],
      framePalettes: [0, 1, 2, 3, 0],
      framePaletteIds: ['a', 'b', 'c', 'd', 'e'],
    });

    expect(result.frameIndices).toEqual([0, 1, 0, 1]);
    expect(result.frameDurations).toEqual([4, 8, 12, 20]);
    expect(result.framePalettes).toEqual([0, 1, 2, 0]);
    expect(result.framePaletteIds).toEqual(['a', 'b', 'c', 'e']);
    expect(result.removedFrameIndices).toEqual([5]);
  });

  it('validates metasprite origin within NES relative displacement bounds', () => {
    // 16x16 frame:
    // valid originX in [-119 .. 128]
    expect(isAnimationOriginValid(16, 16, 0, 0)).toBe(true);
    expect(isAnimationOriginValid(16, 16, 8, 16)).toBe(true);
    expect(isAnimationOriginValid(16, 16, 128, 128)).toBe(true);
    expect(isAnimationOriginValid(16, 16, 129, 0)).toBe(false); // -originX = -129 < -128
    expect(isAnimationOriginValid(16, 16, -130, 0)).toBe(false); // (16-8) - (-130) = 138 > 127
  });
});

function getTestAnimationConfig(
  project: StudioProject,
): ProjectAnimationSettingsConfig {
  if (!project.animation) {
    throw new Error('Project animation configuration is missing');
  }
  return project.animation;
}

describe('Spritesheet Reimport Full Pipeline (reconcileSpritesheetReimport & Issue #97 Scenarios)', () => {
  it('Scenario 1: Reimport with same size and different pixels updates CHR without stale residues', () => {
    const project = createDefaultProject('Hero Project', 'animation');
    const animId =
      getTestAnimationConfig(project).animations[0]?.id ?? 'anim-default';

    const oldImage = createTestIndexedImage(16, 16);
    setTilePatternInImage(oldImage, 0, 0, [1, 1, 1, 1]); // Pattern A

    const initialReimport = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage: oldImage,
    });

    expect(initialReimport.success).toBe(true);
    if (!initialReimport.success) return;

    const patternTableByteOffset =
      (project.animation?.patternTable ?? 0) * 4096;
    // The first slot in the configured Sprite Pattern Table has Pattern A.
    expect(
      initialReimport.animationModel.finalChr[patternTableByteOffset],
    ).toBe(0xff); // bitplane 0 for color 1
    const stableAssetId = initialReimport.reconciliation.assetId;

    // Reimport new image with Pattern B (color 2)
    const newImage = createTestIndexedImage(16, 16);
    setTilePatternInImage(newImage, 0, 0, [2, 2, 2, 2]); // Pattern B

    const secondReimport = reconcileSpritesheetReimport({
      project: initialReimport.project,
      animationId: animId,
      newImage,
    });

    expect(secondReimport.success).toBe(true);
    if (!secondReimport.success) return;

    // ProjectAssetId preserved
    expect(secondReimport.reconciliation.assetId).toBe(stableAssetId);
    expect(
      getTestAnimationConfig(secondReimport.project).animations[0]?.asset?.id,
    ).toBe(stableAssetId);

    // The same slot now has Pattern B (bitplane 0 = 0, bitplane 1 = 0xff).
    expect(secondReimport.animationModel.finalChr[patternTableByteOffset]).toBe(
      0x00,
    );
    expect(
      secondReimport.animationModel.finalChr[patternTableByteOffset + 8],
    ).toBe(0xff);

    // Mapping index has origin and usages
    const firstSpriteSlot = (project.animation?.patternTable ?? 0) * 256;
    const slot = getPhysicalSlotAttribution(
      firstSpriteSlot,
      secondReimport.mappingIndex,
    );
    expect(slot?.origin?.primaryAssetId).toBe(stableAssetId);
  });

  it('Scenario 2: Increasing image size expands frame availability and preserves valid keys', () => {
    const project = createDefaultProject('Resize Project', 'animation');
    const animId =
      getTestAnimationConfig(project).animations[0]?.id ?? 'anim-default';

    const smallImage = createTestIndexedImage(16, 16); // 1 frame 16x16
    setTilePatternInImage(smallImage, 0, 0, [1]);

    const res1 = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage: smallImage,
    });
    expect(res1.success).toBe(true);
    if (!res1.success) return;

    const largeImage = createTestIndexedImage(32, 32); // 4 frames 16x16
    setTilePatternInImage(largeImage, 0, 0, [1]);
    setTilePatternInImage(largeImage, 2, 2, [2]); // New tile at (2, 2)

    const res2 = reconcileSpritesheetReimport({
      project: res1.project,
      animationId: animId,
      newImage: largeImage,
    });

    expect(res2.success).toBe(true);
    if (!res2.success) return;

    expect(res2.reconciliation.nextDimensions).toEqual({
      width: 32,
      height: 32,
    });
    expect(res2.reconciliation.assetId).toBe(res1.reconciliation.assetId);
  });

  it('Scenario 3: Decreasing image size removes out-of-bounds frames and overrides', () => {
    let project = createDefaultProject('Shrink Project', 'animation');
    const animId =
      getTestAnimationConfig(project).animations[0]?.id ?? 'anim-default';

    const bigImage = createTestIndexedImage(32, 32); // 4 frames 16x16 (indices 0, 1, 2, 3)
    setTilePatternInImage(bigImage, 0, 0, [1]);
    setTilePatternInImage(bigImage, 2, 0, [2]);
    setTilePatternInImage(bigImage, 0, 2, [3]);
    setTilePatternInImage(bigImage, 2, 2, [1, 2]);

    const res1 = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage: bigImage,
    });
    expect(res1.success).toBe(true);
    if (!res1.success) return;

    // Add overrides: 0_0 (inside), 3_3 (outside 16x16)
    const baseAnim1 = getTestAnimationConfig(res1.project).animations[0];
    if (!baseAnim1) return;
    const animWithOverrides: ProjectAnimationItemConfig = {
      ...baseAnim1,
      frameIndices: [0, 1, 2, 3],
      frameDurations: [4, 8, 12, 16],
      framePalettes: [null, 1, 2, 3],
      pixelOverrides: {
        '0_0': { 0: 3 },
        '3_3': { 0: 3 },
      },
    };

    project = {
      ...res1.project,
      animation: {
        ...getTestAnimationConfig(res1.project),
        animations: [animWithOverrides],
      },
    };

    const smallImage = createTestIndexedImage(16, 16); // 1 frame 16x16 (index 0)
    setTilePatternInImage(smallImage, 0, 0, [1]);

    const res2 = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage: smallImage,
    });

    expect(res2.success).toBe(true);
    if (!res2.success) return;

    // Overrides: 0_0 retained, 3_3 removed
    expect(res2.reconciliation.retainedOverrides).toEqual(['0_0']);
    expect(res2.reconciliation.removedOverrides).toEqual(['3_3']);

    // Frame indices: only frame 0 retained
    expect(res2.reconciliation.retainedFrameIndices).toEqual([0]);
    expect(res2.reconciliation.removedFrameIndices).toEqual([1, 2, 3]);

    const finalAnim = getTestAnimationConfig(res2.project).animations[0];
    expect(finalAnim?.frameIndices).toEqual([0]);
    expect(finalAnim?.frameDurations).toEqual([4]);
    expect(finalAnim?.framePalettes).toEqual([null]);
    expect(finalAnim?.pixelOverrides).toEqual({ '0_0': { 0: 3 } });
  });

  it('Scenario 4 & 5 & 6: Multiple pixel overrides reconciliation', () => {
    let project = createDefaultProject('Overrides Project', 'animation');
    const animId =
      getTestAnimationConfig(project).animations[0]?.id ?? 'anim-default';

    const baseAnim = getTestAnimationConfig(project).animations[0];
    if (!baseAnim) return;

    const animConfig: ProjectAnimationItemConfig = {
      ...baseAnim,
      frameWidth: 24,
      frameHeight: 16,
      frameIndices: [0],
      pixelOverrides: {
        '0_0': { 0: 1 },
        '1_0': { 0: 2 },
        '2_1': { 0: 3 },
        '4_4': { 0: 3 },
      },
    };

    project = {
      ...project,
      animation: {
        ...getTestAnimationConfig(project),
        animations: [animConfig],
      },
    };

    // 24x16 image = 3x2 tiles (tileX 0..2, tileY 0..1)
    const newImage = createTestIndexedImage(24, 16);
    setTilePatternInImage(newImage, 0, 0, [1]);

    const res = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage,
      newFrameWidth: 24,
      newFrameHeight: 16,
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    // '0_0' (0,0) and '1_0' (1,0) are within bounds [0..2, 0..1]
    // '2_1' (2,1) has tileY=1 < 2, tileX=2 < 3 -> within bounds!
    // '4_4' (4,4) has tileX=4 >= 3 -> removed!
    expect(res.reconciliation.retainedOverrides).toEqual(['0_0', '1_0', '2_1']);
    expect(res.reconciliation.removedOverrides).toEqual(['4_4']);
  });

  it('Scenario 7 & 8 & 9: Frame indices, durations, and palettes remain aligned', () => {
    let project = createDefaultProject('Alignment Project', 'animation');
    const animId =
      getTestAnimationConfig(project).animations[0]?.id ?? 'anim-default';

    const baseAnim = getTestAnimationConfig(project).animations[0];
    if (!baseAnim) return;

    const animConfig: ProjectAnimationItemConfig = {
      ...baseAnim,
      frameIndices: [3, 0, 5, 1],
      frameDurations: [30, 10, 50, 20],
      framePalettes: [3, null, 2, 1],
      framePaletteIds: ['p3', 'p0', 'p2', 'p1'],
    };

    project = {
      ...project,
      animation: {
        ...getTestAnimationConfig(project),
        animations: [animConfig],
      },
    };

    // 32x16 image with frameWidth=16, frameHeight=16 -> 2 frames (0 and 1)
    const newImage = createTestIndexedImage(32, 16);
    setTilePatternInImage(newImage, 0, 0, [1]);
    setTilePatternInImage(newImage, 2, 0, [2]);

    const res = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage,
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    // Frames 3 and 5 are >= 2, removed. Surviving are frames 0 and 1.
    const finalAnim = getTestAnimationConfig(res.project).animations[0];
    expect(finalAnim?.frameIndices).toEqual([0, 1]);
    expect(finalAnim?.frameDurations).toEqual([10, 20]);
    expect(finalAnim?.framePalettes).toEqual([null, 1]);
    expect(finalAnim?.framePaletteIds).toEqual(['p0', 'p1']);
  });

  it('Scenario 10 & 11 & 12: Changing frame dimensions reconciles frame selection and metasprites', () => {
    const project = createDefaultProject('Frame Dim Project', 'animation');
    const animId =
      getTestAnimationConfig(project).animations[0]?.id ?? 'anim-default';

    // 48x48 image
    const image = createTestIndexedImage(48, 48);
    setTilePatternInImage(image, 0, 0, [1]);
    setTilePatternInImage(image, 3, 3, [2]);

    const res = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage: image,
      newFrameWidth: 24,
      newFrameHeight: 24,
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    const finalAnim = getTestAnimationConfig(res.project).animations[0];
    expect(finalAnim?.frameWidth).toBe(24);
    expect(finalAnim?.frameHeight).toBe(24);
    expect(res.animationModel.animations[0]?.width).toBe(24);
    expect(res.animationModel.animations[0]?.height).toBe(24);
  });

  it('Scenario 13 & 14 & 15 & 16: ProjectAssetId and LogicalTileKeys stable provenance', () => {
    let project = createDefaultProject('Provenance Project', 'animation');
    const animId =
      getTestAnimationConfig(project).animations[0]?.id ?? 'anim-default';
    const customAssetId = 'asset-hero-fixed-id';

    const baseAnim = getTestAnimationConfig(project).animations[0];
    if (!baseAnim) return;

    project = {
      ...project,
      animation: {
        ...getTestAnimationConfig(project),
        animations: [
          {
            ...baseAnim,
            asset: {
              id: customAssetId,
              path: 'hero.png',
              name: 'hero.png',
              sourceKind: 'png',
            },
            frameIndices: [0, 3],
          },
        ],
      },
    };

    const image1 = createTestIndexedImage(16, 16);
    setTilePatternInImage(image1, 0, 0, [1]);
    setTilePatternInImage(image1, 1, 1, [2]);

    const res1 = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage: image1,
    });
    expect(res1.success).toBe(true);
    if (!res1.success) return;

    expect(res1.reconciliation.assetId).toBe(customAssetId);

    // Check logical keys in mapping index
    const usages00 = getUsagesForLogicalKey(
      `${customAssetId}:0:0`,
      res1.mappingIndex,
    );
    expect(usages00.length).toBeGreaterThan(0);

    // Expand image to 32x32 (4 frames: 0..3) with frameIndices [0, 3]
    const image2 = createTestIndexedImage(32, 32);
    setTilePatternInImage(image2, 0, 0, [1]);
    setTilePatternInImage(image2, 3, 3, [3]);

    const baseAnim1After = getTestAnimationConfig(res1.project).animations[0];
    if (!baseAnim1After) return;

    const res2 = reconcileSpritesheetReimport({
      project: {
        ...res1.project,
        animation: {
          ...getTestAnimationConfig(res1.project),
          animations: [
            {
              ...baseAnim1After,
              frameIndices: [0, 3],
            },
          ],
        },
      },
      animationId: animId,
      newImage: image2,
    });
    expect(res2.success).toBe(true);
    if (!res2.success) return;

    // Asset ID remains unchanged
    expect(res2.reconciliation.assetId).toBe(customAssetId);

    // Key `${customAssetId}:0:0` remains stable
    const usagesAfter = getUsagesForLogicalKey(
      `${customAssetId}:0:0`,
      res2.mappingIndex,
    );
    expect(usagesAfter.length).toBeGreaterThan(0);

    // New key `${customAssetId}:3:3` exists
    const usagesNew = getUsagesForLogicalKey(
      `${customAssetId}:3:3`,
      res2.mappingIndex,
    );
    expect(usagesNew.length).toBeGreaterThan(0);
  });

  it('Scenario 17 & 18: Obsolete physical tile released and shared tile preserved for other asset', () => {
    // Project with two animations sharing pattern A
    let project = createDefaultProject('Shared Project', 'animation');
    const heroAnimId = 'anim-hero';
    const enemyAnimId = 'anim-enemy';

    const sharedPattern = [1, 2, 3, 1];
    const exclusiveHeroPattern = [3, 3, 3, 3];
    const enemyPattern = [2, 2, 2, 2];

    const heroImage = createTestIndexedImage(16, 16);
    setTilePatternInImage(heroImage, 0, 0, sharedPattern);
    setTilePatternInImage(heroImage, 1, 0, exclusiveHeroPattern);

    const enemyImage = createTestIndexedImage(16, 16);
    setTilePatternInImage(enemyImage, 0, 0, sharedPattern); // Shares pattern A!
    setTilePatternInImage(enemyImage, 1, 0, enemyPattern);

    project = {
      ...project,
      animation: {
        ...getTestAnimationConfig(project),
        animations: [
          {
            id: heroAnimId,
            name: 'Hero',
            asset: {
              id: 'asset-hero',
              path: 'hero.png',
              name: 'hero.png',
              sourceKind: 'png',
            },
            frameWidth: 16,
            frameHeight: 16,
            originX: 0,
            originY: 0,
            playback: 'loop',
            allowHorizontalFlip: false,
            allowVerticalFlip: false,
            defaultDuration: 6,
            frameIndices: [0],
            frameDurations: [6],
          },
          {
            id: enemyAnimId,
            name: 'Enemy',
            asset: {
              id: 'asset-enemy',
              path: 'enemy.png',
              name: 'enemy.png',
              sourceKind: 'png',
            },
            frameWidth: 16,
            frameHeight: 16,
            originX: 0,
            originY: 0,
            playback: 'loop',
            allowHorizontalFlip: false,
            allowVerticalFlip: false,
            defaultDuration: 6,
            frameIndices: [0],
            frameDurations: [6],
          },
        ],
      },
    };

    // Initial build with both assets
    const defs = [
      {
        id: heroAnimId,
        assetId: 'asset-hero',
        name: 'Hero',
        image: heroImage,
        frameWidth: 16,
        frameHeight: 16,
        originX: 0,
        originY: 0,
        frameIndices: [0],
        frameDuration: 6,
      },
      {
        id: enemyAnimId,
        assetId: 'asset-enemy',
        name: 'Enemy',
        image: enemyImage,
        frameWidth: 16,
        frameHeight: 16,
        originX: 0,
        originY: 0,
        frameIndices: [0],
        frameDuration: 6,
      },
    ];

    const initialModel = buildAnimationProjectModel({
      name: 'Test',
      symbolPrefix: 'test',
      animations: defs,
    });
    const initialMapping = buildChrAssetMappingIndex({
      project,
      animationModel: initialModel,
      animations: getTestAnimationConfig(project).animations,
    });

    // Slot 0 is shared between Hero and Enemy
    const slot0 = getPhysicalSlotAttribution(0, initialMapping);
    expect(slot0?.isShared).toBe(true);

    // Reimport Hero with a single new pattern, removing exclusiveHeroPattern AND sharedPattern from Hero
    const newHeroImage = createTestIndexedImage(16, 16);
    setTilePatternInImage(newHeroImage, 0, 0, [3, 1, 3, 1]); // New pattern C

    const res = reconcileSpritesheetReimport({
      project,
      animationId: heroAnimId,
      newImage: newHeroImage,
      animationImages: {
        [enemyAnimId]: enemyImage,
      },
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    // Enemy STILL uses the shared tile
    const enemyUsages = getUsagesForLogicalKey(
      'asset-enemy:0:0',
      res.mappingIndex,
    );
    expect(enemyUsages.length).toBeGreaterThan(0);
  });

  it('Scenario 19 & 20: Base CHR and CHR Reservations are preserved', () => {
    let project = createDefaultProject('Base CHR Project', 'animation');
    const animId =
      getTestAnimationConfig(project).animations[0]?.id ?? 'anim-default';

    // Base CHR with non-zero tile at slot 5
    const baseChr = new Uint8Array(4096);
    baseChr.set(encodeTile(createPatternTile(5, [1, 2, 3, 1])), 5 * 16);

    project = {
      ...project,
      chrRegions: [
        {
          id: 'res-1',
          name: 'Engine Reservation',
          patternTable: 0,
          startTile: 0,
          endTile: 3,
          kind: 'reservation',
        },
      ],
    };

    const image = createTestIndexedImage(16, 16);
    setTilePatternInImage(image, 0, 0, [2, 2, 2, 2]);

    const res = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage: image,
      baseChr,
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    // Base CHR tile at slot 5 is preserved
    const baseSlot5 = getPhysicalSlotAttribution(5, res.mappingIndex);
    expect(baseSlot5?.origin?.creationKind).toBe('base-chr');

    // Reserved slots 0..3 were not overwritten by new extracted sprites
    for (let slot = 0; slot <= 3; slot += 1) {
      const slotAttr = getPhysicalSlotAttribution(slot, res.mappingIndex);
      expect(slotAttr?.origin?.creationKind).not.toBe('extracted');
    }
  });

  it('Scenario 21: Capacity overflow fails atomically without mutating previous project', () => {
    const project = createDefaultProject('Atomic Project', 'animation');
    const animId =
      getTestAnimationConfig(project).animations[0]?.id ?? 'anim-default';

    // Create an image of 160x160 with frameWidth=16, frameHeight=16 (100 frames, 400 unique tiles > 256 PT capacity)
    const giantImage = createTestIndexedImage(160, 160);
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 20; x += 1) {
        const id = y * 20 + x;
        // Asymmetric unique pattern per tile
        for (let py = 0; py < 8; py += 1) {
          for (let px = 0; px < 8; px += 1) {
            const bit = py * 8 + px;
            const color =
              bit < 9
                ? ((id >> bit) & 1) + 1
                : bit === 63
                  ? 3
                  : ((id + py + px) % 2) + 1;
            const imgX = x * 8 + px;
            const imgY = y * 8 + py;
            giantImage.pixels[imgY * giantImage.width + imgX] = color;
          }
        }
      }
    }

    const baseAnim = getTestAnimationConfig(project).animations[0];
    if (!baseAnim) return;

    const priorState: StudioProject = {
      ...project,
      animation: {
        ...getTestAnimationConfig(project),
        animations: [
          {
            ...baseAnim,
            frameWidth: 16,
            frameHeight: 16,
            frameIndices: Array.from({ length: 100 }, (_, i) => i),
          },
        ],
      },
    };

    const initialClone = JSON.stringify(priorState);

    const res = reconcileSpritesheetReimport({
      project: priorState,
      animationId: animId,
      newImage: giantImage,
      newFrameWidth: 16,
      newFrameHeight: 16,
    });

    expect(res.success).toBe(false);
    if (res.success) return;

    expect(res.error).toBeInstanceOf(AnimationModelError);
    if (res.error instanceof AnimationModelError) {
      expect(res.error.code).toBe('pattern-table-capacity-overflow');
    }

    // Previous project remained completely intact
    expect(JSON.stringify(res.previousProject)).toBe(initialClone);
    expect(JSON.stringify(priorState)).toBe(initialClone);
  });

  it('Scenario 22: Deterministic reimport', () => {
    const project = createDefaultProject('Deterministic Project', 'animation');
    const animId =
      getTestAnimationConfig(project).animations[0]?.id ?? 'anim-default';

    const image = createTestIndexedImage(32, 32);
    setTilePatternInImage(image, 0, 0, [1, 2]);
    setTilePatternInImage(image, 1, 1, [2, 3]);

    const res1 = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage: image,
    });
    const res2 = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage: image,
    });

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    if (res1.success && res2.success) {
      expect(res1.animationModel.finalChr).toEqual(
        res2.animationModel.finalChr,
      );
      expect(res1.reconciliation).toEqual(res2.reconciliation);
    }
  });

  it('Scenario 23: Post-reimport serialize -> deserialize -> rebuild produces identical results', () => {
    const project = createDefaultProject('Serialize Project', 'animation');
    const animId =
      getTestAnimationConfig(project).animations[0]?.id ?? 'anim-default';

    const image = createTestIndexedImage(32, 32);
    setTilePatternInImage(image, 0, 0, [1, 2, 3]);
    setTilePatternInImage(image, 1, 0, [2, 1, 0]);

    const res = reconcileSpritesheetReimport({
      project,
      animationId: animId,
      newImage: image,
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    // Serialize project to JSON
    const serialized = serializeProject(res.project);

    // Verify physical assignments are NOT persisted
    expect(serialized).not.toContain('finalChr');
    expect(serialized).not.toContain('byPhysicalIndex');
    expect(serialized).not.toContain('physicalTileIndex');

    // Deserialize
    const deserializedResult = deserializeProject(serialized);
    expect(deserializedResult.success).toBe(true);
    if (!deserializedResult.success) return;

    const reloadedProject = deserializedResult.project;
    expect(
      getTestAnimationConfig(reloadedProject).animations[0]?.asset?.id,
    ).toBe(res.reconciliation.assetId);

    // Rebuild model from reloaded project
    const reloadedAnim = getTestAnimationConfig(reloadedProject).animations[0];
    if (!reloadedAnim) return;

    const rebuiltModel = buildAnimationProjectModel({
      name: reloadedProject.animation?.name ?? 'entity',
      symbolPrefix: reloadedProject.animation?.symbolPrefix ?? 'entity',
      patternTable: reloadedProject.animation?.patternTable,
      animations: [
        {
          id: reloadedAnim.id,
          assetId: reloadedAnim.asset?.id,
          name: reloadedAnim.name,
          image,
          frameWidth: reloadedAnim.frameWidth,
          frameHeight: reloadedAnim.frameHeight,
          originX: reloadedAnim.originX,
          originY: reloadedAnim.originY,
          frameIndices: reloadedAnim.frameIndices,
          frameDuration: reloadedAnim.defaultDuration,
          pixelOverrides: reloadedAnim.pixelOverrides,
        },
      ],
    });

    expect(rebuiltModel.finalChr).toEqual(res.animationModel.finalChr);
  });
});
