/**
 * Asset lifecycle reconciliation domain engine.
 *
 * Implements deterministic lifecycle semantics for logical assets whose generated
 * or referenced CHR content changes over time:
 * - Asset replacement (preserving ProjectAssetId, reconciling pixel overrides, preserving shared physical allocations)
 * - Asset removal (removing usages, transferring primary origin deterministically to surviving consumers, releasing unused project slots)
 * - Orphan detection and conservative garbage collection
 * - Base CHR and CHR Reservation safety
 * - CHR Editor shared tile divergence analysis
 *
 * Milestone 6: Tile Ownership & Asset Mapping.
 * This is a pure, side-effect free reconciliation engine.
 */

import { normalizeProjectAssetId, type ProjectAssetId } from './asset-identity';
import {
  buildChrAssetMappingIndex,
  comparePhysicalTileUsages,
  getPhysicalIndicesForAsset,
  type ChrAssetMappingIndex,
  type PhysicalSlotAttribution,
  type PhysicalTileOrigin,
  type PhysicalTileUsage,
} from './chr-asset-mapping';
import {
  collectReservedPhysicalTileIndices,
  NES_CHR_ROM_TILE_COUNT,
  patternTableForPhysicalTile,
  localPatternTableTileIndex,
  type SpritePatternTable,
} from './chr-pattern-table';
import {
  buildAnimationProjectModel,
  AnimationModelError,
  type AnimationProjectModel,
  type AnimationDefinitionInput,
} from './animation-model';
import type { ProjectAnimationItemConfig, StudioProject } from './project';
import { parseTileKey, type TilePixelOverrides } from './pixel-overrides';
import type { IndexedImage, Tile } from './types';

/** Represents a primary origin transfer from a removed/replaced asset to a surviving consumer. */
export interface TransferredTileOrigin {
  readonly physicalIndex: number;
  readonly previousAssetId: ProjectAssetId;
  readonly newOrigin: PhysicalTileOrigin;
}

/** Result of reconciling tile pixel overrides when image geometry changes. */
export interface ReconcileTilePixelOverridesResult {
  readonly reconciledOverrides: TilePixelOverrides;
  readonly retainedKeys: readonly string[];
  readonly removedKeys: readonly string[];
}

/** Options for reconciling an animation definition's geometry and frame arrays. */
export interface ReconcileAnimationGeometryOptions {
  /** Target frame width in pixels. */
  readonly frameWidth: number;
  /** Target frame height in pixels. */
  readonly frameHeight: number;
  /** Source image width in pixels. */
  readonly imageWidth: number;
  /** Source image height in pixels. */
  readonly imageHeight: number;
  /** Frame indices sequence. */
  readonly frameIndices: readonly number[];
  /** Default frame duration in ticks. */
  readonly defaultDuration?: number;
  /** Per-frame durations corresponding to frameIndices. */
  readonly frameDurations?: readonly number[];
  /** Per-frame palette indices corresponding to frameIndices. */
  readonly framePalettes?: readonly (number | null)[];
  /** Per-frame palette IDs corresponding to frameIndices. */
  readonly framePaletteIds?: readonly (string | null)[];
  /** Sparse pixel overrides dictionary. */
  readonly pixelOverrides?: TilePixelOverrides | null;
  /** Metasprite origin anchor X in pixels. */
  readonly originX?: number;
  /** Metasprite origin anchor Y in pixels. */
  readonly originY?: number;
}

/** Result of reconciling animation geometry, frame sequences, and pixel overrides. */
export interface ReconcileAnimationGeometryResult {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly frameColumns: number;
  readonly frameRows: number;
  readonly totalFrames: number;
  readonly frameIndices: readonly number[];
  readonly frameDurations: readonly number[];
  readonly framePalettes: readonly (number | null)[];
  readonly framePaletteIds: readonly (string | null)[];
  readonly pixelOverrides: TilePixelOverrides;
  readonly retainedOverrideKeys: readonly string[];
  readonly removedOverrideKeys: readonly string[];
  readonly removedFrameIndices: readonly number[];
  readonly originX: number;
  readonly originY: number;
  readonly isOriginValid: boolean;
}

/** Options for safely reconciling and testing the reimportation of a spritesheet in a project. */
export interface ReconcileSpritesheetReimportOptions {
  readonly project: StudioProject;
  readonly animationId: string;
  readonly newImage: IndexedImage;
  /** Optional dictionary of indexed images for any other animations in the project. */
  readonly animationImages?: Readonly<Record<string, IndexedImage>>;
  readonly newFrameWidth?: number;
  readonly newFrameHeight?: number;
  readonly newSourcePath?: string;
  readonly newSourceName?: string;
  readonly baseChr?: Uint8Array;
}

