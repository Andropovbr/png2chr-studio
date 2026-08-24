import type { AnimationProjectModel } from './animation-model';
import { decodeChrTile } from './chr-decoder';
import { encodeTile } from './chr-encoder';
import {
  deduplicateTiles,
  deduplicateTilesConsideringFlips,
} from './tile-deduplication';
import type { Tile } from './types';

export const NES_PATTERN_TABLE_TILE_COUNT = 256;
export const NES_PATTERN_TABLE_SIZE = NES_PATTERN_TABLE_TILE_COUNT * 16;
export const NES_CHR_ROM_TILE_COUNT = NES_PATTERN_TABLE_TILE_COUNT * 2;
export const NES_CHR_ROM_SIZE = NES_CHR_ROM_TILE_COUNT * 16;

export type SpritePatternTable = 0 | 1;
export type PatternTableTileSource = 'destination' | 'imported';
export type ChrSlotOccupancy = 'empty' | 'project' | 'base' | 'reserved';
export type ChrHighlightScope =
  'none' | 'frame' | 'animation' | 'entity' | 'base' | 'all';

export interface ChrSlotClassification {
  readonly physicalIndex: number;
  readonly localIndex: number;
  readonly patternTable: SpritePatternTable;
  readonly occupancy: ChrSlotOccupancy;
  readonly attribution?: string;
}

export interface CollectChrHighlightOptions {
  readonly scope: ChrHighlightScope;
  readonly mode?: 'tileset' | 'playfield' | 'animation';
  readonly animationModel?: {
    readonly animations: readonly {
      readonly id?: string;
      readonly name: string;
      readonly entity?: string;
      readonly frames: readonly {
        readonly sprites: readonly {
          readonly physicalTileIndex: number;
        }[];
      }[];
    }[];
  } | null;
  readonly selectedAnimationId?: string | null;
  readonly selectedFrameIndex?: number | null;
  readonly selectedEntity?: string | null;
  readonly classifications?: readonly ChrSlotClassification[];
}

export interface ClassifyChrSlotsOptions {
  readonly mode?: 'tileset' | 'playfield' | 'animation';
  readonly animationModel?: {
    readonly animations: readonly {
      readonly name: string;
      readonly frames: readonly {
        readonly sprites: readonly {
          readonly physicalTileIndex: number;
        }[];
      }[];
    }[];
  } | null;
  readonly baseChr?: Uint8Array | null;
  readonly baseChrName?: string | null;
  readonly destinationPatternTable?: SpritePatternTable;
  readonly tiles?: readonly Tile[];
  readonly deduplicationEnabled?: boolean;
  readonly flipDeduplicationEnabled?: boolean;
  readonly finalChrBytes?: Uint8Array | null;
}

export interface PatternTableSlot {
  readonly physicalTileIndex: number;
  readonly tile: Tile | null;
  readonly source: PatternTableTileSource | null;
}

export interface PatternTableOccupancy {
  readonly patternTable: SpritePatternTable;
  readonly capacityTiles: number;
  readonly occupiedTiles: number;
  readonly freeTiles: number;
}

export interface BaseChrOccupancy {
  readonly fileSizeBytes: number;
  readonly fileTileSlots: number;
  readonly physicalCapacityTiles: number;
  readonly occupiedTiles: number;
  readonly freeTiles: number;
  readonly patternTables: readonly [
    PatternTableOccupancy,
    PatternTableOccupancy,
  ];
}

export function isSpritePatternTable(
  value: number,
): value is SpritePatternTable {
  return value === 0 || value === 1;
}

export function physicalTileIndex(
  patternTable: SpritePatternTable,
  localTileIndex: number,
): number {
  if (
    !Number.isInteger(localTileIndex) ||
    localTileIndex < 0 ||
    localTileIndex >= NES_PATTERN_TABLE_TILE_COUNT
  ) {
    throw new RangeError('Pattern-table tile index must be between 0 and 255.');
  }
  return patternTable * NES_PATTERN_TABLE_TILE_COUNT + localTileIndex;
}

export function localPatternTableTileIndex(physicalIndex: number): number {
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= NES_CHR_ROM_TILE_COUNT
  ) {
    throw new RangeError('Physical CHR tile index must be between 0 and 511.');
  }
  return physicalIndex % NES_PATTERN_TABLE_TILE_COUNT;
}

export function patternTableForPhysicalTile(
  physicalIndex: number,
): SpritePatternTable {
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= NES_CHR_ROM_TILE_COUNT
  ) {
    throw new RangeError('Physical CHR tile index must be between 0 and 511.');
  }
  return physicalIndex < NES_PATTERN_TABLE_TILE_COUNT ? 0 : 1;
}

