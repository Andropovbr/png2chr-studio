import { describe, expect, it } from 'vitest';

import {
  exportAnimationChr,
  generateCAnimationExport,
  generateCa65AnimationExport,
  serializeAnimationMetadata,
} from './animation-exporters';
import { buildAnimationProjectModel } from './animation-model';
import { reconcileSpritesheetReimport } from './asset-lifecycle';
import { buildChrAssetMappingIndex } from './chr-asset-mapping';
import {
  createDefaultProject,
  deserializeProject,
  serializeProject,
  type StudioProject,
} from './project';
import type { IndexedImage } from './types';

describe('Milestone 7 Quality Pass (Issue #99): End-to-End Spritesheet-to-CHR Integration', () => {
  function createTestPatternImage(
    width: number,
    height: number,
    fillColors?: (x: number, y: number) => number,
  ): IndexedImage {
    const pixels = new Uint8Array(width * height);
    if (fillColors) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          pixels[y * width + x] = fillColors(x, y);
        }
      }
    }
    return {
      width,
      height,
      pixels,
      colors: [
        null,
        { red: 255, green: 0, blue: 0 },
        { red: 0, green: 255, blue: 0 },
        { red: 0, green: 0, blue: 255 },
      ],
      transparentIndex: 0,
      colorCount: 4,
    };
  }

  function setTilePattern(
    image: IndexedImage,
    tileX: number,
    tileY: number,
    pattern: number[],
  ): void {
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const color = pattern[y * 8 + x] ?? 0;
        const px = tileX * 8 + x;
        const py = tileY * 8 + y;
        image.pixels[py * image.width + px] = color;
      }
    }
  }

  // 8x8 asymmetric test tile pattern
  const ASYM_TILE_A = [
    1, 1, 1, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];

  // 8x8 asymmetric test tile pattern B
  const ASYM_TILE_B = [
    3, 3, 3, 3, 0, 0, 0, 0, 3, 2, 2, 0, 0, 0, 0, 0, 3, 2, 1, 0, 0, 0, 0, 0, 3,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];

  it('E2E Scenario 1: Comprehensive Multi-Asset Pipeline (Base CHR + Reservations + PT1 + Flips + OAM + Exporters + Serialization)', () => {
    // 1. Setup Base CHR with occupied slots in PT0 (first 8 slots) and PT1 (slots 256..259)
    const baseChr = new Uint8Array(8192);
    for (let i = 0; i < 8; i += 1) {
      baseChr[i * 16] = 0x11 * (i + 1);
    }
    for (let i = 0; i < 4; i += 1) {
      baseChr[(256 + i) * 16] = 0x22 * (i + 1);
    }

    // 2. Setup Spritesheet with 4 frames (32x16 pixels each -> 2x2 = 4 tiles per frame)
    // Frame 0: Tile A at (0,0), Tile B at (1,0), others transparent
    // Frame 1: H-Flipped Tile A at (0,0), V-Flipped Tile B at (1,0)
    // Frame 2: HV-Flipped Tile A at (0,0), Exact Tile B at (1,0)
    // Frame 3: Transparent sparse frame (only 1 tile at 0,0)
    const sheetImage = createTestPatternImage(64, 32);

    // Frame 0 (x=0, y=0)
    setTilePattern(sheetImage, 0, 0, ASYM_TILE_A);
    setTilePattern(sheetImage, 1, 0, ASYM_TILE_B);

    // Frame 1 (x=32, y=0) -> Tile A H-flipped, Tile B V-flipped
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        sheetImage.pixels[y * 64 + (32 + x)] =
          ASYM_TILE_A[y * 8 + (7 - x)] ?? 0;
        sheetImage.pixels[y * 64 + (40 + x)] =
          ASYM_TILE_B[(7 - y) * 8 + x] ?? 0;
      }
    }

    // Frame 2 (x=0, y=16) -> Tile A HV-flipped, Tile B exact
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        sheetImage.pixels[(16 + y) * 64 + x] =
          ASYM_TILE_A[(7 - y) * 8 + (7 - x)] ?? 0;
        sheetImage.pixels[(16 + y) * 64 + (8 + x)] =
          ASYM_TILE_B[y * 8 + x] ?? 0;
      }
    }

    // Frame 3 (x=32, y=16) -> Only 1 tile
    setTilePattern(sheetImage, 4, 2, ASYM_TILE_A);

    // 3. Configure CHR Reservations:
    // PT1 Reservation at slots 4..7 (local indices 4..7 -> physical 260..263)
    const chrRegions = [
      {
        id: 'res_special',
        name: 'Reserved Sprite FX',
        patternTable: 1 as const,
        startTile: 4,
        endTile: 7,
        kind: 'reservation' as const,
      },
    ];

    // 4. Build Animation Project Model on Pattern Table 1
    const model = buildAnimationProjectModel({
      name: 'HeroMega',
      symbolPrefix: 'hero_mega',
      image: sheetImage,
      frameWidth: 32,
      frameHeight: 16,
      originX: 16,
      originY: 16,
      defaultPaletteIndex: 1, // palette 1
      patternTable: 1, // PT1!
      destinationPatternTable: 1,
      baseChr,
      chrRegions,
      flipDeduplication: true,
      animations: [
        {
          id: 'anim_walk',
          name: 'walk',
          playback: 'loop',
          frameIndices: [0, 1, 2],
          frameDuration: 6,
          frameDurations: [6, 12, 8], // non-uniform durations
        },
        {
          id: 'anim_jump',
          name: 'jump',
          playback: 'once',
          frameIndices: [3],
          frameDuration: 10,
          paletteIndex: 2, // animation palette override
        },
      ],
    });

    // 5. Verify Unified CHR Allocation and Deduplication Invariants
    // Base CHR occupies local slots 0..3 in PT1 (physical 256..259)
    // Reservation blocks local slots 4..7 in PT1 (physical 260..263)
    // First new allocated sprite tile MUST be at local slot 8 in PT1 (physical 264)
    // Second unique sprite tile MUST be at local slot 9 in PT1 (physical 265)
    // All 4 frames reuse only these 2 unique tiles via Flip-H, Flip-V, Flip-HV!
    expect(model.chr.newTileCount).toBe(2);
    expect(model.animations[0]?.frames[0]?.sprites[0]?.tile).toBe(8);
    expect(model.animations[0]?.frames[0]?.sprites[0]?.physicalTileIndex).toBe(
      264,
    );
    expect(model.animations[0]?.frames[0]?.sprites[1]?.tile).toBe(9);
    expect(model.animations[0]?.frames[0]?.sprites[1]?.physicalTileIndex).toBe(
      265,
    );

    // Frame 1 uses H-flip on tile 8 (attr = 0x41) and V-flip on tile 9 (attr = 0x81)
    expect(model.animations[0]?.frames[1]?.sprites[0]?.tile).toBe(8);
    expect(model.animations[0]?.frames[1]?.sprites[0]?.attributes).toBe(0x41);
    expect(model.animations[0]?.frames[1]?.sprites[1]?.tile).toBe(9);
    expect(model.animations[0]?.frames[1]?.sprites[1]?.attributes).toBe(0x81);

    // Frame 2 uses HV-flip on tile 8 (attr = 0xC1) and exact reuse on tile 9 (attr = 0x01)
    expect(model.animations[0]?.frames[2]?.sprites[0]?.tile).toBe(8);
    expect(model.animations[0]?.frames[2]?.sprites[0]?.attributes).toBe(0xc1);
    expect(model.animations[0]?.frames[2]?.sprites[1]?.tile).toBe(9);
    expect(model.animations[0]?.frames[2]?.sprites[1]?.attributes).toBe(0x01);

    // Frame 3 (in jump anim with palette 2 override) uses exact tile 8 (attr = 0x02)
    expect(model.animations[1]?.frames[0]?.sprites[0]?.tile).toBe(8);
    expect(model.animations[1]?.frames[0]?.sprites[0]?.attributes).toBe(0x02);

    // 6. Verify Mapping Index Integrity (Origin vs Usage)
    const mappingIndex = buildChrAssetMappingIndex({
      animations: [
        {
          id: 'anim_walk',
          name: 'walk',
          asset: { id: 'asset_hero_sheet' },
        },
      ],
      animationModel: model,
      baseChr,
      destinationPatternTable: 1,
      chrRegions,
    });

    const slot264 = mappingIndex.byPhysicalIndex[264];
    expect(slot264?.origin?.primaryAssetId).toBe('asset_hero_sheet');
    expect(slot264?.isShared).toBe(true);
    expect(slot264?.usages.length).toBeGreaterThan(1);

    // 7. Verify Exporters Alignment across C, ASM, and JSON v5
    const cExport = generateCAnimationExport(model);
    const asmExport = generateCa65AnimationExport(model);
    const jsonExportStr = serializeAnimationMetadata(model);
    const jsonExport = JSON.parse(jsonExportStr) as Record<string, unknown>;
    const chrBinary = exportAnimationChr(model);

    // Header and constant verification
    expect(cExport.header).toContain(
      '#define HERO_MEGA_HEROMEGA_SPRITE_PATTERN_TABLE 1',
    );
    expect(cExport.source).toContain(
      'hero_mega_heromega_sprite_pattern_table = 1;',
    );
    expect(asmExport.include).toContain(
      'HERO_MEGA_HEROMEGA_SPRITE_PATTERN_TABLE = 1',
    );
    expect(asmExport.source).toContain(
      'hero_mega_heromega_sprite_pattern_table:\n    .byte 1',
    );
    expect(jsonExport.pattern_table).toBe(1);

    // Raw CHR Binary preservation
    expect(chrBinary.length).toBe(8192);
    expect(chrBinary[0]).toBe(0x11); // PT0 Base CHR preserved
    expect(chrBinary[256 * 16]).toBe(0x22); // PT1 Base CHR preserved

    // 8. Serialize to StudioProject, Deserialize, and Verify Complete Round-trip
    const project: StudioProject = {
      ...createDefaultProject('Hero E2E', 'animation'),
      chrRegions,
      animation: {
        name: 'HeroMega',
        symbolPrefix: 'hero_mega',
        defaultPaletteIndex: 1,
        quantizationMode: 'median-cut',
        ditheringMode: 'none',
        flipDeduplication: true,
        spritePalette: 0,
        spriteColorIndex: 1,
        patternTable: 1,
        destinationPatternTable: 1,
        destinationChr: null,
        animations: [
          {
            id: 'anim_walk',
            name: 'walk',
            entity: 'hero',
            asset: null,
            frameWidth: 32,
            frameHeight: 16,
            originX: 16,
            originY: 16,
            playback: 'loop',
            allowHorizontalFlip: true,
            allowVerticalFlip: true,
            flipH: false,
            flipV: false,
            defaultDuration: 6,
            frameIndices: [0, 1, 2],
            frameDurations: [6, 12, 8],
            framePalettes: [1, 1, 1],
          },
          {
            id: 'anim_jump',
            name: 'jump',
            entity: 'hero',
            asset: null,
            frameWidth: 32,
            frameHeight: 16,
            originX: 16,
            originY: 16,
            playback: 'once',
            paletteIndex: 2,
            allowHorizontalFlip: true,
            allowVerticalFlip: true,
            flipH: false,
            flipV: false,
            defaultDuration: 10,
            frameIndices: [3],
            frameDurations: [10],
            framePalettes: [2],
          },
        ],
      },
    };

    const serializedP2c = serializeProject(project);
    const deserialized = deserializeProject(serializedP2c);
    expect(deserialized.success).toBe(true);

    if (deserialized.success) {
      const reloadedProject = deserialized.project;
      const reloadedModel = buildAnimationProjectModel({
        name: reloadedProject.animation?.name ?? 'HeroMega',
        symbolPrefix: reloadedProject.animation?.symbolPrefix ?? 'hero_mega',
        image: sheetImage,
        frameWidth: 32,
        frameHeight: 16,
        originX: 16,
        originY: 16,
        defaultPaletteIndex: 1,
        patternTable: 1,
        destinationPatternTable: 1,
        baseChr,
        chrRegions: reloadedProject.chrRegions,
        flipDeduplication: true,
        animations: [
          {
            name: 'walk',
            playback: 'loop',
            frameIndices: [0, 1, 2],
            frameDuration: 6,
            frameDurations: [6, 12, 8],
          },
          {
            name: 'jump',
            playback: 'once',
            frameIndices: [3],
            frameDuration: 10,
            paletteIndex: 2,
          },
        ],
      });

      expect(generateCAnimationExport(reloadedModel)).toEqual(cExport);
      expect(generateCa65AnimationExport(reloadedModel)).toEqual(asmExport);
      expect(serializeAnimationMetadata(reloadedModel)).toBe(jsonExportStr);
      expect(exportAnimationChr(reloadedModel)).toEqual(chrBinary);
    }
  });

  it('E2E Scenario 2: Spritesheet Reimport Lifecycle, Geometry Resizing and Pixel Overrides', () => {
    // Initial 32x32 image with 4 frames (16x16)
    const initialImage = createTestPatternImage(32, 32);
    setTilePattern(initialImage, 0, 0, ASYM_TILE_A);
    setTilePattern(initialImage, 2, 0, ASYM_TILE_B);

    const initialOverrides = {
      '0_0': { '0': 2, '1': 3 }, // Tile (0, 0)
      '1_1': { '5': 1 }, // Tile (1, 1)
      '3_3': { '0': 1 }, // Tile (3, 3) - in initial 32x32 image (4x4 tiles)
    };

    const initialProject: StudioProject = {
      ...createDefaultProject('Reimport Test', 'animation'),
      animation: {
        name: 'HeroLifecycle',
        symbolPrefix: 'hero_life',
        defaultPaletteIndex: 0,
        quantizationMode: 'median-cut',
        ditheringMode: 'none',
        flipDeduplication: true,
        spritePalette: 0,
        spriteColorIndex: 1,
        patternTable: 0,
        destinationPatternTable: 0,
        destinationChr: null,
        animations: [
          {
            id: 'anim_main',
            name: 'action',
            entity: 'hero',
            asset: {
              id: 'asset_hero_sheet_v1',
              path: 'hero_v1.png',
              name: 'hero_v1.png',
              sourceKind: 'png',
            },
            frameWidth: 16,
            frameHeight: 16,
            originX: 8,
            originY: 8,
            playback: 'loop',
            allowHorizontalFlip: true,
            allowVerticalFlip: false,
            flipH: false,
            flipV: false,
            defaultDuration: 6,
            frameIndices: [0, 1, 2, 3],
            frameDurations: [6, 6, 8, 12],
            framePalettes: [0, 1, 0, 2],
            pixelOverrides: initialOverrides,
          },
        ],
      },
    };

    // 1. Reimport with smaller spritesheet (16x16 pixels = 2x2 tiles)
    // Frame count shrinks from 4 to 1 (only frame index 0 remains)
    // Pixel overrides at (3, 3) must be automatically pruned; (0, 0) and (1, 1) retained
    const smallerImage = createTestPatternImage(16, 16);
    setTilePattern(smallerImage, 0, 0, ASYM_TILE_A);

    const reimportResult = reconcileSpritesheetReimport({
      project: initialProject,
      animationId: 'anim_main',
      newImage: smallerImage,
      newSourcePath: 'hero_v2_smaller.png',
      newSourceName: 'hero_v2_smaller.png',
    });

    expect(reimportResult.success).toBe(true);
    if (!reimportResult.success) return;

    const reconciledAnim = reimportResult.project.animation?.animations[0];
    expect(reconciledAnim?.frameIndices).toEqual([0]);
    expect(reconciledAnim?.frameDurations).toEqual([6]);
    expect(reconciledAnim?.framePalettes).toEqual([0]);

    // Retained overrides (0_0 and 1_1), pruned override 3_3
    expect(reconciledAnim?.pixelOverrides).toHaveProperty('0_0');
    expect(reconciledAnim?.pixelOverrides).toHaveProperty('1_1');
    expect(reconciledAnim?.pixelOverrides).not.toHaveProperty('3_3');

    // Stable ProjectAssetId preserved
    expect(reconciledAnim?.asset?.id).toBe('asset_hero_sheet_v1');
    expect(reconciledAnim?.asset?.path).toBe('hero_v2_smaller.png');

    // 2. Reimport with project with existing Base CHR where new image exceeds remaining capacity
    const fullBaseChr = new Uint8Array(4096);
    for (let i = 0; i < 255; i += 1) {
      fullBaseChr[i * 16] = 0xaa; // 255 slots occupied out of 256
    }

    const currentAnimation = reimportResult.project.animation;
    if (!currentAnimation) return;

    const crowdedProject: StudioProject = {
      ...reimportResult.project,
      animation: {
        ...currentAnimation,
        destinationChr: {
          id: 'asset_base_chr',
          path: 'crowded.chr',
          name: 'crowded.chr',
          sourceKind: 'chr',
        },
      },
    };

    // New image needs 2 unique tiles but only 1 free slot exists in PT0 -> Capacity Overflow
    const multiTileImage = createTestPatternImage(16, 16);
    setTilePattern(multiTileImage, 0, 0, ASYM_TILE_A);
    setTilePattern(multiTileImage, 1, 0, ASYM_TILE_B);

    const overflowResult = reconcileSpritesheetReimport({
      project: crowdedProject,
      animationId: 'anim_main',
      newImage: multiTileImage,
      baseChr: fullBaseChr,
    });

    // Must fail atomically without corrupting the previous valid project
    expect(overflowResult.success).toBe(false);
    if (!overflowResult.success) {
      expect(overflowResult.previousProject).toBe(crowdedProject);
    }
  });

  it('E2E Scenario 3: Shared Tile Ownership & Multi-Asset Consumer Independence', () => {
    // Two separate animations sharing identical tile graphics
    const sharedTilePattern = [1, 2, 3, 1, 2, 3, 1, 2];
    const image1 = createTestPatternImage(16, 16);
    setTilePattern(image1, 0, 0, sharedTilePattern);

    const image2 = createTestPatternImage(16, 16);
    setTilePattern(image2, 0, 0, sharedTilePattern);

    const model = buildAnimationProjectModel({
      name: 'SharedEntities',
      symbolPrefix: 'shared_ent',
      animations: [
        {
          id: 'anim_player',
          name: 'player_idle',
          image: image1,
          frameWidth: 16,
          frameHeight: 16,
          frameIndices: [0],
          frameDuration: 6,
        },
        {
          id: 'anim_npc',
          name: 'npc_idle',
          image: image2,
          frameWidth: 16,
          frameHeight: 16,
          frameIndices: [0],
          frameDuration: 6,
        },
      ],
    });

    // Deduplicated to 1 physical tile slot in CHR
    expect(model.chr.finalTileCount).toBe(1);

    const mapping = buildChrAssetMappingIndex({
      animations: [
        {
          id: 'anim_player',
          name: 'player_idle',
          asset: { id: 'asset_player_sheet' },
        },
        {
          id: 'anim_npc',
          name: 'npc_idle',
          asset: { id: 'asset_npc_sheet' },
        },
      ],
      animationModel: model,
    });

    // Slot 0 has primary origin from asset_player_sheet, and is shared with asset_npc_sheet
    expect(mapping.byPhysicalIndex[0]?.origin?.primaryAssetId).toBe(
      'asset_player_sheet',
    );
    expect(mapping.byPhysicalIndex[0]?.isShared).toBe(true);
    expect(
      mapping.byPhysicalIndex[0]?.usages.some(
        (u) => u.assetId === 'asset_npc_sheet',
      ),
    ).toBe(true);
  });

  it('E2E Scenario 4: Tileset and Playfield Modes Non-Regression & Coexistence', () => {
    // 1. Create a project in Tileset mode
    const tilesetProject = createDefaultProject('Dungeon Tiles', 'tileset');
    expect(tilesetProject.mode).toBe('tileset');
    expect(tilesetProject.formatVersion).toBe(1);

    // 2. Create a project in Playfield mode
    const playfieldProject = createDefaultProject(
      'Overworld Stage',
      'playfield',
    );
    expect(playfieldProject.mode).toBe('playfield');
    expect(playfieldProject.playfield?.randomPlayfieldFeatures).toBeDefined();

    // 3. Serialize and deserialize both
    const serializedTileset = serializeProject(tilesetProject);
    const deserializedTileset = deserializeProject(serializedTileset);
    expect(deserializedTileset.success).toBe(true);

    const serializedPlayfield = serializeProject(playfieldProject);
    const deserializedPlayfield = deserializeProject(serializedPlayfield);
    expect(deserializedPlayfield.success).toBe(true);

    if (deserializedPlayfield.success) {
      expect(deserializedPlayfield.project.mode).toBe('playfield');
      expect(
        deserializedPlayfield.project.playfield?.randomPlayfieldFeatures
          ?.length,
      ).toBe(playfieldProject.playfield?.randomPlayfieldFeatures?.length);
    }
  });

  it('E2E Scenario 5: Deterministic Stress Repeatability across Pipeline', () => {
    const sheetImage = createTestPatternImage(32, 32);
    setTilePattern(sheetImage, 0, 0, ASYM_TILE_A);
    setTilePattern(sheetImage, 1, 0, ASYM_TILE_B);
    setTilePattern(sheetImage, 0, 1, ASYM_TILE_A);

    function runPipeline() {
      const model = buildAnimationProjectModel({
        name: 'StressModel',
        symbolPrefix: 'stress_model',
        image: sheetImage,
        frameWidth: 16,
        frameHeight: 16,
        originX: 8,
        originY: 8,
        defaultPaletteIndex: 0,
        patternTable: 0,
        destinationPatternTable: 0,
        flipDeduplication: true,
        animations: [
          { name: 'idle', frameIndices: [0, 1], frameDuration: 6 },
          { name: 'attack', frameIndices: [1, 2], frameDuration: 8 },
        ],
      });

      const c = generateCAnimationExport(model);
      const asm = generateCa65AnimationExport(model);
      const json = serializeAnimationMetadata(model);
      const chr = exportAnimationChr(model);
      return { c, asm, json, chr };
    }

    const baseline = runPipeline();

    for (let iteration = 0; iteration < 10; iteration += 1) {
      const current = runPipeline();
      expect(current.c).toEqual(baseline.c);
      expect(current.asm).toEqual(baseline.asm);
      expect(current.json).toBe(baseline.json);
      expect(current.chr).toEqual(baseline.chr);
    }
  });
});