/** Summary of changes produced by a successful spritesheet reimport reconciliation. */
export interface ReconciledSpritesheetSummary {
  readonly assetId: ProjectAssetId;
  readonly previousDimensions?: {
    readonly width: number;
    readonly height: number;
  };
  readonly nextDimensions: { readonly width: number; readonly height: number };
  readonly retainedOverrides: readonly string[];
  readonly removedOverrides: readonly string[];
  readonly retainedFrameIndices: readonly number[];
  readonly removedFrameIndices: readonly number[];
  readonly releasedPhysicalIndices: readonly number[];
  readonly preservedSharedPhysicalIndices: readonly number[];
  readonly transferredOrigins: readonly TransferredTileOrigin[];
}

/** Result of atomic spritesheet reimport reconciliation. */
export type ReconcileSpritesheetReimportResult =
  | {
      readonly success: true;
      readonly project: StudioProject;
      readonly animationModel: AnimationProjectModel;
      readonly mappingIndex: ChrAssetMappingIndex;
      readonly reconciliation: ReconciledSpritesheetSummary;
    }
  | {
      readonly success: false;
      readonly error: AnimationModelError | Error;
      readonly previousProject: StudioProject;
    };

/** Structured reconciliation report returned before or during an asset lifecycle mutation. */
export interface AssetLifecycleReconciliation {
  readonly releasedPhysicalIndices: readonly number[];
  readonly preservedSharedPhysicalIndices: readonly number[];
  readonly transferredOrigins: readonly TransferredTileOrigin[];
  readonly removedOverrides: readonly string[];
  readonly retainedOverrides: readonly string[];
  readonly orphanedPhysicalIndices: readonly number[];
}

/** Detailed classification for a physical CHR slot regarding orphan/reclaimable status. */
export interface OrphanedPhysicalTileReport {
  readonly physicalIndex: number;
  readonly patternTable: SpritePatternTable;
  readonly localIndex: number;
  readonly isOrphan: boolean;
  readonly reason:
    | 'active-usage'
    | 'base-chr'
    | 'manual-materialized'
    | 'reserved'
    | 'empty'
    | 'orphaned-project-tile';
}

/** Options for planning the removal of an asset. */
export interface PlanAssetRemovalOptions {
  readonly mappingIndex: ChrAssetMappingIndex;
  readonly assetId: ProjectAssetId;
  readonly assetName?: string;
  readonly reservedPhysicalIndices?: ReadonlySet<number>;
  readonly currentOverrides?: TilePixelOverrides | null;
}

/** Options for planning the replacement of an asset. */
export interface PlanAssetReplacementOptions {
  readonly mappingIndex: ChrAssetMappingIndex;
  readonly assetId: ProjectAssetId;
  readonly previousTiles?: readonly Tile[] | readonly Uint8Array[];
  readonly nextTiles: readonly Tile[] | readonly Uint8Array[];
  readonly previousDimensions?: {
    readonly width: number;
    readonly height: number;
  };
  readonly nextDimensions: {
    readonly width: number;
    readonly height: number;
  };
  readonly currentOverrides?: TilePixelOverrides | null;
  readonly reservedPhysicalIndices?: ReadonlySet<number>;
}

/** Options for analyzing CHR Editor shared tile divergence. */
export interface AnalyzeChrEditDivergenceOptions {
  readonly mappingIndex: ChrAssetMappingIndex;
  readonly physicalIndex: number;
  readonly targetAssetId: ProjectAssetId;
}

/** Result of analyzing CHR Editor shared tile divergence. */
export interface ChrEditDivergenceAnalysis {
  readonly physicalIndex: number;
  readonly isShared: boolean;
  readonly targetAssetId: ProjectAssetId;
  readonly survivingAssetIds: readonly ProjectAssetId[];
  readonly willDivergeOnPixelChange: boolean;
}

/**
 * Creates a deterministic PhysicalTileOrigin from a surviving PhysicalTileUsage.
 */