export function patternTablePhysicalRange(
  patternTable: SpritePatternTable,
): readonly [number, number] {
  const start = patternTable * NES_PATTERN_TABLE_TILE_COUNT;
  return [start, start + NES_PATTERN_TABLE_TILE_COUNT - 1];
}

export interface TileAddressingMetadata {
  readonly physicalIndex: number;
  readonly physicalIndexHex: string;
  readonly localIndex: number;
  readonly localIndexHex: string;
  readonly patternTable: SpritePatternTable;
  readonly patternTableAddress: string;
  readonly patternTableLabel: string;
  readonly tileCol: number;
  readonly tileRow: number;
  readonly startByteOffset: number;
  readonly startByteOffsetHex: string;
  readonly plane0Offset: number;
  readonly plane0OffsetHex: string;
  readonly plane1Offset: number;
  readonly plane1OffsetHex: string;
}

export function tileStartByteOffset(physicalIndex: number): number {
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= NES_CHR_ROM_TILE_COUNT
  ) {
    throw new RangeError('Physical CHR tile index must be between 0 and 511.');
  }
  return physicalIndex * 16;
}

export function tileBitplaneOffsets(physicalIndex: number): {
  readonly plane0: number;
  readonly plane1: number;
} {
  const start = tileStartByteOffset(physicalIndex);
  return {
    plane0: start,
    plane1: start + 8,
  };
}

export function computeTileAddressingMetadata(
  physicalIndex: number,
): TileAddressingMetadata {
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= NES_CHR_ROM_TILE_COUNT
  ) {
    throw new RangeError('Physical CHR tile index must be between 0 and 511.');
  }

  const localIndex = localPatternTableTileIndex(physicalIndex);
  const patternTable = patternTableForPhysicalTile(physicalIndex);
  const tileCol = localIndex % 16;
  const tileRow = Math.floor(localIndex / 16);
  const startByteOffset = physicalIndex * 16;
  const plane0Offset = startByteOffset;
  const plane1Offset = startByteOffset + 8;
  const ptAddress = patternTable === 0 ? '$0000' : '$1000';

  return {
    physicalIndex,
    physicalIndexHex: `$${physicalIndex.toString(16).toUpperCase().padStart(3, '0')}`,
    localIndex,
    localIndexHex: `$${localIndex.toString(16).toUpperCase().padStart(2, '0')}`,
    patternTable,
    patternTableAddress: ptAddress,
    patternTableLabel: `PT${String(patternTable)} (${ptAddress})`,
    tileCol,
    tileRow,
    startByteOffset,
    startByteOffsetHex: `$${startByteOffset.toString(16).toUpperCase().padStart(4, '0')}`,
    plane0Offset,
    plane0OffsetHex: `$${plane0Offset.toString(16).toUpperCase().padStart(4, '0')}`,
    plane1Offset,
    plane1OffsetHex: `$${plane1Offset.toString(16).toUpperCase().padStart(4, '0')}`,
  };
}

function validateBaseChr(baseChr: Uint8Array): void {
  if (baseChr.length % 16 !== 0 || baseChr.length > NES_CHR_ROM_SIZE) {
    throw new RangeError(
      'CHR base must contain at most 8 KiB of complete tiles.',
    );
  }
}

function baseChrPhysicalStart(
  fileTileSlots: number,
  destinationPatternTable: SpritePatternTable,
): number {
  return fileTileSlots <= NES_PATTERN_TABLE_TILE_COUNT
    ? physicalTileIndex(destinationPatternTable, 0)
    : 0;
}

function rawChrTileOccupied(baseChr: Uint8Array, tileIndex: number): boolean {
  const encodedStart = tileIndex * 16;
  return baseChr
    .subarray(encodedStart, encodedStart + 16)
    .some((byte) => byte !== 0);
}

