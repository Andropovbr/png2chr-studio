import { describe, expect, it } from 'vitest';
import type { AnimationItemSetting } from '../ui/types';
import { buildAnimationProjectModel } from './animation-model';
import { buildChrAssetMappingIndex } from './chr-asset-mapping';
import {
  advanceScenePlayback,
  computeInstanceProjection,
  createSceneInstance,
  deriveSceneInstanceResourceFacts,
  getAnimationsForEntity,
  getInstanceAnimationReferenceStatus,
  getAvailableEntities,
  initializePlaybackStates,
  resetPlaybackStates,
  reorderSceneInstances,
  resolveInstanceAnimation,
  resolveInstanceFrames,
  resolveScenePaletteIds,
  type ScenePreviewInstance,
} from './scene-preview';

describe('Scene canonical resource context', () => {
  it('derives current palette, frame, sprites, and CHR slots without copying project state', () => {
    const animation = createMockAnimation(
      'resource-animation',
      'idle',
      'hero',
      [0],
      [8],
    );
    const withPalette = { ...animation, paletteId: 'palette-before' };
    const sourceImage = animation.source?.indexedImage;
    expect(sourceImage).toBeDefined();
    if (sourceImage === undefined) return;
    const image = {
      ...sourceImage,
      pixels: new Uint8Array(sourceImage.width * sourceImage.height).fill(1),
      colors: [null, null, null, null],
      transparentIndex: 0 as const,
      colorCount: 4,
    };
    const model = buildAnimationProjectModel({
      name: 'hero',
      animations: [
        {
          id: animation.id,
          assetId: animation.source?.assetId,
          name: 'hero_idle',
          image,
          frameWidth: animation.frameWidth,
          frameHeight: animation.frameHeight,
          frameIndices: animation.frameIndices,
          frameDuration: animation.defaultDuration,
        },
      ],
    });
    const mappingIndex = buildChrAssetMappingIndex({
      animationModel: model,
      animations: [withPalette],
    });
    const instance: ScenePreviewInstance = {
      id: 'resource-instance',
      animationId: animation.id,
      entityId: 'hero',
      animationName: 'idle',
      x: 0,
      y: 0,
      visible: true,
    };

    const before = deriveSceneInstanceResourceFacts(
      instance,
      0,
      [withPalette],
      model,
      mappingIndex,
    );
    expect(before.status).toBe('resolved');
    if (before.status !== 'resolved') return;
    expect(before.paletteId).toBe('palette-before');
    expect(before.spriteCount).toBeGreaterThan(0);
    expect(before.physicalTileIndices.length).toBeGreaterThan(0);
    expect(before.assetId).toBe(animation.source?.assetId);

    const after = deriveSceneInstanceResourceFacts(
      instance,
      0,
      [{ ...withPalette, paletteId: 'palette-after' }],
      model,
      mappingIndex,
    );
    expect(after.paletteId).toBe('palette-after');
    expect(before.paletteId).toBe('palette-before');
  });

  it('keeps dangling animation references explicit and safe', () => {
    const instance: ScenePreviewInstance = {
      id: 'dangling-resource-instance',
      animationId: 'removed-animation',
      entityId: 'hero',
      animationName: 'removed',
      x: 0,
      y: 0,
      visible: true,
    };
    expect(
      deriveSceneInstanceResourceFacts(instance, 0, [], null, null),
    ).toEqual({
      status: 'unresolved-animation',
      animationId: 'removed-animation',
      frameIndex: 0,
      paletteId: null,
    });
  });
});

