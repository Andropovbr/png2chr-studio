import { describe, expect, it } from 'vitest';

import {
  exportAnimationChr,
  generateCAnimationExport,
  generateCa65AnimationExport,
  sanitizeCIdentifier,
  serializeAnimationMetadata,
} from './animation-exporters';
import { buildAnimationProjectModel } from './animation-model';
import {
  createDefaultProject,
  deserializeProject,
  serializeProject,
} from './project';
import type { IndexedImage } from './types';

function model(
  directional = false,
  symbolPrefix = 'hero',
  animationName = 'animation',
) {
  const pixels = new Uint8Array(128);
  pixels[0] = 1;
  pixels[8 + 7] = 1;
  const image: IndexedImage = {
    width: 16,
    height: 8,
    pixels,
    colors: [null, { red: 255, green: 255, blue: 255 }],
    transparentIndex: 0,
    colorCount: 2,
  };
  return buildAnimationProjectModel({
    name: animationName,
    symbolPrefix,
    sourceImageName: 'hero.png',
    image,
    frameWidth: 8,
    frameHeight: 8,
    animations: [
      { name: 'idle', category: 'idle', frameIndices: [0], frameDuration: 12 },
      {
        name: 'movement',
        category: 'movement',
        frameIndices: [1],
        frameDuration: 6,
        ...(directional
          ? {
              direction: 'right' as const,
              exportMirroredDirection: true,
            }
          : {}),
      },
    ],
  });
}