export function createPatternTableSlots(
  baseChr: Uint8Array,
  destinationPatternTable: SpritePatternTable = 0,
): PatternTableSlot[] {
  validateBaseChr(baseChr);
  const fileTileSlots = baseChr.length / 16;
  const slots = Array.from(
    { length: NES_CHR_ROM_TILE_COUNT },
    (_, physicalIndex): PatternTableSlot => ({
      physicalTileIndex: physicalIndex,
      tile: null,
      source: null,
    }),
  );
  const start = baseChrPhysicalStart(fileTileSlots, destinationPatternTable);

  for (let index = 0; index < fileTileSlots; index += 1) {
    const physicalIndex = start + index;
    const slot = slots[physicalIndex];
    if (slot === undefined) {
      throw new RangeError('CHR base does not fit in the physical CHR-ROM.');
    }
    // Raw CHR files have no ownership metadata. Until managed projects can
    // express reservations, a sixteen-byte zero tile is the fallback marker
    // for a free slot. Its physical index remains untouched.
    if (!rawChrTileOccupied(baseChr, index)) continue;
    const encodedStart = index * 16;
    const tile = decodeChrTile(
      baseChr.subarray(encodedStart, encodedStart + 16),
      index,
      index % 16,
      Math.floor(index / 16),
    );
    slots[physicalIndex] = {
      physicalTileIndex: physicalIndex,
      tile: { ...tile, id: physicalIndex },
      source: 'destination',
    };
  }

  return slots;
}

function summarizePatternTableOccupancy(
  patternTable: SpritePatternTable,
  occupiedTiles: number,
): PatternTableOccupancy {
  return {
    patternTable,
    capacityTiles: NES_PATTERN_TABLE_TILE_COUNT,
    occupiedTiles,
    freeTiles: NES_PATTERN_TABLE_TILE_COUNT - occupiedTiles,
  };
}

export function analyzeBaseChrOccupancy(
  baseChr: Uint8Array,
  destinationPatternTable: SpritePatternTable = 0,
): BaseChrOccupancy {
  validateBaseChr(baseChr);
  const fileTileSlots = baseChr.length / 16;
  const start = baseChrPhysicalStart(fileTileSlots, destinationPatternTable);
  const occupiedByPatternTable: [number, number] = [0, 0];
  for (let index = 0; index < fileTileSlots; index += 1) {
    if (!rawChrTileOccupied(baseChr, index)) continue;
    const patternTable = patternTableForPhysicalTile(start + index);
    occupiedByPatternTable[patternTable] += 1;
  }
  const patternTable0 = summarizePatternTableOccupancy(
    0,
    occupiedByPatternTable[0],
  );
  const patternTable1 = summarizePatternTableOccupancy(
    1,
    occupiedByPatternTable[1],
  );
  const occupiedTiles =
    patternTable0.occupiedTiles + patternTable1.occupiedTiles;
  return {
    fileSizeBytes: baseChr.length,
    fileTileSlots,
    physicalCapacityTiles: NES_CHR_ROM_TILE_COUNT,
    occupiedTiles,
    freeTiles: NES_CHR_ROM_TILE_COUNT - occupiedTiles,
    patternTables: [patternTable0, patternTable1],
  };
}

export function encodePatternTableSlots(
  slots: readonly PatternTableSlot[],
): Uint8Array {
  if (slots.length !== NES_CHR_ROM_TILE_COUNT) {
    throw new RangeError('A complete NES CHR-ROM has exactly 512 tile slots.');
  }
  const bytes = new Uint8Array(NES_CHR_ROM_SIZE);
  slots.forEach((slot, physicalIndex) => {
    if (slot.tile !== null) {
      bytes.set(encodeTile(slot.tile), physicalIndex * 16);
    }
  });
  return bytes;
}

