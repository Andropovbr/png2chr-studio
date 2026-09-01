import { describe, expect, it } from 'vitest';
import { createLogicalTileKey } from './asset-identity';
import { createEmptyBackgroundMap } from './background-model';
import {
  analyzeChrOwnershipDiagnostics,
  buildChrAssetMappingIndex,
} from './chr-asset-mapping';
import { createProjectBaseChr } from './project-graphics';
import {
  compileProjectGraphics,
  type CompileProjectGraphicsOptions,
} from './project-graphics-compiler';
import { createDefaultProject } from './project';
import type { LogicalAnimationFrame } from './metasprite-extraction';
import type { Tile } from './types';

function pixels(seed: number): Uint8Array {
  const result = new Uint8Array(64);
  let value = seed + 1;
  for (let index = 0; index < 16; index += 1) {
    result[index] = value & 3;
    value = Math.floor(value / 4);
  }
  return result;
}

function tile(tileX: number, seed: number): Tile {
  return { id: tileX, column: tileX, row: 0, pixels: pixels(seed) };
}

function decodedAsset(assetId: string, tiles: readonly Tile[]) {
  return {
    assetId,
    widthTiles: tiles.length,
    heightTiles: 1,
    tiles,
    tilesByLogicalKey: new Map(
      tiles.map((value) => [
        createLogicalTileKey(assetId, value.column, value.row),
        value,
      ]),
    ),
  };
}

function frame(
  assetId: string,
  sprites: readonly { tileX: number; pixels: Uint8Array }[],
): LogicalAnimationFrame {
  return {
    sourceIndex: 0,
    sourceX: 0,
    sourceY: 0,
    duration: 8,
    effectivePalette: 0,
    width: sprites.length * 8,
    height: 8,
    omittedTileCount: 0,
    sprites: sprites.map((sprite, spriteIndex) => ({
      pixels: sprite.pixels,
      tileColumn: spriteIndex,
      tileRow: 0,
      tileX: sprite.tileX,
      tileY: 0,
      logicalKey: createLogicalTileKey(assetId, sprite.tileX, 0),
      x: spriteIndex * 8,
      y: 0,
      sourceTileColumn: spriteIndex,
      sourceTileRow: 0,
    })),
  };
}

function flipHorizontal(source: Uint8Array): Uint8Array {
  const result = new Uint8Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      result[y * 8 + x] = source[y * 8 + (7 - x)] ?? 0;
    }
  }
  return result;
}

function options(
  backgroundPatternTable: 0 | 1,
  spritePatternTable: 0 | 1,
): CompileProjectGraphicsOptions {
  const project = createDefaultProject();
  const bgTile = tile(0, 10);
  const spriteTile = tile(0, 20);
  const map = {
    ...createEmptyBackgroundMap({ id: 'map-main' }),
    assetId: 'asset-bg',
    cells: createEmptyBackgroundMap().cells.map((_, index) =>
      index === 0
        ? {
            logicalKey: createLogicalTileKey('asset-bg', 0, 0),
            tileX: 0,
            tileY: 0,
          }
        : null,
    ),
  };
  return {
    graphics: {
      ...project.graphics,
      assets: [
        {
          id: 'asset-bg',
          kind: 'background-image',
          name: 'Background',
          source: null,
          logicalTiles: {
            decoding: 'png-indexed',
            quantization: null,
            paletteBank: 'background',
          },
        },
        {
          id: 'asset-sprite',
          kind: 'spritesheet',
          name: 'Sprite',
          source: null,
          logicalTiles: {
            decoding: 'png-indexed',
            quantization: null,
            paletteBank: 'sprite',
          },
        },
      ],
      renderContexts: [
        {
          id: 'context-main',
          name: 'Main',
          backgroundPatternTable,
          spriteMode: '8x8',
          spritePatternTable,
          mapIds: ['map-main'],
          animationIds: ['anim-main'],
        },
      ],
    },
    decodedAssets: [
      decodedAsset('asset-bg', [bgTile]),
      decodedAsset('asset-sprite', [spriteTile]),
    ],
    backgroundMaps: [map],
    animationDemands: [
      {
        animationId: 'anim-main',
        frames: [
          frame('asset-sprite', [{ tileX: 0, pixels: spriteTile.pixels }]),
        ],
      },
    ],
  };
}

