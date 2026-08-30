import { parseLogicalTileKey, type LogicalTileKey } from './asset-identity';
import {
  allocateBackgroundChr,
  type BackgroundPhysicalAssignment,
} from './chr-background-allocation';
import { decodeChrTile } from './chr-decoder';
import { encodeTile } from './chr-encoder';
import {
  baseChrPhysicalStart,
  collectReservedPhysicalTileIndices,
  localPatternTableTileIndex,
  NES_CHR_ROM_SIZE,
  NES_CHR_ROM_TILE_COUNT,
  NES_PATTERN_TABLE_TILE_COUNT,
  patternTableForPhysicalTile,
  validateChrRegion,
  type ChrRegion,
  type PatternTableSlot,
  type SpritePatternTable,
} from './chr-pattern-table';
import {
  allocateSpritesheetChr,
  type MetaspritePhysicalAssignment,
} from './chr-spritesheet-allocation';
import type { BackgroundMapDefinition } from './background-model';
import type { LogicalAnimationFrame } from './metasprite-extraction';
import {
  PROJECT_GRAPHICS_PROFILE,
  validateProjectGraphicsConfiguration,
  type BaseChrOccupancy,
  type BaseChrProvenance,
  type BaseChrWritability,
  type DecodedGraphicsAsset,
  type ProjectGraphicsConfiguration,
  type ProjectRenderContext,
} from './project-graphics';
import type { Tile } from './types';

const TILE_BYTES = 16;

export type ProjectGraphicsCompilationFailureCode =
  | 'invalid-graphics-configuration'
  | 'invalid-base-chr'
  | 'unresolved-base-chr'
  | 'unresolved-render-context-consumer'
  | 'unresolved-logical-tile'
  | 'pattern-table-capacity-overflow'
  | 'allocation-conflict';

