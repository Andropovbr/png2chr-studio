import { describe, expect, it } from 'vitest';

import {
  generateCAnimationExport,
  generateCa65AnimationExport,
  sanitizeCIdentifier,
  serializeAnimationMetadata,
} from './animation-exporters';
import { buildAnimationProjectModel } from './animation-model';
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
      version: 3,
      name: 'animation',
      symbol_prefix: 'hero',
      symbol_base: 'hero_animation',
      chr: {
        base_tile_count: 0,
        final_tile_count: 1,
        final_size_bytes: 8192,
      },
      animation_flags: {
        direction_mask: 3,
        direction_left: 1,
        direction_right: 2,
        generated_horizontal_flip: 128,
      },
    });
    expect(first).not.toContain('finalChr');
    expect(first).toContain('"attributes": 64');
  });

  it('generates consistent cc65-friendly flattened C data', () => {
    const output = generateCAnimationExport(model());

    expect(output.headerFileName).toBe('hero_animation.h');
    expect(output.header).toContain('typedef struct {');
    expect(output.header).toContain('uint16_t sprite_offset;');
    expect(output.source).toContain('{ 0, 0, 0x00, 0x00 }');
    expect(output.source).toContain('{ 0, 0, 0x00, 0x40 }');
    expect(output.source).toContain(
      'const uint8_t hero_animation_animation_count = 2;',
    );
    expect(output.estimatedRomBytes).toBe(31);
  });

  it('generates deterministic ca65 data with documented layouts', () => {
    const first = generateCa65AnimationExport(model());
    const second = generateCa65AnimationExport(model());

    expect(first).toEqual(second);
    expect(first.includeFileName).toBe('hero_animation.inc');
    expect(first.include).toContain('Sprite entry (4 bytes)');
    expect(first.source).toContain('.segment "RODATA"');
    expect(first.source).not.toContain('.include');
    expect(first.source).toContain('.byte $00, $00, $00, $40');
    expect(first.source).toContain('hero_animation_animation_count:');
    expect(first.estimatedRomBytes).toBe(31);
  });

  it('exports directional metadata and compact flags for both movement directions', () => {
    const directional = model(true);
    const parsed = JSON.parse(serializeAnimationMetadata(directional)) as {
      animations: {
        name: string;
        direction: string;
        generated_by_horizontal_flip: boolean;
      }[];
    };
    const c = generateCAnimationExport(directional);
    const asm = generateCa65AnimationExport(directional);

    expect(
      parsed.animations.map(({ name, direction }) => ({ name, direction })),
    ).toEqual([
      { name: 'idle', direction: 'none' },
      { name: 'movement_right', direction: 'right' },
      { name: 'movement_left', direction: 'left' },
    ]);
    expect(parsed.animations[2]?.generated_by_horizontal_flip).toBe(true);
    expect(c.header).toContain('uint8_t direction_flags;');
    expect(c.header).toContain('DIRECTION_MASK 0x03');
    expect(c.source).toContain('{ 1, 1, 1, 1, 1, 0x02 }');
    expect(c.source).toContain('{ 2, 1, 1, 1, 1, 0x81 }');
    expect(asm.include).toContain('Animation entry (7 bytes)');
    expect(asm.include).toContain('DIRECTION_MASK = $03');
    expect(asm.source).toContain('.byte 1, 1, 1, 1, $81');
    expect(c.estimatedRomBytes).toBe(46);
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
});
