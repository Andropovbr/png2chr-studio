import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROJECT_FORMAT_VERSION,
  createDefaultProject,
  deserializeProject,
  serializeProject,
} from './project';

function legacyProject(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    name: 'Legacy Graphics',
    mode: 'animation',
    settings: {
      deduplicationEnabled: true,
      flipDeduplicationEnabled: false,
      quantization: {
        quantizationMode: 'median-cut',
        ditheringMode: 'none',
        colorDistanceMode: 'perceptual',
      },
    },
    palette: {},
    ...overrides,
  };
}

describe('project graphics architecture', () => {
  it('defaults new projects to NROM static CHR-ROM with BG PT0 and 8x8 Sprites PT1', () => {
    const project = createDefaultProject();
    expect(project.formatVersion).toBe(CURRENT_PROJECT_FORMAT_VERSION);
    expect(project.graphics.profile).toEqual({
      mapper: 'nrom',
      chrMemory: 'static-8k-chr-rom',
      spriteMode: '8x8',
      patternTableMode: 'fixed-per-render-context',
    });
    expect(project.graphics.renderContexts[0]).toMatchObject({
      backgroundPatternTable: 0,
      spriteMode: '8x8',
      spritePatternTable: 1,
    });
  });

  it.each([
    [1, 0],
    [0, 0],
    [1, 1],
  ] as const)(
    'round-trips configurable Background PT%s / Sprite PT%s contexts',
    (backgroundPatternTable, spritePatternTable) => {
      const project = createDefaultProject();
      const raw = JSON.parse(serializeProject(project)) as Record<
        string,
        unknown
      >;
      const graphics = raw.graphics as {
        renderContexts: Record<string, unknown>[];
      };
      graphics.renderContexts[0] = {
        ...graphics.renderContexts[0],
        backgroundPatternTable,
        spritePatternTable,
      };

      const loaded = deserializeProject(JSON.stringify(raw));
      expect(loaded.success).toBe(true);
      if (!loaded.success) return;
      expect(loaded.project.graphics.renderContexts[0]).toMatchObject({
        backgroundPatternTable,
        spritePatternTable,
      });
      const reloaded = deserializeProject(serializeProject(loaded.project));
      expect(reloaded.success).toBe(true);
      if (!reloaded.success) return;
      expect(reloaded.project.graphics.renderContexts).toEqual(
        loaded.project.graphics.renderContexts,
      );
    },
  );

  it('migrates every legacy graphics family into stable catalog identities', () => {
    const raw = legacyProject({
      mode: 'playfield',
      chrRegions: [
        {
          id: 'reserved-engine',
          name: 'Engine',
          patternTable: 1,
          startTile: 240,
          endTile: 255,
          kind: 'reservation',
        },
      ],
      tileset: {
        asset: { path: 'tiles.png', sourceKind: 'png' },
        paletteAssignments: [0],
        pixelOverrides: [1],
      },
      playfield: {
        asset: { path: 'screen.png', sourceKind: 'png' },
        collisionCells: [3, 0],
        paletteAssignments: [2],
        pixelOverrides: [1],
      },
      backgrounds: {
        activeMapId: 'map-town',
        maps: [
          {
            id: 'map-town',
            name: 'Town',
            widthTiles: 32,
            heightTiles: 30,
            patternTable: 1,
            assetId: 'asset-town',
            asset: {
              id: 'asset-town',
              path: 'town.png',
              sourceKind: 'png',
            },
            cells: [],
            paletteAssignments: [],
          },
        ],
      },
      animation: {
        patternTable: 0,
        destinationPatternTable: 1,
        destinationChr: {
          path: 'base.chr',
          sourceKind: 'chr',
        },
        animations: [
          {
            id: 'anim-hero',
            name: 'idle',
            asset: { path: 'hero.png', sourceKind: 'png' },
            frameWidth: 16,
            frameHeight: 16,
            frameIndices: [0],
            frameDurations: [8],
          },
        ],
      },
    });

    const result = deserializeProject(JSON.stringify(raw));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.project.formatVersion).toBe(2);
    expect(result.project.graphics.assets.map((asset) => asset.id)).toEqual([
      'asset-tileset-default',
      'asset-playfield-default',
      'asset-town',
      'asset-anim-anim-hero',
    ]);
    expect(result.project.playfield?.collisionCells).toEqual([3, 0]);
    expect(result.project.chrRegions?.[0]?.id).toBe('reserved-engine');
    expect(result.project.graphics.renderContexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'render-context-map-town',
          backgroundPatternTable: 1,
          spritePatternTable: 0,
          mapIds: ['map-town'],
          animationIds: ['anim-hero'],
        }),
        expect.objectContaining({
          id: 'render-context-background-playfield-default',
          backgroundPatternTable: 1,
          spritePatternTable: 0,
          mapIds: ['background-playfield-default'],
          animationIds: ['anim-hero'],
        }),
      ]),
    );
  });

  it('keeps an unresolved external Base CHR unknown and locked', () => {
    const result = deserializeProject(
      JSON.stringify(
        legacyProject({
          animation: {
            destinationPatternTable: 1,
            destinationChr: {
              path: 'external-base.chr',
              sourceKind: 'chr',
            },
            animations: [],
          },
        }),
      ),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.project.graphics.baseChr).toMatchObject({
      byteLength: null,
      shortFilePatternTable: 1,
      slotPolicies: [
        {
          startSlot: 0,
          endSlot: 511,
          occupancy: 'unknown',
          writability: 'locked',
          provenance: 'pending-source',
        },
      ],
    });
  });

  it('round-trips Base CHR occupancy metadata independently from zero bytes', () => {
    const zeroBase = btoa('\0'.repeat(4096));
    const result = deserializeProject(
      JSON.stringify(
        legacyProject({
          animation: {
            destinationPatternTable: 1,
            destinationChr: {
              id: 'asset-base-font',
              path: 'font.chr',
              sourceKind: 'chr',
              dataUrl: `data:application/octet-stream;base64,${zeroBase}`,
            },
            animations: [],
          },
        }),
      ),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.project.graphics.baseChr.slotPolicies).toEqual([
      expect.objectContaining({
        startSlot: 0,
        endSlot: 255,
        occupancy: 'available',
        writability: 'writable',
      }),
      expect.objectContaining({
        startSlot: 256,
        endSlot: 511,
        occupancy: 'occupied',
        writability: 'locked',
        ownerAssetId: 'asset-base-font',
      }),
    ]);

    const reloaded = deserializeProject(serializeProject(result.project));
    expect(reloaded.success).toBe(true);
    if (!reloaded.success) return;
    expect(reloaded.project.graphics.baseChr).toEqual(
      result.project.graphics.baseChr,
    );
  });

  it('rejects conflicting legacy asset identities instead of guessing', () => {
    const result = deserializeProject(
      JSON.stringify(
        legacyProject({
          backgrounds: {
            maps: [
              {
                id: 'map-conflict',
                name: 'Conflict',
                widthTiles: 32,
                heightTiles: 30,
                patternTable: 0,
                assetId: 'asset-map',
                asset: { id: 'asset-other', path: 'map.png' },
                cells: [],
                paletteAssignments: [],
              },
            ],
          },
        }),
      ),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('invalid-project-schema');
    expect(result.error.message).toContain('conflicting assetId');
  });

  it('rejects unsupported sprite modes and duplicate asset identity in sources', () => {
    const project = JSON.parse(
      serializeProject(createDefaultProject()),
    ) as Record<string, unknown>;
    const graphics = project.graphics as {
      assets: Record<string, unknown>[];
      renderContexts: Record<string, unknown>[];
    };
    graphics.renderContexts[0] = {
      ...graphics.renderContexts[0],
      spriteMode: '8x16',
    };
    let result = deserializeProject(JSON.stringify(project));
    expect(result.success).toBe(false);

    graphics.renderContexts[0] = {
      ...graphics.renderContexts[0],
      spriteMode: '8x8',
    };
    graphics.assets.push({
      id: 'asset-a',
      kind: 'tileset-image',
      name: 'A',
      source: { id: 'asset-b', path: 'a.png' },
      logicalTiles: {
        decoding: 'png-indexed',
        quantization: null,
        paletteBank: 'background',
      },
    });
    result = deserializeProject(JSON.stringify(project));
    expect(result.success).toBe(false);
  });

  it('treats v2 compatibility aliases as projections of canonical graphics', () => {
    const migrated = deserializeProject(
      JSON.stringify(
        legacyProject({
          tileset: {
            asset: {
              id: 'asset-canonical',
              path: 'canonical.png',
              sourceKind: 'png',
            },
            paletteAssignments: [2],
          },
        }),
      ),
    );
    expect(migrated.success).toBe(true);
    if (!migrated.success) return;

    const project = JSON.parse(serializeProject(migrated.project)) as Record<
      string,
      unknown
    >;
    const tileset = project.tileset as Record<string, unknown>;
    expect(tileset.assetId).toBe('asset-canonical');
    expect(tileset.asset).toBeNull();
    expect(tileset.paletteAssignments).toBeUndefined();
    tileset.asset = {
      id: 'asset-alias',
      path: 'ignored.png',
      sourceKind: 'png',
    };
    tileset.paletteAssignments = [3];

    const loaded = deserializeProject(JSON.stringify(project));
    expect(loaded.success).toBe(true);
    if (!loaded.success) return;
    expect(loaded.project.tileset).toMatchObject({
      assetId: 'asset-canonical',
      asset: { id: 'asset-canonical', path: 'canonical.png' },
      paletteAssignments: [2],
    });
  });

  it('rejects render contexts that refer to asset IDs instead of consumer IDs', () => {
    const project = JSON.parse(
      serializeProject(createDefaultProject()),
    ) as Record<string, unknown>;
    const graphics = project.graphics as {
      renderContexts: Record<string, unknown>[];
    };
    graphics.renderContexts[0] = {
      ...graphics.renderContexts[0],
      animationIds: ['asset-anim-default'],
    };

    const result = deserializeProject(JSON.stringify(project));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.message).toContain('missing animation');
  });
});