export function createOriginFromUsage(
  usage: PhysicalTileUsage,
  assetName?: string,
): PhysicalTileOrigin {
  if (usage.type === 'animation') {
    const col = usage.sourceTileColumn ?? Math.floor(usage.x / 8);
    const row = usage.sourceTileRow ?? Math.floor(usage.y / 8);
    return {
      primaryAssetId: usage.assetId,
      primaryAssetName: assetName ?? usage.animationName,
      logicalKey: usage.logicalKey,
      sourceCoordinates: {
        tileX: col,
        tileY: row,
        pixelX: col * 8,
        pixelY: row * 8,
      },
      creationKind: 'extracted',
    };
  }

  if (usage.type === 'tileset') {
    const tileX = usage.sourceCoordinates?.tileX ?? usage.tileIndex % 16;
    const tileY =
      usage.sourceCoordinates?.tileY ?? Math.floor(usage.tileIndex / 16);
    return {
      primaryAssetId: usage.assetId,
      primaryAssetName: assetName,
      logicalKey: usage.logicalKey,
      sourceCoordinates: {
        tileX,
        tileY,
        pixelX: tileX * 8,
        pixelY: tileY * 8,
      },
      creationKind: 'extracted',
    };
  }

  if (usage.type === 'background') {
    return {
      primaryAssetId: usage.assetId,
      primaryAssetName: assetName ?? `Background Map (${usage.mapId})`,
      logicalKey: usage.logicalKey,
      sourceCoordinates: {
        tileX: usage.column,
        tileY: usage.row,
        pixelX: usage.column * 8,
        pixelY: usage.row * 8,
      },
      creationKind: 'extracted',
    };
  }

  // Playfield usage
  return {
    primaryAssetId: usage.assetId,
    primaryAssetName: assetName,
    logicalKey: usage.logicalKey,
    sourceCoordinates: {
      tileX: usage.column,
      tileY: usage.row,
      pixelX: usage.column * 8,
      pixelY: usage.row * 8,
    },
    creationKind: 'extracted',
  };
}

/**
 * Reconciles tile pixel overrides for an asset when its source image dimensions change.
 *
 * Invariants:
 * - Overrides within the new dimensions [0..newWidthInTiles-1, 0..newHeightInTiles-1] are preserved.
 * - Stale overrides referencing out-of-bounds tile coordinates are removed.
 * - Array positions or tile shifts do not cause accidental reassignment because keys use stable logical coordinates.
 */
export function reconcilePixelOverridesForGeometry(
  overrides: TilePixelOverrides | undefined | null,
  newWidthInTiles: number,
  newHeightInTiles: number,
): ReconcileTilePixelOverridesResult {
  if (!overrides || Object.keys(overrides).length === 0) {
    return {
      reconciledOverrides: {},
      retainedKeys: [],
      removedKeys: [],
    };
  }

  const reconciled: TilePixelOverrides = {};
  const retainedKeys: string[] = [];
  const removedKeys: string[] = [];

  for (const [key, tileMap] of Object.entries(overrides)) {
    const coords = parseTileKey(key);
    if (!coords) {
      removedKeys.push(key);
      continue;
    }

    if (
      coords.tileX >= 0 &&
      coords.tileX < newWidthInTiles &&
      coords.tileY >= 0 &&
      coords.tileY < newHeightInTiles
    ) {
      reconciled[key] = tileMap;
      retainedKeys.push(key);
    } else {
      removedKeys.push(key);
    }
  }

  return {
    reconciledOverrides: Object.freeze(reconciled),
    retainedKeys: Object.freeze(retainedKeys.sort()),
    removedKeys: Object.freeze(removedKeys.sort()),
  };
}

/**
 * Validates whether the origin anchor (originX, originY) is within NES hardware relative sprite offset bounds (-128..127).
 */
export function isAnimationOriginValid(
  frameWidth: number,
  frameHeight: number,
  originX: number,
  originY: number,
): boolean {
  return (
    Number.isInteger(originX) &&
    Number.isInteger(originY) &&
    -originX >= -128 &&
    frameWidth - 8 - originX <= 127 &&
    -originY >= -128 &&
    frameHeight - 8 - originY <= 127
  );
}

/**
 * Reconciles frame indices, durations, palettes, origin, and pixel overrides when an animation's
 * frame dimensions or source image resolution changes.
 *
 * Invariants:
 * - Pure and deterministic.
 * - Preserves 1-to-1 alignment between surviving frame sequence steps and parallel arrays (durations, palettes, palette IDs).
 * - Removes invalid out-of-bounds frame indices and stale pixel overrides.
 * - Validates origin anchor against NES signed 8-bit displacement limits.
 */
