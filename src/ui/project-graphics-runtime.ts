import {
  parseLogicalTileKey,
  type ProjectAssetId,
} from '../core/asset-identity';
import { extractLogicalAnimationFrames } from '../core/metasprite-extraction';
import { createEmptyProjectBaseChr } from '../core/project-graphics';
import type { GraphicsAssetDecodeSource } from '../core/project-graphics-assets';
import { decodeProjectGraphicsAssets } from '../core/project-graphics-assets';
import { compileProjectGraphics } from '../core/project-graphics-compiler';
import type { DeliveryCompilationStatus } from './delivery-workspace';
import type { ProjectView } from './types';

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isLegacyUnknownBaseChr(project: ProjectView): boolean {
  const baseChr = project.graphics.baseChr;
  const policy = baseChr.slotPolicies[0];
  return (
    baseChr.assetId !== null &&
    baseChr.byteLength === null &&
    baseChr.slotPolicies.length === 1 &&
    policy?.startSlot === 0 &&
    policy.endSlot === 511 &&
    policy.occupancy === 'unknown' &&
    policy.writability === 'locked' &&
    policy.provenance === 'pending-source'
  );
}

/** Builds demands only from executable Animation sources. */
export function createRuntimeAnimationDemands(project: ProjectView) {
  return project.animation.animations.flatMap((animation) =>
    animation.source?.indexedImage && animation.source.assetId
      ? [
          {
            animationId: animation.id,
            frames: extractLogicalAnimationFrames({
              image: animation.source.indexedImage,
              pixelOverrides: animation.pixelOverrides,
              frameIndices: animation.frameIndices,
              defaultDuration: animation.defaultDuration,
              frameDurations: animation.frameDurations,
              framePalettes: animation.framePalettes,
              paletteIndex: animation.paletteIndex,
              frameWidth: animation.frameWidth,
              frameHeight: animation.frameHeight,
              originX: animation.originX,
              originY: animation.originY,
              assetId: animation.source.assetId,
            }),
            flipDeduplication: project.animation.flipDeduplication,
          },
        ]
      : [],
  );
}

/** Runtime source registry. IDs are explicit; absent assets remain unresolved. */
export function runtimeGraphicsAssetSources(
  project: ProjectView,
  restoredSources: Iterable<GraphicsAssetDecodeSource>,
): readonly GraphicsAssetDecodeSource[] {
  const sources = Array.from(restoredSources);
  if (project.assetId && project.indexedImage) {
    sources.push({
      assetId: project.assetId,
      indexedImage: project.indexedImage,
      tiles: project.tiles,
    });
  }
  for (const animation of project.animation.animations) {
    const source = animation.source;
    if (source?.assetId) {
      sources.push({
        assetId: source.assetId,
        indexedImage: source.indexedImage,
      });
    }
  }
  return sources;
}

function missingAnimationDemandStatus(
  project: ProjectView,
  demands: ReturnType<typeof createRuntimeAnimationDemands>,
): DeliveryCompilationStatus | null {
  const demandIds = new Set(demands.map((demand) => demand.animationId));
  const missing = project.graphics.renderContexts.flatMap((context) =>
    context.animationIds
      .filter((animationId) => !demandIds.has(animationId))
      .map((animationId) => ({ contextId: context.id, animationId })),
  );
  if (missing.length === 0) return null;
  return {
    kind: 'failed-compilation',
    result: {
      success: false,
      failures: [
        {
          code: 'unresolved-render-context-consumer',
          message:
            'A render-context Animation has no executable runtime source and cannot produce a compiler demand.',
          details: { missing },
        },
      ],
    },
  };
}

/** One runtime projection of canonical inputs; never reconstructs placement. */
export function compileRuntimeProjectGraphics(
  project: ProjectView,
  restoredSources: Iterable<GraphicsAssetDecodeSource>,
): DeliveryCompilationStatus {
  const animationDemands = createRuntimeAnimationDemands(project);
  const missingDemand = missingAnimationDemandStatus(project, animationDemands);
  if (missingDemand) return missingDemand;

  const requiredAssetIds = new Set<ProjectAssetId>();
  for (const map of project.backgrounds?.maps ?? []) {
    for (const cell of map.cells) {
      if (cell === null) continue;
      const parsed = parseLogicalTileKey(cell.logicalKey);
      if (parsed) requiredAssetIds.add(parsed.assetId);
    }
  }
  for (const demand of animationDemands) {
    for (const frame of demand.frames) {
      for (const sprite of frame.sprites) {
        const parsed = parseLogicalTileKey(sprite.logicalKey);
        if (parsed) requiredAssetIds.add(parsed.assetId);
      }
    }
  }
  const decoded = decodeProjectGraphicsAssets(
    project.graphics,
    runtimeGraphicsAssetSources(project, restoredSources),
    requiredAssetIds,
  );
  if (!decoded.success) {
    return {
      kind:
        decoded.reason === 'missing-source'
          ? 'missing-assets'
          : 'unsupported-source',
      assetId: decoded.assetId,
    };
  }
  const result = compileProjectGraphics({
    graphics: project.graphics,
    decodedAssets: decoded.assets,
    backgroundMaps: project.backgrounds?.maps ?? [],
    animationDemands,
    baseChrBytes:
      project.animation.destinationChr.length > 0
        ? project.animation.destinationChr
        : undefined,
    chrRegions: project.chrRegions,
  });
  return result.success
    ? { kind: 'compiled', compiled: result }
    : { kind: 'failed-compilation', result };
}

/**
 * Clears a legacy Base CHR only when a no-Base canonical compilation exactly
 * reproduces the padded runtime envelope. This proves generated output.
 */
export function recoverGeneratedLegacyChrEnvelope(
  project: ProjectView,
  restoredSources: Iterable<GraphicsAssetDecodeSource>,
): ProjectView {
  if (
    !isLegacyUnknownBaseChr(project) ||
    project.animation.destinationChr.length !== 8192
  ) {
    return project;
  }
  const recovered: ProjectView = {
    ...project,
    graphics: { ...project.graphics, baseChr: createEmptyProjectBaseChr() },
    animation: {
      ...project.animation,
      destinationChrAsset: null,
      destinationChrAssetId: null,
      destinationChrName: null,
      destinationChr: new Uint8Array(),
    },
  };
  const compilation = compileRuntimeProjectGraphics(recovered, restoredSources);
  return compilation.kind === 'compiled' &&
    sameBytes(compilation.compiled.finalChr, project.animation.destinationChr)
    ? recovered
    : project;
}