export function classifyChrSlots(
  options: ClassifyChrSlotsOptions = {},
): readonly ChrSlotClassification[] {
  const result: ChrSlotClassification[] = [];
  const baseChr = options.baseChr;
  const destinationPt = options.destinationPatternTable ?? 0;
  const mode = options.mode ?? 'tileset';
  const finalChrBytes = options.finalChrBytes;

  // Animation mode
  if (
    mode === 'animation' &&
    options.animationModel !== null &&
    options.animationModel !== undefined
  ) {
    const model = options.animationModel;
    const baseHasDataMap = new Uint8Array(NES_CHR_ROM_TILE_COUNT);
    if (baseChr && baseChr.length > 0) {
      const fileTileSlots = Math.floor(baseChr.length / 16);
      const baseStart =
        fileTileSlots <= NES_PATTERN_TABLE_TILE_COUNT
          ? destinationPt * NES_PATTERN_TABLE_TILE_COUNT
          : 0;
      for (let i = 0; i < fileTileSlots; i += 1) {
        const physicalIdx = baseStart + i;
        if (physicalIdx < NES_CHR_ROM_TILE_COUNT) {
          const rawOffset = i * 16;
          const hasData = baseChr
            .subarray(rawOffset, rawOffset + 16)
            .some((b) => b !== 0);
          if (hasData) {
            baseHasDataMap[physicalIdx] = 1;
          }
        }
      }
    }

    const projectAttributionMap = new Map<number, string[]>();
    for (const anim of model.animations) {
      anim.frames.forEach((frame, frameIdx) => {
        for (const sprite of frame.sprites) {
          const pIdx = sprite.physicalTileIndex;
          if (pIdx >= 0 && pIdx < NES_CHR_ROM_TILE_COUNT) {
            const frameLabel = `${anim.name} (#${String(frameIdx)})`;
            const current = projectAttributionMap.get(pIdx) ?? [];
            if (!current.includes(frameLabel)) {
              current.push(frameLabel);
              projectAttributionMap.set(pIdx, current);
            }
          }
        }
      });
    }

    for (
      let physicalIndex = 0;
      physicalIndex < NES_CHR_ROM_TILE_COUNT;
      physicalIndex += 1
    ) {
      const localIndex = localPatternTableTileIndex(physicalIndex);
      const patternTable = patternTableForPhysicalTile(physicalIndex);

      if (baseHasDataMap[physicalIndex] === 1) {
        result.push({
          physicalIndex,
          localIndex,
          patternTable,
          occupancy: 'base',
          attribution: options.baseChrName
            ? `Base CHR: ${options.baseChrName}`
            : 'Base CHR',
        });
      } else {
        const refs = projectAttributionMap.get(physicalIndex);
        if (refs && refs.length > 0) {
          result.push({
            physicalIndex,
            localIndex,
            patternTable,
            occupancy: 'project',
            attribution: refs.join(', '),
          });
        } else {
          const startByte = physicalIndex * 16;
          const isNonZero =
            finalChrBytes && finalChrBytes.length >= startByte + 16
              ? finalChrBytes
                  .subarray(startByte, startByte + 16)
                  .some((b: number) => b !== 0)
              : false;

          if (isNonZero) {
            result.push({
              physicalIndex,
              localIndex,
              patternTable,
              occupancy: 'project',
              attribution: 'Project Tile',
            });
          } else {
            result.push({
              physicalIndex,
              localIndex,
              patternTable,
              occupancy: 'empty',
            });
          }
        }
      }
    }

    return result;
  }

  // Tileset or Playfield mode with Base CHR
  if (baseChr && baseChr.length > 0) {
    const slots = createPatternTableSlots(baseChr, destinationPt);
    const deduplicated = options.flipDeduplicationEnabled
      ? deduplicateTilesConsideringFlips(options.tiles ?? [])
      : options.deduplicationEnabled !== false
        ? deduplicateTiles(options.tiles ?? [])
        : (options.tiles ?? []);

    let insertIndex = 0;
    for (const tile of deduplicated) {
      while (insertIndex < slots.length && slots[insertIndex]?.tile !== null) {
        insertIndex += 1;
      }
      if (insertIndex < slots.length) {
        slots[insertIndex] = {
          physicalTileIndex: insertIndex,
          tile,
          source: 'imported',
        };
        insertIndex += 1;
      }
    }

    for (
      let physicalIndex = 0;
      physicalIndex < NES_CHR_ROM_TILE_COUNT;
      physicalIndex += 1
    ) {
      const localIndex = localPatternTableTileIndex(physicalIndex);
      const patternTable = patternTableForPhysicalTile(physicalIndex);
      const slot = slots[physicalIndex];

      if (slot?.source === 'destination') {
        result.push({
          physicalIndex,
          localIndex,
          patternTable,
          occupancy: 'base',
          attribution: options.baseChrName
            ? `Base CHR: ${options.baseChrName}`
            : 'Base CHR',
        });
      } else if (slot?.source === 'imported') {
        const matchedTile =
          (options.tiles ?? []).find((tItem) => tItem.id === physicalIndex) ??
          slot.tile;
        const attribution = matchedTile
          ? `Tile #${String(matchedTile.id)} (Col ${String(matchedTile.column)}, Row ${String(matchedTile.row)})`
          : 'Project Tile';

        result.push({
          physicalIndex,
          localIndex,
          patternTable,
          occupancy: 'project',
          attribution,
        });
      } else {
        const startByte = physicalIndex * 16;
        const isNonZero =
          finalChrBytes && finalChrBytes.length >= startByte + 16
            ? finalChrBytes
                .subarray(startByte, startByte + 16)
                .some((b: number) => b !== 0)
            : false;

        if (isNonZero) {
          result.push({
            physicalIndex,
            localIndex,
            patternTable,
            occupancy: 'project',
            attribution: 'Project Tile',
          });
        } else {
          result.push({
            physicalIndex,
            localIndex,
            patternTable,
            occupancy: 'empty',
          });
        }
      }
    }

    return result;
  }

  // Tileset or Playfield mode without Base CHR
  const deduplicated = options.flipDeduplicationEnabled
    ? deduplicateTilesConsideringFlips(options.tiles ?? [])
    : options.deduplicationEnabled !== false
      ? deduplicateTiles(options.tiles ?? [])
      : (options.tiles ?? []);

  const totalOccupied = Math.min(NES_CHR_ROM_TILE_COUNT, deduplicated.length);

  for (
    let physicalIndex = 0;
    physicalIndex < NES_CHR_ROM_TILE_COUNT;
    physicalIndex += 1
  ) {
    const localIndex = localPatternTableTileIndex(physicalIndex);
    const patternTable = patternTableForPhysicalTile(physicalIndex);

    const matchedDirect = (options.tiles ?? []).find(
      (tItem) => tItem.id === physicalIndex,
    );

    const startByte = physicalIndex * 16;
    const isNonZero =
      finalChrBytes && finalChrBytes.length >= startByte + 16
        ? finalChrBytes
            .subarray(startByte, startByte + 16)
            .some((b: number) => b !== 0)
        : false;

    if (
      physicalIndex < totalOccupied ||
      matchedDirect !== undefined ||
      isNonZero
    ) {
      const matchedTile = matchedDirect ?? deduplicated[physicalIndex];
      const attribution = matchedTile
        ? `Tile #${String(matchedTile.id)} (Col ${String(matchedTile.column)}, Row ${String(matchedTile.row)})`
        : 'Project Tile';

      result.push({
        physicalIndex,
        localIndex,
        patternTable,
        occupancy: 'project',
        attribution,
      });
    } else {
      result.push({
        physicalIndex,
        localIndex,
        patternTable,
        occupancy: 'empty',
      });
    }
  }

  return result;
}