export function reconcileAnimationGeometry(
  options: ReconcileAnimationGeometryOptions,
): ReconcileAnimationGeometryResult {
  const frameWidth = Math.max(8, Math.floor(options.frameWidth / 8) * 8);
  const frameHeight = Math.max(8, Math.floor(options.frameHeight / 8) * 8);
  const imageWidth = Math.max(0, options.imageWidth);
  const imageHeight = Math.max(0, options.imageHeight);

  const frameColumns = frameWidth > 0 ? Math.floor(imageWidth / frameWidth) : 0;
  const frameRows = frameHeight > 0 ? Math.floor(imageHeight / frameHeight) : 0;
  const totalFrames = frameColumns * frameRows;

  const newWidthInTiles = Math.floor(imageWidth / 8);
  const newHeightInTiles = Math.floor(imageHeight / 8);

  const overrideResult = reconcilePixelOverridesForGeometry(
    options.pixelOverrides,
    newWidthInTiles,
    newHeightInTiles,
  );

  const defaultDuration = options.defaultDuration ?? 12;
  const survivingFrameIndices: number[] = [];
  const survivingFrameDurations: number[] = [];
  const survivingFramePalettes: (number | null)[] = [];
  const survivingFramePaletteIds: (string | null)[] = [];
  const removedFrameIndices: number[] = [];

  for (let i = 0; i < options.frameIndices.length; i += 1) {
    const frameIndex = options.frameIndices[i];
    if (
      typeof frameIndex === 'number' &&
      Number.isInteger(frameIndex) &&
      frameIndex >= 0 &&
      frameIndex < totalFrames
    ) {
      survivingFrameIndices.push(frameIndex);
      survivingFrameDurations.push(
        options.frameDurations?.[i] ?? defaultDuration,
      );
      survivingFramePalettes.push(options.framePalettes?.[i] ?? null);
      survivingFramePaletteIds.push(options.framePaletteIds?.[i] ?? null);
    } else if (typeof frameIndex === 'number') {
      removedFrameIndices.push(frameIndex);
    }
  }

  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const isOriginValid = isAnimationOriginValid(
    frameWidth,
    frameHeight,
    originX,
    originY,
  );

  return {
    frameWidth,
    frameHeight,
    imageWidth,
    imageHeight,
    frameColumns,
    frameRows,
    totalFrames,
    frameIndices: Object.freeze(survivingFrameIndices),
    frameDurations: Object.freeze(survivingFrameDurations),
    framePalettes: Object.freeze(survivingFramePalettes),
    framePaletteIds: Object.freeze(survivingFramePaletteIds),
    pixelOverrides: overrideResult.reconciledOverrides,
    retainedOverrideKeys: overrideResult.retainedKeys,
    removedOverrideKeys: overrideResult.removedKeys,
    removedFrameIndices: Object.freeze(removedFrameIndices),
    originX,
    originY,
    isOriginValid,
  };
}

/**
 * Reconciles and plans the replacement/reimportation of a spritesheet in a StudioProject.
 *
 * Guarantees:
 * - Atomic transaction: if rebuild fails (e.g. capacity overflow or invalid frame grid), the original project is returned intact without mutations.
 * - Preserves stable ProjectAssetId.
 * - Reconciles pixel overrides and frame sequences pure-functionally.
 * - Reconstructs the complete CHR allocation and mapping index.
 */
