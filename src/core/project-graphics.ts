import type {
  LogicalTileKey,
  ProjectAssetId,
  ProjectAssetKind,
} from './asset-identity';
import type { TilePixelOverrides } from './pixel-overrides';
import type { QuantizationSettings } from './quantization-settings';
import type { Tile } from './types';
import {
  NES_CHR_ROM_SIZE,
  NES_CHR_ROM_TILE_COUNT,
  NES_PATTERN_TABLE_SIZE,
  NES_PATTERN_TABLE_TILE_COUNT,
} from './chr-pattern-table';

export const PROJECT_GRAPHICS_PROFILE = Object.freeze({
  mapper: 'nrom',
  chrMemory: 'static-8k-chr-rom',
  spriteMode: '8x8',
  patternTableMode: 'fixed-per-render-context',
} as const);

export type ProjectGraphicsProfile = typeof PROJECT_GRAPHICS_PROFILE;
export type GraphicsAssetKind = Exclude<ProjectAssetKind, 'base-chr'>;
export type GraphicsPaletteBank = 'background' | 'sprite' | null;

/** File/data ownership for one catalog entry. Identity lives on the entry. */
export interface ProjectAssetSource {
  readonly path: string;
  readonly name?: string;
  readonly sourceKind?: 'png' | 'chr' | 'nes';
  readonly dataUrl?: string;
}

export type GraphicsPixelOverrides =
  | {
      readonly kind: 'indexed-image';
      readonly values: readonly number[];
    }
  | {
      readonly kind: 'sparse-tiles';
      readonly values: TilePixelOverrides;
    };

/** Inputs that deterministically produce the asset's logical 8x8 tile grid. */
export interface ProjectLogicalTileSource {
  readonly decoding: 'png-indexed' | 'nes-2bpp';
  readonly quantization: QuantizationSettings | null;
  readonly paletteBank: GraphicsPaletteBank;
  readonly paletteAssignments?: readonly number[];
  readonly pixelOverrides?: GraphicsPixelOverrides;
}

export interface ProjectGraphicsAsset {
  readonly id: ProjectAssetId;
  readonly kind: GraphicsAssetKind;
  readonly name: string;
  readonly source: ProjectAssetSource | null;
  readonly logicalTiles: ProjectLogicalTileSource;
}

/** Decoded runtime projection. Never persisted and never implies CHR placement. */
export interface DecodedGraphicsAsset {
  readonly assetId: ProjectAssetId;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tiles: readonly Tile[];
  readonly tilesByLogicalKey: ReadonlyMap<LogicalTileKey, Tile>;
}

export type BaseChrOccupancy = 'available' | 'occupied' | 'unknown';
export type BaseChrWritability = 'writable' | 'locked';
export type BaseChrProvenance = 'none' | 'imported-base-chr' | 'pending-source';

/** Inclusive physical-slot policy range. Ranges must partition slots 0..511. */
export interface BaseChrSlotPolicyRange {
  readonly startSlot: number;
  readonly endSlot: number;
  readonly occupancy: BaseChrOccupancy;
  readonly writability: BaseChrWritability;
  readonly ownerAssetId: ProjectAssetId | null;
  readonly provenance: BaseChrProvenance;
}

export interface ProjectBaseChr {
  readonly assetId: ProjectAssetId | null;
  readonly source: ProjectAssetSource | null;
  /** Null means companion bytes were unavailable when migration ran. */
  readonly byteLength: number | null;
  /** Placement of Base CHR files containing at most one Pattern Table. */
  readonly shortFilePatternTable: 0 | 1;
  readonly slotPolicies: readonly BaseChrSlotPolicyRange[];
}

export interface ProjectRenderContext {
  readonly id: string;
  readonly name: string;
  readonly backgroundPatternTable: 0 | 1;
  readonly spriteMode: '8x8';
  readonly spritePatternTable: 0 | 1;
  /** Background map IDs, never asset IDs. */
  readonly mapIds: readonly string[];
  /** Animation IDs, never source-asset IDs. */
  readonly animationIds: readonly string[];
}

export interface ProjectGraphicsConfiguration {
  readonly profile: ProjectGraphicsProfile;
  readonly assets: readonly ProjectGraphicsAsset[];
  readonly baseChr: ProjectBaseChr;
  readonly renderContexts: readonly ProjectRenderContext[];
}

const TILE_BYTES = NES_PATTERN_TABLE_SIZE / NES_PATTERN_TABLE_TILE_COUNT;

function availableRange(startSlot: number, endSlot: number) {
  return {
    startSlot,
    endSlot,
    occupancy: 'available' as const,
    writability: 'writable' as const,
    ownerAssetId: null,
    provenance: 'none' as const,
  };
}

export function createEmptyProjectBaseChr(): ProjectBaseChr {
  return {
    assetId: null,
    source: null,
    byteLength: 0,
    shortFilePatternTable: 0,
    slotPolicies: [availableRange(0, NES_CHR_ROM_TILE_COUNT - 1)],
  };
}