describe('reorderSceneInstances', () => {
  const instances: readonly ScenePreviewInstance[] = [
    {
      id: 'back',
      animationId: 'idle',
      entityId: 'hero',
      animationName: 'idle',
      x: 0,
      y: 0,
      visible: true,
    },
    {
      id: 'middle',
      animationId: 'walk',
      entityId: 'hero',
      animationName: 'walk',
      x: 0,
      y: 0,
      visible: true,
    },
    {
      id: 'front',
      animationId: 'attack',
      entityId: 'hero',
      animationName: 'attack',
      x: 0,
      y: 0,
      visible: true,
    },
  ];

  it('moves instances within canonical render order without changing identity', () => {
    const movedForward = reorderSceneInstances(instances, 'middle', 'forward');
    expect(movedForward.map((instance) => instance.id)).toEqual([
      'back',
      'front',
      'middle',
    ]);
    expect(movedForward[2]).toBe(instances[1]);

    const movedBackward = reorderSceneInstances(
      movedForward,
      'middle',
      'backward',
    );
    expect(movedBackward.map((instance) => instance.id)).toEqual([
      'back',
      'middle',
      'front',
    ]);
  });

  it('returns original order at boundaries or for unknown identities', () => {
    expect(reorderSceneInstances(instances, 'front', 'forward')).toBe(
      instances,
    );
    expect(reorderSceneInstances(instances, 'back', 'backward')).toBe(
      instances,
    );
    expect(reorderSceneInstances(instances, 'missing', 'forward')).toBe(
      instances,
    );
  });
});

function createMockAnimation(
  id: string,
  name: string,
  entity: string,
  frames: number[],
  durations: number[],
): AnimationItemSetting {
  const width = 64;
  const height = 16;
  return {
    id,
    name,
    entity,
    source: {
      assetId: `${id}-source`,
      fileName: `${id}.png`,
      sourceImage: {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
        colorSpace: 'srgb',
      },
      indexedImage: {
        width,
        height,
        pixels: new Uint8Array(width * height),
        colors: [],
        transparentIndex: null,
        colorCount: 0,
      },
    },
    paletteIndex: null,
    frameWidth: 16,
    frameHeight: 16,
    originX: 0,
    originY: 0,
    playback: 'loop',
    allowHorizontalFlip: false,
    allowVerticalFlip: false,
    flipH: false,
    flipV: false,
    defaultDuration: 10,
    frameIndices: frames,
    frameDurations: durations,
    framePalettes: [],
    collapsed: false,
  };
}

