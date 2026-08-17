import type { SpritePatternTable } from './chr-pattern-table';
import {
  analyzeScenePalettes,
  resolveSpritePaletteSlot,
  type PaletteDefinition,
} from './palette-manager';
import type { AnimationProjectModel } from './animation-model';
import type {
  ProjectScenePreviewConfig,
  ScenePreviewInstance,
} from './scene-preview';
import type { AnimationItemSetting } from '../ui/types';
import type { NesPaletteSet } from './nes-palette';

export const NES_MAX_SPRITE_PALETTES = 4;
export const NES_MAX_OAM_SPRITES = 64;
export const NES_MAX_SPRITES_PER_SCANLINE = 8;
export const NES_PATTERN_TABLE_CAPACITY = 256;
export const NES_CHR_NEAR_CAPACITY_THRESHOLD = 240;
export const NES_SCREEN_SCANLINES = 240;
export const NES_SCREEN_WIDTH = 256;
export const NES_TILE_SIZE = 8;

export type ValidationSeverity = 'info' | 'warning' | 'error';

export type ValidationScope =
  | 'PROJECT'
  | 'ASSET'
  | 'ENTITY'
  | 'ANIMATION'
  | 'SCENE'
  | 'CHR'
  | 'PALETTE';

export interface ValidationIssue {
  readonly id: string;
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly message: string;
  readonly scope: ValidationScope;
  readonly entityId?: string;
  readonly animationId?: string;
  readonly assetId?: string;
  readonly sceneInstanceId?: string;
  readonly paletteId?: string;
  readonly details?: Record<string, unknown>;
}

export interface ValidationMetrics {
  readonly spritePalettesUsed: number;
  readonly spritePalettesMax: number;
  readonly activeSlotsFilled: number;
  readonly spriteChrTilesUsed: number;
  readonly spriteChrTilesMax: number;
  readonly oamSpritesUsed: number;
  readonly oamSpritesMax: number;
  readonly peakSpritesPerScanline: number;
  readonly maxSpritesPerScanline: number;
  readonly peakScanlineIndex: number | null;
}

export interface ValidationResult {
  readonly issues: readonly ValidationIssue[];
  readonly metrics: ValidationMetrics;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly valid: boolean;
}

export interface ScanlineSpriteCount {
  readonly scanline: number;
  readonly count: number;
}

export interface ScanlineConflictGroup {
  readonly startScanline: number;
  readonly endScanline: number;
  readonly peakCount: number;
  readonly peakScanline: number;
}

export interface NesValidatorInput {
  readonly animations?: readonly AnimationItemSetting[];
  readonly animationModel?: AnimationProjectModel | null;
  readonly scenePreview?: ProjectScenePreviewConfig | null;
  readonly palettes?: readonly PaletteDefinition[];
  readonly activeSpritePaletteSlots?: readonly (string | null)[];
  readonly paletteSet?: NesPaletteSet;
  readonly patternTable?: SpritePatternTable;
  readonly destinationPatternTable?: SpritePatternTable;
  readonly baseChr?: Uint8Array;
}

