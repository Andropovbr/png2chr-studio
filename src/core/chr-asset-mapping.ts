/**
 * Pure derived domain engine for CHR Tile Ownership and Asset Mapping.
 *
 * Implements bidirectional physical CHR attribution answering:
 * - Given physical CHR slot N (0..511):
 *   - Where did this tile originate? (`origin?: PhysicalTileOrigin`)
 *   - Which logical asset produced it? (`origin.primaryAssetId`)
 *   - Which project objects currently use it? (`usages: readonly PhysicalTileUsage[]`)
 *   - Is the physical tile shared because of deduplication? (`isShared: boolean`)
 * - Given `ProjectAssetId`:
 *   - Which physical CHR slots are currently associated with it? (`physicalIndicesByAsset`)
 *
 * Established for Milestone 6: Tile Ownership & Asset Mapping.
 * This is a deterministic, runtime-derived mapping and is never persisted into .p2c files.
 */

import {
  computeAnimationLogicalTileCoordinate,
  createLogicalTileKey,
  normalizeProjectAssetId,
  type LogicalTileKey,
  type ProjectAssetId,
} from './asset-identity';
import type { AnimationProjectModel } from './animation-model';
import {
  baseChrPhysicalStart,
  collectReservedPhysicalTileIndices,
  createPatternTableSlots,
  findNextAvailableChrSlot,
  localPatternTableTileIndex,
  NES_CHR_ROM_SIZE,
  NES_CHR_ROM_TILE_COUNT,
  patternTableForPhysicalTile,
  type ChrRegion,
  type SpritePatternTable,
} from './chr-pattern-table';
import type { ProjectMode } from './project-mode';
import type { ProjectAnimationItemConfig, StudioProject } from './project';
import {
  deduplicateTileSet,
  deduplicateTilesConsideringFlips,
} from './tile-deduplication';
import type { Tile } from './types';

/** Mechanism by which a physical tile slot came into existence. */
export type PhysicalTileCreationKind =
  'extracted' | 'base-chr' | 'manual-materialized';

/** Provenance / primary ownership of a physical CHR slot. */
export interface PhysicalTileOrigin {
  readonly primaryAssetId: ProjectAssetId;
  readonly primaryAssetName?: string;
  readonly logicalKey?: LogicalTileKey;
  readonly sourceCoordinates?: {
    readonly tileX: number;
    readonly tileY: number;
    readonly pixelX: number;
    readonly pixelY: number;
  };
  readonly creationKind: PhysicalTileCreationKind;
}

/** Usage of a physical tile by an animation metasprite. */
export interface AnimationTileUsage {
  readonly type: 'animation';
  readonly assetId: ProjectAssetId;
  readonly entity?: string;
  readonly animationId: string;
  readonly animationName?: string;
  readonly frameIndex: number;
  readonly spriteIndex: number;
  readonly x: number;
  readonly y: number;
  readonly horizontalFlip: boolean;
  readonly verticalFlip: boolean;
  readonly physicalTileIndex: number;
  readonly logicalKey?: LogicalTileKey;
  readonly sourceTileColumn?: number;
  readonly sourceTileRow?: number;
}

/** Usage of a physical tile by a Playfield Nametable cell. */
export interface PlayfieldTileUsage {
  readonly type: 'playfield';
  readonly assetId: ProjectAssetId;
  readonly column: number;
  readonly row: number;
  readonly nametableIndex: number;
  readonly localTileIndex: number;
  readonly physicalTileIndex: number;
  readonly logicalKey?: LogicalTileKey;
}

/** Usage of a physical tile by a Tileset entry. */
export interface TilesetTileUsage {
  readonly type: 'tileset';
  readonly assetId: ProjectAssetId;
  readonly tileIndex: number;
  readonly sourceIndex?: number;
  readonly physicalTileIndex: number;
  readonly logicalKey?: LogicalTileKey;
  readonly sourceCoordinates?: {
    readonly tileX: number;
    readonly tileY: number;
  };
}

/** Discriminated union of all active physical tile usage types in the project. */
export type PhysicalTileUsage =
  AnimationTileUsage | PlayfieldTileUsage | TilesetTileUsage;

/** Structured attribution record for a single physical CHR slot (0..511). */
export interface PhysicalSlotAttribution {
  readonly physicalIndex: number;
  readonly patternTable: SpritePatternTable;
  readonly localIndex: number;

  readonly origin?: PhysicalTileOrigin;
  readonly usages: readonly PhysicalTileUsage[];