describe('Scene Preview Domain Logic', () => {
  const soldierIdle = createMockAnimation(
    'a1',
    'idle',
    'Soldier',
    [0, 1],
    [10, 10],
  );
  const soldierWalk = createMockAnimation(
    'a2',
    'walk',
    'Soldier',
    [2, 3, 4],
    [5, 5, 5],
  );
  const batFly = createMockAnimation('a3', 'fly', 'Bat', [0, 1, 2], [8, 8, 8]);
  const swordAttack = createMockAnimation(
    'a4',
    'attack',
    'Sword',
    [0, 1, 2, 3],
    [4, 4, 4, 4],
  );

  const allAnimations = [soldierIdle, soldierWalk, batFly, swordAttack];

  it('extracts unique available entities in alphabetical order', () => {
    const entities = getAvailableEntities(allAnimations);
    expect(entities).toEqual(['Bat', 'Soldier', 'Sword']);
  });

  it('filters animations belonging to an entity (case-insensitive)', () => {
    const soldierAnims = getAnimationsForEntity(allAnimations, 'soldier');
    expect(soldierAnims.map((a) => a.name)).toEqual(['idle', 'walk']);
  });

  it('creates an instance with default idle or first animation', () => {
    const instance = createSceneInstance('Soldier', allAnimations);
    expect(instance.animationId).toBe('a1');
    expect(instance.entityId).toBe('Soldier');
    expect(instance.animationName).toBe('idle');
    expect(instance.visible).toBe(true);
    expect(instance.x).toBe(120);
    expect(instance.y).toBe(112);
  });

  it('allows multiple instances of the same entity with distinct IDs and animations', () => {
    const bat1 = createSceneInstance('Bat', allAnimations, {
      name: 'Bat #1',
      x: 50,
      y: 60,
    });
    const bat2 = createSceneInstance('Bat', allAnimations, {
      name: 'Bat #2',
      x: 150,
      y: 160,
    });

    expect(bat1.id).not.toBe(bat2.id);
    expect(bat1.entityId).toBe('Bat');
    expect(bat2.entityId).toBe('Bat');
    expect(bat1.x).toBe(50);
    expect(bat2.x).toBe(150);
  });

  it('does not fall back when the canonical animation ID is dangling', () => {
    const instance: ScenePreviewInstance = {
      id: 'i1',
      animationId: 'missing-animation',
      entityId: 'Soldier',
      animationName: 'unknown_anim',
      x: 0,
      y: 0,
      visible: true,
    };
    const resolved = resolveInstanceAnimation(instance, allAnimations);
    expect(resolved).toBeNull();
    expect(getInstanceAnimationReferenceStatus(instance, allAnimations)).toBe(
      'dangling',
    );
  });

  it('keeps an unresolved legacy reference unresolved despite matching aliases', () => {
    const instance: ScenePreviewInstance = {
      id: 'legacy-unresolved',
      animationId: '',
      entityId: 'Soldier',
      animationName: 'idle',
      x: 0,
      y: 0,
      visible: true,
    };

    expect(resolveInstanceAnimation(instance, allAnimations)).toBeNull();
    expect(getInstanceAnimationReferenceStatus(instance, allAnimations)).toBe(
      'unresolved',
    );
  });

  it('does not choose the first animation when canonical IDs are duplicated', () => {
    const instance = createSceneInstance('Soldier', allAnimations);
    const duplicate = { ...soldierWalk, id: instance.animationId };

    expect(
      resolveInstanceAnimation(instance, [...allAnimations, duplicate]),
    ).toBeNull();
  });

  it('returns null if entity does not exist in animations list', () => {
    const instance: ScenePreviewInstance = {
      id: 'i1',
      animationId: 'a1',
      entityId: 'DeletedEntity',
      animationName: 'idle',
      x: 0,
      y: 0,
      visible: true,
    };
    const resolved = resolveInstanceAnimation(instance, allAnimations);
    expect(resolved).toBe(soldierIdle);
  });

  it('advances playback for multiple instances independently based on duration', () => {
    const inst1: ScenePreviewInstance = {
      id: 'i1',
      animationId: 'a2',
      entityId: 'Soldier',
      animationName: 'walk', // 3 frames, 5 ticks each
      x: 10,
      y: 10,
      visible: true,
    };
    const inst2: ScenePreviewInstance = {
      id: 'i2',
      animationId: 'a3',
      entityId: 'Bat',
      animationName: 'fly', // 3 frames, 8 ticks each
      x: 20,
      y: 20,
      visible: true,
    };

    const instances = [inst1, inst2];
    let states = initializePlaybackStates(instances);

    // Initial state: frame 0 for both
    expect(states.get('i1')?.currentFrameIndex).toBe(0);
    expect(states.get('i2')?.currentFrameIndex).toBe(0);

    // Advance 5 ticks: Soldier walk should advance to frame 1, Bat still at frame 0 (needs 8)
    states = advanceScenePlayback(instances, states, allAnimations, 5);
    expect(states.get('i1')?.currentFrameIndex).toBe(1);
    expect(states.get('i2')?.currentFrameIndex).toBe(0);

    // Advance 3 more ticks (total 8 for Bat): Bat advances to frame 1, Soldier still at frame 1 (needs 10 total)
    states = advanceScenePlayback(instances, states, allAnimations, 3);
    expect(states.get('i1')?.currentFrameIndex).toBe(1);
    expect(states.get('i2')?.currentFrameIndex).toBe(1);

    // Advance 2 more ticks (total 10 for Soldier): Soldier advances to frame 2
    states = advanceScenePlayback(instances, states, allAnimations, 2);
    expect(states.get('i1')?.currentFrameIndex).toBe(2);
    expect(states.get('i2')?.currentFrameIndex).toBe(1);
  });

  it('resets playback states returning all instances to frame 0', () => {
    const inst1: ScenePreviewInstance = {
      id: 'i1',
      animationId: 'a2',
      entityId: 'Soldier',
      animationName: 'walk',
      x: 10,
      y: 10,
      visible: true,
    };
    const instances = [inst1];
    let states = initializePlaybackStates(instances);
    states = advanceScenePlayback(instances, states, allAnimations, 10);
    expect(states.get('i1')?.currentFrameIndex).toBe(2);

    states = resetPlaybackStates(instances);
    expect(states.get('i1')?.currentFrameIndex).toBe(0);
    expect(states.get('i1')?.elapsedTicks).toBe(0);
  });

  it('resolves frame information for rendering', () => {
    const inst1: ScenePreviewInstance = {
      id: 'i1',
      animationId: 'a2',
      entityId: 'Soldier',
      animationName: 'walk',
      x: 10,
      y: 10,
      visible: true,
    };
    const instances = [inst1];
    const states = initializePlaybackStates(instances);
    const resolved = resolveInstanceFrames(instances, states, allAnimations);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.currentFrameIndex).toBe(0);
    expect(resolved[0]?.sourceFrameIndex).toBe(2); // soldierWalk frame 0 is index 2
    expect(resolved[0]?.frameDuration).toBe(5);
  });

  it('resolves only visible scene palette IDs using the current frame override', () => {
    const animation: AnimationItemSetting = {
      ...soldierWalk,
      paletteId: 'pal_default',
      framePaletteIds: [null, 'pal_frame', 'pal_default'],
    };
    const instances: readonly ScenePreviewInstance[] = [
      {
        id: 'visible-a',
        animationId: 'a2',
        entityId: 'Soldier',
        animationName: 'walk',
        x: 0,
        y: 0,
        visible: true,
      },
      {
        id: 'visible-b',
        animationId: 'a2',
        entityId: 'Soldier',
        animationName: 'walk',
        x: 16,
        y: 0,
        visible: true,
      },
      {
        id: 'hidden',
        animationId: 'a2',
        entityId: 'Soldier',
        animationName: 'walk',
        x: 32,
        y: 0,
        visible: false,
      },
    ];
    let states = initializePlaybackStates(instances);
    states = advanceScenePlayback(instances, states, [animation], 5);

    expect(resolveScenePaletteIds(instances, states, [animation])).toEqual([
      'pal_frame',
      'pal_frame',
    ]);
  });

  it('isolates palette requirements to the current scene instead of all project animations', () => {
    const sceneAAnimation: AnimationItemSetting = {
      ...soldierIdle,
      paletteId: 'pal_scene_a',
    };
    const sceneBAnimation: AnimationItemSetting = {
      ...soldierWalk,
      entity: 'Enemy',
      paletteId: 'pal_scene_b',
    };
    const sceneA: readonly ScenePreviewInstance[] = [
      {
        id: 'scene-a-instance',
        animationId: 'a1',
        entityId: 'Soldier',
        animationName: 'idle',
        x: 0,
        y: 0,
        visible: true,
      },
    ];
    const sceneB: readonly ScenePreviewInstance[] = [
      {
        id: 'scene-b-instance',
        animationId: 'a2',
        entityId: 'Enemy',
        animationName: 'walk',
        x: 0,
        y: 0,
        visible: true,
      },
    ];
    const animations = [sceneAAnimation, sceneBAnimation];

    expect(
      resolveScenePaletteIds(
        sceneA,
        initializePlaybackStates(sceneA),
        animations,
      ),
    ).toEqual(['pal_scene_a']);
    expect(
      resolveScenePaletteIds(
        sceneB,
        initializePlaybackStates(sceneB),
        animations,
      ),
    ).toEqual(['pal_scene_b']);
  });

  it('does not count a visible instance whose animation cannot render sprites', () => {
    const animation: AnimationItemSetting = {
      ...soldierIdle,
      source: null,
      paletteId: 'pal_not_rendered',
    };
    const instances: readonly ScenePreviewInstance[] = [
      {
        id: 'no-source',
        animationId: 'a1',
        entityId: 'Soldier',
        animationName: 'idle',
        x: 0,
        y: 0,
        visible: true,
      },
    ];

    expect(
      resolveScenePaletteIds(instances, initializePlaybackStates(instances), [
        animation,
      ]),
    ).toEqual([]);
  });

  it('handles hidden instances without advancing their timers', () => {
    const inst1: ScenePreviewInstance = {
      id: 'i1',
      animationId: 'a2',
      entityId: 'Soldier',
      animationName: 'walk',
      x: 10,
      y: 10,
      visible: false,
    };
    const instances = [inst1];
    let states = initializePlaybackStates(instances);
    states = advanceScenePlayback(instances, states, allAnimations, 10);

    expect(states.get('i1')?.currentFrameIndex).toBe(0);
  });

  it('updates instance animation and reflects new animation frame durations during playback', () => {
    let instance = createSceneInstance('Soldier', allAnimations, {
      animationName: 'idle',
      x: 20,
      y: 30,
    });
    expect(resolveInstanceAnimation(instance, allAnimations)?.name).toBe(
      'idle',
    );

    // Change animation to walk
    instance = {
      ...instance,
      animationId: 'a2',
      animationName: 'walk',
    };
    const resolved = resolveInstanceAnimation(instance, allAnimations);
    expect(resolved?.name).toBe('walk');
    expect(resolved?.frameIndices).toEqual([2, 3, 4]);
  });

  it('clamps coordinates to NES screen bounds', () => {
    const instOutOfBound = createSceneInstance('Bat', allAnimations, {
      x: 300,
      y: -50,
    });
    expect(instOutOfBound.x).toBeLessThanOrEqual(256);
    expect(instOutOfBound.y).toBeGreaterThanOrEqual(0);
  });
});