export interface CreateProjectBaseChrOptions {
  readonly assetId: ProjectAssetId;
  readonly source: ProjectAssetSource;
  readonly byteLength: number | null;
  readonly shortFilePatternTable: 0 | 1;
}

/** Builds conservative semantic occupancy without inspecting tile byte values. */
export function createProjectBaseChr(
  options: CreateProjectBaseChrOptions,
): ProjectBaseChr {
  const { assetId, source, byteLength, shortFilePatternTable } = options;
  if (byteLength === null) {
    return {
      assetId,
      source,
      byteLength: null,
      shortFilePatternTable,
      slotPolicies: [
        {
          startSlot: 0,
          endSlot: NES_CHR_ROM_TILE_COUNT - 1,
          occupancy: 'unknown',
          writability: 'locked',
          ownerAssetId: assetId,
          provenance: 'pending-source',
        },
      ],
    };
  }
  if (
    !Number.isInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > NES_CHR_ROM_SIZE ||
    byteLength % TILE_BYTES !== 0
  ) {
    throw new RangeError(
      'Base CHR byteLength must contain at most 8 KiB of complete 16-byte tiles.',
    );
  }

  const tileCount = byteLength / TILE_BYTES;
  const startSlot =
    tileCount <= NES_PATTERN_TABLE_TILE_COUNT
      ? shortFilePatternTable * NES_PATTERN_TABLE_TILE_COUNT
      : 0;
  const endSlot = startSlot + tileCount - 1;
  const ranges: BaseChrSlotPolicyRange[] = [];
  if (startSlot > 0) ranges.push(availableRange(0, startSlot - 1));
  if (tileCount > 0) {
    ranges.push({
      startSlot,
      endSlot,
      occupancy: 'occupied',
      writability: 'locked',
      ownerAssetId: assetId,
      provenance: 'imported-base-chr',
    });
  }
  if (endSlot < NES_CHR_ROM_TILE_COUNT - 1) {
    ranges.push(
      availableRange(Math.max(0, endSlot + 1), NES_CHR_ROM_TILE_COUNT - 1),
    );
  }

  return {
    assetId,
    source,
    byteLength,
    shortFilePatternTable,
    slotPolicies: ranges,
  };
}

export function createDefaultRenderContext(
  animationIds: readonly string[] = [],
): ProjectRenderContext {
  return {
    id: 'render-context-default',
    name: 'Default Render Context',
    backgroundPatternTable: 0,
    spriteMode: '8x8',
    spritePatternTable: 1,
    mapIds: [],
    animationIds: [...animationIds],
  };
}

export function createDefaultProjectGraphicsConfiguration(
  animationIds: readonly string[] = [],
): ProjectGraphicsConfiguration {
  return {
    profile: PROJECT_GRAPHICS_PROFILE,
    assets: [],
    baseChr: createEmptyProjectBaseChr(),
    renderContexts: [createDefaultRenderContext(animationIds)],
  };
}

function hasUniqueNonEmptyStrings(values: readonly string[]): boolean {
  return (
    values.every((value) => typeof value === 'string' && value.trim() !== '') &&
    new Set(values).size === values.length
  );
}

export function validateProjectGraphicsConfiguration(
  graphics: ProjectGraphicsConfiguration,
): readonly string[] {
  const errors: string[] = [];
  const assetIds = graphics.assets.map((asset) => asset.id);
  if (!hasUniqueNonEmptyStrings(assetIds)) {
    errors.push('graphics.assets must have unique non-empty IDs.');
  }

  const ranges = graphics.baseChr.slotPolicies;
  let expectedStart = 0;
  for (const range of ranges) {
    if (
      !Number.isInteger(range.startSlot) ||
      !Number.isInteger(range.endSlot) ||
      range.startSlot !== expectedStart ||
      range.endSlot < range.startSlot ||
      range.endSlot >= NES_CHR_ROM_TILE_COUNT
    ) {
      errors.push(
        'graphics.baseChr.slotPolicies must be an ordered, non-overlapping partition of slots 0..511.',
      );
      break;
    }
    expectedStart = range.endSlot + 1;
  }
  if (expectedStart !== NES_CHR_ROM_TILE_COUNT) {
    errors.push('graphics.baseChr.slotPolicies must cover every slot 0..511.');
  }
  if (
    (graphics.baseChr.assetId === null) !==
    (graphics.baseChr.source === null)
  ) {
    errors.push(
      'graphics.baseChr assetId and source must both be set or null.',
    );
  }

  const contextIds = graphics.renderContexts.map((context) => context.id);
  if (!hasUniqueNonEmptyStrings(contextIds)) {
    errors.push('graphics.renderContexts must have unique non-empty IDs.');
  }
  for (const context of graphics.renderContexts) {
    if (
      !hasUniqueNonEmptyStrings(context.mapIds) ||
      !hasUniqueNonEmptyStrings(context.animationIds)
    ) {
      errors.push(
        `Render context "${context.id}" contains duplicate or empty consumer IDs.`,
      );
    }
  }
  return errors;
}