export interface ProjectGraphicsCompilationFailure {
  readonly code: ProjectGraphicsCompilationFailureCode;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AnimationLogicalDemand {
  readonly animationId: string;
  readonly frames: readonly LogicalAnimationFrame[];
  readonly flipDeduplication?: boolean;
}

export type CompiledTileUsage =
  | {
      readonly kind: 'background';
      readonly contextId: string;
      readonly mapId: string;
      readonly cellIndex: number;
    }
  | {
      readonly kind: 'animation';
      readonly contextId: string;
      readonly animationId: string;
      readonly frameIndex: number;
      readonly spriteIndex: number;
      readonly flipAttributes: number;
    };

export interface CompiledLogicalTilePlacement {
  readonly logicalKey: LogicalTileKey;
  readonly originAssetId: string;
  readonly physicalSlot: number;
  readonly patternTable: SpritePatternTable;
  readonly localPatternTableIndex: number;
  readonly exactTileBytes: readonly number[];
  readonly usages: readonly CompiledTileUsage[];
}

export type CompiledChrSlotState =
  'available' | 'reserved' | 'locked' | 'base-chr' | 'project';

export interface CompiledChrAllocation {
  readonly physicalSlot: number;
  readonly patternTable: SpritePatternTable;
  readonly localPatternTableIndex: number;
  readonly state: CompiledChrSlotState;
  readonly baseChrPolicy: Readonly<{
    occupancy: BaseChrOccupancy;
    writability: BaseChrWritability;
    ownerAssetId: string | null;
    provenance: BaseChrProvenance;
  }>;
  readonly originAssetId: string | null;
  readonly originLogicalKey: LogicalTileKey | null;
  readonly regionIds: readonly string[];
  readonly reservationIds: readonly string[];
  readonly exactTileBytes: readonly number[] | null;
  readonly usages: readonly CompiledTileUsage[];
}

export interface CompiledBackgroundMap {
  readonly contextId: string;
  readonly mapId: string;
  readonly requiredPatternTable: SpritePatternTable;
  readonly nametable: Uint8Array;
  readonly assignments: readonly BackgroundPhysicalAssignment[];
}

export interface CompiledAnimation {
  readonly contextId: string;
  readonly animationId: string;
  readonly requiredPatternTable: SpritePatternTable;
  readonly frameAssignments: readonly (readonly MetaspritePhysicalAssignment[])[];
  readonly oamTileIndexes: readonly (readonly number[])[];
}

export interface PatternTableCapacityFacts {
  readonly patternTable: SpritePatternTable;
  readonly capacitySlots: 256;
  readonly baseChrSlots: number;
  readonly projectSlots: number;
  readonly reservedAvailableSlots: number;
  readonly lockedAvailableSlots: number;
  readonly availableSlots: number;
}

export interface CompiledProjectGraphics {
  readonly success: true;
  /** A defensive copy is returned so callers cannot mutate compiler state. */
  readonly finalChr: Uint8Array;
  readonly allocationManifest: readonly CompiledChrAllocation[];
  readonly logicalTilePlacements: readonly CompiledLogicalTilePlacement[];
  readonly backgrounds: readonly CompiledBackgroundMap[];
  readonly animations: readonly CompiledAnimation[];
  readonly capacity: readonly [
    PatternTableCapacityFacts,
    PatternTableCapacityFacts,
  ];
  readonly requiredPatternTableConfigurations: readonly ProjectRenderContext[];
}

export interface FailedProjectGraphicsCompilation {
  readonly success: false;
  readonly failures: readonly ProjectGraphicsCompilationFailure[];
}

export type ProjectGraphicsCompilationResult =
  CompiledProjectGraphics | FailedProjectGraphicsCompilation;

export interface CompileProjectGraphicsOptions {
  readonly graphics: ProjectGraphicsConfiguration;
  readonly decodedAssets: readonly DecodedGraphicsAsset[];
  readonly backgroundMaps: readonly BackgroundMapDefinition[];
  readonly animationDemands: readonly AnimationLogicalDemand[];
  readonly baseChrBytes?: Uint8Array | null;
  readonly chrRegions?: readonly ChrRegion[];
}

interface MutablePlacement {
  logicalKey: LogicalTileKey;
  originAssetId: string;
  physicalSlot: number;
  patternTable: SpritePatternTable;
  localPatternTableIndex: number;
  exactTileBytes: readonly number[];
  usages: CompiledTileUsage[];
}

function failure(
  code: ProjectGraphicsCompilationFailureCode,
  message: string,
  details: Record<string, unknown> = {},
): FailedProjectGraphicsCompilation {
  return Object.freeze({
    success: false,
    failures: Object.freeze([
      Object.freeze({ code, message, details: Object.freeze(details) }),
    ]),
  });
}

function cloneContext(context: ProjectRenderContext): ProjectRenderContext {
  return Object.freeze({
    ...context,
    mapIds: Object.freeze([...context.mapIds]),
    animationIds: Object.freeze([...context.animationIds]),
  });
}

function tileBytes(tile: Tile): readonly number[] {
  return Object.freeze(Array.from(encodeTile(tile)));
}

function buildInitialSlots(
  graphics: ProjectGraphicsConfiguration,
  baseChrBytes: Uint8Array | null | undefined,
): PatternTableSlot[] | FailedProjectGraphicsCompilation {
  const baseChr = graphics.baseChr;
  if (baseChr.byteLength === null) {
    return failure(
      'unresolved-base-chr',
      'Base CHR bytes are unresolved, so an authoritative 8 KiB image cannot be compiled.',
      { assetId: baseChr.assetId },
    );
  }
  if (
    !Number.isInteger(baseChr.byteLength) ||
    baseChr.byteLength < 0 ||
    baseChr.byteLength > NES_CHR_ROM_SIZE ||
    baseChr.byteLength % TILE_BYTES !== 0
  ) {
    return failure('invalid-base-chr', 'Base CHR byte length is invalid.', {
      byteLength: baseChr.byteLength,
    });
  }
  const bytes = baseChrBytes ?? new Uint8Array(0);
  if (bytes.length !== baseChr.byteLength) {
    return failure(
      baseChr.byteLength > 0 ? 'unresolved-base-chr' : 'invalid-base-chr',
      'Resolved Base CHR bytes do not match project Base CHR metadata.',
      {
        expectedByteLength: baseChr.byteLength,
        actualByteLength: bytes.length,
      },
    );
  }

  const slots: PatternTableSlot[] = Array.from(
    { length: NES_CHR_ROM_TILE_COUNT },
    (_, physicalTileIndex) => ({ physicalTileIndex, tile: null, source: null }),
  );
  const byteStartSlot = baseChrPhysicalStart(
    bytes.length / TILE_BYTES,
    baseChr.shortFilePatternTable,
  );
  for (const policy of baseChr.slotPolicies) {
    if (policy.occupancy !== 'occupied') continue;
    for (
      let physicalSlot = policy.startSlot;
      physicalSlot <= policy.endSlot;
      physicalSlot += 1
    ) {
      const byteTileIndex = physicalSlot - byteStartSlot;
      if (byteTileIndex < 0 || byteTileIndex * TILE_BYTES >= bytes.length) {
        return failure(
          'invalid-base-chr',
          'Base CHR occupancy policy references a slot without resolved bytes.',
          { physicalSlot },
        );
      }
      const encodedStart = byteTileIndex * TILE_BYTES;
      slots[physicalSlot] = {
        physicalTileIndex: physicalSlot,
        tile: decodeChrTile(
          bytes.subarray(encodedStart, encodedStart + TILE_BYTES),
          physicalSlot,
          physicalSlot % 16,
          Math.floor(localPatternTableTileIndex(physicalSlot) / 16),
        ),
        source: 'destination',
      };
    }
  }
  return slots;
}

function collectPolicyBlockedSlots(
  graphics: ProjectGraphicsConfiguration,
): ReadonlySet<number> {
  const blocked = new Set<number>();
  for (const policy of graphics.baseChr.slotPolicies) {
    if (policy.occupancy === 'available' && policy.writability === 'writable') {
      continue;
    }
    for (let slot = policy.startSlot; slot <= policy.endSlot; slot += 1) {
      blocked.add(slot);
    }
  }
  return blocked;
}

function createTileLookup(
  assets: readonly DecodedGraphicsAsset[],
): Map<LogicalTileKey, Tile> | FailedProjectGraphicsCompilation {
  const lookup = new Map<LogicalTileKey, Tile>();
  for (const asset of assets) {
    for (const [key, tile] of asset.tilesByLogicalKey) {
      const parsed = parseLogicalTileKey(key);
      if (parsed?.assetId !== asset.assetId || tile.pixels.length !== 64) {
        return failure(
          'allocation-conflict',
          'Decoded asset contains an invalid or conflicting logical tile.',
          { assetId: asset.assetId, logicalKey: key },
        );
      }
      const existing = lookup.get(key);
      if (
        existing &&
        (existing.pixels.length !== tile.pixels.length ||
          existing.pixels.some((value, index) => value !== tile.pixels[index]))
      ) {
        return failure(
          'allocation-conflict',
          'One logical tile key resolves to different exact tile bytes.',
          { logicalKey: key },
        );
      }
      lookup.set(key, tile);
    }
  }
  return lookup;
}

function errorToFailure(error: unknown): FailedProjectGraphicsCompilation {
  if (error instanceof Error) {
    const candidate = error as Error & {
      code?: string;
      details?: Record<string, unknown>;
    };
    if (
      candidate.code === 'background-capacity-overflow' ||
      candidate.code === 'pattern-table-capacity-overflow'
    ) {
      return failure(
        'pattern-table-capacity-overflow',
        'A required Pattern Table has no capacity for all project demands.',
        candidate.details ?? {},
      );
    }
    if (candidate.code === 'unresolved-logical-tile') {
      return failure(
        'unresolved-logical-tile',
        'A logical tile required by a consumer could not be resolved.',
        candidate.details ?? {},
      );
    }
    return failure('allocation-conflict', error.message, {
      ...(candidate.code ? { causeCode: candidate.code } : {}),
      ...(candidate.details ?? {}),
    });
  }
  return failure(
    'allocation-conflict',
    'Unknown graphics allocation conflict.',
  );
}

function placementKey(
  logicalKey: LogicalTileKey,
  physicalSlot: number,
): string {
  return `${logicalKey}\u0000${String(physicalSlot)}`;
}

function addPlacementUsage(
  placements: Map<string, MutablePlacement>,
  slots: readonly PatternTableSlot[],
  logicalKey: LogicalTileKey,
  physicalSlot: number,
  usage: CompiledTileUsage,
): void {
  const key = placementKey(logicalKey, physicalSlot);
  const existing = placements.get(key);
  if (existing) {
    existing.usages.push(usage);
    return;
  }
  const parsed = parseLogicalTileKey(logicalKey);
  const tile = slots[physicalSlot]?.tile;
  if (!parsed || !tile) {
    throw new Error(`Missing compiled tile for ${logicalKey}.`);
  }
  placements.set(key, {
    logicalKey,
    originAssetId: parsed.assetId,
    physicalSlot,
    patternTable: patternTableForPhysicalTile(physicalSlot),
    localPatternTableIndex: localPatternTableTileIndex(physicalSlot),
    exactTileBytes: tileBytes(tile),
    usages: [usage],
  });
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareUsage(
  left: CompiledTileUsage,
  right: CompiledTileUsage,
): number {
  if (left.kind !== right.kind) return left.kind === 'background' ? -1 : 1;
  const contextOrder = compareOrdinal(left.contextId, right.contextId);
  if (contextOrder !== 0) return contextOrder;
  if (left.kind === 'background' && right.kind === 'background') {
    return (
      compareOrdinal(left.mapId, right.mapId) ||
      left.cellIndex - right.cellIndex
    );
  }
  if (left.kind === 'animation' && right.kind === 'animation') {
    return (
      compareOrdinal(left.animationId, right.animationId) ||
      left.frameIndex - right.frameIndex ||
      left.spriteIndex - right.spriteIndex ||
      left.flipAttributes - right.flipAttributes
    );
  }
  return 0;
}

function compileCapacity(
  patternTable: SpritePatternTable,
  slots: readonly PatternTableSlot[],
  graphics: ProjectGraphicsConfiguration,
  reserved: ReadonlySet<number>,
): PatternTableCapacityFacts {
  const start = patternTable * NES_PATTERN_TABLE_TILE_COUNT;
  let baseChrSlots = 0;
  let projectSlots = 0;
  let reservedAvailableSlots = 0;
  let lockedAvailableSlots = 0;
  let availableSlots = 0;
  for (
    let physicalSlot = start;
    physicalSlot < start + 256;
    physicalSlot += 1
  ) {
    const slot = slots[physicalSlot];
    if (slot?.source === 'destination') baseChrSlots += 1;
    else if (slot?.source === 'imported') projectSlots += 1;
    else {
      const policy = graphics.baseChr.slotPolicies.find(
        (range) =>
          physicalSlot >= range.startSlot && physicalSlot <= range.endSlot,
      );
      if (reserved.has(physicalSlot)) reservedAvailableSlots += 1;
      if (policy?.writability === 'locked') lockedAvailableSlots += 1;
      if (
        !reserved.has(physicalSlot) &&
        policy?.occupancy === 'available' &&
        policy.writability === 'writable'
      ) {
        availableSlots += 1;
      }
    }
  }
  return Object.freeze({
    patternTable,
    capacitySlots: 256,
    baseChrSlots,
    projectSlots,
    reservedAvailableSlots,
    lockedAvailableSlots,
    availableSlots,
  });
}

function compileProjectGraphicsUnchecked(
  options: CompileProjectGraphicsOptions,
): ProjectGraphicsCompilationResult {
  const configurationErrors = [
    ...validateProjectGraphicsConfiguration(options.graphics),
  ];
  const profile = options.graphics.profile;
  if (
    Object.entries(PROJECT_GRAPHICS_PROFILE).some(
      ([key, value]) =>
        (profile as unknown as Record<string, unknown>)[key] !== value,
    )
  ) {
    configurationErrors.push('Unsupported graphics profile.');
  }
  for (const context of options.graphics.renderContexts) {
    const runtimeContext = context as unknown as {
      backgroundPatternTable: number;
      spriteMode: string;
      spritePatternTable: number;
    };
    if (
      (runtimeContext.backgroundPatternTable !== 0 &&
        runtimeContext.backgroundPatternTable !== 1) ||
      runtimeContext.spriteMode !== '8x8' ||
      (runtimeContext.spritePatternTable !== 0 &&
        runtimeContext.spritePatternTable !== 1)
    ) {
      configurationErrors.push(
        `Render context "${context.id}" has unsupported Pattern Table or Sprite mode configuration.`,
      );
    }
  }
  if (configurationErrors.length > 0) {
    return failure(
      'invalid-graphics-configuration',
      'Project graphics configuration is invalid.',
      { errors: Object.freeze([...configurationErrors]) },
    );
  }

  const initialSlots = buildInitialSlots(
    options.graphics,
    options.baseChrBytes,
  );
  if (!Array.isArray(initialSlots)) return initialSlots;
  const tileLookup = createTileLookup(options.decodedAssets);
  if (!(tileLookup instanceof Map)) return tileLookup;

  const catalogAssetIds = new Set(
    options.graphics.assets.map((asset) => asset.id),
  );
  const decodedAssetIds = options.decodedAssets.map((asset) => asset.assetId);
  if (
    new Set(decodedAssetIds).size !== decodedAssetIds.length ||
    decodedAssetIds.some((assetId) => !catalogAssetIds.has(assetId))
  ) {
    return failure(
      'allocation-conflict',
      'Decoded graphics assets must have unique IDs present in the canonical asset catalog.',
    );
  }

  const mapsById = new Map(options.backgroundMaps.map((map) => [map.id, map]));
  const animationsById = new Map(
    options.animationDemands.map((demand) => [demand.animationId, demand]),
  );
  if (
    mapsById.size !== options.backgroundMaps.length ||
    animationsById.size !== options.animationDemands.length
  ) {
    return failure(
      'allocation-conflict',
      'Background Map and Animation demand IDs must be unique.',
    );
  }
  for (const map of options.backgroundMaps) {
    for (const cell of map.cells) {
      if (cell === null) continue;
      const parsed = parseLogicalTileKey(cell.logicalKey);
      if (
        !parsed ||
        map.assetId === undefined ||
        parsed.assetId !== map.assetId
      ) {
        return failure(
          'unresolved-logical-tile',
          'Background Map logical tiles must resolve through its declared graphics asset.',
          {
            mapId: map.id,
            assetId: map.assetId,
            logicalKey: cell.logicalKey,
          },
        );
      }
    }
  }
  for (const demand of options.animationDemands) {
    for (const logicalFrame of demand.frames) {
      for (const sprite of logicalFrame.sprites) {
        const parsed = parseLogicalTileKey(sprite.logicalKey);
        if (!parsed || !catalogAssetIds.has(parsed.assetId)) {
          return failure(
            'unresolved-logical-tile',
            'Animation demand references a logical tile outside the asset catalog.',
            { animationId: demand.animationId, logicalKey: sprite.logicalKey },
          );
        }
        const decoded = tileLookup.get(sprite.logicalKey);
        if (!decoded) {
          return failure(
            'unresolved-logical-tile',
            'Animation demand references a logical tile that was not decoded.',
            { animationId: demand.animationId, logicalKey: sprite.logicalKey },
          );
        }
        if (
          sprite.pixels.length !== 64 ||
          decoded.pixels.some((value, index) => value !== sprite.pixels[index])
        ) {
          return failure(
            'allocation-conflict',
            'Animation demand conflicts with decoded bytes for one logical tile.',
            { animationId: demand.animationId, logicalKey: sprite.logicalKey },
          );
        }
      }
    }
  }
  for (const context of options.graphics.renderContexts) {
    for (const mapId of context.mapIds) {
      if (!mapsById.has(mapId)) {
        return failure(
          'unresolved-render-context-consumer',
          'Render context references an unavailable Background Map.',
          { contextId: context.id, mapId },
        );
      }
    }
    for (const animationId of context.animationIds) {
      if (!animationsById.has(animationId)) {
        return failure(
          'unresolved-render-context-consumer',
          'Render context references unavailable Animation demands.',
          { contextId: context.id, animationId },
        );
      }
    }
  }

  const regions = options.chrRegions ?? [];
  const regionIds = regions.map((region) => region.id);
  if (
    new Set(regionIds).size !== regionIds.length ||
    regions.some((region) => !validateChrRegion(region).valid)
  ) {
    return failure(
      'allocation-conflict',
      'CHR Regions and Reservations must have unique IDs and valid local ranges.',
    );
  }
  const reservations = collectReservedPhysicalTileIndices(regions);
  const blocked = new Set([
    ...reservations,
    ...collectPolicyBlockedSlots(options.graphics),
  ]);
  let slots: readonly PatternTableSlot[] = initialSlots;
  const backgrounds: CompiledBackgroundMap[] = [];
  const animations: CompiledAnimation[] = [];
  const placements = new Map<string, MutablePlacement>();
  const allUsagesBySlot = new Map<number, CompiledTileUsage[]>();

  const recordUsage = (
    physicalSlot: number,
    usage: CompiledTileUsage,
  ): void => {
    const usages = allUsagesBySlot.get(physicalSlot) ?? [];
    usages.push(usage);
    allUsagesBySlot.set(physicalSlot, usages);
  };

  for (const context of options.graphics.renderContexts) {
    for (const mapId of context.mapIds) {
      const sourceMap = mapsById.get(mapId);
      if (!sourceMap) continue;
      const map = {
        ...sourceMap,
        patternTable: context.backgroundPatternTable,
      };
      const compiled = allocateBackgroundChr({
        map,
        initialSlots: slots,
        tileMap: tileLookup,
        reservedIndices: blocked,
      });
      slots = compiled.slots;
      const assignments = Object.freeze(
        compiled.cellAssignments.map((assignment) =>
          Object.freeze({ ...assignment }),
        ),
      );
      const nametable = compiled.nametable.slice();
      backgrounds.push(
        Object.freeze({
          contextId: context.id,
          mapId,
          requiredPatternTable: context.backgroundPatternTable,
          get nametable() {
            return nametable.slice();
          },
          assignments,
        }),
      );
      assignments.forEach((assignment) => {
        const usage = Object.freeze({
          kind: 'background' as const,
          contextId: context.id,
          mapId,
          cellIndex: assignment.cellIndex,
        });
        recordUsage(assignment.physicalTileIndex, usage);
        if (assignment.logicalKey !== null) {
          addPlacementUsage(
            placements,
            slots,
            assignment.logicalKey,
            assignment.physicalTileIndex,
            usage,
          );
        }
      });
    }
  }

  for (const context of options.graphics.renderContexts) {
    for (const animationId of context.animationIds) {
      const demand = animationsById.get(animationId);
      if (!demand) continue;
      const compiled = allocateSpritesheetChr({
        logicalFrames: demand.frames,
        initialSlots: slots,
        patternTable: context.spritePatternTable,
        reservedIndices: blocked,
        flipDeduplication: demand.flipDeduplication,
      });
      slots = compiled.slots;
      const frameAssignments = Object.freeze(
        compiled.frameAssignments.map((frame) =>
          Object.freeze(
            frame.map((assignment) => Object.freeze({ ...assignment })),
          ),
        ),
      );
      animations.push(
        Object.freeze({
          contextId: context.id,
          animationId,
          requiredPatternTable: context.spritePatternTable,
          frameAssignments,
          oamTileIndexes: Object.freeze(
            frameAssignments.map((frame) =>
              Object.freeze(
                frame.map((assignment) => assignment.localTileIndex),
              ),
            ),
          ),
        }),
      );
      frameAssignments.forEach((frame, frameIndex) => {
        frame.forEach((assignment, spriteIndex) => {
          const usage = Object.freeze({
            kind: 'animation' as const,
            contextId: context.id,
            animationId,
            frameIndex,
            spriteIndex,
            flipAttributes: assignment.flipAttributes,
          });
          recordUsage(assignment.physicalTileIndex, usage);
          addPlacementUsage(
            placements,
            slots,
            assignment.logicalKey,
            assignment.physicalTileIndex,
            usage,
          );
        });
      });
    }
  }

  const firstPlacementBySlot = new Map<number, MutablePlacement>();
  for (const placement of placements.values()) {
    if (!firstPlacementBySlot.has(placement.physicalSlot)) {
      firstPlacementBySlot.set(placement.physicalSlot, placement);
    }
  }

  const immutablePlacements = Object.freeze(
    [...placements.values()]
      .sort(
        (a, b) =>
          a.physicalSlot - b.physicalSlot ||
          compareOrdinal(a.logicalKey, b.logicalKey),
      )
      .map((placement) =>
        Object.freeze({
          ...placement,
          usages: Object.freeze([...placement.usages].sort(compareUsage)),
        }),
      ),
  );
  const allocationManifest = Object.freeze(
    slots.map((slot) => {
      const policy = options.graphics.baseChr.slotPolicies.find(
        (range) =>
          slot.physicalTileIndex >= range.startSlot &&
          slot.physicalTileIndex <= range.endSlot,
      );
      const slotRegions = regions.filter(
        (region) =>
          region.patternTable ===
            patternTableForPhysicalTile(slot.physicalTileIndex) &&
          localPatternTableTileIndex(slot.physicalTileIndex) >=
            region.startTile &&
          localPatternTableTileIndex(slot.physicalTileIndex) <= region.endTile,
      );
      const origin = firstPlacementBySlot.get(slot.physicalTileIndex);
      const state: CompiledChrSlotState =
        slot.source === 'destination'
          ? 'base-chr'
          : slot.source === 'imported'
            ? 'project'
            : reservations.has(slot.physicalTileIndex)
              ? 'reserved'
              : policy?.writability === 'locked'
                ? 'locked'
                : 'available';
      return Object.freeze({
        physicalSlot: slot.physicalTileIndex,
        patternTable: patternTableForPhysicalTile(slot.physicalTileIndex),
        localPatternTableIndex: localPatternTableTileIndex(
          slot.physicalTileIndex,
        ),
        state,
        baseChrPolicy: Object.freeze({
          occupancy: policy?.occupancy ?? 'unknown',
          writability: policy?.writability ?? 'locked',
          ownerAssetId: policy?.ownerAssetId ?? null,
          provenance: policy?.provenance ?? 'none',
        }),
        originAssetId:
          slot.source === 'destination'
            ? (policy?.ownerAssetId ?? options.graphics.baseChr.assetId)
            : (origin?.originAssetId ?? null),
        originLogicalKey: origin?.logicalKey ?? null,
        regionIds: Object.freeze(
          slotRegions
            .filter((region) => region.kind === 'region')
            .map((region) => region.id),
        ),
        reservationIds: Object.freeze(
          slotRegions
            .filter((region) => region.kind === 'reservation')
            .map((region) => region.id),
        ),
        exactTileBytes: slot.tile ? tileBytes(slot.tile) : null,
        usages: Object.freeze(
          [...(allUsagesBySlot.get(slot.physicalTileIndex) ?? [])].sort(
            compareUsage,
          ),
        ),
      });
    }),
  );
  const finalChrBytes = new Uint8Array(NES_CHR_ROM_SIZE);
  const resolvedBaseChrBytes = options.baseChrBytes ?? new Uint8Array(0);
  finalChrBytes.set(
    resolvedBaseChrBytes,
    baseChrPhysicalStart(
      resolvedBaseChrBytes.length / TILE_BYTES,
      options.graphics.baseChr.shortFilePatternTable,
    ) * TILE_BYTES,
  );
  for (const slot of slots) {
    if (slot.source === 'imported' && slot.tile !== null) {
      finalChrBytes.set(
        encodeTile(slot.tile),
        slot.physicalTileIndex * TILE_BYTES,
      );
    }
  }
  const capacity: [PatternTableCapacityFacts, PatternTableCapacityFacts] = [
    compileCapacity(0, slots, options.graphics, reservations),
    compileCapacity(1, slots, options.graphics, reservations),
  ];

  const result = {
    success: true as const,
    get finalChr() {
      return finalChrBytes.slice();
    },
    allocationManifest,
    logicalTilePlacements: immutablePlacements,
    backgrounds: Object.freeze(backgrounds),
    animations: Object.freeze(animations),
    capacity: Object.freeze(capacity),
    requiredPatternTableConfigurations: Object.freeze(
      options.graphics.renderContexts.map(cloneContext),
    ),
  };
  return Object.freeze(result);
}

/** Never exposes partial output or lets malformed runtime input escape as a throw. */
export function compileProjectGraphics(
  options: CompileProjectGraphicsOptions,
): ProjectGraphicsCompilationResult {
  try {
    return compileProjectGraphicsUnchecked(options);
  } catch (error) {
    return errorToFailure(error);
  }
}
