import type { AnimationItemSetting } from '../ui/types';

export interface ScenePreviewInstance {
  readonly id: string;
  /** Canonical animation identity. Empty marks an unresolved reference. */
  readonly animationId: string;
  /** Backward-compatible display alias. */
  readonly entityId: string;
  /** Backward-compatible display alias. */
  readonly animationName: string;
  readonly x: number;
  readonly y: number;
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

  return {
    id: generateInstanceId(),
    animationId: selectedAnim?.id ?? '',
    entityId,
    animationName: selectedAnim?.name ?? 'anim_1',
    x: Math.max(0, Math.min(NES_SCREEN_WIDTH, defaultX)),
    y: Math.max(0, Math.min(NES_SCREEN_HEIGHT, defaultY)),
    visible: true,
    name: options?.name ?? `${entityId} #${String(instanceCounter)}`,
  };
}

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