export function collectFramePhysicalTileUsage(
  animationModel?: CollectChrHighlightOptions['animationModel'],
  selectedAnimationId?: string | null,
  frameIndex?: number | null,
): Set<number> {
  const result = new Set<number>();
  if (!animationModel?.animations || animationModel.animations.length === 0) {
    return result;
  }

  const targetAnimation =
    (selectedAnimationId
      ? animationModel.animations.find(
          (a) => a.id === selectedAnimationId || a.name === selectedAnimationId,
        )
      : null) ?? animationModel.animations[0];

  if (!targetAnimation?.frames || targetAnimation.frames.length === 0) {
    return result;
  }

  const frameOrder = frameIndex ?? 0;
  const targetFrame = targetAnimation.frames[frameOrder];
  if (!targetFrame?.sprites) {
    return result;
  }

  for (const sprite of targetFrame.sprites) {
    if (
      typeof sprite.physicalTileIndex === 'number' &&
      sprite.physicalTileIndex >= 0 &&
      sprite.physicalTileIndex < NES_CHR_ROM_TILE_COUNT
    ) {
      result.add(sprite.physicalTileIndex);
    }
  }

  return result;
}

export function collectAnimationPhysicalTileUsage(
  animationModel?: CollectChrHighlightOptions['animationModel'],
  selectedAnimationId?: string | null,
): Set<number> {
  const result = new Set<number>();
  if (!animationModel?.animations || animationModel.animations.length === 0) {
    return result;
  }

  let matchingAnimations = selectedAnimationId
    ? animationModel.animations.filter(
        (a) => a.id === selectedAnimationId || a.name === selectedAnimationId,
      )
    : [];

  if (matchingAnimations.length === 0 && animationModel.animations[0]) {
    matchingAnimations = [animationModel.animations[0]];
  }

  for (const anim of matchingAnimations) {
    for (const frame of anim.frames) {
      for (const sprite of frame.sprites) {
        if (
          typeof sprite.physicalTileIndex === 'number' &&
          sprite.physicalTileIndex >= 0 &&
          sprite.physicalTileIndex < NES_CHR_ROM_TILE_COUNT
        ) {
          result.add(sprite.physicalTileIndex);
        }
      }
    }
  }

  return result;
}

