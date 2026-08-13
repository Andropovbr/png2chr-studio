import { describe, expect, it } from 'vitest';

import {
  generateCAnimationExport,
  generateCa65AnimationExport,
  sanitizeCIdentifier,
  serializeAnimationMetadata,
} from './animation-exporters';
import {
  ANIMATION_METADATA_VERSION,
  buildAnimationProjectModel,
  DEFAULT_ANIMATION_CHR_CAPACITY_TILES,
} from './animation-model';
import type { IndexedImage } from './types';
import example from '../../examples/sprite-animation/hero_animation.json';

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
      version: 4,
      name: 'animation',
      symbol_prefix: 'hero',
      symbol_base: 'hero_animation',
      chr: {
        base_tile_count: 0,
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
    expect(output.source).toContain('{ 0, 0, 0x00, 0x00 }');
    expect(output.source).toContain('{ 0, 0, 0x00, 0x40 }');
    expect(output.source).toContain(
      'const uint8_t hero_animation_animation_count = 2;',
    );
    expect(output.estimatedRomBytes).toBe(35);
  });

  it('generates deterministic ca65 data with documented layouts and animation constants', () => {
    const first = generateCa65AnimationExport(model());
    const second = generateCa65AnimationExport(model());

    expect(first).toEqual(second);
    expect(first.includeFileName).toBe('hero_animation.inc');
    expect(first.include).toContain('Sprite entry (5 bytes)');
    expect(first.include).toContain('HERO_ANIMATION_ANIM_IDLE = 0');
    expect(first.include).toContain('HERO_ANIMATION_ANIM_MOVEMENT = 1');
    expect(first.source).toContain('.segment "RODATA"');
    expect(first.source).not.toContain('.include');
    expect(first.source).toContain(
      '.byte $00, $00\n    .word $0000\n    .byte $40',
    );
    expect(first.source).toContain('hero_animation_animation_count:');
    expect(first.estimatedRomBytes).toBe(35);
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
    expect(asm.source).toContain(
      '.byte $00, $00\n    .word $0000\n    .byte $02',
    );
    expect(asm.source).toContain(
      '.byte $00, $00\n    .word $0000\n    .byte $03',
    );
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

  it('keeps the committed sprite-animation example metadata in sync with the current schema', () => {
    expect(example.version).toBe(ANIMATION_METADATA_VERSION);
    expect(example.chr.capacity_tiles).toBe(
      DEFAULT_ANIMATION_CHR_CAPACITY_TILES,
    );

    const reuseCounts: Record<string, number> = {
      destination: 0,
      imported: 0,
      new: 0,
    };
    for (const animation of example.animations) {
      for (const frame of animation.frames) {
        for (const sprite of frame.sprites) {
          reuseCounts[sprite.reuse] = (reuseCounts[sprite.reuse] ?? 0) + 1;
        }
      }
    }
    expect(reuseCounts.destination).toBe(example.chr.reused_destination_tiles);
    expect(reuseCounts.imported).toBe(example.chr.reused_imported_tiles);
    expect(reuseCounts.new).toBe(example.chr.new_tile_count);

    expect(example.chr.final_tile_count).toBe(
      example.chr.base_tile_count + example.chr.new_tile_count,
    );
    expect(example.chr.remaining_tiles).toBe(
      example.chr.capacity_tiles - example.chr.final_tile_count,
    );
  });
});