describe('compileProjectGraphics', () => {
  it.each([
    [0, 1],
    [1, 0],
  ] as const)(
    'compiles BG PT%s / Sprite PT%s with correct Nametable and OAM local indexes',
    (backgroundPatternTable, spritePatternTable) => {
      const result = compileProjectGraphics(
        options(backgroundPatternTable, spritePatternTable),
      );
      expect(result.success).toBe(true);
      if (!result.success) return;

      const backgroundAssignment = result.backgrounds[0]?.assignments[0];
      const spriteAssignment = result.animations[0]?.frameAssignments[0]?.[0];
      expect(
        Math.floor((backgroundAssignment?.physicalTileIndex ?? -1) / 256),
      ).toBe(backgroundPatternTable);
      expect(result.backgrounds[0]?.nametable[0]).toBe(
        (backgroundAssignment?.physicalTileIndex ?? -1) % 256,
      );
      expect(
        Math.floor((spriteAssignment?.physicalTileIndex ?? -1) / 256),
      ).toBe(spritePatternTable);
      expect(result.animations[0]?.oamTileIndexes[0]?.[0]).toBe(
        (spriteAssignment?.physicalTileIndex ?? -1) % 256,
      );
    },
  );

  it('shares one capacity budget and exact tile slot for same-table Background/Sprite use', () => {
    const input = options(0, 0);
    const bgPixels = input.decodedAssets[0]?.tiles[0]?.pixels;
    expect(bgPixels).toBeDefined();
    if (!bgPixels) return;
    const sprite = input.animationDemands[0]?.frames[0]?.sprites[0];
    const backgroundAsset = input.decodedAssets[0];
    if (!sprite || !backgroundAsset) return;
    const sharedInput: CompileProjectGraphicsOptions = {
      ...input,
      decodedAssets: [
        backgroundAsset,
        decodedAsset('asset-sprite', [
          { id: 0, column: 0, row: 0, pixels: bgPixels },
        ]),
      ],
      animationDemands: [
        {
          animationId: 'anim-main',
          frames: [frame('asset-sprite', [{ tileX: 0, pixels: bgPixels }])],
        },
      ],
    };
    const result = compileProjectGraphics(sharedInput);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const bgSlot = result.backgrounds[0]?.assignments[0]?.physicalTileIndex;
    const spriteSlot =
      result.animations[0]?.frameAssignments[0]?.[0]?.physicalTileIndex;
    expect(spriteSlot).toBe(bgSlot);
    expect(result.allocationManifest[bgSlot ?? -1]?.usages).toHaveLength(2);
  });

  it('keeps first compiled logical origin when a lexically earlier asset reuses its slot', () => {
    const input = options(0, 0);
    const backgroundPixels = input.decodedAssets[0]?.tiles[0]?.pixels;
    const map = input.backgroundMaps[0];
    if (!backgroundPixels || !map) return;
    const logicalKey = createLogicalTileKey('z-background', 0, 0);
    const result = compileProjectGraphics({
      ...input,
      graphics: {
        ...input.graphics,
        assets: input.graphics.assets.map((asset) => ({
          ...asset,
          id: asset.kind === 'background-image' ? 'z-background' : 'a-sprite',
        })),
      },
      backgroundMaps: [
        {
          ...map,
          assetId: 'z-background',
          cells: map.cells.map((cell, index) =>
            index === 0 ? { logicalKey, tileX: 0, tileY: 0 } : cell,
          ),
        },
      ],
      decodedAssets: [
        decodedAsset('z-background', [
          { id: 0, column: 0, row: 0, pixels: backgroundPixels },
        ]),
        decodedAsset('a-sprite', [
          { id: 0, column: 0, row: 0, pixels: backgroundPixels },
        ]),
      ],
      animationDemands: [
        {
          animationId: 'anim-main',
          frames: [frame('a-sprite', [{ tileX: 0, pixels: backgroundPixels }])],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.allocationManifest[0]).toMatchObject({
      originAssetId: 'z-background',
      originLogicalKey: logicalKey,
    });
  });

  it('requires Animation logical tiles to resolve through decoded canonical assets', () => {
    const input = options(0, 1);
    const result = compileProjectGraphics({
      ...input,
      decodedAssets: input.decodedAssets.slice(0, 1),
    });
    expect(result).toMatchObject({
      success: false,
      failures: [{ code: 'unresolved-logical-tile' }],
    });
  });

  it('preserves flip-aware Sprite reuse only when enabled', () => {
    const input = options(0, 1);
    const backgroundAsset = input.decodedAssets[0];
    if (!backgroundAsset) return;
    const asymmetric = pixels(1701);
    const flipped = flipHorizontal(asymmetric);
    const demands = (flipDeduplication: boolean) => [
      {
        animationId: 'anim-main',
        flipDeduplication,
        frames: [
          frame('asset-sprite', [
            { tileX: 0, pixels: asymmetric },
            { tileX: 1, pixels: flipped },
          ]),
        ],
      },
    ];
    const compile = (flipDeduplication: boolean) =>
      compileProjectGraphics({
        ...input,
        decodedAssets: [
          backgroundAsset,
          decodedAsset('asset-sprite', [
            { id: 0, column: 0, row: 0, pixels: asymmetric },
            { id: 1, column: 1, row: 0, pixels: flipped },
          ]),
        ],
        animationDemands: demands(flipDeduplication),
      });
    const enabled = compile(true);
    const disabled = compile(false);
    expect(enabled.success).toBe(true);
    expect(disabled.success).toBe(true);
    if (!enabled.success || !disabled.success) return;
    expect(enabled.animations[0]?.frameAssignments[0]).toMatchObject([
      { physicalTileIndex: 256, flipAttributes: 0 },
      { physicalTileIndex: 256, flipAttributes: 0x40 },
    ]);
    expect(disabled.animations[0]?.frameAssignments[0]).toMatchObject([
      { physicalTileIndex: 256, flipAttributes: 0 },
      { physicalTileIndex: 257, flipAttributes: 0 },
    ]);
  });

  it('keeps each Animation asset identity for exact and flipped shared placements', () => {
    const input = options(0, 1);
    const backgroundAsset = input.decodedAssets[0];
    if (!backgroundAsset) return;
    const asymmetric = pixels(1701);
    const flipped = flipHorizontal(asymmetric);
    const result = compileProjectGraphics({
      ...input,
      graphics: {
        ...input.graphics,
        assets: [
          ...input.graphics.assets,
          {
            id: 'asset-sprite-flipped',
            kind: 'spritesheet',
            name: 'Flipped sprite',
            source: null,
            logicalTiles: {
              decoding: 'png-indexed',
              quantization: null,
              paletteBank: 'sprite',
            },
          },
        ],
        renderContexts: input.graphics.renderContexts.map((context) => ({
          ...context,
          animationIds: ['anim-main', 'anim-flipped'],
        })),
      },
      decodedAssets: [
        backgroundAsset,
        decodedAsset('asset-sprite', [
          { id: 0, column: 0, row: 0, pixels: asymmetric },
        ]),
        decodedAsset('asset-sprite-flipped', [
          { id: 0, column: 0, row: 0, pixels: asymmetric },
          { id: 1, column: 1, row: 0, pixels: flipped },
        ]),
      ],
      animationDemands: [
        {
          animationId: 'anim-main',
          flipDeduplication: true,
          frames: [frame('asset-sprite', [{ tileX: 0, pixels: asymmetric }])],
        },
        {
          animationId: 'anim-flipped',
          flipDeduplication: true,
          frames: [
            frame('asset-sprite-flipped', [
              { tileX: 0, pixels: asymmetric },
              { tileX: 1, pixels: flipped },
            ]),
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const mapping = buildChrAssetMappingIndex({ compiled: result });
    const slot = result.logicalTilePlacements.find(
      (placement) => placement.physicalSlot === 256,
    )?.physicalSlot;
    expect(slot).toBe(256);
    if (slot === undefined) return;
    expect(
      mapping.byPhysicalIndex[slot]?.usages.map((usage) => usage.assetId),
    ).toEqual(['asset-sprite', 'asset-sprite-flipped', 'asset-sprite-flipped']);
    expect(
      analyzeChrOwnershipDiagnostics({
        mappingIndex: mapping,
        activeAssetIds: new Set([
          'asset-bg',
          'asset-sprite',
          'asset-sprite-flipped',
        ]),
      }).filter(
        (diagnostic) =>
          diagnostic.kind === 'invalid-logical-key' &&
          diagnostic.reason === 'asset-mismatch',
      ),
    ).toEqual([]);
  });

  it('preserves Base CHR, reuses exact zero bytes, and allocates new tiles after occupied slots', () => {
    const input = options(0, 1);
    const baseChrBytes = new Uint8Array(32);
    baseChrBytes[16] = 0x80;
    const baseChr = createProjectBaseChr({
      assetId: 'asset-base',
      source: { path: 'base.chr', sourceKind: 'chr' },
      byteLength: 32,
      shortFilePatternTable: 0,
    });
    const zeroTile = tile(0, -1);
    zeroTile.pixels.fill(0);
    const nonBaseTile = tile(1, 44);
    const map = input.backgroundMaps[0];
    const spriteAsset = input.decodedAssets[1];
    if (!map || !spriteAsset) return;
    const result = compileProjectGraphics({
      ...input,
      graphics: { ...input.graphics, baseChr },
      baseChrBytes,
      decodedAssets: [
        decodedAsset('asset-bg', [zeroTile, nonBaseTile]),
        spriteAsset,
      ],
      backgroundMaps: [
        {
          ...map,
          cells: map.cells.map((_, index) =>
            index < 2
              ? {
                  logicalKey: createLogicalTileKey('asset-bg', index, 0),
                  tileX: index,
                  tileY: 0,
                }
              : null,
          ),
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.backgrounds[0]?.assignments[0]?.physicalTileIndex).toBe(0);
    expect(result.backgrounds[0]?.assignments[1]?.physicalTileIndex).toBe(2);
    expect(result.allocationManifest[0]).toMatchObject({
      state: 'base-chr',
      originAssetId: 'asset-base',
    });
    expect(result.finalChr.slice(0, 32)).toEqual(baseChrBytes);
  });

  it('blocks locked available slots independently from byte occupancy', () => {
    const input = options(0, 1);
    const result = compileProjectGraphics({
      ...input,
      graphics: {
        ...input.graphics,
        baseChr: {
          ...input.graphics.baseChr,
          slotPolicies: [
            {
              startSlot: 0,
              endSlot: 0,
              occupancy: 'available',
              writability: 'locked',
              ownerAssetId: null,
              provenance: 'none',
            },
            {
              startSlot: 1,
              endSlot: 511,
              occupancy: 'available',
              writability: 'writable',
              ownerAssetId: null,
              provenance: 'none',
            },
          ],
        },
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.backgrounds[0]?.assignments[0]?.physicalTileIndex).toBe(1);
    expect(result.allocationManifest[0]?.state).toBe('locked');
  });

  it('keeps overlapping Base lock and Reservation facts orthogonal', () => {
    const input = options(0, 1);
    const result = compileProjectGraphics({
      ...input,
      graphics: {
        ...input.graphics,
        baseChr: {
          ...input.graphics.baseChr,
          slotPolicies: [
            {
              startSlot: 0,
              endSlot: 0,
              occupancy: 'available',
              writability: 'locked',
              ownerAssetId: null,
              provenance: 'none',
            },
            {
              startSlot: 1,
              endSlot: 511,
              occupancy: 'available',
              writability: 'writable',
              ownerAssetId: null,
              provenance: 'none',
            },
          ],
        },
      },
      chrRegions: [
        {
          id: 'reservation-locked',
          name: 'Locked Reservation',
          patternTable: 0,
          startTile: 0,
          endTile: 0,
          kind: 'reservation',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.allocationManifest[0]).toMatchObject({
      state: 'reserved',
      baseChrPolicy: {
        occupancy: 'available',
        writability: 'locked',
      },
      reservationIds: ['reservation-locked'],
    });
    expect(result.capacity[0]).toMatchObject({
      reservedAvailableSlots: 1,
      lockedAvailableSlots: 1,
    });
  });

  it('preserves untouched bytes in explicitly writable Base CHR ranges', () => {
    const input = options(1, 1);
    const baseChrBytes = new Uint8Array(16);
    baseChrBytes[0] = 0x80;
    const result = compileProjectGraphics({
      ...input,
      baseChrBytes,
      graphics: {
        ...input.graphics,
        baseChr: {
          assetId: 'asset-base',
          source: { path: 'base.chr', sourceKind: 'chr' },
          byteLength: 16,
          shortFilePatternTable: 0,
          slotPolicies: [
            {
              startSlot: 0,
              endSlot: 511,
              occupancy: 'available',
              writability: 'writable',
              ownerAssetId: null,
              provenance: 'imported-base-chr',
            },
          ],
        },
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.finalChr[0]).toBe(0x80);
    expect(result.allocationManifest[0]?.state).toBe('available');
  });

  it('blocks Reservations while retaining Region and Reservation membership in manifest', () => {
    const input = options(0, 1);
    const result = compileProjectGraphics({
      ...input,
      chrRegions: [
        {
          id: 'region-ui',
          name: 'UI',
          patternTable: 0,
          startTile: 0,
          endTile: 4,
          kind: 'region',
        },
        {
          id: 'reservation-engine',
          name: 'Engine',
          patternTable: 0,
          startTile: 0,
          endTile: 0,
          kind: 'reservation',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.backgrounds[0]?.assignments[0]?.physicalTileIndex).toBe(1);
    expect(result.allocationManifest[0]).toMatchObject({
      state: 'reserved',
      regionIds: ['region-ui'],
      reservationIds: ['reservation-engine'],
    });
    expect(result.allocationManifest[1]?.regionIds).toEqual(['region-ui']);
  });

  it('fails atomically when selected PT is exhausted without spilling into other PT', () => {
    const input = options(0, 1);
    const result = compileProjectGraphics({
      ...input,
      chrRegions: [
        {
          id: 'reservation-pt0',
          name: 'Full PT0',
          patternTable: 0,
          startTile: 0,
          endTile: 255,
          kind: 'reservation',
        },
      ],
    });
    expect(result).toMatchObject({
      success: false,
      failures: [{ code: 'pattern-table-capacity-overflow' }],
    });
    expect('finalChr' in result).toBe(false);
    expect('allocationManifest' in result).toBe(false);
  });

  it('fails total same-table project allocation atomically without silent truncation', () => {
    const input = options(0, 0);
    const bgTiles = Array.from({ length: 255 }, (_, index) =>
      tile(index, 1000 + index),
    );
    const map = input.backgroundMaps[0];
    if (!map) return;
    const animationTile = tile(0, 9000);
    const result = compileProjectGraphics({
      ...input,
      decodedAssets: [
        decodedAsset('asset-bg', bgTiles),
        decodedAsset('asset-sprite', [animationTile]),
      ],
      backgroundMaps: [
        {
          ...map,
          cells: map.cells.map((_, index) =>
            index < bgTiles.length
              ? {
                  logicalKey: createLogicalTileKey('asset-bg', index, 0),
                  tileX: index,
                  tileY: 0,
                }
              : null,
          ),
        },
      ],
      animationDemands: [
        {
          animationId: 'anim-main',
          frames: [
            frame('asset-sprite', [{ tileX: 0, pixels: animationTile.pixels }]),
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.failures[0]?.code).toBe('pattern-table-capacity-overflow');
    expect('backgrounds' in result).toBe(false);
  });

  it('returns byte-for-byte deterministic immutable manifests on repeat compilation', () => {
    const input = options(0, 1);
    const first = compileProjectGraphics(input);
    const second = compileProjectGraphics(input);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(first.finalChr).toEqual(second.finalChr);
    expect(first.allocationManifest).toEqual(second.allocationManifest);
    expect(first.logicalTilePlacements).toEqual(second.logicalTilePlacements);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.allocationManifest)).toBe(true);
    expect(Object.isFrozen(first.allocationManifest[0])).toBe(true);

    const mutated = first.finalChr;
    mutated[0] = 0xff;
    expect(first.finalChr).toEqual(second.finalChr);
  });

  it('fails when Base CHR is unresolved instead of guessing allocation or bytes', () => {
    const input = options(0, 1);
    const result = compileProjectGraphics({
      ...input,
      graphics: {
        ...input.graphics,
        baseChr: {
          assetId: 'asset-base',
          source: { path: 'missing.chr', sourceKind: 'chr' },
          byteLength: null,
          shortFilePatternTable: 0,
          slotPolicies: [
            {
              startSlot: 0,
              endSlot: 511,
              occupancy: 'unknown',
              writability: 'locked',
              ownerAssetId: 'asset-base',
              provenance: 'pending-source',
            },
          ],
        },
      },
    });
    expect(result).toMatchObject({
      success: false,
      failures: [{ code: 'unresolved-base-chr' }],
    });
  });

  it('converts malformed runtime projections into typed atomic failure', () => {
    const input = options(0, 1);
    const malformed = {
      ...input.decodedAssets[0],
      tilesByLogicalKey: null,
    } as unknown as (typeof input.decodedAssets)[number];
    let result: ReturnType<typeof compileProjectGraphics> | undefined;
    expect(() => {
      result = compileProjectGraphics({ ...input, decodedAssets: [malformed] });
    }).not.toThrow();
    expect(result).toMatchObject({
      success: false,
      failures: [{ code: 'allocation-conflict' }],
    });
  });
});
