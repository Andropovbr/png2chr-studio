import { t } from '../i18n';
import type {
  AnimationModel,
  AnimationProjectModel,
  MetaspriteTile,
} from './animation-model';
import type { ScenePreviewInstance } from './scene-preview';

/** Current Studio metasprites use the NES 8 x 8 sprite mode. */
export const NES_SPRITE_WIDTH_PIXELS = 8;
export const NES_SPRITE_HEIGHT_PIXELS = 8;
/** The NES PPU can select at most eight sprites for one scanline. */
export const NES_SPRITES_PER_SCANLINE_LIMIT = 8;
/** Six concurrent sprites leave little scanline capacity for other objects. */
export const NES_SPRITE_SCANLINE_WARNING_THRESHOLD = 6;
/** One hardware OAM coordinate byte represents values from 0 through 255. */
export const NES_SPRITE_COORDINATE_MAX = 0xff;
/** Visible NES picture dimensions used by Scene Preview. */
export const NES_VISIBLE_SCREEN_WIDTH = 256;
export const NES_VISIBLE_SCREEN_HEIGHT = 240;

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

export type SceneInstanceVisibilityDiagnosticKind =
  'all-sprites-offscreen' | 'coordinate-wraps';

export interface SceneSpriteBoundingRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WrappedSpriteCoordinate {
  readonly spriteIndex: number;
  readonly x: number;
  readonly y: number;
  readonly wrappedX: number;
  readonly wrappedY: number;
  readonly wrapsX: boolean;
  readonly wrapsY: boolean;
}

interface SceneInstanceVisibilityFactBase {
  readonly id: string;
  readonly code: SceneInstanceVisibilityDiagnosticKind;
  readonly kind: SceneInstanceVisibilityDiagnosticKind;
  readonly instanceId: string;
  readonly instanceName: string;
  readonly animationId: string;
  readonly animationName: string;
  readonly frameIndex: number;
  readonly sourceFrameIndex: number;
}

export interface AllSpritesOffscreenFact extends SceneInstanceVisibilityFactBase {
  readonly code: 'all-sprites-offscreen';
  readonly kind: 'all-sprites-offscreen';
  readonly severity: 'warning';
  readonly boundingRect: SceneSpriteBoundingRect;
}

export interface CoordinateWrapsFact extends SceneInstanceVisibilityFactBase {
  readonly code: 'coordinate-wraps';
  readonly kind: 'coordinate-wraps';
  readonly severity: 'info';
  /** Consolidated into one fact per instance/frame to avoid duplicate notices. */
  readonly coordinates: readonly WrappedSpriteCoordinate[];
}

export type SceneInstanceVisibilityFact =
  AllSpritesOffscreenFact | CoordinateWrapsFact;

function wrapUnsignedByte(value: number): number {
  return ((value % 256) + 256) % 256;
}

/**
 * Analyze persisted visible Scene instances against every canonical frame.
 *
 * Model sprite offsets are origin-relative. The projection below restores
 * frame-local positions before adding the persisted instance render position.
 * A sprite is visible when its half-open 8 x 8 rectangle intersects the NES
 * picture. Partial edge intersections are valid clipping and never produce an
 * offscreen warning. Unresolved animation references remain owned by the
 * existing reference diagnostics and are intentionally skipped here.
 */
