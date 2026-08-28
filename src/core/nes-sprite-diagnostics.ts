import { t } from '../i18n';
import type { AnimationProjectModel, MetaspriteTile } from './animation-model';

/** Current Studio metasprites use the NES 8 x 8 sprite mode. */
export const NES_SPRITE_HEIGHT_PIXELS = 8;
/** The NES PPU can select at most eight sprites for one scanline. */
export const NES_SPRITES_PER_SCANLINE_LIMIT = 8;
/** Six concurrent sprites leave little scanline capacity for other objects. */
export const NES_SPRITE_SCANLINE_WARNING_THRESHOLD = 6;

export type SpriteScanlinePressureDiagnosticKind =
  'sprite-scanline-pressure' | 'sprite-scanline-limit-exceeded';

/** Minimal frame-local geometry needed for deterministic scanline analysis. */
export interface MetaspriteScanlineSprite {
  /** Top pixel row relative to the frame's top edge. */
  readonly y: number;
}

export interface SpriteScanlinePressureFact {
  readonly id: string;
  readonly code: SpriteScanlinePressureDiagnosticKind;
  readonly kind: SpriteScanlinePressureDiagnosticKind;
  readonly severity: 'warning' | 'error';
  readonly scanline: number;
  readonly spriteCount: number;
  readonly limit: typeof NES_SPRITES_PER_SCANLINE_LIMIT;
}

export interface AnimationSpriteScanlinePressureFact extends SpriteScanlinePressureFact {
  readonly animationId: string;
  readonly animationName: string;
  readonly frameIndex: number;
  readonly sourceFrameIndex: number;
}

/**
 * Analyze visible 8 x 8 sprites in frame-local coordinates.
 *
 * Each sprite intersects the half-open vertical interval [y, y + 8). Rows
 * outside [0, frameHeight) are clipped, so fully offscreen sprites contribute
 * nothing while partially clipped sprites contribute only to visible rows.
 */
export function analyzeMetaspriteScanlinePressure(
  sprites: readonly MetaspriteScanlineSprite[],
  frameHeight: number,
): readonly SpriteScanlinePressureFact[] {
  if (!Number.isFinite(frameHeight) || frameHeight <= 0) return [];

  const visibleHeight = Math.floor(frameHeight);
  const counts = new Uint32Array(visibleHeight);

  for (const sprite of sprites) {
    if (!Number.isFinite(sprite.y)) continue;

    const spriteTop = Math.trunc(sprite.y);
    const start = Math.max(0, spriteTop);
    const end = Math.min(visibleHeight, spriteTop + NES_SPRITE_HEIGHT_PIXELS);
    for (let scanline = start; scanline < end; scanline += 1) {
      counts[scanline] = (counts[scanline] ?? 0) + 1;
    }
  }

  const facts: SpriteScanlinePressureFact[] = [];
  counts.forEach((spriteCount, scanline) => {
    if (spriteCount < NES_SPRITE_SCANLINE_WARNING_THRESHOLD) return;

    const kind: SpriteScanlinePressureDiagnosticKind =
      spriteCount > NES_SPRITES_PER_SCANLINE_LIMIT
        ? 'sprite-scanline-limit-exceeded'
        : 'sprite-scanline-pressure';
    facts.push({
      id: `sprite-scanline:${String(scanline)}`,
      code: kind,
      kind,
      severity: kind === 'sprite-scanline-limit-exceeded' ? 'error' : 'warning',
      scanline,
      spriteCount,
      limit: NES_SPRITES_PER_SCANLINE_LIMIT,
    });
  });

  return facts;
}

/** Analyze every canonical animation frame without mutating project state. */
export function analyzeAnimationSpriteScanlinePressure(
  model: AnimationProjectModel,
): readonly AnimationSpriteScanlinePressureFact[] {
  const facts: AnimationSpriteScanlinePressureFact[] = [];

  model.animations.forEach((animation, animationIndex) => {
    animation.frames.forEach((frame, frameIndex) => {
      // Metasprite coordinates are origin-relative. Convert them back to the
      // frame-local coordinate space expected by the clipping analyzer.
      const frameLocalSprites: readonly MetaspriteScanlineSprite[] =
        frame.sprites.map((sprite: MetaspriteTile) => ({
          y: sprite.y + animation.originY,
        }));
      const animationId = animation.id ?? animation.name;

      const scanlineFacts = analyzeMetaspriteScanlinePressure(
        frameLocalSprites,
        frame.height,
      );
      const peakFact = scanlineFacts.reduce<
        SpriteScanlinePressureFact | undefined
      >(
        (peak, fact) =>
          peak === undefined || fact.spriteCount > peak.spriteCount
            ? fact
            : peak,
        undefined,
      );

      if (peakFact !== undefined) {
        facts.push({
          ...peakFact,
          id: `sprite-scanline:${animationId}:${String(animationIndex)}:${String(frameIndex)}:${String(peakFact.scanline)}`,
          animationId,
          animationName: animation.name,
          frameIndex,
          sourceFrameIndex: frame.sourceIndex,
        });
      }
    });
  });

  return facts;
}

export function formatSpriteScanlinePressureDiagnosticMessage(
  fact: AnimationSpriteScanlinePressureFact,
): string {
  return t(
    fact.kind === 'sprite-scanline-limit-exceeded'
      ? 'spriteScanlineLimitExceeded'
      : 'spriteScanlinePressure',
    {
      animation: fact.animationName,
      frame: fact.frameIndex + 1,
      scanline: fact.scanline,
      sprites: fact.spriteCount,
    },
  );
}