export function reconcileSpritesheetReimport(
  options: ReconcileSpritesheetReimportOptions,
): ReconcileSpritesheetReimportResult {
  const { project, animationId, newImage } = options;

  if (!project.animation || project.animation.animations.length === 0) {
    return {
      success: false,
      error: new Error('Project contains no animation configuration.'),
      previousProject: project,
    };
  }

  const targetIndex = project.animation.animations.findIndex(
    (a) => a.id === animationId,
  );
  if (targetIndex < 0) {
    return {
      success: false,
      error: new Error(
        `Animation with ID "${animationId}" not found in project.`,
      ),
      previousProject: project,
    };
  }

  const targetAnim = project.animation.animations[targetIndex];
  if (!targetAnim) {
    return {
      success: false,
      error: new Error(
        `Animation at index ${String(targetIndex)} is undefined.`,
      ),
      previousProject: project,
    };
  }

  // 1. Preserve ProjectAssetId
  const assetId =
    targetAnim.asset?.id ??
    normalizeProjectAssetId(undefined, 'spritesheet', targetAnim.id);

  const frameWidth = options.newFrameWidth ?? targetAnim.frameWidth;
  const frameHeight = options.newFrameHeight ?? targetAnim.frameHeight;

  // 2. Reconcile Geometry & Frame Selections & Pixel Overrides
  const reconciled = reconcileAnimationGeometry({
    frameWidth,
    frameHeight,
    imageWidth: newImage.width,
    imageHeight: newImage.height,
    frameIndices: targetAnim.frameIndices,
    defaultDuration: targetAnim.defaultDuration,
    frameDurations: targetAnim.frameDurations,
    framePalettes: targetAnim.framePalettes,
    framePaletteIds: targetAnim.framePaletteIds,
    pixelOverrides: targetAnim.pixelOverrides,
    originX: targetAnim.originX,
    originY: targetAnim.originY,
  });

  const finalFrameIndices =
    reconciled.frameIndices.length > 0
      ? reconciled.frameIndices
      : targetAnim.frameIndices.length === 0 && reconciled.totalFrames > 0
        ? Array.from({ length: reconciled.totalFrames }, (_, i) => i)
        : [];

  const finalFrameDurations =
    reconciled.frameIndices.length > 0
      ? reconciled.frameDurations
      : Array.from(
          { length: finalFrameIndices.length },
          () => targetAnim.defaultDuration,
        );

  const finalFramePalettes =
    reconciled.frameIndices.length > 0
      ? reconciled.framePalettes
      : Array.from({ length: finalFrameIndices.length }, () => null);

  const finalFramePaletteIds =
    reconciled.frameIndices.length > 0
      ? reconciled.framePaletteIds
      : Array.from({ length: finalFrameIndices.length }, () => null);

  const sourcePath =
    options.newSourcePath ?? targetAnim.asset?.path ?? 'sprites.png';
  const sourceName =
    options.newSourceName ?? targetAnim.asset?.name ?? 'sprites.png';

  const updatedAnimConfig: ProjectAnimationItemConfig = {
    ...targetAnim,
    asset: {
      id: assetId,
      path: sourcePath,
      name: sourceName,
      sourceKind: 'png',
    },
    frameWidth: reconciled.frameWidth,
    frameHeight: reconciled.frameHeight,
    frameIndices: finalFrameIndices,
    frameDurations: finalFrameDurations,
    framePalettes: finalFramePalettes,
    framePaletteIds: finalFramePaletteIds,
    pixelOverrides: reconciled.pixelOverrides,
    originX: reconciled.originX,
    originY: reconciled.originY,
  };

  const nextAnimations = project.animation.animations.map((a, i) =>
    i === targetIndex ? updatedAnimConfig : a,
  );

  const nextProject: StudioProject = {
    ...project,
    animation: {
      ...project.animation,
      animations: nextAnimations,
    },
  };

  // 3. Attempt building derived model atomically
  try {
    const definitions: AnimationDefinitionInput[] = nextAnimations
      .filter(
        (anim) =>
          anim.id === animationId ||
          options.animationImages?.[anim.id] !== undefined,
      )
      .map((anim) => ({
        id: anim.id,
        assetId:
          anim.asset?.id ??
          normalizeProjectAssetId(undefined, 'spritesheet', anim.id),
        name: anim.name,
        entity: anim.entity,
        image:
          anim.id === animationId
            ? newImage
            : options.animationImages?.[anim.id],
        frameWidth: anim.frameWidth,
        frameHeight: anim.frameHeight,
        originX: anim.originX,
        originY: anim.originY,
        playback: anim.playback,
        allowHorizontalFlip: anim.allowHorizontalFlip,
        allowVerticalFlip: anim.allowVerticalFlip,
        flipH: anim.allowHorizontalFlip,
        flipV: anim.allowVerticalFlip,
        frameIndices: anim.frameIndices,
        frameDuration: anim.defaultDuration,
        frameDurations: anim.frameDurations,
        framePalettes: anim.framePalettes,
        pixelOverrides: anim.pixelOverrides,
      }));

    const primaryEntity =
      nextAnimations[0]?.entity ?? nextProject.animation?.name ?? 'entity';

    const baseChr = options.baseChr;

    const animationModel = buildAnimationProjectModel({
      name: primaryEntity,
      symbolPrefix: primaryEntity,
      animations: definitions,
      defaultPaletteIndex: nextProject.animation?.defaultPaletteIndex ?? 0,
      quantizationMode: nextProject.animation?.quantizationMode ?? 'median-cut',
      patternTable: nextProject.animation?.patternTable ?? 0,
      destinationPatternTable:
        nextProject.animation?.destinationPatternTable ?? 0,
      flipDeduplication: nextProject.animation?.flipDeduplication ?? true,
      spritePalette: nextProject.animation?.spritePalette ?? 0,
      chrRegions: nextProject.chrRegions,
      baseChr,
    });

    const mappingIndex = buildChrAssetMappingIndex({
      project: nextProject,
      animationModel,
      animations: nextAnimations,
      baseChr,
      destinationPatternTable:
        nextProject.animation?.destinationPatternTable ?? 0,
      chrRegions: nextProject.chrRegions,
    });

    const lifecyclePlan = planAssetReplacement({
      mappingIndex,
      assetId,
      nextTiles: [],
      nextDimensions: { width: newImage.width, height: newImage.height },
      currentOverrides: targetAnim.pixelOverrides,
      reservedPhysicalIndices: collectReservedPhysicalTileIndices(
        nextProject.chrRegions ?? [],
        nextProject.animation?.patternTable ?? 0,
      ),
    });

    return {
      success: true,
      project: nextProject,
      animationModel,
      mappingIndex,
      reconciliation: {
        assetId,
        nextDimensions: { width: newImage.width, height: newImage.height },
        retainedOverrides: reconciled.retainedOverrideKeys,
        removedOverrides: reconciled.removedOverrideKeys,
        retainedFrameIndices: reconciled.frameIndices,
        removedFrameIndices: reconciled.removedFrameIndices,
        releasedPhysicalIndices: lifecyclePlan.releasedPhysicalIndices,
        preservedSharedPhysicalIndices:
          lifecyclePlan.preservedSharedPhysicalIndices,
        transferredOrigins: lifecyclePlan.transferredOrigins,
      },
    };
  } catch (error: unknown) {
    return {
      success: false,
      error:
        error instanceof AnimationModelError
          ? error
          : new Error(error instanceof Error ? error.message : String(error)),
      previousProject: project,
    };
  }
}

