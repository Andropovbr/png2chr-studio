import type { AnimationItemSetting } from '../ui/types';

export interface ScenePreviewInstance {
  readonly id: string;
  /** Canonical animation identity. Empty marks an unresolved reference. */
  readonly animationId: string;
  /** Backward-compatible display alias. */
  readonly entityId: string;
  /** Backward-compatible display alias. */
  readonly animationName: string;
  readonly x: number; // legacy position (deprecated)
  readonly y: number; // legacy position (deprecated)
  readonly anchorX?: number; // canonical anchor position
  readonly anchorY?: number; // canonical anchor position
  readonly visible: boolean;
  readonly name?: string;
}

export interface ProjectScenePreviewConfig {
  readonly instances: readonly ScenePreviewInstance[];
}

export interface InstancePlaybackState {
  readonly instanceId: string;
  readonly currentFrameIndex: number;
  readonly elapsedTicks: number;
}

export interface ResolvedInstanceFrame {
  readonly instance: ScenePreviewInstance;
  readonly animation: AnimationItemSetting | null;
  readonly currentFrameIndex: number;
  readonly sourceFrameIndex: number;
  readonly frameDuration: number;
}

export type InstanceAnimationReferenceStatus =
  'resolved' | 'unresolved' | 'dangling';

export const NES_SCREEN_WIDTH = 256;
export const NES_SCREEN_HEIGHT = 240;

let instanceCounter = 0;

export function generateInstanceId(): string {
  instanceCounter += 1;
  return `inst_${String(Date.now())}_${String(instanceCounter)}`;
}

export function createDefaultScenePreviewConfig(): ProjectScenePreviewConfig {
  return {
    instances: [],
  };
}

export function getAvailableEntities(
  animations: readonly AnimationItemSetting[],
): readonly string[] {
  const entitySet = new Set<string>();
  for (const anim of animations) {
    const name =
      anim.entity?.trim() !== '' && anim.entity ? anim.entity.trim() : 'entity';
    entitySet.add(name);
  }
  return Array.from(entitySet).sort();
}

export function getAnimationsForEntity(
  animations: readonly AnimationItemSetting[],
  entityId: string,
): readonly AnimationItemSetting[] {
  const target = entityId.trim().toLowerCase();
  return animations.filter((a) => {
    const name =
      a.entity?.trim() !== '' && a.entity ? a.entity.trim() : 'entity';
    return name.toLowerCase() === target;
  });
}

export function createSceneInstance(
  entityId: string,
  animations: readonly AnimationItemSetting[],
  options?: {
    x?: number;
    y?: number;
    name?: string;
    animationName?: string;
  },
): ScenePreviewInstance {
  const entityAnims = getAnimationsForEntity(animations, entityId);
  const selectedAnim =
    (options?.animationName
      ? entityAnims.find((a) => a.name === options.animationName)
      : null) ??
    entityAnims.find((a) => a.name.toLowerCase().includes('idle')) ??
    entityAnims[0];

  const defaultX = options?.x ?? Math.floor(NES_SCREEN_WIDTH / 2 - 8);
  const defaultY = options?.y ?? Math.floor(NES_SCREEN_HEIGHT / 2 - 8);
  const clampedX = Math.max(0, Math.min(NES_SCREEN_WIDTH, defaultX));
  const clampedY = Math.max(0, Math.min(NES_SCREEN_HEIGHT, defaultY));

  // Compute canonical anchor from the resolved animation's origin.
  // anchorX = renderX + originX  (so posX = anchorX - originX round-trips cleanly).
  const originX = selectedAnim?.originX ?? 0;
  const originY = selectedAnim?.originY ?? 0;
  const anchorX = clampedX + originX;
  const anchorY = clampedY + originY;

  return {
    id: generateInstanceId(),
    animationId: selectedAnim?.id ?? '',
    entityId,
    animationName: selectedAnim?.name ?? 'anim_1',
    x: clampedX,
    y: clampedY,
    anchorX,
    anchorY,
    visible: true,
    name: options?.name ?? `${entityId} #${String(instanceCounter)}`,
  };
}

export function computeInstanceProjection(
  instance: ScenePreviewInstance,
  animation: AnimationItemSetting | null,
): { posX: number; posY: number; flipH: boolean; flipV: boolean } {
  // Single source of truth for render position, anchor/origin semantics and flips.
  //
  // Canonical path: anchorX/anchorY are stored on the instance.
  //   posX = anchorX - originX;  posY = anchorY - originY.
  //
  // Legacy path (no anchorX/anchorY on instance): instance.x/y IS the render
  // position. When the animation resolves unambiguously the legacy render
  // position is used directly (round-trips as anchorX=x+originX then
  // posX=anchorX-originX=x). When animation is null, origin is unknown so
  // we use x/y directly and do NOT invent anchor coordinates.
  const originX = animation?.originX ?? 0;
  const originY = animation?.originY ?? 0;

  let posX: number;
  let posY: number;

  if (instance.anchorX !== undefined && instance.anchorY !== undefined) {
    // Canonical anchor path.
    posX = instance.anchorX - originX;
    posY = instance.anchorY - originY;
  } else {
    // Legacy path: x/y is the render position. Origin doesn't change the result
    // because anchorX would be x+originX, so posX = (x+originX) - originX = x.
    // Dangling (animation===null) also falls here – no anchor invented.
    posX = instance.x;
    posY = instance.y;
  }

  const flipH = !!animation?.flipH;
  const flipV = !!animation?.flipV;

  return { posX, posY, flipH, flipV };
}