export function analyzeSceneInstanceVisibility(
  instances: readonly ScenePreviewInstance[],
  animations: readonly AnimationModel[],
): readonly SceneInstanceVisibilityFact[] {
  const facts: SceneInstanceVisibilityFact[] = [];

  for (const instance of instances) {
    if (!instance.visible || instance.animationId === '') continue;

    const matches = animations.filter(
      (animation) =>
        animation.id === instance.animationId &&
        animation.generatedByHorizontalFlip !== true,
    );
    if (matches.length !== 1) continue;
    const animation = matches[0];
    if (animation === undefined) continue;

    const hasCanonicalAnchor =
      instance.anchorX !== undefined && instance.anchorY !== undefined;
    const renderX = hasCanonicalAnchor
      ? (instance.anchorX ?? 0) - animation.originX
      : instance.x;
    const renderY = hasCanonicalAnchor
      ? (instance.anchorY ?? 0) - animation.originY
      : instance.y;
    const instanceName = instance.name ?? instance.id;

    animation.frames.forEach((frame, frameIndex) => {
      if (frame.sprites.length === 0) return;

      const absoluteSprites = frame.sprites.map((sprite, spriteIndex) => {
        const x = renderX + sprite.x + animation.originX;
        const y = renderY + sprite.y + animation.originY;
        return { spriteIndex, x, y };
      });
      const left = Math.min(...absoluteSprites.map(({ x }) => x));
      const top = Math.min(...absoluteSprites.map(({ y }) => y));
      const right = Math.max(
        ...absoluteSprites.map(({ x }) => x + NES_SPRITE_WIDTH_PIXELS),
      );
      const bottom = Math.max(
        ...absoluteSprites.map(({ y }) => y + NES_SPRITE_HEIGHT_PIXELS),
      );
      const baseId = `scene-visibility:${instance.id}:${animation.id ?? animation.name}:${String(frameIndex)}`;
      const common = {
        instanceId: instance.id,
        instanceName,
        animationId: animation.id ?? animation.name,
        animationName: animation.name,
        frameIndex,
        sourceFrameIndex: frame.sourceIndex,
      } as const;

      const allSpritesOffscreen = absoluteSprites.every(
        ({ x, y }) =>
          x + NES_SPRITE_WIDTH_PIXELS <= 0 ||
          x >= NES_VISIBLE_SCREEN_WIDTH ||
          y + NES_SPRITE_HEIGHT_PIXELS <= 0 ||
          y >= NES_VISIBLE_SCREEN_HEIGHT,
      );
      if (allSpritesOffscreen) {
        facts.push({
          ...common,
          id: `${baseId}:all-offscreen`,
          code: 'all-sprites-offscreen',
          kind: 'all-sprites-offscreen',
          severity: 'warning',
          boundingRect: {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
          },
        });
      }

      const coordinates = absoluteSprites.flatMap(
        ({ spriteIndex, x, y }): readonly WrappedSpriteCoordinate[] => {
          const wrapsX = x < 0 || x > NES_SPRITE_COORDINATE_MAX;
          const wrapsY = y < 0 || y > NES_SPRITE_COORDINATE_MAX;
          return wrapsX || wrapsY
            ? [
                {
                  spriteIndex,
                  x,
                  y,
                  wrappedX: wrapUnsignedByte(x),
                  wrappedY: wrapUnsignedByte(y),
                  wrapsX,
                  wrapsY,
                },
              ]
            : [];
        },
      );
      if (coordinates.length > 0) {
        facts.push({
          ...common,
          id: `${baseId}:wraps`,
          code: 'coordinate-wraps',
          kind: 'coordinate-wraps',
          severity: 'info',
          coordinates,
        });
      }
    });
  }

  return facts;
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
    // Generated horizontal mirrors preserve vertical geometry and therefore
    // have identical scanline pressure to their canonical editable source.
    if (animation.generatedByHorizontalFlip === true) return;

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

export function formatSceneInstanceVisibilityDiagnosticMessage(
  fact: SceneInstanceVisibilityFact,
): string {
  if (fact.kind === 'all-sprites-offscreen') {
    const { x, y, width, height } = fact.boundingRect;
    return t('sceneAllSpritesOffscreen', {
      instance: fact.instanceName,
      animation: fact.animationName,
      frame: fact.frameIndex + 1,
      x,
      y,
      width,
      height,
    });
  }

  const coordinateSummary = fact.coordinates
    .map((coordinate) => {
      const parts: string[] = [];
      if (coordinate.wrapsX) {
        parts.push(
          `X ${String(coordinate.x)} -> ${String(coordinate.wrappedX)}`,
        );
      }
      if (coordinate.wrapsY) {
        parts.push(
          `Y ${String(coordinate.y)} -> ${String(coordinate.wrappedY)}`,
        );
      }
      return `#${String(coordinate.spriteIndex + 1)} ${parts.join(', ')}`;
    })
    .join('; ');
  return t('sceneSpriteCoordinateWraps', {
    instance: fact.instanceName,
    animation: fact.animationName,
    frame: fact.frameIndex + 1,
    coordinates: coordinateSummary,
  });
}