  readonly usageCount: number;
  readonly isShared: boolean;
}

/** Pure bidirectional derived CHR asset mapping index. */
export interface ChrAssetMappingIndex {
  /** Complete physical slot attributions spanning both PT0 and PT1 (length 512). */
  readonly byPhysicalIndex: readonly PhysicalSlotAttribution[];

  /** All physical slots associated with an asset ID (either as primary origin or active consumer). */
  readonly physicalIndicesByAsset: ReadonlyMap<
    ProjectAssetId,
    ReadonlySet<number>
  >;

  /** Active usages indexed by canonical logical tile key. */
  readonly usagesByLogicalKey: ReadonlyMap<
    LogicalTileKey,
    readonly PhysicalTileUsage[]
  >;
}

/** Generic animation item shape compatible with both project config and UI settings. */
export interface GenericAnimationItemConfig {
  readonly id: string;
  readonly name: string;
  readonly entity?: string;
  readonly asset?: {
    readonly id?: ProjectAssetId;
    readonly name?: string;
  } | null;
  readonly source?: {
    readonly assetId?: string;
    readonly fileName?: string;
  } | null;
}

/** Options for constructing the pure ChrAssetMappingIndex. */
export interface BuildChrAssetMappingIndexOptions {
  /** Optional active studio project. */
  readonly project?: StudioProject | null;
  /** Active project mode override (if not extracted from project). */
  readonly mode?: ProjectMode;
  /** Compiled animation project model (authoritative physical allocation source). */
  readonly animationModel?: AnimationProjectModel | null;
  /** Animation items for resolving asset identities. */
  readonly animations?: readonly (
    ProjectAnimationItemConfig | GenericAnimationItemConfig
  )[];
  /** Base CHR binary buffer (up to 8 KiB). */
  readonly baseChr?: Uint8Array | null;
  /** Stable asset ID for Base CHR. */
  readonly baseChrAssetId?: ProjectAssetId;
  /** Display name for Base CHR asset. */
  readonly baseChrName?: string;
  /** Destination pattern table for tileset / playfield / base CHR (0 or 1). */
  readonly destinationPatternTable?: SpritePatternTable;
  /** Extracted / raw tiles for tileset mode. */
  readonly tiles?: readonly Tile[];
  /** Nametable buffer for playfield mode (960 bytes). */
  readonly playfieldNametable?: Uint8Array | null;
  /** Stable asset ID for Tileset. */
  readonly tilesetAssetId?: ProjectAssetId;
  /** Stable asset ID for Playfield. */
  readonly playfieldAssetId?: ProjectAssetId;
  /** Deduplication settings. */
  readonly deduplicationEnabled?: boolean;
  readonly flipDeduplicationEnabled?: boolean;
  /** CHR regions/reservations (if not extracted from project). */
  readonly chrRegions?: readonly ChrRegion[];
  /** Optional manual materialization origins (e.g. for direct CHR Editor edits). */
  readonly manualOrigins?: ReadonlyMap<number, PhysicalTileOrigin>;
}

/** Helper to check whether a 16-byte CHR tile in a raw buffer contains non-zero pixels. */
function rawChrTileHasData(baseChr: Uint8Array, tileIndex: number): boolean {
  const start = tileIndex * 16;
  return baseChr.subarray(start, start + 16).some((b) => b !== 0);
}

/** Compares two PhysicalTileUsages to enforce deterministic, canonical ordering. */
export function comparePhysicalTileUsages(
  a: PhysicalTileUsage,
  b: PhysicalTileUsage,
): number {
  if (a.type !== b.type) {
    const typeOrder: Record<PhysicalTileUsage['type'], number> = {
      animation: 0,
      playfield: 1,
      tileset: 2,
    };
    return typeOrder[a.type] - typeOrder[b.type];
  }

  const assetCmp = a.assetId.localeCompare(b.assetId);
  if (assetCmp !== 0) return assetCmp;

  if (a.type === 'animation' && b.type === 'animation') {
    const animCmp = a.animationId.localeCompare(b.animationId);
    if (animCmp !== 0) return animCmp;
    if (a.frameIndex !== b.frameIndex) return a.frameIndex - b.frameIndex;
    if (a.spriteIndex !== b.spriteIndex) return a.spriteIndex - b.spriteIndex;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  }

  if (a.type === 'playfield' && b.type === 'playfield') {
    return a.nametableIndex - b.nametableIndex;
  }

  if (a.type === 'tileset' && b.type === 'tileset') {
    if (a.tileIndex !== b.tileIndex) return a.tileIndex - b.tileIndex;
    return (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0);
  }

  return 0;
}