export function validateSpritePalettes(input: NesValidatorInput): {
  issues: ValidationIssue[];
  palettesUsed: number;
  activeSlotsFilled: number;
} {
  const issues: ValidationIssue[] = [];
  const palettes = input.palettes ?? [];
  const activeSlots = input.activeSpritePaletteSlots ?? [];
  const instances = input.scenePreview?.instances ?? [];
  const animations = input.animations ?? [];

  const activeSlotsFilled = activeSlots.filter(
    (slot) => typeof slot === 'string' && slot.trim() !== '',
  ).length;

  const visibleInstances = instances.filter((inst) => inst.visible);
  const requiredPaletteIds: string[] = [];

  for (const instance of visibleInstances) {
    const matchingAnim = animations.find(
      (a) =>
        (a.entity ?? 'entity').toLowerCase() ===
          instance.entityId.toLowerCase() &&
        a.name.toLowerCase() === instance.animationName.toLowerCase(),
    );

    const animPaletteId =
      matchingAnim?.paletteId ??
      (palettes.length > 0 ? palettes[0]?.id : undefined);

    if (animPaletteId) {
      requiredPaletteIds.push(animPaletteId);

      const slotRes = resolveSpritePaletteSlot(
        animPaletteId,
        activeSlots,
        palettes,
      );

      if (!slotRes.isActive) {
        const palName = slotRes.definition?.name ?? animPaletteId;
        const entityLabel = instance.name ?? instance.entityId;
        issues.push({
          id: `palette-not-active-${instance.id}-${animPaletteId}`,
          code: 'NES_PALETTE_NOT_ACTIVE',
          severity: 'error',
          message: `Palette "${palName}" required by entity "${entityLabel}" is not assigned to an active sprite palette slot.`,
          scope: 'SCENE',
          sceneInstanceId: instance.id,
          entityId: instance.entityId,
          paletteId: animPaletteId,
          details: {
            paletteName: palName,
            instanceName: entityLabel,
            paletteId: animPaletteId,
          },
        });
      }
    }
  }

  const analysis = analyzeScenePalettes(requiredPaletteIds, activeSlots, palettes);

  if (analysis.requiredCount > NES_MAX_SPRITE_PALETTES) {
    issues.push({
      id: `palette-limit-exceeded-${String(analysis.requiredCount)}`,
      code: 'NES_PALETTE_LIMIT',
      severity: 'error',
      message: `${String(analysis.requiredCount)} sprite palettes required in this scene; NES supports at most ${String(NES_MAX_SPRITE_PALETTES)}.`,
      scope: 'SCENE',
      details: {
        requiredCount: analysis.requiredCount,
        maxAllowed: NES_MAX_SPRITE_PALETTES,
        distinctPaletteIds: analysis.distinctPaletteIds,
      },
    });
  }

  return {
    issues,
    palettesUsed: analysis.requiredCount,
    activeSlotsFilled,
  };
}

export function validateChrAndPatternTable(input: NesValidatorInput): {
  issues: ValidationIssue[];
  tilesUsed: number;
} {
  const issues: ValidationIssue[] = [];
  const model = input.animationModel;

  if (!model) {
    return { issues, tilesUsed: 0 };
  }

  const tilesUsed = model.chr.patternTableFinalTileCount;

  if (tilesUsed > NES_PATTERN_TABLE_CAPACITY) {
    const excess = tilesUsed - NES_PATTERN_TABLE_CAPACITY;
    issues.push({
      id: `chr-capacity-exceeded-${String(tilesUsed)}`,
      code: 'NES_CHR_CAPACITY',
      severity: 'error',
      message: `Sprite pattern table capacity exceeded: ${String(tilesUsed)} / ${String(NES_PATTERN_TABLE_CAPACITY)} tiles (+${String(excess)}).`,
      scope: 'CHR',
      details: {
        tilesUsed,
        maxAllowed: NES_PATTERN_TABLE_CAPACITY,
        excess,
      },
    });
  } else if (tilesUsed >= NES_CHR_NEAR_CAPACITY_THRESHOLD) {
    const pct = ((tilesUsed / NES_PATTERN_TABLE_CAPACITY) * 100).toFixed(1);
    issues.push({
      id: `chr-near-capacity-${String(tilesUsed)}`,
      code: 'NES_CHR_NEAR_CAPACITY',
      severity: 'warning',
      message: `Sprite pattern table is ${pct}% full (${String(tilesUsed)} / ${String(NES_PATTERN_TABLE_CAPACITY)} tiles).`,
      scope: 'CHR',
      details: {
        tilesUsed,
        maxAllowed: NES_PATTERN_TABLE_CAPACITY,
        percentage: Number(pct),
      },
    });
  }

  // Validate local tile index ranges and pattern table alignment
  const selectedPatternTable = input.patternTable ?? 0;
  const expectedPhysicalBase = selectedPatternTable * NES_PATTERN_TABLE_CAPACITY;

  for (const anim of model.animations) {
    for (const frame of anim.frames) {
      for (const sprite of frame.sprites) {
        if (
          sprite.tile < 0 ||
          sprite.tile >= NES_PATTERN_TABLE_CAPACITY
        ) {
          issues.push({
            id: `tile-index-range-${anim.name}-${String(frame.sourceIndex)}-${String(sprite.tile)}`,
            code: 'NES_TILE_INDEX_RANGE',
            severity: 'error',
            message: `Sprite tile index $${sprite.tile.toString(16).toUpperCase()} in animation "${anim.name}" is outside the valid 0..255 range.`,
            scope: 'ANIMATION',
            animationId: anim.name,
            details: {
              animationName: anim.name,
              sourceFrameIndex: frame.sourceIndex,
              tileIndex: sprite.tile,
            },
          });
        }

        const physicalIdx = sprite.physicalTileIndex;
        if (
          physicalIdx < expectedPhysicalBase ||
          physicalIdx >= expectedPhysicalBase + NES_PATTERN_TABLE_CAPACITY
        ) {
          issues.push({
            id: `wrong-pattern-table-${anim.name}-${String(sprite.physicalTileIndex)}`,
            code: 'NES_WRONG_PATTERN_TABLE',
            severity: 'error',
            message: `Animation "${anim.name}" references sprite tile data outside the selected pattern table (physical index ${String(physicalIdx)}).`,
            scope: 'CHR',
            animationId: anim.name,
            details: {
              animationName: anim.name,
              physicalTileIndex: physicalIdx,
              selectedPatternTable,
            },
          });
        }
      }
    }
  }

  return { issues, tilesUsed };
}