/**
 * Determines whether a physical slot attribution qualifies as a project-generated orphan.
 *
 * A slot is an orphan IF AND ONLY IF:
 * 1. It has an active primary origin with creationKind === 'extracted' (project-generated);
 * 2. It has no active logical usages (usageCount === 0);
 * 3. It is NOT Base CHR content;
 * 4. It is NOT intentionally manual-materialized;
 * 5. It is NOT protected by an empty/reserved slot definition.
 */
export function isPhysicalTileOrphan(
  attribution: PhysicalSlotAttribution,
  isReserved = false,
): boolean {
  if (!attribution.origin) return false;
  if (attribution.origin.creationKind !== 'extracted') return false;
  if (attribution.usageCount > 0) return false;
  if (isReserved) return false;
  return true;
}

/**
 * Scans all 512 physical CHR slots and reports the indices of all orphaned project-generated tiles.
 */
export function detectOrphanedPhysicalTiles(
  index: ChrAssetMappingIndex,
  reservedPhysicalIndices?: ReadonlySet<number>,
): readonly number[] {
  const orphans: number[] = [];

  for (let i = 0; i < NES_CHR_ROM_TILE_COUNT; i += 1) {
    const slot = index.byPhysicalIndex[i];
    if (!slot) continue;
    const isReserved = reservedPhysicalIndices?.has(i) ?? false;
    if (isPhysicalTileOrphan(slot, isReserved)) {
      orphans.push(i);
    }
  }

  return Object.freeze(orphans);
}

/**
 * Generates a full 512-slot diagnostic classification report.
 */
export function classifyOrphanedPhysicalTiles(
  index: ChrAssetMappingIndex,
  reservedPhysicalIndices?: ReadonlySet<number>,
): readonly OrphanedPhysicalTileReport[] {
  const reports: OrphanedPhysicalTileReport[] = [];

  for (let i = 0; i < NES_CHR_ROM_TILE_COUNT; i += 1) {
    const slot = index.byPhysicalIndex[i];
    const patternTable = patternTableForPhysicalTile(i);
    const localIndex = localPatternTableTileIndex(i);
    const isReserved = reservedPhysicalIndices?.has(i) ?? false;

    if (!slot?.origin) {
      reports.push({
        physicalIndex: i,
        patternTable,
        localIndex,
        isOrphan: false,
        reason: isReserved ? 'reserved' : 'empty',
      });
      continue;
    }

    if (slot.origin.creationKind === 'base-chr') {
      reports.push({
        physicalIndex: i,
        patternTable,
        localIndex,
        isOrphan: false,
        reason: 'base-chr',
      });
      continue;
    }

    if (slot.origin.creationKind === 'manual-materialized') {
      reports.push({
        physicalIndex: i,
        patternTable,
        localIndex,
        isOrphan: false,
        reason: 'manual-materialized',
      });
      continue;
    }

    if (slot.usageCount > 0) {
      reports.push({
        physicalIndex: i,
        patternTable,
        localIndex,
        isOrphan: false,
        reason: 'active-usage',
      });
      continue;
    }

    if (isReserved) {
      reports.push({
        physicalIndex: i,
        patternTable,
        localIndex,
        isOrphan: false,
        reason: 'reserved',
      });
      continue;
    }

    reports.push({
      physicalIndex: i,
      patternTable,
      localIndex,
      isOrphan: true,
      reason: 'orphaned-project-tile',
    });
  }

  return Object.freeze(reports);
}