interface MutableSlotState {
  origin?: PhysicalTileOrigin;
  readonly usages: PhysicalTileUsage[];
  readonly seenUsageKeys: Set<string>;
}

/**
 * Builds the canonical derived ChrAssetMappingIndex covering all 512 physical CHR slots.
 *
 * Guaranteed invariants:
 * - Pure and side-effect free (does not mutate inputs).
 * - byPhysicalIndex has exactly 512 entries, ordered 0..511.
 * - Single primary origin per slot representing true allocation provenance.
 * - Preserves all structured usages and distinguishes same-asset, cross-asset, and flip-aware deduplication.
 * - Base CHR occupied slots have Base CHR origin; zero-filled Base CHR slots have no origin.
 * - Reverse lookup physicalIndicesByAsset contains all physical slots with origin or usage by each asset.
 */
export function buildChrAssetMappingIndex(
  options: BuildChrAssetMappingIndexOptions = {},
): ChrAssetMappingIndex {
  const project = options.project ?? null;
  const mode = options.mode ?? project?.mode ?? 'tileset';
  const destPt: SpritePatternTable =
    options.destinationPatternTable ??
    project?.animation?.destinationPatternTable ??
    0;

  // Initialize all 512 physical slots
  const slots: MutableSlotState[] = Array.from(
    { length: NES_CHR_ROM_TILE_COUNT },
    () => ({
      origin: undefined,
      usages: [],
      seenUsageKeys: new Set<string>(),
    }),
  );

  const addUsage = (
    physicalIndex: number,
    usage: PhysicalTileUsage,
    semanticKey: string,
  ): void => {
    if (physicalIndex < 0 || physicalIndex >= NES_CHR_ROM_TILE_COUNT) return;
    const slot = slots[physicalIndex];
    if (!slot) return;
    if (!slot.seenUsageKeys.has(semanticKey)) {
      slot.seenUsageKeys.add(semanticKey);
      slot.usages.push(usage);
    }
  };

  // 1. Process Base CHR (Provenance and Origin)
  const baseChr =
    options.baseChr ??
    (project?.animation?.destinationChr?.dataUrl
      ? undefined // raw bytes passed via options.baseChr
      : null);

  if (baseChr && baseChr.length > 0) {
    const baseAssetRef =
      project?.animation?.destinationChr ?? project?.tileset?.asset;
    const baseAssetId =
      options.baseChrAssetId ??
      normalizeProjectAssetId(baseAssetRef?.id, 'base-chr');
    const baseAssetName =
      options.baseChrName ?? baseAssetRef?.name ?? 'Base CHR';

    const fileTileSlots = Math.min(
      Math.floor(baseChr.length / 16),
      NES_CHR_ROM_TILE_COUNT,
    );
    const start = baseChrPhysicalStart(fileTileSlots, destPt);

    for (let tileIndex = 0; tileIndex < fileTileSlots; tileIndex += 1) {
      if (rawChrTileHasData(baseChr, tileIndex)) {
        const physicalIndex = start + tileIndex;
        if (physicalIndex >= 0 && physicalIndex < NES_CHR_ROM_TILE_COUNT) {
          const tileX = tileIndex % 16;
          const tileY = Math.floor(tileIndex / 16);
          const logicalKey = createLogicalTileKey(baseAssetId, tileX, tileY);
          const slot = slots[physicalIndex];
          if (slot && slot.origin === undefined) {
            slot.origin = {
              primaryAssetId: baseAssetId,
              primaryAssetName: baseAssetName,
              logicalKey,
              sourceCoordinates: {
                tileX,
                tileY,
                pixelX: tileX * 8,
                pixelY: tileY * 8,
              },
              creationKind: 'base-chr',
            };
          }
        }
      }
    }
  }

  // 2. Process Animation Model (authoritative allocation results)
  const animationModel = options.animationModel;
  if (animationModel && animationModel.animations.length > 0) {
    const animationConfigList =
      options.animations ?? project?.animation?.animations ?? [];

    for (const anim of animationModel.animations) {
      const animConfig = animationConfigList.find(
        (c) => c.id === anim.id || c.name === anim.name,
      );
      const rawAssetId =
        animConfig?.asset?.id ??
        (animConfig && 'source' in animConfig
          ? animConfig.source?.assetId
          : undefined) ??
        anim.id;
      const assetId = normalizeProjectAssetId(
        rawAssetId,
        'spritesheet',
        anim.id ?? anim.name,
      );

      const animWidth = anim.width > 0 ? anim.width : 16;
      const animHeight = anim.height > 0 ? anim.height : 16;
      const sourceImageWidth =
        animationModel.source?.imageWidth ??
        anim.widthTiles * 8 * (animationModel.source?.frameColumns ?? 1);

      for (
        let frameIndex = 0;
        frameIndex < anim.frames.length;
        frameIndex += 1
      ) {
        const frame = anim.frames[frameIndex];
        if (!frame) continue;

        for (
          let spriteIndex = 0;
          spriteIndex < frame.sprites.length;
          spriteIndex += 1
        ) {
          const sprite = frame.sprites[spriteIndex];
          if (!sprite) continue;

          const physicalIndex = sprite.physicalTileIndex;
          if (physicalIndex < 0 || physicalIndex >= NES_CHR_ROM_TILE_COUNT) {
            continue;
          }

          const cellCol = sprite.sourceTileColumn;
          const cellRow = sprite.sourceTileRow;

          const tileX =
            typeof frame.sourceX === 'number'
              ? Math.floor(frame.sourceX / 8) + cellCol
              : computeAnimationLogicalTileCoordinate({
                  frameIndex: frame.sourceIndex,
                  frameWidth: animWidth,
                  frameHeight: animHeight,
                  imageWidth: Math.max(animWidth, sourceImageWidth),
                  cellColumn: cellCol,
                  cellRow: cellRow,
                }).tileX;

          const tileY =
            typeof frame.sourceY === 'number'
              ? Math.floor(frame.sourceY / 8) + cellRow
              : computeAnimationLogicalTileCoordinate({
                  frameIndex: frame.sourceIndex,
                  frameWidth: animWidth,
                  frameHeight: animHeight,
                  imageWidth: Math.max(animWidth, sourceImageWidth),
                  cellColumn: cellCol,
                  cellRow: cellRow,
                }).tileY;

          const logicalKey = createLogicalTileKey(assetId, tileX, tileY);

          const usage: AnimationTileUsage = {
            type: 'animation',
            assetId,
            entity: anim.entity,
            animationId: anim.id ?? anim.name,
            animationName: anim.name,
            frameIndex,
            spriteIndex,
            x: sprite.x,
            y: sprite.y,
            horizontalFlip: sprite.horizontalFlip,
            verticalFlip: sprite.verticalFlip,
            physicalTileIndex: physicalIndex,
            logicalKey,
            sourceTileColumn: sprite.sourceTileColumn,
            sourceTileRow: sprite.sourceTileRow,
          };

          const semanticKey = `anim:${assetId}:${usage.animationId}:${String(frameIndex)}:${String(spriteIndex)}`;
          addUsage(physicalIndex, usage, semanticKey);

          // Register primary origin if slot has no origin yet
          const slot = slots[physicalIndex];
          if (slot && slot.origin === undefined) {
            slot.origin = {
              primaryAssetId: assetId,
              primaryAssetName: anim.name,
              logicalKey,
              sourceCoordinates: {
                tileX,
                tileY,
                pixelX: tileX * 8,
                pixelY: tileY * 8,
              },
              creationKind: 'extracted',
            };
          }
        }
      }
    }
  }

  // 3. Process Tileset Mode
  const tiles = options.tiles;
  if (mode === 'tileset' && tiles && tiles.length > 0) {
    const tilesetAssetId =
      options.tilesetAssetId ??
      normalizeProjectAssetId(project?.tileset?.asset?.id, 'tileset-image');
    const tilesetAssetName = project?.tileset?.asset?.name ?? 'Tileset Image';

    const deduplicationEnabled =
      options.deduplicationEnabled ??
      project?.settings.deduplicationEnabled ??
      true;
    const flipDeduplicationEnabled =
      options.flipDeduplicationEnabled ??
      project?.settings.flipDeduplicationEnabled ??
      false;

    let deduplicated: readonly Tile[];
    let originalToUnique: Uint32Array | null = null;

    if (deduplicationEnabled) {
      if (flipDeduplicationEnabled) {
        deduplicated = deduplicateTilesConsideringFlips(tiles);
      } else {
        const dedup = deduplicateTileSet(tiles);
        deduplicated = dedup.tiles;
        originalToUnique = dedup.originalToUnique;
      }
    } else {
      deduplicated = tiles;
    }

    // Allocate physical slots for unique tiles
    const tempSlots = createPatternTableSlots(
      baseChr && baseChr.length > 0
        ? baseChr
        : new Uint8Array(NES_CHR_ROM_SIZE),
      destPt,
    );
    const reservedSet = collectReservedPhysicalTileIndices(
      options.chrRegions ?? project?.chrRegions ?? [],
    );

    let searchIndex = destPt * 256;
    const uniquePhysicalIndices: number[] = [];
    for (const uTile of deduplicated) {
      const avSlot = findNextAvailableChrSlot(tempSlots, {
        startIndex: searchIndex,
        patternTable: destPt,
        reservedIndices: reservedSet,
      });
      if (avSlot !== undefined) {
        const physical = avSlot.physicalTileIndex;
        tempSlots[physical] = {
          physicalTileIndex: physical,
          tile: uTile,
          source: 'imported',
        };
        uniquePhysicalIndices.push(physical);
        searchIndex = physical + 1;
      } else {
        uniquePhysicalIndices.push(-1);
      }
    }

    const baseOffset = destPt * 256;
    tiles.forEach((tile, origIdx) => {
      const uIdx = originalToUnique
        ? (originalToUnique[origIdx] ?? origIdx)
        : origIdx;
      const mappedIndex = uniquePhysicalIndices[uIdx];
      const physicalIndex =
        typeof mappedIndex === 'number' && mappedIndex !== -1
          ? mappedIndex
          : baseOffset + origIdx;

      if (physicalIndex >= 0 && physicalIndex < NES_CHR_ROM_TILE_COUNT) {
        const tileX = tile.column;
        const tileY = tile.row;
        const logicalKey = createLogicalTileKey(tilesetAssetId, tileX, tileY);

        const usage: TilesetTileUsage = {
          type: 'tileset',
          assetId: tilesetAssetId,
          tileIndex: uIdx,
          sourceIndex: tile.id,
          physicalTileIndex: physicalIndex,
          logicalKey,
          sourceCoordinates: {
            tileX,
            tileY,
          },
        };

        const semanticKey = `tileset:${tilesetAssetId}:${String(origIdx)}:${String(physicalIndex)}`;
        addUsage(physicalIndex, usage, semanticKey);

        const slot = slots[physicalIndex];
        if (slot && slot.origin === undefined) {
          slot.origin = {
            primaryAssetId: tilesetAssetId,
            primaryAssetName: tilesetAssetName,
            logicalKey,
            sourceCoordinates: {
              tileX,
              tileY,
              pixelX: tileX * 8,
              pixelY: tileY * 8,
            },
            creationKind: 'extracted',
          };
        }
      }
    });
  }

  // 4. Process Playfield Mode
  const nametable = options.playfieldNametable;
  if (mode === 'playfield' && nametable && nametable.length > 0) {
    const playfieldAssetId =
      options.playfieldAssetId ??
      normalizeProjectAssetId(project?.playfield?.asset?.id, 'playfield-image');
    const playfieldAssetName =
      project?.playfield?.asset?.name ?? 'Playfield Image';

    const baseOffset = destPt * 256;
    const maxCells = Math.min(nametable.length, 960);

    for (let i = 0; i < maxCells; i += 1) {
      const localTileIndex = nametable[i] ?? 0;
      const physicalIndex = baseOffset + localTileIndex;
      const col = i % 32;
      const row = Math.floor(i / 32);

      if (physicalIndex >= 0 && physicalIndex < NES_CHR_ROM_TILE_COUNT) {
        const logicalKey = createLogicalTileKey(playfieldAssetId, col, row);

        const usage: PlayfieldTileUsage = {
          type: 'playfield',
          assetId: playfieldAssetId,
          column: col,
          row,
          nametableIndex: i,
          localTileIndex,
          physicalTileIndex: physicalIndex,
          logicalKey,
        };

        const semanticKey = `playfield:${playfieldAssetId}:${String(i)}`;
        addUsage(physicalIndex, usage, semanticKey);

        const slot = slots[physicalIndex];
        if (slot && slot.origin === undefined) {
          slot.origin = {
            primaryAssetId: playfieldAssetId,
            primaryAssetName: playfieldAssetName,
            logicalKey,
            sourceCoordinates: {
              tileX: col,
              tileY: row,
              pixelX: col * 8,
              pixelY: row * 8,
            },
            creationKind: 'extracted',
          };
        }
      }
    }
  }

  // 5. Apply Manual Materialization Origins
  if (options.manualOrigins) {
    for (const [
      physicalIndex,
      manualOrigin,
    ] of options.manualOrigins.entries()) {
      if (physicalIndex >= 0 && physicalIndex < NES_CHR_ROM_TILE_COUNT) {
        const slot = slots[physicalIndex];
        if (slot && slot.origin === undefined) {
          slot.origin = manualOrigin;
        }
      }
    }
  }

  // 6. Finalize Attributions, Build Reverse Indices, and Freeze Structures
  const byPhysicalIndex: PhysicalSlotAttribution[] = [];
  const physicalIndicesByAssetMap = new Map<ProjectAssetId, Set<number>>();
  const usagesByLogicalKeyMap = new Map<LogicalTileKey, PhysicalTileUsage[]>();

  const trackAssetPhysicalIndex = (
    assetId: ProjectAssetId,
    physicalIndex: number,
  ): void => {
    let set = physicalIndicesByAssetMap.get(assetId);
    if (!set) {
      set = new Set<number>();
      physicalIndicesByAssetMap.set(assetId, set);
    }
    set.add(physicalIndex);
  };

  for (
    let physicalIndex = 0;
    physicalIndex < NES_CHR_ROM_TILE_COUNT;
    physicalIndex += 1
  ) {
    const slot = slots[physicalIndex];
    if (!slot) continue;
    const patternTable = patternTableForPhysicalTile(physicalIndex);
    const localIndex = localPatternTableTileIndex(physicalIndex);

    // Sort usages deterministically
    slot.usages.sort(comparePhysicalTileUsages);

    const usageCount = slot.usages.length;
    const isShared = usageCount > 1;

    byPhysicalIndex.push({
      physicalIndex,
      patternTable,
      localIndex,
      origin: slot.origin,
      usages: Object.freeze([...slot.usages]),
      usageCount,
      isShared,
    });

    // Populate reverse asset index
    if (slot.origin) {
      trackAssetPhysicalIndex(slot.origin.primaryAssetId, physicalIndex);
    }

    for (const usage of slot.usages) {
      trackAssetPhysicalIndex(usage.assetId, physicalIndex);

      if (usage.logicalKey) {
        let logicalUsages = usagesByLogicalKeyMap.get(usage.logicalKey);
        if (!logicalUsages) {
          logicalUsages = [];
          usagesByLogicalKeyMap.set(usage.logicalKey, logicalUsages);
        }
        logicalUsages.push(usage);
      }
    }
  }

  // Freeze reverse map sets and logical key arrays
  const physicalIndicesByAsset = new Map<ProjectAssetId, ReadonlySet<number>>();
  for (const [assetId, set] of physicalIndicesByAssetMap.entries()) {
    const sortedIndices = Array.from(set).sort((a, b) => a - b);
    physicalIndicesByAsset.set(assetId, Object.freeze(new Set(sortedIndices)));
  }

  const usagesByLogicalKey = new Map<
    LogicalTileKey,
    readonly PhysicalTileUsage[]
  >();
  for (const [key, usageList] of usagesByLogicalKeyMap.entries()) {
    usageList.sort(comparePhysicalTileUsages);
    usagesByLogicalKey.set(key, Object.freeze([...usageList]));
  }

  return {
    byPhysicalIndex: Object.freeze(byPhysicalIndex),
    physicalIndicesByAsset,
    usagesByLogicalKey,
  };
}

/**
 * Pure query helper to get the physical slot attribution for a physical CHR index (0..511).
 */
export function getPhysicalSlotAttribution(
  physicalIndex: number,
  index: ChrAssetMappingIndex,
): PhysicalSlotAttribution | undefined {
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= index.byPhysicalIndex.length
  ) {
    return undefined;
  }
  return index.byPhysicalIndex[physicalIndex];
}

/**
 * Pure query helper to retrieve all unique physical CHR slots associated with a given ProjectAssetId.
 */
export function getPhysicalIndicesForAsset(
  assetId: ProjectAssetId,
  index: ChrAssetMappingIndex,
): ReadonlySet<number> {
  return index.physicalIndicesByAsset.get(assetId) ?? new Set<number>();
}

/**
 * Pure query helper to retrieve all active usages associated with a canonical LogicalTileKey.
 */
export function getUsagesForLogicalKey(
  logicalKey: LogicalTileKey,
  index: ChrAssetMappingIndex,
): readonly PhysicalTileUsage[] {
  return index.usagesByLogicalKey.get(logicalKey) ?? [];
}