export function reorderSceneInstances(
  instances: readonly ScenePreviewInstance[],
  instanceId: string,
  direction: 'forward' | 'backward',
): readonly ScenePreviewInstance[] {
  const currentIndex = instances.findIndex(
    (instance) => instance.id === instanceId,
  );
  const targetIndex =
    direction === 'forward' ? currentIndex + 1 : currentIndex - 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= instances.length) {
    return instances;
  }

  const reordered = [...instances];
  const [instance] = reordered.splice(currentIndex, 1);
  if (instance === undefined) return instances;
  reordered.splice(targetIndex, 0, instance);
  return reordered;
}

/**
 * Resolves the AnimationItemSetting for a given scene instance.
 * Matches on entity (case-insensitive) and animation name.
 * Falls back to the first animation for the entity when the named animation is
 * not found. Returns null when the entity has no animations at all.
 */
export function resolveInstanceAnimation(
  instance: ScenePreviewInstance,
  animations: readonly AnimationItemSetting[],
): AnimationItemSetting | null {
  if (instance.animationId === '') return null;
  const matches = animations.filter(
    (animation) => animation.id === instance.animationId,
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function getInstanceAnimationReferenceStatus(
  instance: ScenePreviewInstance,
  animations: readonly AnimationItemSetting[],
): InstanceAnimationReferenceStatus {
  if (instance.animationId === '') return 'unresolved';
  return resolveInstanceAnimation(instance, animations) === null
    ? 'dangling'
    : 'resolved';
}

export function initializePlaybackStates(
  instances: readonly ScenePreviewInstance[],
): Map<string, InstancePlaybackState> {
  const map = new Map<string, InstancePlaybackState>();
  for (const inst of instances) {
    map.set(inst.id, {
      instanceId: inst.id,
      currentFrameIndex: 0,
      elapsedTicks: 0,
    });
  }
  return map;
}

export function resetPlaybackStates(
  instances: readonly ScenePreviewInstance[],
): Map<string, InstancePlaybackState> {
  return initializePlaybackStates(instances);
}

export function advanceScenePlayback(
  instances: readonly ScenePreviewInstance[],
  playbackStates: Map<string, InstancePlaybackState>,
  animations: readonly AnimationItemSetting[],
  ticksToAdvance = 1,
): Map<string, InstancePlaybackState> {
  const nextStates = new Map<string, InstancePlaybackState>(playbackStates);

  for (const inst of instances) {
    if (!inst.visible) continue;

    const anim = resolveInstanceAnimation(inst, animations);
    if (!anim || anim.frameIndices.length === 0) continue;

    const currentPlayback = nextStates.get(inst.id) ?? {
      instanceId: inst.id,
      currentFrameIndex: 0,
      elapsedTicks: 0,
    };

    let { currentFrameIndex, elapsedTicks } = currentPlayback;
    elapsedTicks += ticksToAdvance;

    const totalFrames = anim.frameIndices.length;
    if (totalFrames <= 0) continue;

    if (currentFrameIndex >= totalFrames) {
      currentFrameIndex = 0;
    }

    const currentDuration =
      anim.frameDurations[currentFrameIndex] ?? anim.defaultDuration;

    while (elapsedTicks >= Math.max(1, currentDuration)) {
      elapsedTicks -= Math.max(1, currentDuration);
      if (anim.playback === 'once' && currentFrameIndex >= totalFrames - 1) {
        currentFrameIndex = totalFrames - 1;
        break;
      }
      currentFrameIndex = (currentFrameIndex + 1) % totalFrames;
    }

    nextStates.set(inst.id, {
      instanceId: inst.id,
      currentFrameIndex,
      elapsedTicks,
    });
  }

  return nextStates;
}

export function resolveInstanceFrames(
  instances: readonly ScenePreviewInstance[],
  playbackStates: Map<string, InstancePlaybackState>,
  animations: readonly AnimationItemSetting[],
): readonly ResolvedInstanceFrame[] {
  return instances.map((inst) => {
    const anim = resolveInstanceAnimation(inst, animations);
    const playback = playbackStates.get(inst.id) ?? {
      instanceId: inst.id,
      currentFrameIndex: 0,
      elapsedTicks: 0,
    };

    if (!anim || anim.frameIndices.length === 0) {
      return {
        instance: inst,
        animation: anim,
        currentFrameIndex: 0,
        sourceFrameIndex: 0,
        frameDuration: 12,
      };
    }

    const safeIndex =
      playback.currentFrameIndex < anim.frameIndices.length
        ? playback.currentFrameIndex
        : 0;

    const sourceFrameIndex = anim.frameIndices[safeIndex] ?? 0;
    const frameDuration =
      anim.frameDurations[safeIndex] ?? anim.defaultDuration;

    return {
      instance: inst,
      animation: anim,
      currentFrameIndex: safeIndex,
      sourceFrameIndex,
      frameDuration,
    };
  });
}

/**
 * Resolves the logical sprite palette required by each visible scene instance
 * at its current playback frame. Frame overrides take precedence over the
 * animation default; duplicate IDs are intentionally left for the palette
 * analyzer to deduplicate.
 */
export function resolveScenePaletteIds(
  instances: readonly ScenePreviewInstance[],
  playbackStates: Map<string, InstancePlaybackState>,
  animations: readonly AnimationItemSetting[],
): readonly string[] {
  const paletteIds: string[] = [];

  for (const resolved of resolveInstanceFrames(
    instances,
    playbackStates,
    animations,
  )) {
    if (!resolved.instance.visible) {
      continue;
    }
    const animation = resolved.animation;
    if (animation === null) {
      continue;
    }
    if (animation.source === null || animation.frameIndices.length === 0) {
      continue;
    }
    const paletteId =
      animation.framePaletteIds?.[resolved.currentFrameIndex] ??
      animation.paletteId;
    if (paletteId?.trim()) paletteIds.push(paletteId);
  }

  return paletteIds;
}