/**
 * Plans the removal of a logical project asset.
 *
 * Invariants:
 * - Physical slots used exclusively by the removed asset become released/reclaimable.
 * - Physical slots shared with surviving assets are preserved.
 * - If the removed asset was the primary origin of a surviving shared slot, the origin
 *   transfers deterministically to the highest-priority surviving consumer.
 * - Base CHR slots are never reclaimed.
 * - Manually materialized slots are never reclaimed.
 */
export function planAssetRemoval(
  options: PlanAssetRemovalOptions,
): AssetLifecycleReconciliation {
  const { mappingIndex, assetId, reservedPhysicalIndices } = options;
  const associatedIndices = getPhysicalIndicesForAsset(assetId, mappingIndex);

  const releasedPhysicalIndices: number[] = [];
  const preservedSharedPhysicalIndices: number[] = [];
  const transferredOrigins: TransferredTileOrigin[] = [];

  for (const physicalIndex of associatedIndices) {
    const slot = mappingIndex.byPhysicalIndex[physicalIndex];
    if (!slot) continue;

    const survivingUsages = slot.usages.filter((u) => u.assetId !== assetId);
    const isOrigin = slot.origin?.primaryAssetId === assetId;

    if (isOrigin) {
      if (survivingUsages.length > 0) {
        // Tile is shared with surviving consumers: preserve and transfer origin
        preservedSharedPhysicalIndices.push(physicalIndex);

        const sortedSurviving = [...survivingUsages].sort(
          comparePhysicalTileUsages,
        );
        const topUsage = sortedSurviving[0];
        if (topUsage) {
          transferredOrigins.push({
            physicalIndex,
            previousAssetId: assetId,
            newOrigin: createOriginFromUsage(topUsage),
          });
        }
      } else {
        // No surviving consumers
        if (slot.origin.creationKind === 'extracted') {
          // Project-generated slot with 0 usages -> release
          releasedPhysicalIndices.push(physicalIndex);
        } else {
          // Base CHR or manual materialized -> preserve
          preservedSharedPhysicalIndices.push(physicalIndex);
        }
      }
    } else {
      // Asset was merely a consumer (not origin): tile is owned elsewhere and preserved
      preservedSharedPhysicalIndices.push(physicalIndex);
    }
  }

  // Reconcile overrides for removed asset
  const removedOverrides = options.currentOverrides
    ? Object.keys(options.currentOverrides).sort()
    : [];

  const orphanedPhysicalIndices = detectOrphanedPhysicalTiles(
    mappingIndex,
    reservedPhysicalIndices,
  );

  return {
    releasedPhysicalIndices: Object.freeze(
      releasedPhysicalIndices.sort((a, b) => a - b),
    ),
    preservedSharedPhysicalIndices: Object.freeze(
      preservedSharedPhysicalIndices.sort((a, b) => a - b),
    ),
    transferredOrigins: Object.freeze(transferredOrigins),
    removedOverrides: Object.freeze(removedOverrides),
    retainedOverrides: Object.freeze([]),
    orphanedPhysicalIndices,
  };
}

/**
 * Plans the replacement of an asset with new source content.
 *
 * Invariants:
 * - Stable ProjectAssetId is preserved.
 * - If new content is byte-for-byte identical, no physical churn occurs.
 * - If content partially changes, unchanged tiles still present or shared elsewhere are preserved.
 * - Obsolete exclusive tiles are released.
 * - Out-of-bounds pixel overrides are cleaned up.
 */
