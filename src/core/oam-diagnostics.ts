import { t } from '../i18n';
import type {
  AnimationFrameModel,
  AnimationProjectModel,
} from './animation-model';

/** NES OAM stores 64 four-byte sprite entries. */
export const NES_OAM_ENTRY_CAPACITY = 64;
/** More than 32 entries is a useful pressure signal, not a hardware limit. */
export const NES_OAM_PRESSURE_THRESHOLD = 32;

export type OamCapacityDiagnosticKind =
  'oam-capacity-pressure' | 'oam-capacity-exceeded';

export interface OamCapacityDiagnosticFact {
  readonly id: string;
  readonly code: OamCapacityDiagnosticKind;
  readonly kind: OamCapacityDiagnosticKind;
  readonly severity: 'warning' | 'error';
  readonly animationId: string;
  readonly animationName: string;
  readonly frameIndex: number;
  readonly sourceFrameIndex: number;
  readonly spriteCount: number;
}

/** Count generated metasprite tiles, each of which occupies one OAM entry. */
export function countOamEntriesForFrame(frame: AnimationFrameModel): number {
  return frame.sprites.length;
}

/** Analyze every generated animation frame without mutating model state. */
export function analyzeAnimationOamCapacity(
  model: AnimationProjectModel,
): readonly OamCapacityDiagnosticFact[] {
  const facts: OamCapacityDiagnosticFact[] = [];

  model.animations.forEach((animation, animationIndex) => {
    // Export-generated mirror variants share the canonical animation identity
    // and sprite count. Reporting both would duplicate one editable problem.
    if (animation.generatedByHorizontalFlip === true) return;

    animation.frames.forEach((frame, frameIndex) => {
      const spriteCount = countOamEntriesForFrame(frame);
      const kind: OamCapacityDiagnosticKind | null =
        spriteCount > NES_OAM_ENTRY_CAPACITY
          ? 'oam-capacity-exceeded'
          : spriteCount > NES_OAM_PRESSURE_THRESHOLD
            ? 'oam-capacity-pressure'
            : null;
      if (kind === null) return;

      facts.push({
        id: `oam:${animation.id ?? animation.name}:${String(animationIndex)}:${String(frameIndex)}`,
        code: kind,
        kind,
        severity: kind === 'oam-capacity-exceeded' ? 'error' : 'warning',
        animationId: animation.id ?? animation.name,
        animationName: animation.name,
        frameIndex,
        sourceFrameIndex: frame.sourceIndex,
        spriteCount,
      });
    });
  });

  return facts;
}

export function formatOamCapacityDiagnosticMessage(
  fact: OamCapacityDiagnosticFact,
): string {
  return t(
    fact.kind === 'oam-capacity-exceeded'
      ? 'oamCapacityExceeded'
      : 'oamCapacityPressure',
    {
      animation: fact.animationName,
      frame: fact.frameIndex + 1,
      sprites: fact.spriteCount,
    },
  );
}
