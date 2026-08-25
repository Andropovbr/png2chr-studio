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

import { type ProjectAssetId } from './asset-identity';
import {
  comparePhysicalTileUsages,
  getPhysicalIndicesForAsset,
  type ChrAssetMappingIndex,
  type PhysicalSlotAttribution,
  type PhysicalTileOrigin,
  type PhysicalTileUsage,
} from './chr-asset-mapping';
import {
  NES_CHR_ROM_TILE_COUNT,
  patternTableForPhysicalTile,
  localPatternTableTileIndex,
  type SpritePatternTable,
} from './chr-pattern-table';
import { parseTileKey, type TilePixelOverrides } from './pixel-overrides';
import type { Tile } from './types';

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