export function validateAnimationFramesAndPixels(input: NesValidatorInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const animations = input.animations ?? [];

  for (const anim of animations) {
    if (
      anim.frameWidth <= 0 ||
      anim.frameHeight <= 0 ||
      anim.frameWidth % NES_TILE_SIZE !== 0 ||
      anim.frameHeight % NES_TILE_SIZE !== 0
    ) {
      issues.push({
        id: `frame-dimensions-${anim.id}`,
        code: 'NES_FRAME_DIMENSIONS',
        severity: 'error',
        message: `Frame dimensions (${String(anim.frameWidth)}x${String(anim.frameHeight)}) for animation "${anim.name}" must be positive multiples of 8 pixels.`,
        scope: 'ANIMATION',
        animationId: anim.id,
        entityId: anim.entity,
        details: {
          frameWidth: anim.frameWidth,
          frameHeight: anim.frameHeight,
        },
      });
    }

    // Check pixel overrides for values outside 0..3
    if (anim.pixelOverrides) {
      for (const [tileKey, tileOverride] of Object.entries(
        anim.pixelOverrides,
      )) {
        if (typeof tileOverride === 'object' && tileOverride !== null) {
          for (const [pixelIdx, val] of Object.entries(tileOverride)) {
            if (
              typeof val === 'number' &&
              (val < 0 || val > 3 || !Number.isInteger(val))
            ) {
              issues.push({
                id: `pixel-index-range-${anim.id}-${tileKey}-${pixelIdx}`,
                code: 'NES_PIXEL_INDEX_RANGE',
                severity: 'error',
                message: `Invalid pixel color index ${String(val)} in animation "${anim.name}". NES pixel indices must be 0, 1, 2, or 3.`,
                scope: 'ANIMATION',
                animationId: anim.id,
                entityId: anim.entity,
                details: {
                  tileKey,
                  pixelIndex: Number(pixelIdx),
                  invalidValue: val,
                },
              });
            }
          }
        }
      }
    }

    // Check indexed image pixels if available
    if (anim.source?.indexedImage) {
      const pixels = anim.source.indexedImage.pixels;
      let hasInvalid = false;
      for (let i = 0; i < pixels.length; i += 1) {
        const p = pixels[i];
        if (p !== undefined && (p < 0 || p > 3)) {
          hasInvalid = true;
          break;
        }
      }
      if (hasInvalid) {
        issues.push({
          id: `pixel-source-range-${anim.id}`,
          code: 'NES_PIXEL_INDEX_RANGE',
          severity: 'error',
          message: `Source image for animation "${anim.name}" contains pixel values outside the 0..3 NES indexed range.`,
          scope: 'ASSET',
          animationId: anim.id,
          entityId: anim.entity,
        });
      }
    }
  }

  return issues;
}