export function collectEntityPhysicalTileUsage(
  animationModel?: CollectChrHighlightOptions['animationModel'],
  targetEntity?: string | null,
  selectedAnimationId?: string | null,
): Set<number> {
  const result = new Set<number>();
  if (!animationModel?.animations || animationModel.animations.length === 0) {
    return result;
  }

  let entityName = targetEntity?.trim();
  if (!entityName) {
    const activeAnim = selectedAnimationId
      ? animationModel.animations.find(
          (a) => a.id === selectedAnimationId || a.name === selectedAnimationId,
        )
      : animationModel.animations[0];
    entityName = activeAnim?.entity?.trim();
    if (!entityName && activeAnim?.name) {
      const parts = activeAnim.name.split('_');
      if (parts.length > 1 && parts[0]) {
        entityName = parts[0];
      }
    }
  }

  if (!entityName) {
    return collectAnimationPhysicalTileUsage(
      animationModel,
      selectedAnimationId,
    );
  }

  const normalizedEntity = entityName.toLowerCase();
  const matchingAnimations = animationModel.animations.filter((a) => {
    if (a.entity?.trim().toLowerCase() === normalizedEntity) {
      return true;
    }
    const prefix = a.name.toLowerCase().split('_')[0];
    return prefix === normalizedEntity;
  });

  for (const anim of matchingAnimations) {
    for (const frame of anim.frames) {
      for (const sprite of frame.sprites) {
        if (
          typeof sprite.physicalTileIndex === 'number' &&
          sprite.physicalTileIndex >= 0 &&
          sprite.physicalTileIndex < NES_CHR_ROM_TILE_COUNT
        ) {
          result.add(sprite.physicalTileIndex);
        }
      }
    }
  }

  return result;
}

export function collectChrHighlightTileIndices(
  options: CollectChrHighlightOptions,
): ReadonlySet<number> {
  switch (options.scope) {
    case 'none':
      return new Set<number>();
    case 'frame':
      return collectFramePhysicalTileUsage(
        options.animationModel,
        options.selectedAnimationId,
        options.selectedFrameIndex,
      );
    case 'animation':
      return collectAnimationPhysicalTileUsage(
        options.animationModel,
        options.selectedAnimationId,
      );
    case 'entity':
      return collectEntityPhysicalTileUsage(
        options.animationModel,
        options.selectedEntity,
        options.selectedAnimationId,
      );
    case 'base': {
      const baseIndices = new Set<number>();
      for (const classification of options.classifications ?? []) {
        if (classification.occupancy === 'base') {
          baseIndices.add(classification.physicalIndex);
        }
      }
      return baseIndices;
    }
    case 'all': {
      const projectIndices = new Set<number>();
      for (const classification of options.classifications ?? []) {
        if (classification.occupancy === 'project') {
          projectIndices.add(classification.physicalIndex);
        }
      }
      return projectIndices;
    }
    default:
      return new Set<number>();
  }
}

export interface AnimationTileReference {
  readonly type: 'animation';
  readonly entity?: string;
  readonly animationId: string;
  readonly animationName: string;
  readonly frameIndex: number;
  readonly spriteIndex: number;
  readonly x: number;
  readonly y: number;
  readonly horizontalFlip: boolean;
  readonly verticalFlip: boolean;
  readonly physicalTileIndex: number;
}

export interface PlayfieldTileReference {
  readonly type: 'playfield';
  readonly column: number;
  readonly row: number;
  readonly nametableIndex: number;
  readonly tileIndex: number;
  readonly physicalTileIndex: number;
}

export interface TilesetTileReference {
  readonly type: 'tileset';
  readonly tileIndex: number;
  readonly sourceIndex?: number;
  readonly physicalTileIndex: number;
}

export type ChrTileReference =
  AnimationTileReference | PlayfieldTileReference | TilesetTileReference;

export interface CollectChrTileReferencesOptions {
  readonly physicalTileIndex: number;
  readonly mode?: 'tileset' | 'playfield' | 'animation';
  readonly animationModel?: AnimationProjectModel | null;
  readonly playfieldNametable?: Uint8Array | null;
  readonly destinationPatternTable?: SpritePatternTable;
  readonly tiles?: readonly Tile[];
  readonly deduplicationEnabled?: boolean;
  readonly flipDeduplicationEnabled?: boolean;
}