describe('animation exporters', () => {
  it.each([
    ['Hero Player', 'hero_player'],
    ['ação rápida', 'acao_rapida'],
    ['123 hero', '_123_hero'],
    ['const', 'const_animation'],
    ['---', 'animation'],
  ])('sanitizes C identifier %s', (input, expected) => {
    expect(sanitizeCIdentifier(input)).toBe(expected);
  });

  it('serializes deterministic versioned JSON without binary CHR data', () => {
    const first = serializeAnimationMetadata(model());
    const second = serializeAnimationMetadata(model());
    const parsed = JSON.parse(first) as Record<string, unknown>;

    expect(first).toBe(second);
    expect(parsed).toMatchObject({
      format: 'png2chr-studio-animation',
      version: 5,
      name: 'animation',
      symbol_prefix: 'hero',
      symbol_base: 'hero_animation',
      pattern_table: 0,
      destination_pattern_table: 0,
      chr: {
        physical_capacity_tiles: 512,
        pattern_table: 0,
        pattern_table_capacity_tiles: 256,
        base_tile_count: 0,
        base_occupancy: {
          file_size_bytes: 0,
          file_tile_slots: 0,
          physical_capacity_tiles: 512,
          occupied_tiles: 0,
          free_tiles: 512,
          pattern_tables: [
            {
              pattern_table: 0,
              capacity_tiles: 256,
              occupied_tiles: 0,
              free_tiles: 256,
            },
            {
              pattern_table: 1,
              capacity_tiles: 256,
              occupied_tiles: 0,
              free_tiles: 256,
            },
          ],
        },
        final_tile_count: 1,
        final_size_bytes: 8192,
      },
      attribute_flags: {
        flip_horizontal: 64,
        flip_vertical: 128,
        palette_mask: 3,
      },
      playback_constants: {
        loop: 0,
        once: 1,
      },
    });
    expect(first).not.toContain('finalChr');
    expect(first).toContain('"attributes": 64');
  });

  it('generates consistent cc65-friendly flattened C data with animation enum', () => {
    const output = generateCAnimationExport(model());

    expect(output.headerFileName).toBe('hero_animation.h');
    expect(output.header).toContain('typedef struct {');
    expect(output.header).toContain('uint16_t sprite_offset;');
    expect(output.header).toContain('typedef enum {');
    expect(output.header).toContain('HERO_ANIMATION_ANIM_IDLE = 0,');
    expect(output.header).toContain('HERO_ANIMATION_ANIM_MOVEMENT = 1,');
    expect(output.header).toContain('} HeroAnimationAnimationId;');
    expect(output.header).toContain(
      '#define HERO_ANIMATION_SPRITE_PATTERN_TABLE 0',
    );
    expect(output.source).toContain('{ 0, 0, 0x00, 0x00 }');
    expect(output.source).toContain('{ 0, 0, 0x00, 0x40 }');
    expect(output.source).toContain(
      'const uint8_t hero_animation_animation_count = 2;',
    );
    expect(output.source).toContain(
      'const uint8_t hero_animation_sprite_pattern_table = 0;',
    );
    expect(output.estimatedRomBytes).toBe(31);
  });

  it('generates deterministic ca65 data with documented layouts and animation constants', () => {
    const first = generateCa65AnimationExport(model());
    const second = generateCa65AnimationExport(model());

    expect(first).toEqual(second);
    expect(first.includeFileName).toBe('hero_animation.inc');
    expect(first.include).toContain('Sprite entry (4 bytes)');
    expect(first.include).toContain('HERO_ANIMATION_ANIM_IDLE = 0');
    expect(first.include).toContain('HERO_ANIMATION_ANIM_MOVEMENT = 1');
    expect(first.include).toContain('HERO_ANIMATION_SPRITE_PATTERN_TABLE = 0');
    expect(first.source).toContain('.segment "RODATA"');
    expect(first.source).not.toContain('.include');
    expect(first.source).toContain('.byte $00, $00, $00, $40');
    expect(first.source).toContain('hero_animation_animation_count:');
    expect(first.source).toContain('hero_animation_sprite_pattern_table:');
    expect(first.estimatedRomBytes).toBe(31);
  });

  it('exports multiple arbitrary animations with loop and once playbacks to C and Assembly', () => {
    const pixels = new Uint8Array(192);
    const image: IndexedImage = {
      width: 24,
      height: 8,
      pixels,
      colors: [null, { red: 255, green: 255, blue: 255 }],
      transparentIndex: 0,
      colorCount: 2,
    };
    const multiModel = buildAnimationProjectModel({
      name: 'soldier',
      symbolPrefix: 'soldier',
      sourceImageName: 'soldier.png',
      image,
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        {
          name: 'idle',
          playback: 'loop',
          frameIndices: [0],
          frameDuration: 12,
        },
        { name: 'walk', playback: 'loop', frameIndices: [1], frameDuration: 8 },
        {
          name: 'attack',
          playback: 'once',
          frameIndices: [2],
          frameDuration: 6,
          flipH: true,
        },
      ],
    });

    const c = generateCAnimationExport(multiModel);
    const asm = generateCa65AnimationExport(multiModel);
    const json = JSON.parse(serializeAnimationMetadata(multiModel)) as {
      animations: {
        name: string;
        playback: string;
        allow_horizontal_flip: boolean;
      }[];
    };

    expect(json.animations).toHaveLength(3);
    expect(json.animations[0]).toMatchObject({
      name: 'idle',
      source_file: 'soldier.png',
      frame_width: 8,
      frame_height: 8,
      origin_x: 0,
      origin_y: 0,
      playback: 'loop',
      allow_horizontal_flip: false,
    });
    expect(json.animations[2]).toMatchObject({
      name: 'attack',
      source_file: 'soldier.png',
      frame_width: 8,
      frame_height: 8,
      playback: 'once',
      allow_horizontal_flip: true,
    });

    expect(c.header).toContain('SOLDIER_ANIM_IDLE = 0,');
    expect(c.header).toContain('SOLDIER_ANIM_WALK = 1,');
    expect(c.header).toContain('SOLDIER_ANIM_ATTACK = 2,');
    expect(c.header).toContain('} SoldierAnimationId;');
    expect(c.source).toContain('{ 0, 1, 1, 1, 0, 0x00 }'); // idle (frameOffset=0, count=1, w=1, h=1, loop=0, flags=0)
    expect(c.source).toContain('{ 2, 1, 1, 1, 1, 0x40 }'); // attack (frameOffset=2, count=1, w=1, h=1, once=1, flags=0x40)

    expect(asm.include).toContain('SOLDIER_ANIM_IDLE = 0');
    expect(asm.include).toContain('SOLDIER_ANIM_WALK = 1');
    expect(asm.include).toContain('SOLDIER_ANIM_ATTACK = 2');
  });

  it('generates two exports that can coexist without symbol or guard collisions', () => {
    const idle = generateCAnimationExport(model(false, 'soldier', 'idle'));
    const movement = generateCAnimationExport(
      model(false, 'soldier', 'movement'),
    );

    expect(idle.headerFileName).toBe('soldier_idle.h');
    expect(idle.sourceFileName).toBe('soldier_idle.c');
    expect(idle.header).toContain('#ifndef SOLDIER_IDLE_H');
    expect(idle.header).toContain('soldier_idle_sprites[]');
    expect(idle.source).toContain('soldier_idle_animation_count');
    expect(idle.header).not.toContain('soldier_movement_sprites');

    expect(movement.headerFileName).toBe('soldier_movement.h');
    expect(movement.sourceFileName).toBe('soldier_movement.c');
    expect(movement.header).toContain('#ifndef SOLDIER_MOVEMENT_H');
    expect(movement.header).toContain('soldier_movement_sprites[]');
    expect(movement.source).toContain('soldier_movement_animation_count');
    expect(movement.header).not.toContain('soldier_idle_sprites');

    expect(idle.header).toContain('#ifndef PNG2CHR_ANIMATION_FORMAT_CONSTANTS');
    expect(movement.header).toContain(
      '#ifndef PNG2CHR_ANIMATION_FORMAT_CONSTANTS',
    );
  });

  it('exports allow flip constants in C and Assembly and excludes root origin from JSON', () => {
    const pixels = new Uint8Array(64);
    const image: IndexedImage = {
      width: 8,
      height: 8,
      pixels,
      colors: [null, { red: 255, green: 255, blue: 255 }],
      transparentIndex: 0,
      colorCount: 2,
    };
    const mod = buildAnimationProjectModel({
      name: 'soldier',
      symbolPrefix: 'soldier',
      sourceImageName: 'soldier.png',
      image,
      frameWidth: 8,
      frameHeight: 8,
      animations: [
        {
          name: 'idle',
          playback: 'loop',
          allowHorizontalFlip: true,
          allowVerticalFlip: false,
          frameIndices: [0],
          frameDuration: 10,
        },
      ],
    });

    const c = generateCAnimationExport(mod);
    const asm = generateCa65AnimationExport(mod);
    const jsonStr = serializeAnimationMetadata(mod);
    const json = JSON.parse(jsonStr) as Record<string, unknown>;

    expect(c.header).toContain('#define ANIMATION_ALLOW_H_FLIP 0x40');
    expect(c.header).toContain('#define ANIMATION_ALLOW_V_FLIP 0x80');
    expect(c.header).not.toContain('#define ANIMATION_FLIP_H');
    expect(c.header).not.toContain('#define ANIMATION_FLIP_V');

    expect(asm.include).toContain('ANIMATION_ALLOW_H_FLIP = $40');
    expect(asm.include).toContain('ANIMATION_ALLOW_V_FLIP = $80');
    expect(asm.include).not.toContain('ANIMATION_FLIP_H =');
    expect(asm.include).not.toContain('ANIMATION_FLIP_V =');

    expect(json).not.toHaveProperty('origin');
    const anim = (json.animations as Record<string, unknown>[])[0];
    expect(anim).toMatchObject({
      allow_horizontal_flip: true,
      allow_vertical_flip: false,
    });
  });

  it('serializes default_palette_index, color_reduction, and animation/frame palette indices to JSON, C, and CA65', () => {
    const pixels = new Uint8Array(64);
    pixels[0] = 1;
    const image: IndexedImage = {
      width: 8,
      height: 8,
      pixels,
      colors: [null, { red: 255, green: 255, blue: 255 }],
      transparentIndex: 0,
      colorCount: 2,
    };

    const mod = buildAnimationProjectModel({
      name: 'soldier',
      symbolPrefix: 'soldier',
      defaultPaletteIndex: 1,
      quantizationMode: 'median-cut',
      animations: [
        {
          name: 'idle',
          image,
          paletteIndex: 2,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0, 0],
          frameDuration: 8,
          framePalettes: [null, 3],
        },
      ],
    });

    const jsonStr = serializeAnimationMetadata(mod);
    const json = JSON.parse(jsonStr) as Record<string, unknown>;

    expect(json).toMatchObject({
      default_palette_index: 1,
      color_reduction: 'median-cut',
    });

    const anim = (json.animations as Record<string, unknown>[])[0];
    expect(anim?.palette_index).toBe(2);
    const frames = anim?.frames as Record<string, unknown>[];
    expect(frames[0]?.palette_index).toBeNull();
    expect(frames[1]?.palette_index).toBe(3);

    // C export should have fully resolved attributes for sprites:
    // Frame 0 uses anim palette 2 -> attributes = 2
    // Frame 1 uses frame palette override 3 -> attributes = 3
    const c = generateCAnimationExport(mod);
    expect(c.source).toContain('{ 0, 0, 0x00, 0x02 }');
    expect(c.source).toContain('{ 0, 0, 0x00, 0x03 }');

    // CA65 export
    const asm = generateCa65AnimationExport(mod);
    expect(asm.source).toContain('.byte $00, $00, $00, $02');
    expect(asm.source).toContain('.byte $00, $00, $00, $03');
  });

  it('exports global color_reduction at root and omits quantization_mode from animations', () => {
    const pixels = new Uint8Array(64);
    pixels[0] = 1;
    const image: IndexedImage = {
      width: 8,
      height: 8,
      pixels,
      colors: [null, { red: 255, green: 255, blue: 255 }],
      transparentIndex: 0,
      colorCount: 2,
    };

    const mod = buildAnimationProjectModel({
      name: 'soldier',
      quantizationMode: 'k-means',
      animations: [
        {
          name: 'idle',
          image,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDuration: 10,
        },
        {
          name: 'walk',
          image,
          frameWidth: 8,
          frameHeight: 8,
          frameIndices: [0],
          frameDuration: 8,
        },
      ],
    });

    const jsonStr = serializeAnimationMetadata(mod);
    const json = JSON.parse(jsonStr) as Record<string, unknown>;

    // Verifies color_reduction at root
    expect(json.color_reduction).toBe('k-means');

    // Verifies quantization_mode is NOT present inside animations[]
    const animations = json.animations as Record<string, unknown>[];
    expect(animations.length).toBe(2);
    animations.forEach((anim) => {
      expect(anim).not.toHaveProperty('quantization_mode');
      expect(anim).not.toHaveProperty('quantizationMode');
      expect(anim).not.toHaveProperty('color_reduction');
    });
  });

  it('ensures animation JSON v5, C, and ca65 outputs remain strictly unpolluted', () => {
    const mod = model();
    const json = JSON.parse(serializeAnimationMetadata(mod)) as Record<
      string,
      unknown
    >;
    const cCode = generateCAnimationExport(mod);
    const asmCode = generateCa65AnimationExport(mod);

    // JSON v5 format and version invariant
    expect(json.format).toBe('png2chr-studio-animation');
    expect(json.version).toBe(5);
    expect(json).not.toHaveProperty('chrRegions');
    expect(json).not.toHaveProperty('regions');

    // C and ASM invariants
    expect(cCode.source).toContain(
      'const Png2ChrAnimationFrame hero_animation_frames',
    );
    expect(asmCode.source).toContain('hero_animation_frames:');
  });

  describe('Issue #98 Scenarios: Metasprite Data Alignment for C, ASM, JSON v5 & CHR', () => {
    interface ExportedSprite {
      readonly x: number;
      readonly y: number;
      readonly tile: number;
      readonly physical_tile_index: number;
      readonly attributes: number;
      readonly palette: number;
      readonly horizontal_flip: boolean;
      readonly vertical_flip: boolean;
      readonly reuse?: string;
      readonly source_tile_column?: number;
      readonly source_tile_row?: number;
    }

    interface ExportedFrame {
      readonly source_index: number;
      readonly source_x: number;
      readonly source_y: number;
      readonly duration: number;
      readonly palette_index?: number | null;
      readonly width: number;
      readonly height: number;
      readonly omitted_tile_count: number;
      readonly sprites: readonly ExportedSprite[];
    }

    interface ExportedAnimation {
      readonly name: string;
      readonly source_file?: string;
      readonly palette_index?: number | null;
      readonly frame_width: number;
      readonly frame_height: number;
      readonly origin_x: number;
      readonly origin_y: number;
      readonly playback: string;
      readonly allow_horizontal_flip: boolean;
      readonly allow_vertical_flip: boolean;
      readonly default_frame_duration: number;
      readonly width: number;
      readonly height: number;
      readonly width_tiles: number;
      readonly height_tiles: number;
      readonly frames: readonly ExportedFrame[];
    }

    interface ExportedMetadataJson {
      readonly format: string;
      readonly version: number;
      readonly name: string;
      readonly symbol_prefix: string;
      readonly symbol_base: string;
      readonly default_palette_index: number;
      readonly pattern_table: number;
      readonly destination_pattern_table: number;
      readonly color_reduction: string;
      readonly chr: {
        readonly final_size_bytes: number;
        readonly final_tile_count: number;
        readonly pattern_table: number;
        readonly physical_capacity_tiles: number;
      };
      readonly animations: readonly ExportedAnimation[];
    }

    function createTestPatternImage(
      width: number,
      height: number,
    ): IndexedImage {
      return {
        width,
        height,
        pixels: new Uint8Array(width * height),
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
      colors: number[],
    ): void {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const color = colors[(y * 8 + x) % colors.length] ?? 0;
          const px = tileX * 8 + x;
          const py = tileY * 8 + y;
          image.pixels[py * image.width + px] = color;
        }
      }
    }

    it('Scenario 4 & 5 & 6: Pattern Table 0 vs Pattern Table 1 & Local vs Physical Tile Index', () => {
      // Create image with 1 tile (Pattern A)
      const image = createTestPatternImage(16, 16);
      setTilePattern(image, 0, 0, [1, 2, 3, 1]);

      // Base CHR reserving first 5 tiles
      const baseChr = new Uint8Array(4096);
      for (let i = 0; i < 5; i += 1) {
        baseChr[i * 16] = 0x55; // arbitrary non-zero pattern
      }

      // Build model on PT0: our sprite goes to physical slot 5 -> local tile 5
      const modelPT0 = buildAnimationProjectModel({
        name: 'hero_pt0',
        symbolPrefix: 'hero_pt0',
        image,
        frameWidth: 16,
        frameHeight: 16,
        baseChr,
        patternTable: 0,
        destinationPatternTable: 0,
        animations: [
          {
            name: 'idle',
            frameIndices: [0],
            frameDuration: 6,
          },
        ],
      });

      // Build model on PT1: our sprite goes to physical slot 261 (256 + 5) -> local tile 5
      const modelPT1 = buildAnimationProjectModel({
        name: 'hero_pt1',
        symbolPrefix: 'hero_pt1',
        image,
        frameWidth: 16,
        frameHeight: 16,
        baseChr,
        patternTable: 1,
        destinationPatternTable: 1,
        animations: [
          {
            name: 'idle',
            frameIndices: [0],
            frameDuration: 6,
          },
        ],
      });

      // Verify PT0 exports
      const cPT0 = generateCAnimationExport(modelPT0);
      const asmPT0 = generateCa65AnimationExport(modelPT0);
      const jsonPT0 = JSON.parse(
        serializeAnimationMetadata(modelPT0),
      ) as unknown as ExportedMetadataJson;

      expect(cPT0.header).toContain('#define HERO_PT0_SPRITE_PATTERN_TABLE 0');
      expect(cPT0.source).toContain('hero_pt0_sprite_pattern_table = 0;');
      expect(cPT0.source).toContain('{ 0, 0, 0x05, 0x00 }'); // Local tile index 5

      expect(asmPT0.include).toContain('HERO_PT0_SPRITE_PATTERN_TABLE = 0');
      expect(asmPT0.source).toContain(
        'hero_pt0_sprite_pattern_table:\n    .byte 0',
      );
      expect(asmPT0.source).toContain('.byte $00, $00, $05, $00'); // Local tile index $05

      expect(jsonPT0.pattern_table).toBe(0);
      expect(jsonPT0.animations[0]?.frames[0]?.sprites[0]?.tile).toBe(5);
      expect(
        jsonPT0.animations[0]?.frames[0]?.sprites[0]?.physical_tile_index,
      ).toBe(5);

      // Verify PT1 exports
      const cPT1 = generateCAnimationExport(modelPT1);
      const asmPT1 = generateCa65AnimationExport(modelPT1);
      const jsonPT1 = JSON.parse(
        serializeAnimationMetadata(modelPT1),
      ) as unknown as ExportedMetadataJson;

      expect(cPT1.header).toContain('#define HERO_PT1_SPRITE_PATTERN_TABLE 1');
      expect(cPT1.source).toContain('hero_pt1_sprite_pattern_table = 1;');
      expect(cPT1.source).toContain('{ 0, 0, 0x05, 0x00 }'); // Local tile index 5 (OAM 0..255)!

      expect(asmPT1.include).toContain('HERO_PT1_SPRITE_PATTERN_TABLE = 1');
      expect(asmPT1.source).toContain(
        'hero_pt1_sprite_pattern_table:\n    .byte 1',
      );
      expect(asmPT1.source).toContain('.byte $00, $00, $05, $00'); // Local tile index $05 (OAM 0..255)!

      expect(jsonPT1.pattern_table).toBe(1);
      expect(jsonPT1.animations[0]?.frames[0]?.sprites[0]?.tile).toBe(5); // Local tile index 5
      expect(
        jsonPT1.animations[0]?.frames[0]?.sprites[0]?.physical_tile_index,
      ).toBe(261); // Physical CHR slot 261
    });

    it('Scenario 7 & 8 & 9 & 10: Flip-aware Deduplication (Exact, Flip-H, Flip-V, Flip-HV)', () => {
      // 32x8 image with 4 tiles:
      // Tile 0 (0,0): Asymmetric pattern (Original)
      // Tile 1 (1,0): Horizontally flipped pattern
      // Tile 2 (2,0): Vertically flipped pattern
      // Tile 3 (3,0): Horizontally & Vertically flipped pattern
      const image = createTestPatternImage(32, 8);

      // Asymmetric 8x8 pattern
      const basePattern = [
        1, 1, 1, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ];

      // Draw tile 0
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          image.pixels[y * 32 + x] = basePattern[y * 8 + x] ?? 0;
        }
      }

      // Draw tile 1 (H-flip)
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          image.pixels[y * 32 + (8 + x)] = basePattern[y * 8 + (7 - x)] ?? 0;
        }
      }

      // Draw tile 2 (V-flip)
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          image.pixels[y * 32 + (16 + x)] = basePattern[(7 - y) * 8 + x] ?? 0;
        }
      }

      // Draw tile 3 (HV-flip)
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          image.pixels[y * 32 + (24 + x)] =
            basePattern[(7 - y) * 8 + (7 - x)] ?? 0;
        }
      }

      const mod = buildAnimationProjectModel({
        name: 'flip_test',
        symbolPrefix: 'flip_test',
        image,
        frameWidth: 8,
        frameHeight: 8,
        defaultPaletteIndex: 1, // palette 1 -> attribute lower 2 bits = 0x01
        flipDeduplication: true,
        animations: [
          {
            name: 'flips',
            frameIndices: [0, 1, 2, 3],
            frameDuration: 4,
          },
        ],
      });

      // CHR allocation should deduplicate all 4 tiles into 1 physical tile slot (slot 0)
      expect(mod.chr.finalTileCount).toBe(1);

      const c = generateCAnimationExport(mod);
      const asm = generateCa65AnimationExport(mod);
      const json = JSON.parse(
        serializeAnimationMetadata(mod),
      ) as unknown as ExportedMetadataJson;

      // Frame 0: Exact reuse -> tile 0, attributes 0x01 (palette 1)
      expect(c.source).toContain('{ 0, 0, 0x00, 0x01 }');
      expect(asm.source).toContain('.byte $00, $00, $00, $01');
      expect(json.animations[0]?.frames[0]?.sprites[0]).toMatchObject({
        tile: 0,
        attributes: 0x01,
        palette: 1,
        horizontal_flip: false,
        vertical_flip: false,
      });

      // Frame 1: H-Flip -> tile 0, attributes 0x41 (0x40 | 0x01)
      expect(c.source).toContain('{ 0, 0, 0x00, 0x41 }');
      expect(asm.source).toContain('.byte $00, $00, $00, $41');
      expect(json.animations[0]?.frames[1]?.sprites[0]).toMatchObject({
        tile: 0,
        attributes: 0x41,
        palette: 1,
        horizontal_flip: true,
        vertical_flip: false,
      });

      // Frame 2: V-Flip -> tile 0, attributes 0x81 (0x80 | 0x01)
      expect(c.source).toContain('{ 0, 0, 0x00, 0x81 }');
      expect(asm.source).toContain('.byte $00, $00, $00, $81');
      expect(json.animations[0]?.frames[2]?.sprites[0]).toMatchObject({
        tile: 0,
        attributes: 0x81,
        palette: 1,
        horizontal_flip: false,
        vertical_flip: true,
      });

      // Frame 3: HV-Flip -> tile 0, attributes 0xC1 (0xC0 | 0x01)
      expect(c.source).toContain('{ 0, 0, 0x00, 0xC1 }');
      expect(asm.source).toContain('.byte $00, $00, $00, $C1');
      expect(json.animations[0]?.frames[3]?.sprites[0]).toMatchObject({
        tile: 0,
        attributes: 0xc1,
        palette: 1,
        horizontal_flip: true,
        vertical_flip: true,
      });
    });

    it('Scenario 11: Multi-level Palette Resolution (Global, Animation, Frame)', () => {
      const image = createTestPatternImage(8, 8);
      setTilePattern(image, 0, 0, [1]);

      const mod = buildAnimationProjectModel({
        name: 'palette_res',
        symbolPrefix: 'palette_res',
        image,
        frameWidth: 8,
        frameHeight: 8,
        defaultPaletteIndex: 0, // global = 0
        animations: [
          {
            name: 'anim_default',
            frameIndices: [0],
            frameDuration: 6,
            // uses global 0
          },
          {
            name: 'anim_override',
            paletteIndex: 2, // animation override = 2
            frameIndices: [0],
            frameDuration: 6,
          },
          {
            name: 'frame_override',
            paletteIndex: 1, // animation override = 1
            frameIndices: [0, 0],
            frameDuration: 6,
            framePalettes: [null, 3], // frame 0 uses 1, frame 1 uses 3
          },
        ],
      });

      const c = generateCAnimationExport(mod);
      const asm = generateCa65AnimationExport(mod);
      const json = JSON.parse(
        serializeAnimationMetadata(mod),
      ) as unknown as ExportedMetadataJson;

      // anim_default: attributes = 0x00
      expect(c.source).toContain('{ 0, 0, 0x00, 0x00 }');
      expect(asm.source).toContain('.byte $00, $00, $00, $00');

      // anim_override: attributes = 0x02
      expect(c.source).toContain('{ 0, 0, 0x00, 0x02 }');
      expect(asm.source).toContain('.byte $00, $00, $00, $02');

      // frame_override frame 0: attributes = 0x01, frame 1: attributes = 0x03
      expect(c.source).toContain('{ 0, 0, 0x00, 0x01 }');
      expect(c.source).toContain('{ 0, 0, 0x00, 0x03 }');
      expect(asm.source).toContain('.byte $00, $00, $00, $01');
      expect(asm.source).toContain('.byte $00, $00, $00, $03');

      expect(json.animations[0]?.frames[0]?.sprites[0]?.attributes).toBe(0x00);
      expect(json.animations[1]?.frames[0]?.sprites[0]?.attributes).toBe(0x02);
      expect(json.animations[2]?.frames[0]?.sprites[0]?.attributes).toBe(0x01);
      expect(json.animations[2]?.frames[1]?.sprites[0]?.attributes).toBe(0x03);
    });

    it('Scenario 12: Mirrored Direction Animation (exportMirroredDirection)', () => {
      // 16x16 frame with tile at (0, 0)
      const image = createTestPatternImage(16, 16);
      setTilePattern(image, 0, 0, [1, 2]);

      const mod = buildAnimationProjectModel({
        name: 'walker',
        symbolPrefix: 'walker',
        image,
        frameWidth: 16,
        frameHeight: 16,
        originX: 8,
        originY: 16,
        defaultPaletteIndex: 0,
        animations: [
          {
            name: 'walk',
            category: 'movement',
            direction: 'right',
            exportMirroredDirection: true,
            frameIndices: [0],
            frameDuration: 8,
          },
        ],
      });

      // Two animations produced: walk_right and walk_left
      expect(mod.animations).toHaveLength(2);
      expect(mod.animations[0]?.name).toBe('walk_right');
      expect(mod.animations[1]?.name).toBe('walk_left');

      const c = generateCAnimationExport(mod);
      const asm = generateCa65AnimationExport(mod);
      const json = JSON.parse(
        serializeAnimationMetadata(mod),
      ) as unknown as ExportedMetadataJson;

      // Primary sprite (0, 0) relative to origin (8, 16):
      // sprite x = 0 - 8 = -8, y = 0 - 16 = -16, attributes = 0x00
      // Mirrored sprite:
      // sprite x = -(-8) - 8 = 0, y = -16, attributes = 0x40 (Flip-H)
      expect(c.header).toContain('WALKER_ANIM_WALK_RIGHT = 0,');
      expect(c.header).toContain('WALKER_ANIM_WALK_LEFT = 1,');
      expect(c.source).toContain('{ -8, -16, 0x00, 0x00 }');
      expect(c.source).toContain('{ 0, -16, 0x00, 0x40 }');

      expect(asm.include).toContain('WALKER_ANIM_WALK_RIGHT = 0');
      expect(asm.include).toContain('WALKER_ANIM_WALK_LEFT = 1');
      expect(asm.source).toContain('.byte $F8, $F0, $00, $00'); // signed x=-8 ($F8), y=-16 ($F0)
      expect(asm.source).toContain('.byte $00, $F0, $00, $40'); // signed x=0 ($00), y=-16 ($F0), attr=$40

      expect(json.animations[0]?.frames[0]?.sprites[0]).toMatchObject({
        x: -8,
        y: -16,
        attributes: 0x00,
        horizontal_flip: false,
      });
      expect(json.animations[1]?.frames[0]?.sprites[0]).toMatchObject({
        x: 0,
        y: -16,
        attributes: 0x40,
        horizontal_flip: true,
      });
    });

    it('Scenario 13: Transparent Cell Omission in 16x16 Frame', () => {
      // 16x16 frame: 4 tiles (0,0), (1,0), (0,1), (1,1)
      // Only tiles (0,0) and (1,1) have pixels. (1,0) and (0,1) are transparent!
      const image = createTestPatternImage(16, 16);
      setTilePattern(image, 0, 0, [1]);
      setTilePattern(image, 1, 1, [2]);

      const mod = buildAnimationProjectModel({
        name: 'sparse',
        symbolPrefix: 'sparse',
        image,
        frameWidth: 16,
        frameHeight: 16,
        animations: [
          {
            name: 'idle',
            frameIndices: [0],
            frameDuration: 10,
          },
        ],
      });

      // Frame has exactly 2 visible sprites, 2 omitted tiles
      expect(mod.animations[0]?.frames[0]?.sprites).toHaveLength(2);
      expect(mod.animations[0]?.frames[0]?.omittedTileCount).toBe(2);

      const c = generateCAnimationExport(mod);
      const asm = generateCa65AnimationExport(mod);
      const json = JSON.parse(
        serializeAnimationMetadata(mod),
      ) as unknown as ExportedMetadataJson;

      // C: sprite_count = 2 in frame entry
      expect(c.source).toContain('{ 0, 2, 10 }'); // spriteOffset=0, spriteCount=2, duration=10

      // ASM: sprite count = 2
      expect(asm.source).toContain('.word 0\n    .byte 2, 10');

      // JSON: omitted_tile_count = 2, sprites.length = 2
      expect(json.animations[0]?.frames[0]?.omitted_tile_count).toBe(2);
      expect(json.animations[0]?.frames[0]?.sprites).toHaveLength(2);
    });

    it('Scenario 14 & 15: Multiple Frames with Non-uniform Durations', () => {
      const image = createTestPatternImage(32, 16);
      setTilePattern(image, 0, 0, [1]);
      setTilePattern(image, 2, 0, [2]);

      const mod = buildAnimationProjectModel({
        name: 'timed_hero',
        symbolPrefix: 'timed_hero',
        image,
        frameWidth: 16,
        frameHeight: 16,
        animations: [
          {
            name: 'attack',
            playback: 'once',
            frameIndices: [0, 1],
            frameDuration: 4,
            frameDurations: [4, 14], // non-uniform durations
          },
        ],
      });

      const c = generateCAnimationExport(mod);
      const asm = generateCa65AnimationExport(mod);
      const json = JSON.parse(
        serializeAnimationMetadata(mod),
      ) as unknown as ExportedMetadataJson;

      // Frame 0 has duration 4, Frame 1 has duration 14
      expect(c.source).toContain('{ 0, 1, 4 }');
      expect(c.source).toContain('{ 1, 1, 14 }');

      expect(asm.source).toContain('.word 0\n    .byte 1, 4');
      expect(asm.source).toContain('.word 1\n    .byte 1, 14');

      expect(json.animations[0]?.frames[0]?.duration).toBe(4);
      expect(json.animations[0]?.frames[1]?.duration).toBe(14);
    });

    it('Scenario 16: Signed 8-bit x/y Coordinates (-128..127)', () => {
      const image = createTestPatternImage(16, 16);
      setTilePattern(image, 0, 0, [1]);

      // Set originX=24, originY=32 -> relative offsets x = 0-24 = -24, y = 0-32 = -32
      const mod = buildAnimationProjectModel({
        name: 'signed_test',
        symbolPrefix: 'signed_test',
        image,
        frameWidth: 16,
        frameHeight: 16,
        originX: 24,
        originY: 32,
        animations: [
          {
            name: 'pose',
            frameIndices: [0],
            frameDuration: 6,
          },
        ],
      });

      const c = generateCAnimationExport(mod);
      const asm = generateCa65AnimationExport(mod);
      const json = JSON.parse(
        serializeAnimationMetadata(mod),
      ) as unknown as ExportedMetadataJson;

      // C: decimal signed int8_t
      expect(c.source).toContain('{ -24, -32, 0x00, 0x00 }');

      // ASM: signedByte(-24) = 0xE8, signedByte(-32) = 0xE0
      expect(asm.source).toContain('.byte $E8, $E0, $00, $00');

      // JSON: signed integer numbers
      expect(json.animations[0]?.frames[0]?.sprites[0]?.x).toBe(-24);
      expect(json.animations[0]?.frames[0]?.sprites[0]?.y).toBe(-32);
    });

    it('Scenario 17: Shared Tiles Across Multiple Animations', () => {
      const sharedPattern = [1, 2, 3, 1];
      const image1 = createTestPatternImage(16, 16);
      setTilePattern(image1, 0, 0, sharedPattern);

      const image2 = createTestPatternImage(16, 16);
      setTilePattern(image2, 0, 0, sharedPattern); // Same pattern!

      const mod = buildAnimationProjectModel({
        name: 'shared_asset',
        symbolPrefix: 'shared_asset',
        animations: [
          {
            id: 'anim1',
            assetId: 'asset1',
            name: 'idle',
            image: image1,
            frameWidth: 16,
            frameHeight: 16,
            frameIndices: [0],
            frameDuration: 6,
          },
          {
            id: 'anim2',
            assetId: 'asset2',
            name: 'run',
            image: image2,
            frameWidth: 16,
            frameHeight: 16,
            frameIndices: [0],
            frameDuration: 6,
          },
        ],
      });

      // Deduplicated to 1 physical tile slot in CHR
      expect(mod.chr.finalTileCount).toBe(1);

      const c = generateCAnimationExport(mod);
      const asm = generateCa65AnimationExport(mod);
      const json = JSON.parse(
        serializeAnimationMetadata(mod),
      ) as unknown as ExportedMetadataJson;

      // Both animations reference local tile 0x00
      expect(json.animations[0]?.frames[0]?.sprites[0]?.tile).toBe(0);
      expect(json.animations[1]?.frames[0]?.sprites[0]?.tile).toBe(0);

      expect(c.source).toContain('{ 0, 0, 0x00, 0x00 }');
      expect(asm.source).toContain('.byte $00, $00, $00, $00');
    });

    it('Scenario 18 & 19: Base CHR, CHR Reservations and exportAnimationChr', () => {
      const baseChr = new Uint8Array(4096);
      // Pre-fill slot 0 with pattern 0xAA and slot 1 with pattern 0xBB
      baseChr[0] = 0xaa;
      baseChr[16] = 0xbb;

      const image = createTestPatternImage(16, 16);
      setTilePattern(image, 0, 0, [2]);

      const mod = buildAnimationProjectModel({
        name: 'base_and_res',
        symbolPrefix: 'base_and_res',
        image,
        frameWidth: 16,
        frameHeight: 16,
        baseChr,
        chrRegions: [
          {
            id: 'res_ui',
            name: 'UI Area',
            patternTable: 0,
            startTile: 0,
            endTile: 3, // Reserve slots 0..3
            kind: 'reservation',
          },
        ],
        animations: [
          {
            name: 'idle',
            frameIndices: [0],
            frameDuration: 6,
          },
        ],
      });

      // Sprite should be allocated at slot 4 (after reserved slots 0..3)
      expect(mod.animations[0]?.frames[0]?.sprites[0]?.tile).toBe(4);

      // Verify exportAnimationChr matches mod.finalChr exactly
      const chrBuffer = exportAnimationChr(mod);
      expect(chrBuffer).toBe(mod.finalChr);
      expect(chrBuffer.length).toBe(8192);

      // Preserves base CHR data at slot 0 and slot 1
      expect(chrBuffer[0]).toBe(0xaa);
      expect(chrBuffer[16]).toBe(0xbb);
    });

    it('Scenario 20: Deterministic Output Across Repeated Calls', () => {
      const image = createTestPatternImage(32, 32);
      setTilePattern(image, 0, 0, [1, 2]);
      setTilePattern(image, 1, 1, [2, 3]);

      const mod = buildAnimationProjectModel({
        name: 'det_test',
        symbolPrefix: 'det_test',
        image,
        frameWidth: 16,
        frameHeight: 16,
        animations: [
          { name: 'idle', frameIndices: [0, 1], frameDuration: 6 },
          { name: 'walk', frameIndices: [1, 0], frameDuration: 8 },
        ],
      });

      const c1 = generateCAnimationExport(mod);
      const c2 = generateCAnimationExport(mod);
      expect(c1).toEqual(c2);

      const asm1 = generateCa65AnimationExport(mod);
      const asm2 = generateCa65AnimationExport(mod);
      expect(asm1).toEqual(asm2);

      const json1 = serializeAnimationMetadata(mod);
      const json2 = serializeAnimationMetadata(mod);
      expect(json1).toBe(json2);

      const chr1 = exportAnimationChr(mod);
      const chr2 = exportAnimationChr(mod);
      expect(chr1).toEqual(chr2);
    });

    it('Scenario 21: Cross-format Semantic Equivalence (C, ca65 ASM, JSON v5)', () => {
      const image = createTestPatternImage(32, 32);
      setTilePattern(image, 0, 0, [1, 2, 3]);
      setTilePattern(image, 1, 0, [3, 2, 1]);
      setTilePattern(image, 0, 1, [2, 1, 3]);

      const mod = buildAnimationProjectModel({
        name: 'hero_equiv',
        symbolPrefix: 'hero_equiv',
        image,
        frameWidth: 16,
        frameHeight: 16,
        originX: 8,
        originY: 16,
        defaultPaletteIndex: 1,
        patternTable: 1, // PT1!
        destinationPatternTable: 1,
        animations: [
          {
            name: 'idle',
            playback: 'loop',
            frameIndices: [0, 1],
            frameDuration: 6,
            frameDurations: [6, 12],
            framePalettes: [null, 2],
          },
          {
            name: 'attack',
            playback: 'once',
            frameIndices: [2],
            frameDuration: 8,
            allowHorizontalFlip: true,
          },
        ],
      });

      const c = generateCAnimationExport(mod);
      const asm = generateCa65AnimationExport(mod);
      const json = JSON.parse(
        serializeAnimationMetadata(mod),
      ) as unknown as ExportedMetadataJson;
      const chr = exportAnimationChr(mod);

      // 1. Animation counts and properties
      expect(json.animations).toHaveLength(2);
      expect(c.header).toContain('HERO_EQUIV_ANIM_IDLE = 0');
      expect(c.header).toContain('HERO_EQUIV_ANIM_ATTACK = 1');
      expect(asm.include).toContain('HERO_EQUIV_ANIM_IDLE = 0');
      expect(asm.include).toContain('HERO_EQUIV_ANIM_ATTACK = 1');

      // 2. Pattern table equivalence
      expect(json.pattern_table).toBe(1);
      expect(c.header).toContain('#define HERO_EQUIV_SPRITE_PATTERN_TABLE 1');
      expect(asm.include).toContain('HERO_EQUIV_SPRITE_PATTERN_TABLE = 1');

      // 3. Frame count & sprite count progression
      const flat = mod.animations.flatMap((a) => a.frames);
      expect(flat).toHaveLength(3); // 2 frames in idle, 1 frame in attack

      // Compare every single sprite across JSON, C, and ASM:
      const allSprites = flat.flatMap((f) => f.sprites);
      expect(allSprites.length).toBeGreaterThan(0);

      allSprites.forEach((sprite) => {
        // Local tile index is 0..255
        expect(sprite.tile).toBeGreaterThanOrEqual(0);
        expect(sprite.tile).toBeLessThan(256);

        // Invariant: physicalTileIndex = patternTable * 256 + tile
        expect(sprite.physicalTileIndex).toBe(256 + sprite.tile);

        // Attributes match
        const cSpritePattern = `{ ${String(sprite.x)}, ${String(sprite.y)}, 0x${sprite.tile.toString(16).padStart(2, '0').toUpperCase()}, 0x${sprite.attributes.toString(16).padStart(2, '0').toUpperCase()} }`;
        expect(c.source).toContain(cSpritePattern);

        const asmSignedX = (sprite.x < 0 ? 0x100 + sprite.x : sprite.x)
          .toString(16)
          .padStart(2, '0')
          .toUpperCase();
        const asmSignedY = (sprite.y < 0 ? 0x100 + sprite.y : sprite.y)
          .toString(16)
          .padStart(2, '0')
          .toUpperCase();
        const asmTile = sprite.tile.toString(16).padStart(2, '0').toUpperCase();
        const asmAttr = sprite.attributes
          .toString(16)
          .padStart(2, '0')
          .toUpperCase();
        const asmSpritePattern = `.byte $${asmSignedX}, $${asmSignedY}, $${asmTile}, $${asmAttr}`;
        expect(asm.source).toContain(asmSpritePattern);
      });

      // 4. CHR buffer size
      expect(chr.length).toBe(8192);
      expect(chr.length).toBe(json.chr.final_size_bytes);
    });

    it('Scenario 22: Serialized Project Round-trip and Export Invariance', () => {
      const project = createDefaultProject('Roundtrip Exporter', 'animation');
      const image = createTestPatternImage(32, 16);
      setTilePattern(image, 0, 0, [1, 2]);
      setTilePattern(image, 1, 0, [2, 3]);

      const baseAnim = project.animation?.animations[0];
      const animConfig = project.animation;
      if (!baseAnim || !animConfig) return;

      const projectWithAnimation = {
        ...project,
        animation: {
          ...animConfig,
          name: 'HeroEntity',
          symbolPrefix: 'hero_entity',
          animations: [
            {
              ...baseAnim,
              name: 'idle',
              defaultDuration: 8,
              frameIndices: [0, 1],
              frameDurations: [8, 12],
            },
          ],
        },
      };

      // 1. Initial export from model
      const initialModel = buildAnimationProjectModel({
        name: projectWithAnimation.animation.name,
        symbolPrefix: projectWithAnimation.animation.symbolPrefix,
        image,
        frameWidth: 16,
        frameHeight: 16,
        animations: [
          {
            name: 'idle',
            frameIndices: [0, 1],
            frameDuration: 8,
            frameDurations: [8, 12],
          },
        ],
      });

      const initialC = generateCAnimationExport(initialModel);
      const initialAsm = generateCa65AnimationExport(initialModel);
      const initialJson = serializeAnimationMetadata(initialModel);
      const initialChr = exportAnimationChr(initialModel);

      // 2. Serialize project to JSON and deserialize
      const serializedP2C = serializeProject(projectWithAnimation);
      const deserializedResult = deserializeProject(serializedP2C);
      expect(deserializedResult.success).toBe(true);
      if (!deserializedResult.success) return;

      const reloadedProject = deserializedResult.project;
      const reloadedAnim = reloadedProject.animation?.animations[0];
      const reloadedAnimConfig = reloadedProject.animation;
      if (!reloadedAnim || !reloadedAnimConfig) return;

      // 3. Rebuild model from reloaded project
      const reloadedModel = buildAnimationProjectModel({
        name: reloadedAnimConfig.name,
        symbolPrefix: reloadedAnimConfig.symbolPrefix,
        image,
        frameWidth: reloadedAnim.frameWidth,
        frameHeight: reloadedAnim.frameHeight,
        animations: [
          {
            name: reloadedAnim.name,
            frameIndices: reloadedAnim.frameIndices,
            frameDuration: reloadedAnim.defaultDuration,
            frameDurations: reloadedAnim.frameDurations,
          },
        ],
      });

      const reloadedC = generateCAnimationExport(reloadedModel);
      const reloadedAsm = generateCa65AnimationExport(reloadedModel);
      const reloadedJson = serializeAnimationMetadata(reloadedModel);
      const reloadedChr = exportAnimationChr(reloadedModel);

      // 4. Verify identical exports
      expect(reloadedC).toEqual(initialC);
      expect(reloadedAsm).toEqual(initialAsm);
      expect(reloadedJson).toBe(initialJson);
      expect(reloadedChr).toEqual(initialChr);
    });
  });
});