export interface PlacedHardwareSprite {
  readonly x: number;
  readonly y: number;
  readonly instanceId: string;
  readonly entityId: string;
}

export function extractSceneHardwareSprites(
  instances: readonly ScenePreviewInstance[],
  animations: readonly AnimationItemSetting[],
  animationModel?: AnimationProjectModel | null,
): readonly PlacedHardwareSprite[] {
  const visibleInstances = instances.filter((inst) => inst.visible);
  const sprites: PlacedHardwareSprite[] = [];

  for (const instance of visibleInstances) {
    const matchingAnim = animations.find(
      (a) =>
        (a.entity ?? 'entity').toLowerCase() ===
          instance.entityId.toLowerCase() &&
        a.name.toLowerCase() === instance.animationName.toLowerCase(),
    );

    if (!matchingAnim) continue;

    // Use AnimationProjectModel if available for accurate metasprite decomposition (excluding blank tiles)
    const modelAnim = animationModel?.animations.find(
      (a) => a.name.toLowerCase() === matchingAnim.name.toLowerCase(),
    );

    if (modelAnim && modelAnim.frames.length > 0) {
      const frame = modelAnim.frames[0]; // First frame or current playback frame
      if (frame) {
        for (const spr of frame.sprites) {
          sprites.push({
            x: instance.x + spr.x,
            y: instance.y + spr.y,
            instanceId: instance.id,
            entityId: instance.entityId,
          });
        }
      }
    } else {
      // Fallback: estimate based on frame dimensions (grid of 8x8 tiles)
      const cols = Math.max(1, Math.floor(matchingAnim.frameWidth / NES_TILE_SIZE));
      const rows = Math.max(1, Math.floor(matchingAnim.frameHeight / NES_TILE_SIZE));
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          sprites.push({
            x: instance.x + c * NES_TILE_SIZE,
            y: instance.y + r * NES_TILE_SIZE,
            instanceId: instance.id,
            entityId: instance.entityId,
          });
        }
      }
    }
  }

  return sprites;
}

export function groupConsecutiveScanlineConflicts(
  scanlineCounts: readonly number[],
  limit = NES_MAX_SPRITES_PER_SCANLINE,
): readonly ScanlineConflictGroup[] {
  const groups: ScanlineConflictGroup[] = [];
  let currentGroup: {
    start: number;
    end: number;
    peakCount: number;
    peakScanline: number;
  } | null = null;

  for (let y = 0; y < scanlineCounts.length; y += 1) {
    const count = scanlineCounts[y] ?? 0;
    if (count > limit) {
      if (!currentGroup) {
        currentGroup = {
          start: y,
          end: y,
          peakCount: count,
          peakScanline: y,
        };
      } else {
        currentGroup.end = y;
        if (count > currentGroup.peakCount) {
          currentGroup.peakCount = count;
          currentGroup.peakScanline = y;
        }
      }
    } else if (currentGroup) {
      groups.push({
        startScanline: currentGroup.start,
        endScanline: currentGroup.end,
        peakCount: currentGroup.peakCount,
        peakScanline: currentGroup.peakScanline,
      });
      currentGroup = null;
    }
  }

  if (currentGroup) {
    groups.push({
      startScanline: currentGroup.start,
      endScanline: currentGroup.end,
      peakCount: currentGroup.peakCount,
      peakScanline: currentGroup.peakScanline,
    });
  }

  return groups;
}