export function collectPhysicalTileReferences(
  options: CollectChrTileReferencesOptions,
): readonly ChrTileReference[] {
  const references: ChrTileReference[] = [];
  const targetIndex = options.physicalTileIndex;
  if (targetIndex < 0 || targetIndex >= NES_CHR_ROM_TILE_COUNT) {
    return references;
  }

  // 1. Animation references
  if (options.animationModel) {
    for (const anim of options.animationModel.animations) {
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
          if (sprite?.physicalTileIndex === targetIndex) {
            references.push({
              type: 'animation',
              entity: anim.entity,
              animationId: anim.id ?? anim.name,
              animationName: anim.name,
              frameIndex,
              spriteIndex,
              x: sprite.x,
              y: sprite.y,
              horizontalFlip: sprite.horizontalFlip,
              verticalFlip: sprite.verticalFlip,
              physicalTileIndex: targetIndex,
            });
          }
        }
      }
    }
  }

  // 2. Playfield references
  if (options.mode === 'playfield' && options.playfieldNametable) {
    const destPt = options.destinationPatternTable ?? 0;
    const nametable = options.playfieldNametable;
    const maxCells = Math.min(nametable.length, 960);
    for (let i = 0; i < maxCells; i += 1) {
      const tileIndex = nametable[i] ?? 0;
      const physicalIndex = destPt * NES_PATTERN_TABLE_TILE_COUNT + tileIndex;
      if (physicalIndex === targetIndex) {
        const row = Math.floor(i / 32);
        const col = i % 32;
        references.push({
          type: 'playfield',
          column: col,
          row,
          nametableIndex: i,
          tileIndex,
          physicalTileIndex: targetIndex,
        });
      }
    }
  }

  // 3. Tileset references
  if (options.mode === 'tileset' && options.tiles && options.tiles.length > 0) {
    const destPt = options.destinationPatternTable ?? 0;
    const deduplicationEnabled = options.deduplicationEnabled ?? true;
    const flipDeduplicationEnabled = options.flipDeduplicationEnabled ?? false;
    const visibleTiles = deduplicationEnabled
      ? flipDeduplicationEnabled
        ? deduplicateTilesConsideringFlips(options.tiles)
        : deduplicateTiles(options.tiles)
      : options.tiles;

    const baseOffset = destPt * NES_PATTERN_TABLE_TILE_COUNT;
    const localIndex = targetIndex - baseOffset;
    if (localIndex >= 0 && localIndex < visibleTiles.length) {
      const tile = visibleTiles[localIndex];
      references.push({
        type: 'tileset',
        tileIndex: localIndex,
        sourceIndex: tile?.id,
        physicalTileIndex: targetIndex,
      });
    }
  }

  return references;
}

export function buildPhysicalTileReferenceIndex(
  options: Omit<CollectChrTileReferencesOptions, 'physicalTileIndex'>,
): Map<number, readonly ChrTileReference[]> {
  const index = new Map<number, ChrTileReference[]>();

  const addRef = (ref: ChrTileReference): void => {
    const existing = index.get(ref.physicalTileIndex);
    if (existing) {
      existing.push(ref);
    } else {
      index.set(ref.physicalTileIndex, [ref]);
    }
  };

  // 1. Animation references
  if (options.animationModel) {
    for (const anim of options.animationModel.animations) {
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
          if (sprite) {
            addRef({
              type: 'animation',
              entity: anim.entity,
              animationId: anim.id ?? anim.name,
              animationName: anim.name,
              frameIndex,
              spriteIndex,
              x: sprite.x,
              y: sprite.y,
              horizontalFlip: sprite.horizontalFlip,
              verticalFlip: sprite.verticalFlip,
              physicalTileIndex: sprite.physicalTileIndex,
            });
          }
        }
      }
    }
  }

  // 2. Playfield references
  if (options.mode === 'playfield' && options.playfieldNametable) {
    const destPt = options.destinationPatternTable ?? 0;
    const nametable = options.playfieldNametable;
    const maxCells = Math.min(nametable.length, 960);
    for (let i = 0; i < maxCells; i += 1) {
      const tileIndex = nametable[i] ?? 0;
      const physicalIndex = destPt * NES_PATTERN_TABLE_TILE_COUNT + tileIndex;
      const row = Math.floor(i / 32);
      const col = i % 32;
      addRef({
        type: 'playfield',
        column: col,
        row,
        nametableIndex: i,
        tileIndex,
        physicalTileIndex: physicalIndex,
      });
    }
  }

  // 3. Tileset references
  if (options.mode === 'tileset' && options.tiles && options.tiles.length > 0) {
    const destPt = options.destinationPatternTable ?? 0;
    const deduplicationEnabled = options.deduplicationEnabled ?? true;
    const flipDeduplicationEnabled = options.flipDeduplicationEnabled ?? false;
    const visibleTiles = deduplicationEnabled
      ? flipDeduplicationEnabled
        ? deduplicateTilesConsideringFlips(options.tiles)
        : deduplicateTiles(options.tiles)
      : options.tiles;

    const baseOffset = destPt * NES_PATTERN_TABLE_TILE_COUNT;
    visibleTiles.forEach((tile, localIndex) => {
      const physicalIndex = baseOffset + localIndex;
      addRef({
        type: 'tileset',
        tileIndex: localIndex,
        sourceIndex: tile.id,
        physicalTileIndex: physicalIndex,
      });
    });
  }

  return index;
}

export type ChrHeatmapBucket =
  'unused' | 'single' | 'moderate' | 'high' | 'very-high';