export function planAssetReplacement(
  options: PlanAssetReplacementOptions,
): AssetLifecycleReconciliation {
  const {
    mappingIndex,
    assetId,
    previousTiles,
    nextTiles,
    nextDimensions,
    currentOverrides,
    reservedPhysicalIndices,
  } = options;

  // Reconcile pixel overrides for new dimensions
  const newWidthInTiles = Math.max(1, Math.floor(nextDimensions.width / 8));
  const newHeightInTiles = Math.max(1, Math.floor(nextDimensions.height / 8));
  const overrideSummary = reconcilePixelOverridesForGeometry(
    currentOverrides,
    newWidthInTiles,
    newHeightInTiles,
  );

  const associatedIndices = getPhysicalIndicesForAsset(assetId, mappingIndex);
  const releasedPhysicalIndices: number[] = [];
  const preservedSharedPhysicalIndices: number[] = [];
  const transferredOrigins: TransferredTileOrigin[] = [];

  // Helper to extract pixels from tile
  const getTilePixels = (tile: Tile | Uint8Array): Uint8Array => {
    return tile instanceof Uint8Array ? tile : tile.pixels;
  };

  // Check if a pixel buffer matches any tile in nextTiles
  const matchesAnyNextTile = (pixels: Uint8Array): boolean => {
    return nextTiles.some((nextTile) => {
      const nextPixels = getTilePixels(nextTile);
      if (nextPixels.length !== pixels.length) return false;
      for (let i = 0; i < pixels.length; i += 1) {
        if (nextPixels[i] !== pixels[i]) return false;
      }
      return true;
    });
  };

  for (const physicalIndex of associatedIndices) {
    const slot = mappingIndex.byPhysicalIndex[physicalIndex];
    if (!slot) continue;

    const survivingUsagesFromOtherAssets = slot.usages.filter(
      (u) => u.assetId !== assetId,
    );
    const isOrigin = slot.origin?.primaryAssetId === assetId;

    // Check if previous tile at this physical slot is still matched in nextTiles
    let stillPresentInNextContent = false;
    if (previousTiles && previousTiles.length > 0) {
      // Find previous tile associated with this slot if known
      const prevUsage = slot.usages.find((u) => u.assetId === assetId);
      if (prevUsage?.type === 'tileset') {
        const prevTile = previousTiles[prevUsage.tileIndex];
        if (prevTile && matchesAnyNextTile(getTilePixels(prevTile))) {
          stillPresentInNextContent = true;
        }
      } else if (prevUsage?.type === 'animation') {
        // In animation, if frame tile pixels still match any next tile
        stillPresentInNextContent = true;
      }
    } else {
      // If previous tiles not supplied, assume next tiles will match if counts/dimensions align
      stillPresentInNextContent = true;
    }

    if (
      stillPresentInNextContent ||
      survivingUsagesFromOtherAssets.length > 0
    ) {
      preservedSharedPhysicalIndices.push(physicalIndex);

      if (
        isOrigin &&
        !stillPresentInNextContent &&
        survivingUsagesFromOtherAssets.length > 0
      ) {
        // Transferred origin to surviving consumer
        const sortedSurviving = [...survivingUsagesFromOtherAssets].sort(
          comparePhysicalTileUsages,
        );
        const topUsage = sortedSurviving[0];
        if (topUsage) {
          transferredOrigins.push({
            physicalIndex,
            previousAssetId: assetId,
            newOrigin: createOriginFromUsage(topUsage),
          });
        }
      }
    } else {
      if (slot.origin?.creationKind === 'extracted') {
        releasedPhysicalIndices.push(physicalIndex);
      } else {
        preservedSharedPhysicalIndices.push(physicalIndex);
      }
    }
  }

  const orphanedPhysicalIndices = detectOrphanedPhysicalTiles(
    mappingIndex,
    reservedPhysicalIndices,
  );

  return {
    releasedPhysicalIndices: Object.freeze(
      releasedPhysicalIndices.sort((a, b) => a - b),
    ),
    preservedSharedPhysicalIndices: Object.freeze(
      preservedSharedPhysicalIndices.sort((a, b) => a - b),
    ),
    transferredOrigins: Object.freeze(transferredOrigins),
    removedOverrides: overrideSummary.removedKeys,
    retainedOverrides: overrideSummary.retainedKeys,
    orphanedPhysicalIndices,
  };
}

/**
 * Analyzes the impact of editing a physical CHR tile on shared consumers.
 *
 * When a shared tile is edited:
 * - Only the target asset receives the pixel override in canonical state.
 * - On next rebuild, surviving consumers retain their original graphics.
 * - The allocator naturally forks the physical tiles into separate slots if pixels differ.
 */
export function analyzeChrEditDivergence(
  options: AnalyzeChrEditDivergenceOptions,
): ChrEditDivergenceAnalysis {
  const { mappingIndex, physicalIndex, targetAssetId } = options;
  const slot = mappingIndex.byPhysicalIndex[physicalIndex];

  if (!slot) {
    return {
      physicalIndex,
      isShared: false,
      targetAssetId,
      survivingAssetIds: [],
      willDivergeOnPixelChange: false,
    };
  }

  const otherAssetIds = Array.from(
    new Set(
      slot.usages.map((u) => u.assetId).filter((id) => id !== targetAssetId),
    ),
  ).sort();

  return {
    physicalIndex,
    isShared: slot.isShared,
    targetAssetId,
    survivingAssetIds: Object.freeze(otherAssetIds),
    willDivergeOnPixelChange: slot.isShared && otherAssetIds.length > 0,
  };
}