export function validateSceneOamAndScanlines(input: NesValidatorInput): {
  issues: ValidationIssue[];
  oamSpritesUsed: number;
  peakSpritesPerScanline: number;
  peakScanlineIndex: number | null;
} {
  const issues: ValidationIssue[] = [];
  const instances = input.scenePreview?.instances ?? [];
  const animations = input.animations ?? [];
  const placedSprites = extractSceneHardwareSprites(
    instances,
    animations,
    input.animationModel,
  );

  const oamSpritesUsed = placedSprites.length;

  if (oamSpritesUsed > NES_MAX_OAM_SPRITES) {
    const excess = oamSpritesUsed - NES_MAX_OAM_SPRITES;
    issues.push({
      id: `oam-limit-exceeded-${String(oamSpritesUsed)}`,
      code: 'NES_OAM_LIMIT',
      severity: 'error',
      message: `Scene requires ${String(oamSpritesUsed)} hardware sprites; NES supports at most ${String(NES_MAX_OAM_SPRITES)} (+${String(excess)}).`,
      scope: 'SCENE',
      details: {
        oamSpritesUsed,
        maxAllowed: NES_MAX_OAM_SPRITES,
        excess,
      },
    });
  }

  // Simulate 240 scanlines
  const scanlineCounts = new Array<number>(NES_SCREEN_SCANLINES).fill(0);

  for (const sprite of placedSprites) {
    const startY = sprite.y;
    const endY = sprite.y + NES_TILE_SIZE - 1;

    for (let y = Math.max(0, startY); y <= Math.min(NES_SCREEN_SCANLINES - 1, endY); y += 1) {
      scanlineCounts[y] = (scanlineCounts[y] ?? 0) + 1;
    }
  }

  let peakSpritesPerScanline = 0;
  let peakScanlineIndex: number | null = null;

  for (let y = 0; y < scanlineCounts.length; y += 1) {
    const count = scanlineCounts[y] ?? 0;
    if (count > peakSpritesPerScanline) {
      peakSpritesPerScanline = count;
      peakScanlineIndex = y;
    }
  }

  const conflictGroups = groupConsecutiveScanlineConflicts(scanlineCounts);

  for (const group of conflictGroups) {
    const rangeText =
      group.startScanline === group.endScanline
        ? `scanline ${String(group.startScanline)}`
        : `scanlines ${String(group.startScanline)}-${String(group.endScanline)}`;

    issues.push({
      id: `scanline-sprite-limit-${String(group.startScanline)}-${String(group.endScanline)}`,
      code: 'NES_SCANLINE_SPRITE_LIMIT',
      severity: 'warning',
      message: `Sprite-per-scanline limit exceeded on ${rangeText}. Peak: ${String(group.peakCount)} / ${String(NES_MAX_SPRITES_PER_SCANLINE)} sprites on scanline ${String(group.peakScanline)}.`,
      scope: 'SCENE',
      details: {
        startScanline: group.startScanline,
        endScanline: group.endScanline,
        peakCount: group.peakCount,
        peakScanline: group.peakScanline,
        maxAllowed: NES_MAX_SPRITES_PER_SCANLINE,
      },
    });
  }

  return {
    issues,
    oamSpritesUsed,
    peakSpritesPerScanline,
    peakScanlineIndex,
  };
}

export function validateNesProject(input: NesValidatorInput): ValidationResult {
  const paletteRes = validateSpritePalettes(input);
  const chrRes = validateChrAndPatternTable(input);
  const frameIssues = validateAnimationFramesAndPixels(input);
  const sceneRes = validateSceneOamAndScanlines(input);

  const issues: ValidationIssue[] = [
    ...paletteRes.issues,
    ...chrRes.issues,
    ...frameIssues,
    ...sceneRes.issues,
  ];

  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const issue of issues) {
    if (issue.severity === 'error') errorCount += 1;
    else if (issue.severity === 'warning') warningCount += 1;
    else infoCount += 1;
  }

  const metrics: ValidationMetrics = {
    spritePalettesUsed: paletteRes.palettesUsed,
    spritePalettesMax: NES_MAX_SPRITE_PALETTES,
    activeSlotsFilled: paletteRes.activeSlotsFilled,
    spriteChrTilesUsed: chrRes.tilesUsed,
    spriteChrTilesMax: NES_PATTERN_TABLE_CAPACITY,
    oamSpritesUsed: sceneRes.oamSpritesUsed,
    oamSpritesMax: NES_MAX_OAM_SPRITES,
    peakSpritesPerScanline: sceneRes.peakSpritesPerScanline,
    maxSpritesPerScanline: NES_MAX_SPRITES_PER_SCANLINE,
    peakScanlineIndex: sceneRes.peakScanlineIndex,
  };

  return {
    issues,
    metrics,
    errorCount,
    warningCount,
    infoCount,
    valid: errorCount === 0,
  };
}
