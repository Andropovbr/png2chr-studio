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
  parseLogicalTileKey,
  type LogicalTileKey,
  type ProjectAsset,
  type ProjectAssetId,
  type ProjectAssetKind,
} from './asset-identity';
import type { AnimationProjectModel } from './animation-model';
import type { BackgroundProjectModel } from './chr-background-allocation';
import {
  classifyOrphanedPhysicalTiles,
  detectOrphanedPhysicalTiles,
} from './asset-lifecycle';
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
import { t } from '../i18n';

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

/** Usage of a physical tile by a Background Map Nametable cell. */
export interface BackgroundTileUsage {
  readonly type: 'background';
  readonly assetId: ProjectAssetId;
  readonly mapId: string;
  readonly column: number;
  readonly row: number;
  readonly nametableIndex: number;
  readonly localTileIndex: number;
  readonly physicalTileIndex: number;
  readonly logicalKey?: LogicalTileKey;
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
  | AnimationTileUsage
  | BackgroundTileUsage
  | PlayfieldTileUsage
  | TilesetTileUsage;

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
  /** Compiled background project model (authoritative physical allocation source). */
  readonly backgroundModel?: BackgroundProjectModel | null;
  /** Multiple compiled background project models. */
  readonly backgroundModels?: readonly BackgroundProjectModel[];
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
      background: 1,
      playfield: 2,
      tileset: 3,
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