export interface ChrTileUsageDiagnostic {
  readonly physicalTileIndex: number;
  readonly referenceCount: number;
  readonly resourceCount: number;
  readonly frameCount: number;
  readonly animationCount: number;
  readonly entityCount: number;
  readonly bucket: ChrHeatmapBucket;
}

export interface ChrUsageHeatmapSummary {
  readonly totalReferences: number;
  readonly referencedTileCount: number;
  readonly reusedTileCount: number;
  readonly unreferencedOccupiedTileCount: number;
  readonly maxReferenceCount: number;
  readonly mostReferencedTileIndex: number | null;
  readonly averageReuseRatio: number;
}

export function classifyHeatmapBucket(
  referenceCount: number,
): ChrHeatmapBucket {
  if (referenceCount <= 0) return 'unused';
  if (referenceCount === 1) return 'single';
  if (referenceCount <= 3) return 'moderate';
  if (referenceCount <= 7) return 'high';
  return 'very-high';
}

export interface CalculateTileUsageDiagnosticsOptions extends Omit<
  CollectChrTileReferencesOptions,
  'physicalTileIndex'
> {
  readonly physicalTileCount?: number;
  readonly referenceIndex?: Map<number, readonly ChrTileReference[]>;
}

export function calculateTileUsageDiagnostics(
  options: CalculateTileUsageDiagnosticsOptions,
): readonly ChrTileUsageDiagnostic[] {
  const totalTiles = options.physicalTileCount ?? NES_CHR_ROM_TILE_COUNT;
  const refIndex =
    options.referenceIndex ?? buildPhysicalTileReferenceIndex(options);

  const result: ChrTileUsageDiagnostic[] = [];

  for (let i = 0; i < totalTiles; i += 1) {
    const refs = refIndex.get(i) ?? [];
    const referenceCount = refs.length;

    let frameCount = 0;
    let animationCount = 0;
    let entityCount = 0;
    let resourceCount = 0;

    if (referenceCount > 0) {
      const distinctFrames = new Set<string>();
      const distinctAnimations = new Set<string>();
      const distinctEntities = new Set<string>();
      let hasPlayfield = false;
      let hasTileset = false;

      for (const ref of refs) {
        switch (ref.type) {
          case 'animation':
            distinctFrames.add(`${ref.animationId}:${String(ref.frameIndex)}`);
            distinctAnimations.add(ref.animationId);
            if (ref.entity) {
              distinctEntities.add(ref.entity);
            }
            break;
          case 'playfield':
            hasPlayfield = true;
            break;
          case 'tileset':
            hasTileset = true;
            break;
        }
      }

      frameCount = distinctFrames.size;
      animationCount = distinctAnimations.size;
      entityCount = distinctEntities.size;
      resourceCount =
        animationCount + (hasPlayfield ? 1 : 0) + (hasTileset ? 1 : 0);
    }

    const bucket = classifyHeatmapBucket(referenceCount);

    result.push({
      physicalTileIndex: i,
      referenceCount,
      resourceCount,
      frameCount,
      animationCount,
      entityCount,
      bucket,
    });
  }

  return result;
}

export function calculateChrUsageHeatmapSummary(
  diagnostics: readonly ChrTileUsageDiagnostic[],
  classifications?: readonly ChrSlotClassification[],
): ChrUsageHeatmapSummary {
  let totalReferences = 0;
  let referencedTileCount = 0;
  let reusedTileCount = 0;
  let unreferencedOccupiedTileCount = 0;
  let maxReferenceCount = 0;
  let mostReferencedTileIndex: number | null = null;

  for (const diag of diagnostics) {
    const refs = diag.referenceCount;
    totalReferences += refs;
    if (refs > 0) {
      referencedTileCount += 1;
      if (refs >= 2) {
        reusedTileCount += 1;
      }
      if (refs > maxReferenceCount) {
        maxReferenceCount = refs;
        mostReferencedTileIndex = diag.physicalTileIndex;
      }
    } else if (classifications) {
      const cls = classifications[diag.physicalTileIndex];
      if (cls && (cls.occupancy === 'project' || cls.occupancy === 'base')) {
        unreferencedOccupiedTileCount += 1;
      }
    }
  }

  const averageReuseRatio =
    referencedTileCount > 0
      ? Math.round((totalReferences / referencedTileCount) * 100) / 100
      : 0;

  return {
    totalReferences,
    referencedTileCount,
    reusedTileCount,
    unreferencedOccupiedTileCount,
    maxReferenceCount,
    mostReferencedTileIndex,
    averageReuseRatio,
  };
}