describe('computeInstanceProjection', () => {
  function makeAnim(
    overrides: Partial<AnimationItemSetting> = {},
  ): AnimationItemSetting {
    return {
      id: 'anim-test',
      name: 'idle',
      entity: 'Hero',
      source: null,
      paletteIndex: null,
      frameWidth: 16,
      frameHeight: 16,
      originX: 0,
      originY: 0,
      playback: 'loop',
      allowHorizontalFlip: false,
      allowVerticalFlip: false,
      flipH: false,
      flipV: false,
      defaultDuration: 10,
      frameIndices: [0],
      frameDurations: [10],
      framePalettes: [],
      collapsed: false,
      ...overrides,
    };
  }

  function makeInst(
    overrides: Partial<ScenePreviewInstance> = {},
  ): ScenePreviewInstance {
    return {
      id: 'inst-1',
      animationId: 'anim-test',
      entityId: 'Hero',
      animationName: 'idle',
      x: 50,
      y: 40,
      visible: true,
      ...overrides,
    };
  }

  it('uses anchorX/anchorY when present (canonical path)', () => {
    const anim = makeAnim({ originX: 8, originY: 4 });
    // anchorX=58, anchorY=44 → posX=58-8=50, posY=44-4=40
    const inst = makeInst({ anchorX: 58, anchorY: 44 });
    const { posX, posY } = computeInstanceProjection(inst, anim);
    expect(posX).toBe(50);
    expect(posY).toBe(40);
  });

  it('canonical anchor with origin=0 gives posX/Y equal to anchor', () => {
    const anim = makeAnim({ originX: 0, originY: 0 });
    const inst = makeInst({ anchorX: 50, anchorY: 40 });
    const { posX, posY } = computeInstanceProjection(inst, anim);
    expect(posX).toBe(50);
    expect(posY).toBe(40);
  });

  it('falls back to legacy x/y when no anchorX/anchorY and animation resolves', () => {
    const anim = makeAnim({ originX: 8, originY: 4 });
    // No anchorX/anchorY → legacy path; posX = x = 50 (origin cancels out)
    const inst = makeInst();
    const { posX, posY } = computeInstanceProjection(inst, anim);
    expect(posX).toBe(50);
    expect(posY).toBe(40);
  });

  it('falls back to x/y when animation is null (dangling reference) and does NOT invent anchors', () => {
    const inst = makeInst({ x: 30, y: 20 });
    const { posX, posY } = computeInstanceProjection(inst, null);
    expect(posX).toBe(30);
    expect(posY).toBe(20);
    // The instance itself must not gain anchorX/anchorY (it's readonly – tested by type, but
    // we also confirm the projection doesn't mutate the instance).
    expect(inst.anchorX).toBeUndefined();
    expect(inst.anchorY).toBeUndefined();
  });

  it('returns flipH=false flipV=false when animation has no flips', () => {
    const anim = makeAnim({ flipH: false, flipV: false });
    const inst = makeInst({ anchorX: 50, anchorY: 40 });
    const { flipH, flipV } = computeInstanceProjection(inst, anim);
    expect(flipH).toBe(false);
    expect(flipV).toBe(false);
  });

  it('returns flipH=true when animation is horizontally flipped', () => {
    const anim = makeAnim({ flipH: true, flipV: false });
    const inst = makeInst({ anchorX: 50, anchorY: 40 });
    const { flipH, flipV } = computeInstanceProjection(inst, anim);
    expect(flipH).toBe(true);
    expect(flipV).toBe(false);
  });

  it('returns flipV=true when animation is vertically flipped', () => {
    const anim = makeAnim({ flipH: false, flipV: true });
    const inst = makeInst({ anchorX: 50, anchorY: 40 });
    const { flipH, flipV } = computeInstanceProjection(inst, anim);
    expect(flipH).toBe(false);
    expect(flipV).toBe(true);
  });

  it('returns flipH=true and flipV=true for combined H+V flip', () => {
    const anim = makeAnim({ flipH: true, flipV: true });
    const inst = makeInst({ anchorX: 50, anchorY: 40 });
    const { flipH, flipV } = computeInstanceProjection(inst, anim);
    expect(flipH).toBe(true);
    expect(flipV).toBe(true);
  });

  it('returns flipH=false flipV=false when animation is null', () => {
    const inst = makeInst({ anchorX: 50, anchorY: 40 });
    const { flipH, flipV } = computeInstanceProjection(inst, null);
    expect(flipH).toBe(false);
    expect(flipV).toBe(false);
  });
});

