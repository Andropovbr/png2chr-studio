import { describe, expect, it } from 'vitest';
import { createLogicalTileKey } from './asset-identity';
import { createEmptyBackgroundMap } from './background-model';
import { compileProjectGraphics } from './project-graphics-compiler';
import { buildChrAssetMappingIndex } from './chr-asset-mapping';
import { resolveTileEditOrigin } from './chr-project-integration';
import {
  createDefaultProject,
  deserializeProject,
  serializeProject,
} from './project';

describe('project graphics compiler integration', () => {
  it('derives physical ownership and editor origin exclusively from compiler provenance', () => {
    const source = createDefaultProject('Manifest', 'animation');
    const logicalKey = createLogicalTileKey('asset-real-id', 3, 2);
    const map = {
      ...createEmptyBackgroundMap({ id: 'map-real', patternTable: 0 }),
      assetId: 'asset-real-id',
      cells: createEmptyBackgroundMap().cells.map((_, index) =>
        index === 65 ? { logicalKey, tileX: 3, tileY: 2 } : null,
      ),
    };
    const tile = {
      id: 7,
      column: 3,
      row: 2,
      pixels: new Uint8Array(64).fill(2),
    };
    const compiled = compileProjectGraphics({
      graphics: {
        ...source.graphics,
        assets: [
          {
            id: 'asset-real-id',
            kind: 'background-image',
            name: 'Real',
            source: null,
            logicalTiles: {
              decoding: 'png-indexed',
              quantization: null,
              paletteBank: 'background',
            },
          },
        ],
        renderContexts: [
          {
            id: 'context-real',
            name: 'Real',
            backgroundPatternTable: 0,
            spriteMode: '8x8',
            spritePatternTable: 1,
            mapIds: ['map-real'],
            animationIds: [],
          },
        ],
      },
      decodedAssets: [
        {
          assetId: 'asset-real-id',
          widthTiles: 4,
          heightTiles: 3,
          tiles: [tile],
          tilesByLogicalKey: new Map([[logicalKey, tile]]),
        },
      ],
      backgroundMaps: [map],
      animationDemands: [],
    });
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;

    const mapping = buildChrAssetMappingIndex({ compiled });
    const physicalSlot = compiled.logicalTilePlacements[0]?.physicalSlot;
    expect(physicalSlot).toBeTypeOf('number');
    if (physicalSlot === undefined) return;
    expect(mapping.byPhysicalIndex[physicalSlot]?.origin).toMatchObject({
      primaryAssetId: 'asset-real-id',
      logicalKey,
      sourceCoordinates: { tileX: 3, tileY: 2 },
    });
    expect(mapping.byPhysicalIndex[physicalSlot]?.usages).toHaveLength(1);
    expect(
      resolveTileEditOrigin({
        physicalIndex: physicalSlot,
        mode: 'tileset',
        mappingIndex: mapping,
      }),
    ).toMatchObject({ type: 'tileset', tileX: 3, tileY: 2 });
  });

  it('compiles canonical persisted consumers into one project-wide static CHR result', () => {
    const source = createDefaultProject('Compiled Project', 'animation');
    const logicalKey = createLogicalTileKey('asset-shared', 0, 0);
    const map = {
      ...createEmptyBackgroundMap({ id: 'map-main', patternTable: 1 }),
      assetId: 'asset-shared',
      cells: createEmptyBackgroundMap().cells.map((_, index) =>
        index === 0 ? { logicalKey, tileX: 0, tileY: 0 } : null,
      ),
    };
    const project = {
      ...source,
      backgrounds: { activeMapId: 'map-main', maps: [map] },
      graphics: {
        ...source.graphics,
        assets: [
          {
            id: 'asset-shared',
            kind: 'background-image' as const,
            name: 'Shared',
            source: null,
            logicalTiles: {
              decoding: 'png-indexed' as const,
              quantization: null,
              paletteBank: 'background' as const,
            },
          },
        ],
        renderContexts: [
          {
            id: 'context-main',
            name: 'Main',
            backgroundPatternTable: 1 as const,
            spriteMode: '8x8' as const,
            spritePatternTable: 1 as const,
            mapIds: ['map-main'],
            animationIds: ['anim-default'],
          },
        ],
      },
    };
    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.success).toBe(true);
    if (!loaded.success) return;

    const tile = {
      id: 0,
      column: 0,
      row: 0,
      pixels: new Uint8Array(64).fill(1),
    };
    const compiled = compileProjectGraphics({
      graphics: loaded.project.graphics,
      decodedAssets: [
        {
          assetId: 'asset-shared',
          widthTiles: 1,
          heightTiles: 1,
          tiles: [tile],
          tilesByLogicalKey: new Map([[logicalKey, tile]]),
        },
      ],
      backgroundMaps: loaded.project.backgrounds?.maps ?? [],
      animationDemands: [
        {
          animationId: 'anim-default',
          frames: [
            {
              sourceIndex: 0,
              sourceX: 0,
              sourceY: 0,
              duration: 8,
              effectivePalette: 0,
              width: 8,
              height: 8,
              omittedTileCount: 0,
              sprites: [
                {
                  pixels: tile.pixels,
                  tileColumn: 0,
                  tileRow: 0,
                  tileX: 0,
                  tileY: 0,
                  logicalKey,
                  x: 0,
                  y: 0,
                  sourceTileColumn: 0,
                  sourceTileRow: 0,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    expect(compiled.finalChr).toHaveLength(8192);
    expect(compiled.backgrounds[0]?.nametable[0]).toBe(0);
    expect(compiled.animations[0]?.oamTileIndexes[0]?.[0]).toBe(0);
    expect(compiled.logicalTilePlacements).toEqual([
      expect.objectContaining({
        logicalKey,
        physicalSlot: 256,
        patternTable: 1,
        localPatternTableIndex: 0,
        usages: [
          expect.objectContaining({ kind: 'background' }),
          expect.objectContaining({ kind: 'animation' }),
        ],
      }),
    ]);
    expect(compiled.capacity[1]).toMatchObject({
      projectSlots: 2,
      availableSlots: 254,
    });
  });
});
