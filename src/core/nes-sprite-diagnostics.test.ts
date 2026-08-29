import { describe, expect, it } from 'vitest';
import type {
  AnimationModel,
  AnimationProjectModel,
  MetaspriteTile,
} from './animation-model';
import {
  analyzeAnimationSpriteScanlinePressure,
  analyzeMetaspriteScanlinePressure,
  analyzeSceneInstanceVisibility,
  NES_SPRITE_SCANLINE_WARNING_THRESHOLD,
  NES_SPRITES_PER_SCANLINE_LIMIT,
  type MetaspriteScanlineSprite,
} from './nes-sprite-diagnostics';
import type { ScenePreviewInstance } from './scene-preview';

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

function sceneSprite(x: number, y: number): MetaspriteTile {
  return { x, y } as MetaspriteTile;
}

function sceneAnimation(
  sprites: readonly MetaspriteTile[],
  options: {
    originX?: number;
    originY?: number;
    id?: string;
    generatedByHorizontalFlip?: boolean;
  } = {},
): AnimationModel {
  return {
    id: options.id ?? 'hero',
    name: 'Hero',
    originX: options.originX ?? 0,
    originY: options.originY ?? 0,
    generatedByHorizontalFlip: options.generatedByHorizontalFlip ?? false,
    frames: [
      {
        sourceIndex: 3,
        sprites,
      },
    ],
  } as unknown as AnimationModel;
}

function sceneInstance(
  overrides: Partial<ScenePreviewInstance> = {},
): ScenePreviewInstance {
  return {
    id: 'instance-1',
    animationId: 'hero',
    entityId: 'hero',
    animationName: 'Hero',
    x: 100,
    y: 100,
    visible: true,
    ...overrides,
  };
}

describe('scene instance coordinate and visibility diagnostics', () => {
  it('does not diagnose a centered instance or exact visible edges', () => {
    const sprites = [
      sceneSprite(0, 0),
      sceneSprite(248, 0),
      sceneSprite(0, 232),
    ];

    expect(
      analyzeSceneInstanceVisibility(
        [sceneInstance({ x: 0, y: 0 })],
        [sceneAnimation(sprites)],
      ),
    ).toEqual([]);
  });

  it.each([
    [255, 20],
    [20, 239],
  ])('allows partial clipping at X %s, Y %s', (x, y) => {
    expect(
      analyzeSceneInstanceVisibility(
        [sceneInstance({ x, y })],
        [sceneAnimation([sceneSprite(0, 0)])],
      ),
    ).toEqual([]);
  });

  it('does not warn when one sprite is offscreen and another is visible', () => {
    const facts = analyzeSceneInstanceVisibility(
      [sceneInstance({ x: 20, y: 0 })],
      [sceneAnimation([sceneSprite(0, 232), sceneSprite(0, 240)])],
    );

    expect(facts).toEqual([]);
  });

  it('warns once with real metasprite bounds when every sprite is offscreen', () => {
    const facts = analyzeSceneInstanceVisibility(
      [sceneInstance({ x: 20, y: 240, name: 'Hero One' })],
      [sceneAnimation([sceneSprite(0, 0), sceneSprite(16, 8)])],
    );

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      instanceId: 'instance-1',
      animationId: 'hero',
      frameIndex: 0,
      sourceFrameIndex: 3,
      severity: 'warning',
      kind: 'all-sprites-offscreen',
      boundingRect: { x: 20, y: 240, width: 24, height: 16 },
    });
  });

  it('checks actual sprites instead of treating bounding-box overlap as visibility', () => {
    const facts = analyzeSceneInstanceVisibility(
      [sceneInstance({ x: 0, y: 40 })],
      [sceneAnimation([sceneSprite(-8, 0), sceneSprite(256, 0)])],
    );

    expect(
      facts.filter((fact) => fact.kind === 'all-sprites-offscreen'),
    ).toHaveLength(1);
  });

  it('emits one info fact with every coordinate that wraps an OAM byte', () => {
    const facts = analyzeSceneInstanceVisibility(
      [sceneInstance({ x: -1, y: 0 })],
      [sceneAnimation([sceneSprite(0, 0), sceneSprite(0, 256)])],
    );
    const wrapFact = facts.find((fact) => fact.kind === 'coordinate-wraps');

    expect(wrapFact).toMatchObject({
      instanceId: 'instance-1',
      animationId: 'hero',
      frameIndex: 0,
      severity: 'info',
      kind: 'coordinate-wraps',
      coordinates: [
        { x: -1, y: 0, wrappedX: 255, wrappedY: 0 },
        { x: -1, y: 256, wrappedX: 255, wrappedY: 0 },
      ],
    });
    expect(
      facts.filter((fact) => fact.kind === 'coordinate-wraps'),
    ).toHaveLength(1);
  });

  it('honors canonical anchors, animation origins, and origin-relative sprites', () => {
    const facts = analyzeSceneInstanceVisibility(
      [
        sceneInstance({
          x: 1,
          y: 1,
          anchorX: 28,
          anchorY: 248,
        }),
      ],
      [sceneAnimation([sceneSprite(-8, -8)], { originX: 8, originY: 8 })],
    );

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      kind: 'all-sprites-offscreen',
      boundingRect: { x: 20, y: 240, width: 8, height: 8 },
    });
  });

  it('reports the 8-bit wrap boundary without changing offscreen severity', () => {
    const facts = analyzeSceneInstanceVisibility(
      [sceneInstance({ x: 256, y: 256 })],
      [sceneAnimation([sceneSprite(0, 0)])],
    );

    expect(facts.map(({ kind, severity }) => [kind, severity])).toEqual([
      ['all-sprites-offscreen', 'warning'],
      ['coordinate-wraps', 'info'],
    ]);
  });

  it('skips hidden, unresolved, dangling, duplicated, and empty instances', () => {
    const base = sceneAnimation([sceneSprite(0, 0)]);
    const instances = [
      sceneInstance({ id: 'hidden', visible: false, x: 300 }),
      sceneInstance({ id: 'unresolved', animationId: '', x: 300 }),
      sceneInstance({ id: 'dangling', animationId: 'missing', x: 300 }),
      sceneInstance({ id: 'empty', animationId: 'empty', x: 300 }),
    ];
    const empty = sceneAnimation([], { id: 'empty' });

    expect(
      analyzeSceneInstanceVisibility(instances, [base, base, empty]),
    ).toEqual([]);
  });

  it('ignores generated mirror models sharing the canonical animation id', () => {
    const facts = analyzeSceneInstanceVisibility(
      [sceneInstance({ y: 240 })],
      [
        sceneAnimation([sceneSprite(0, 0)]),
        sceneAnimation([sceneSprite(0, 0)], {
          generatedByHorizontalFlip: true,
        }),
      ],
    );

    expect(
      facts.filter((fact) => fact.kind === 'all-sprites-offscreen'),
    ).toHaveLength(1);
  });
});