  if (a.type === 'background' && b.type === 'background') {
    const mapCmp = a.mapId.localeCompare(b.mapId);
    if (mapCmp !== 0) return mapCmp;
    return a.nametableIndex - b.nametableIndex;
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

  // 4c. Process Background Models
  const backgroundModels: readonly BackgroundProjectModel[] =
    options.backgroundModels ??
    (options.backgroundModel ? [options.backgroundModel] : []);

  for (const bgModel of backgroundModels) {
    const map = bgModel.map;
    const bgAssetId = normalizeProjectAssetId(map.assetId, 'background-image');
    const bgAssetName = map.name || 'Background Map';

    for (let i = 0; i < bgModel.resolvedCells.length; i += 1) {
      const cell = bgModel.resolvedCells[i];
      if (!cell) continue;

      const physicalIndex =
        cell.physicalTileIndex ??
        bgModel.patternTable * 256 + cell.localTileIndex;

      if (physicalIndex >= 0 && physicalIndex < NES_CHR_ROM_TILE_COUNT) {
        const parsedKey = cell.logicalKey
          ? parseLogicalTileKey(cell.logicalKey)
          : null;
        const logicalKey =
          cell.logicalKey ??
          createLogicalTileKey(bgAssetId, cell.column, cell.row);

        const sourceTileX = parsedKey ? parsedKey.tileX : cell.column;
        const sourceTileY = parsedKey ? parsedKey.tileY : cell.row;
        const primaryAssetId = parsedKey ? parsedKey.assetId : bgAssetId;

        const usage: BackgroundTileUsage = {
          type: 'background',
          assetId: bgAssetId,
          mapId: map.id,
          column: cell.column,
          row: cell.row,
          nametableIndex: cell.cellIndex,
          localTileIndex: cell.localTileIndex,
          physicalTileIndex: physicalIndex,
          logicalKey,
        };

        const semanticKey = `background:${map.id}:${String(i)}`;
        addUsage(physicalIndex, usage, semanticKey);

        const slot = slots[physicalIndex];
        if (slot && slot.origin === undefined) {
          slot.origin = {
            primaryAssetId,
            primaryAssetName: bgAssetName,
            logicalKey,
            sourceCoordinates: {
              tileX: sourceTileX,
              tileY: sourceTileY,
              pixelX: sourceTileX * 8,
              pixelY: sourceTileY * 8,
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

// ============================================================================
// Per-Asset & Project-Level CHR Resource Metrics
// ============================================================================

/** Detailed CHR resource accounting for a single logical project asset. */
export interface AssetChrMetrics {
  readonly assetId: ProjectAssetId;
  readonly assetName?: string;
  readonly kind?: ProjectAssetKind;

  /** Total unique physical CHR slots (0..511) associated with this asset. */
  readonly uniquePhysicalSlots: number;

  /** Physical slots where this asset is the primary origin (`origin.primaryAssetId === assetId`). */
  readonly primaryOwnedSlots: number;

  /** Unique physical slots containing at least one active usage from this asset. */
  readonly consumedSlots: number;

  /** Associated physical slots that have more than 1 usage (`isShared === true`). */
  readonly sharedSlots: number;

  /** Associated physical slots used by this asset AND at least one other distinct asset. */
  readonly crossAssetSharedSlots: number;

  /** Physical slots where this asset is the primary origin AND no other asset uses the slot. */
  readonly exclusiveSlots: number;

  /** Associated physical slots originating from Base CHR (`creationKind === 'base-chr'`). */
  readonly baseChrReusedSlots: number;

  /** Primary-owned physical slots originating from manual CHR edits (`creationKind === 'manual-materialized'`). */
  readonly manualMaterializedSlots: number;

  /** Breakdown of unique physical slots across Pattern Tables [PT0, PT1]. */
  readonly patternTableSlots: readonly [number, number];
}

/** Comprehensive project-wide CHR ownership and resource allocation metrics. */
export interface ProjectChrOwnershipMetrics {
  /** Total unique physical slots primarily owned by any project asset (`creationKind === 'extracted'`). */
  readonly totalProjectOwnedSlots: number;

  /** Total physical slots originating from Base CHR. */
  readonly totalBaseChrOccupiedSlots: number;

  /** Total physical slots originating from manual CHR edits. */
  readonly totalManualMaterializedSlots: number;

  /** Total physical slots shared by multiple usages (`usageCount > 1`). */
  readonly totalSharedSlots: number;

  /** Total physical slots shared across 2 or more distinct asset IDs. */
  readonly totalCrossAssetSharedSlots: number;

  /** Total physical slots classified as canonical orphans. */
  readonly totalOrphanedSlots: number;

  /** Total occupied physical slots with unknown provenance. */
  readonly totalUnknownProvenanceSlots: number;

  /** Total active assets with at least 1 associated physical CHR slot. */
  readonly totalActiveAssetsWithChr: number;

  /** Deterministic list of per-asset metrics. */
  readonly byAsset: readonly AssetChrMetrics[];
}

/** Options for computing project CHR ownership metrics. */
export interface CalculateAssetChrMetricsOptions {
  readonly mappingIndex: ChrAssetMappingIndex;
  readonly activeAssets?: readonly ProjectAsset[];
  readonly reservedPhysicalIndices?: ReadonlySet<number>;
  readonly chrRegions?: readonly ChrRegion[];
  readonly finalChrBytes?: Uint8Array;
}

/**
 * Computes pure CHR resource metrics for a specific project asset.
 */
export function calculateAssetChrMetrics(
  asset: {
    readonly id: ProjectAssetId;
    readonly name?: string;
    readonly kind?: ProjectAssetKind;
  },
  mappingIndex: ChrAssetMappingIndex,
): AssetChrMetrics {
  const associatedSlots = getPhysicalIndicesForAsset(asset.id, mappingIndex);
  let pt0 = 0;
  let pt1 = 0;
  let primaryOwned = 0;
  let consumed = 0;
  let shared = 0;
  let crossAssetShared = 0;
  let exclusive = 0;
  let baseChrReused = 0;
  let manualMaterialized = 0;

  for (const slotIdx of associatedSlots) {
    const slot = mappingIndex.byPhysicalIndex[slotIdx];
    if (!slot) continue;

    if (slotIdx < 256) {
      pt0 += 1;
    } else {
      pt1 += 1;
    }

    if (slot.origin?.primaryAssetId === asset.id) {
      primaryOwned += 1;
      if (slot.origin.creationKind === 'manual-materialized') {
        manualMaterialized += 1;
      }
      if (slot.usages.every((u) => u.assetId === asset.id)) {
        exclusive += 1;
      }
    }

    if (slot.usages.some((u) => u.assetId === asset.id)) {
      consumed += 1;
    }

    if (slot.isShared || slot.usageCount > 1) {
      shared += 1;
    }

    const distinctAssets = new Set<string>();
    for (const u of slot.usages) {
      distinctAssets.add(u.assetId);
    }
    if (distinctAssets.size > 1) {
      crossAssetShared += 1;
    }

    if (slot.origin?.creationKind === 'base-chr') {
      baseChrReused += 1;
    }
  }

  return {
    assetId: asset.id,
    assetName: asset.name,
    kind: asset.kind,
    uniquePhysicalSlots: associatedSlots.size,
    primaryOwnedSlots: primaryOwned,
    consumedSlots: consumed,
    sharedSlots: shared,
    crossAssetSharedSlots: crossAssetShared,
    exclusiveSlots: exclusive,
    baseChrReusedSlots: baseChrReused,
    manualMaterializedSlots: manualMaterialized,
    patternTableSlots: [pt0, pt1],
  };
}

/**
 * Computes global and per-asset CHR ownership metrics across all physical slots.
 */
export function calculateProjectChrOwnershipMetrics(
  options: CalculateAssetChrMetricsOptions,
): ProjectChrOwnershipMetrics {
  const { mappingIndex, activeAssets, reservedPhysicalIndices, finalChrBytes } =
    options;

  let totalProjectOwned = 0;
  let totalBaseChrOccupied = 0;
  let totalManualMaterialized = 0;
  let totalShared = 0;
  let totalCrossAssetShared = 0;
  let totalUnknownProvenance = 0;

  for (let i = 0; i < mappingIndex.byPhysicalIndex.length; i += 1) {
    const slot = mappingIndex.byPhysicalIndex[i];
    if (!slot) continue;

    if (slot.origin?.creationKind === 'extracted') {
      totalProjectOwned += 1;
    } else if (slot.origin?.creationKind === 'base-chr') {
      totalBaseChrOccupied += 1;
    } else if (slot.origin?.creationKind === 'manual-materialized') {
      totalManualMaterialized += 1;
    }

    if (slot.isShared || slot.usageCount > 1) {
      totalShared += 1;
    }

    const distinctAssets = new Set<string>();
    for (const u of slot.usages) {
      if (u.assetId) {
        distinctAssets.add(u.assetId);
      }
    }
    if (slot.origin?.primaryAssetId) {
      distinctAssets.add(slot.origin.primaryAssetId);
    }
    if (distinctAssets.size > 1) {
      totalCrossAssetShared += 1;
    }

    // Check unknown provenance: tile is occupied in CHR bytes but has no origin
    if (!slot.origin && finalChrBytes) {
      const byteOffset = i * 16;
      if (finalChrBytes.length >= byteOffset + 16) {
        let isNonZero = false;
        for (let b = 0; b < 16; b += 1) {
          if (finalChrBytes[byteOffset + b] !== 0) {
            isNonZero = true;
            break;
          }
        }
        if (isNonZero) {
          totalUnknownProvenance += 1;
        }
      }
    }
  }

  const orphanedSlots = detectOrphanedPhysicalTiles(
    mappingIndex,
    reservedPhysicalIndices,
  );

  // Asset list resolution
  const assetsToProcess: {
    readonly id: ProjectAssetId;
    readonly name?: string;
    readonly kind?: ProjectAssetKind;
  }[] = [];
  const processedAssetIds = new Set<string>();

  if (activeAssets) {
    for (const a of activeAssets) {
      assetsToProcess.push(a);
      processedAssetIds.add(a.id);
    }
  }

  // Also include any other asset IDs discovered in mappingIndex
  const sortedExtraAssetIds = Array.from(
    mappingIndex.physicalIndicesByAsset.keys(),
  ).sort();
  for (const assetId of sortedExtraAssetIds) {
    if (!processedAssetIds.has(assetId)) {
      const attr = mappingIndex.byPhysicalIndex.find(
        (s) => s.origin?.primaryAssetId === assetId,
      );
      assetsToProcess.push({
        id: assetId,
        name: attr?.origin?.primaryAssetName ?? assetId,
      });
      processedAssetIds.add(assetId);
    }
  }

  const byAsset = assetsToProcess.map((asset) =>
    calculateAssetChrMetrics(asset, mappingIndex),
  );

  const totalActiveAssetsWithChr = byAsset.filter(
    (a) => a.uniquePhysicalSlots > 0,
  ).length;

  return {
    totalProjectOwnedSlots: totalProjectOwned,
    totalBaseChrOccupiedSlots: totalBaseChrOccupied,
    totalManualMaterializedSlots: totalManualMaterialized,
    totalSharedSlots: totalShared,
    totalCrossAssetSharedSlots: totalCrossAssetShared,
    totalOrphanedSlots: orphanedSlots.length,
    totalUnknownProvenanceSlots: totalUnknownProvenance,
    totalActiveAssetsWithChr,
    byAsset: Object.freeze(byAsset),
  };
}

// ============================================================================
// CHR Ownership & Mapping Diagnostics
// ============================================================================

export type ChrOwnershipDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface OrphanedProjectTileDiagnosticFact {
  readonly kind: 'orphaned-project-tile';
  readonly severity: 'warning';
  readonly physicalIndex: number;
  readonly patternTable: SpritePatternTable;
  readonly localIndex: number;
  readonly primaryAssetId?: ProjectAssetId;
  readonly primaryAssetName?: string;
  readonly logicalKey?: LogicalTileKey;
  readonly creationKind: 'extracted';
  readonly regionName?: string;
}

export interface DanglingAssetUsageDiagnosticFact {
  readonly kind: 'dangling-asset-usage';
  readonly severity: 'error';
  readonly physicalIndex: number;
  readonly usageType: 'animation' | 'background' | 'playfield' | 'tileset';
  readonly missingAssetId: ProjectAssetId;
  readonly logicalKey?: LogicalTileKey;
  readonly consumerContext?: string;
}

export interface MissingOriginAssetDiagnosticFact {
  readonly kind: 'missing-origin-asset';
  readonly severity: 'error';
  readonly physicalIndex: number;
  readonly missingAssetId: ProjectAssetId;
  readonly logicalKey?: LogicalTileKey;
}

export interface InvalidPhysicalMappingDiagnosticFact {
  readonly kind: 'invalid-physical-mapping';
  readonly severity: 'error';
  readonly physicalIndex: number;
  readonly details: string;
}

export interface InvalidLogicalKeyDiagnosticFact {
  readonly kind: 'invalid-logical-key';
  readonly severity: 'error';
  readonly physicalIndex: number;
  readonly logicalKey: string;
  readonly assetId?: ProjectAssetId;
  readonly reason: 'malformed-key' | 'asset-mismatch' | 'invalid-coordinates';
}

export interface UnexpectedPatternTableDiagnosticFact {
  readonly kind: 'unexpected-pattern-table';
  readonly severity: 'warning';
  readonly physicalIndex: number;
  readonly actualPatternTable: SpritePatternTable;
  readonly expectedPatternTable: SpritePatternTable;
  readonly assetId: ProjectAssetId;
}

export type ChrOwnershipDiagnosticFact =
  | OrphanedProjectTileDiagnosticFact
  | DanglingAssetUsageDiagnosticFact
  | MissingOriginAssetDiagnosticFact
  | InvalidPhysicalMappingDiagnosticFact
  | InvalidLogicalKeyDiagnosticFact
  | UnexpectedPatternTableDiagnosticFact;

export interface AnalyzeChrOwnershipDiagnosticsOptions {
  readonly mappingIndex: ChrAssetMappingIndex;
  readonly activeAssets?: readonly ProjectAsset[];
  readonly activeAssetIds?: ReadonlySet<ProjectAssetId>;
  readonly reservedPhysicalIndices?: ReadonlySet<number>;
  readonly expectedPatternTable?: SpritePatternTable;
  readonly chrRegions?: readonly ChrRegion[];
  readonly mode?: ProjectMode;
}

/**
 * Pure domain diagnostic analyzer for CHR ownership and mapping integrity.
 */
export function analyzeChrOwnershipDiagnostics(
  options: AnalyzeChrOwnershipDiagnosticsOptions,
): readonly ChrOwnershipDiagnosticFact[] {
  const {
    mappingIndex,
    activeAssets,
    activeAssetIds,
    reservedPhysicalIndices,
    expectedPatternTable,
  } = options;

  const validAssetIds = new Set<string>();
  if (activeAssetIds) {
    for (const id of activeAssetIds) {
      validAssetIds.add(id);
    }
  }
  if (activeAssets) {
    for (const a of activeAssets) {
      validAssetIds.add(a.id);
    }
  }

  const diagnostics: ChrOwnershipDiagnosticFact[] = [];
  const emittedFactKeys = new Set<string>();

  const emit = (fact: ChrOwnershipDiagnosticFact): void => {
    const missingId = 'missingAssetId' in fact ? fact.missingAssetId : '';
    const logKey = 'logicalKey' in fact ? (fact.logicalKey ?? '') : '';
    const reason = 'reason' in fact ? fact.reason : '';
    const details = 'details' in fact ? fact.details : '';
    const dedupeKey = `${fact.kind}:${String(fact.physicalIndex)}:${fact.severity}:${missingId}:${logKey}:${reason}:${details}`;
    if (!emittedFactKeys.has(dedupeKey)) {
      emittedFactKeys.add(dedupeKey);
      diagnostics.push(fact);
    }
  };

  // 1. Validate physical mapping invariants & individual slot integrity (0..511)
  for (let i = 0; i < mappingIndex.byPhysicalIndex.length; i += 1) {
    const slot = mappingIndex.byPhysicalIndex[i];
    if (!slot) {
      emit({
        kind: 'invalid-physical-mapping',
        severity: 'error',
        physicalIndex: i,
        details: `Slot at index ${String(i)} is missing or undefined`,
      });
      continue;
    }

    if (slot.physicalIndex !== i) {
      emit({
        kind: 'invalid-physical-mapping',
        severity: 'error',
        physicalIndex: i,
        details: `Slot physicalIndex ${String(slot.physicalIndex)} does not match array index ${String(i)}`,
      });
    }

    const expectedPt = Math.floor(i / 256) as SpritePatternTable;
    const expectedLocal = i % 256;

    if (slot.patternTable !== expectedPt) {
      emit({
        kind: 'invalid-physical-mapping',
        severity: 'error',
        physicalIndex: i,
        details: `Slot patternTable ${String(slot.patternTable)} does not match expected PT${String(expectedPt)}`,
      });
    }

    if (slot.localIndex !== expectedLocal) {
      emit({
        kind: 'invalid-physical-mapping',
        severity: 'error',
        physicalIndex: i,
        details: `Slot localIndex ${String(slot.localIndex)} does not match expected local index ${String(expectedLocal)}`,
      });
    }

    // Origin asset checks
    if (slot.origin) {
      const { primaryAssetId, logicalKey, creationKind } = slot.origin;

      if (creationKind === 'extracted') {
        if (validAssetIds.size > 0 && !validAssetIds.has(primaryAssetId)) {
          emit({
            kind: 'missing-origin-asset',
            severity: 'error',
            physicalIndex: i,
            missingAssetId: primaryAssetId,
            logicalKey,
          });
        }
      }

      if (logicalKey) {
        const parsed = parseLogicalTileKey(logicalKey);
        if (!parsed) {
          emit({
            kind: 'invalid-logical-key',
            severity: 'error',
            physicalIndex: i,
            logicalKey,
            assetId: primaryAssetId,
            reason: 'malformed-key',
          });
        } else if (parsed.assetId !== primaryAssetId) {
          emit({
            kind: 'invalid-logical-key',
            severity: 'error',
            physicalIndex: i,
            logicalKey,
            assetId: primaryAssetId,
            reason: 'asset-mismatch',
          });
        } else if (parsed.tileX < 0 || parsed.tileY < 0) {
          emit({
            kind: 'invalid-logical-key',
            severity: 'error',
            physicalIndex: i,
            logicalKey,
            assetId: primaryAssetId,
            reason: 'invalid-coordinates',
          });
        }
      }

      if (
        expectedPatternTable !== undefined &&
        creationKind === 'extracted' &&
        slot.patternTable !== expectedPatternTable
      ) {
        emit({
          kind: 'unexpected-pattern-table',
          severity: 'warning',
          physicalIndex: i,
          actualPatternTable: slot.patternTable,
          expectedPatternTable,
          assetId: primaryAssetId,
        });
      }
    }

    // Usages checks
    for (const usage of slot.usages) {
      if (
        usage.physicalTileIndex !== i ||
        usage.physicalTileIndex < 0 ||
        usage.physicalTileIndex >= 512
      ) {
        emit({
          kind: 'invalid-physical-mapping',
          severity: 'error',
          physicalIndex: i,
          details: `Usage physicalTileIndex ${String(usage.physicalTileIndex)} does not match slot ${String(i)}`,
        });
      }

      if (validAssetIds.size > 0 && !validAssetIds.has(usage.assetId)) {
        let consumerContext: string | undefined;
        if (usage.type === 'animation') {
          consumerContext = `Animation: ${usage.animationName ?? usage.animationId} (Frame #${String(usage.frameIndex)})`;
        } else if (usage.type === 'background') {
          consumerContext = `Background: map ${usage.mapId} cell (${String(usage.column)}, ${String(usage.row)})`;
        } else if (usage.type === 'playfield') {
          consumerContext = `Playfield: cell (${String(usage.column)}, ${String(usage.row)})`;
        } else {
          consumerContext = `Tileset: tile #${String(usage.tileIndex)}`;
        }
        emit({
          kind: 'dangling-asset-usage',
          severity: 'error',
          physicalIndex: i,
          usageType: usage.type,
          missingAssetId: usage.assetId,
          logicalKey: usage.logicalKey,
          consumerContext,
        });
      }

      if (usage.logicalKey) {
        const parsed = parseLogicalTileKey(usage.logicalKey);
        if (!parsed) {
          emit({
            kind: 'invalid-logical-key',
            severity: 'error',
            physicalIndex: i,
            logicalKey: usage.logicalKey,
            assetId: usage.assetId,
            reason: 'malformed-key',
          });
        } else if (parsed.assetId !== usage.assetId) {
          emit({
            kind: 'invalid-logical-key',
            severity: 'error',
            physicalIndex: i,
            logicalKey: usage.logicalKey,
            assetId: usage.assetId,
            reason: 'asset-mismatch',
          });
        } else if (parsed.tileX < 0 || parsed.tileY < 0) {
          emit({
            kind: 'invalid-logical-key',
            severity: 'error',
            physicalIndex: i,
            logicalKey: usage.logicalKey,
            assetId: usage.assetId,
            reason: 'invalid-coordinates',
          });
        }
      }
    }
  }

  // 2. Canonical Orphan detection
  const orphanReports = classifyOrphanedPhysicalTiles(
    mappingIndex,
    reservedPhysicalIndices,
  );

  for (const rep of orphanReports) {
    if (rep.isOrphan) {
      const slot = mappingIndex.byPhysicalIndex[rep.physicalIndex];
      emit({
        kind: 'orphaned-project-tile',
        severity: 'warning',
        physicalIndex: rep.physicalIndex,
        patternTable: rep.patternTable,
        localIndex: rep.localIndex,
        primaryAssetId: slot?.origin?.primaryAssetId,
        primaryAssetName: slot?.origin?.primaryAssetName,
        logicalKey: slot?.origin?.logicalKey,
        creationKind: 'extracted',
      });
    }
  }

  // Deterministic sorting: physicalIndex ASC, then severity (error > warning > info), then kind ASC
  return Object.freeze(
    diagnostics.sort((a, b) => {
      if (a.physicalIndex !== b.physicalIndex) {
        return a.physicalIndex - b.physicalIndex;
      }
      const severityRank = (s: ChrOwnershipDiagnosticSeverity): number =>
        s === 'error' ? 0 : s === 'warning' ? 1 : 2;
      const rankA = severityRank(a.severity);
      const rankB = severityRank(b.severity);
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      if (a.kind !== b.kind) {
        return a.kind.localeCompare(b.kind);
      }
      return 0;
    }),
  );
}

/**
 * Formats a typed ChrOwnershipDiagnosticFact into a localized human-readable string.
 */
export function formatChrOwnershipDiagnosticMessage(
  fact: ChrOwnershipDiagnosticFact,
): string {
  const hex = (fact.physicalIndex % 256)
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
  const pt = Math.floor(fact.physicalIndex / 256);

  switch (fact.kind) {
    case 'orphaned-project-tile':
      return t('chrOwnershipOrphanWarning', {
        patternTable: fact.patternTable,
        hex,
      });

    case 'dangling-asset-usage':
      return t('chrOwnershipDanglingUsageError', {
        usageType: fact.usageType,
        patternTable: pt,
        hex,
        assetId: fact.missingAssetId,
      });

    case 'missing-origin-asset':
      return t('chrOwnershipMissingOriginError', {
        patternTable: pt,
        hex,
        assetId: fact.missingAssetId,
      });

    case 'invalid-physical-mapping':
      return t('chrOwnershipInvalidPhysicalMappingError', {
        index: fact.physicalIndex,
        details: fact.details,
      });

    case 'invalid-logical-key':
      return t('chrOwnershipInvalidLogicalKeyError', {
        key: fact.logicalKey,
        patternTable: pt,
        hex,
        reason: fact.reason,
      });

    case 'unexpected-pattern-table':
      return t('chrOwnershipUnexpectedPatternTableWarning', {
        assetId: fact.assetId,
        actualTable: fact.actualPatternTable,
        hex,
        expectedTable: fact.expectedPatternTable,
      });
  }
}