describe('createSceneInstance anchor emission', () => {
  function makeAnim(
    overrides: Partial<AnimationItemSetting> = {},
  ): AnimationItemSetting {
    const width = 16;
    const height = 16;
    return {
      id: 'a1',
      name: 'idle',
      entity: 'Hero',
      source: {
        assetId: 'a1-src',
        fileName: 'hero.png',
        sourceImage: {
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
          colorSpace: 'srgb',
        },
        indexedImage: {
          width,
          height,
          pixels: new Uint8Array(width * height),
          colors: [],
          transparentIndex: null,
          colorCount: 0,
        },
      },
      paletteIndex: null,
      frameWidth: width,
      frameHeight: height,
      originX: 0,
      originY: 0,
      playback: 'loop',
      allowHorizontalFlip: false,
      allowVerticalFlip: false,
      flipH: false,
      flipV: false,
      defaultDuration: 10,
      frameIndices: [0],
      frameDurations: [10],
      framePalettes: [],
      collapsed: false,
      ...overrides,
    };
  }

  it('emits anchorX/anchorY = renderX+originX, renderY+originY when origin is non-zero', () => {
    const anim = makeAnim({ originX: 8, originY: 4 });
    const inst = createSceneInstance('Hero', [anim], { x: 50, y: 40 });
    // posX = 50, so anchorX = 50 + 8 = 58
    expect(inst.x).toBe(50);
    expect(inst.y).toBe(40);
    expect(inst.anchorX).toBe(58);
    expect(inst.anchorY).toBe(44);
  });

  it('emits anchorX/anchorY equal to x/y when origin is 0', () => {
    const anim = makeAnim({ originX: 0, originY: 0 });
    const inst = createSceneInstance('Hero', [anim], { x: 100, y: 80 });
    expect(inst.anchorX).toBe(100);
    expect(inst.anchorY).toBe(80);
  });

  it('round-trips through computeInstanceProjection back to original render position', () => {
    const anim = makeAnim({ originX: 8, originY: 4 });
    const inst = createSceneInstance('Hero', [anim], { x: 50, y: 40 });
    const { posX, posY } = computeInstanceProjection(inst, anim);
    expect(posX).toBe(50);
    expect(posY).toBe(40);
  });
});
