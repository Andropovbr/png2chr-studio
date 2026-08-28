import { describe, expect, it } from 'vitest';
import type { AnimationProjectModel } from './animation-model';
import {
  analyzeAnimationSpriteScanlinePressure,
  analyzeMetaspriteScanlinePressure,
  NES_SPRITE_SCANLINE_WARNING_THRESHOLD,
  NES_SPRITES_PER_SCANLINE_LIMIT,
  type MetaspriteScanlineSprite,
} from './nes-sprite-diagnostics';

function spritesAt(
  count: number,
  y: number,
): readonly MetaspriteScanlineSprite[] {
  return Array.from({ length: count }, () => ({ y }));
}

describe('metasprite scanline pressure diagnostics', () => {
  it.each([
    [5, 0, null],
    [NES_SPRITE_SCANLINE_WARNING_THRESHOLD, 8, 'sprite-scanline-pressure'],
    [NES_SPRITES_PER_SCANLINE_LIMIT, 8, 'sprite-scanline-pressure'],
    [NES_SPRITES_PER_SCANLINE_LIMIT + 1, 8, 'sprite-scanline-limit-exceeded'],
  ] as const)(
    'classifies the %s-sprite boundary',
    (count, expectedFactCount, expectedKind) => {
      const facts = analyzeMetaspriteScanlinePressure(spritesAt(count, 0), 8);

      expect(facts).toHaveLength(expectedFactCount);
      expect(facts[0]?.kind ?? null).toBe(expectedKind);
      expect(facts[0]?.spriteCount ?? null).toBe(
        expectedKind === null ? null : count,
      );
    },
  );

  it('counts only scanlines where vertical sprite intervals overlap', () => {
    const sprites = [
      ...spritesAt(5, 0),
      ...spritesAt(1, 4),
      ...spritesAt(1, 8),
      ...spritesAt(5, 12),
    ];
    const facts = analyzeMetaspriteScanlinePressure(sprites, 24);

    expect(
      facts.map(({ scanline, spriteCount }) => [scanline, spriteCount]),
    ).toEqual([
      [4, 6],
      [5, 6],
      [6, 6],
      [7, 6],
      [12, 6],
      [13, 6],
      [14, 6],
      [15, 6],
    ]);
  });

  it('clips partially visible sprites at both frame edges', () => {
    const sprites = [...spritesAt(6, -7), ...spritesAt(6, 15)];
    const facts = analyzeMetaspriteScanlinePressure(sprites, 16);

    expect(facts.map(({ scanline }) => scanline)).toEqual([0, 15]);
  });

  it('ignores sprites fully above or below the frame', () => {
    const sprites = [...spritesAt(9, -8), ...spritesAt(9, 16)];

    expect(analyzeMetaspriteScanlinePressure(sprites, 16)).toEqual([]);
  });

  it('does not count a sprite after its bottom-exclusive edge', () => {
    const sprites = [...spritesAt(5, 0), ...spritesAt(1, 8)];
    const facts = analyzeMetaspriteScanlinePressure(sprites, 16);

    expect(facts).toEqual([]);
  });

  it('is deterministic and does not mutate input geometry', () => {
    const sprites = Object.freeze(
      spritesAt(9, 3).map((sprite) => Object.freeze({ ...sprite })),
    );
    const before = JSON.stringify(sprites);
    const first = analyzeMetaspriteScanlinePressure(sprites, 16);
    const second = analyzeMetaspriteScanlinePressure(sprites, 16);

    expect(second).toEqual(first);
    expect(JSON.stringify(sprites)).toBe(before);
    expect(first.map((fact) => fact.scanline)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('converts origin-relative model coordinates before frame clipping', () => {
    const model = {
      animations: [
        {
          id: 'hero',
          name: 'Hero',
          originY: 7,
          frames: [
            {
              sourceIndex: 2,
              height: 8,
              sprites: Array.from({ length: 6 }, () => ({ y: -7 })),
            },
          ],
        },
      ],
    } as unknown as AnimationProjectModel;

    const facts = analyzeAnimationSpriteScanlinePressure(model);

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      animationId: 'hero',
      animationName: 'Hero',
      frameIndex: 0,
      sourceFrameIndex: 2,
      scanline: 0,
      spriteCount: 6,
      severity: 'warning',
    });
  });
});
