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

export type ChrRegionKind = 'region' | 'reservation';

export interface ChrRegion {
  readonly id: string;
  readonly name: string;
  readonly patternTable: SpritePatternTable;
  readonly startTile: number;
  readonly endTile: number;
  readonly kind: ChrRegionKind;
  readonly notes?: string;
  readonly color?: string;
}

export type ChrRegionValidationErrorCode =
  | 'invalid-id'
  | 'invalid-name'
  | 'invalid-pattern-table'
  | 'invalid-start-tile'
  | 'invalid-end-tile'
  | 'start-after-end'
  | 'invalid-kind'
  | 'invalid-color'
  | 'invalid-notes';

export interface ChrRegionValidationError {
  readonly code: ChrRegionValidationErrorCode;
  readonly message: string;
  readonly field: keyof ChrRegion;
}

export type ChrRegionValidationResult =
  | { readonly valid: true; readonly region: ChrRegion }
  | {
      readonly valid: false;
      readonly errors: readonly ChrRegionValidationError[];
    };

export interface ChrRegionOverlap {
  readonly regionA: ChrRegion;
  readonly regionB: ChrRegion;
  readonly patternTable: SpritePatternTable;
  readonly overlapStartTile: number;
  readonly overlapEndTile: number;
}

export function validateChrRegion(value: unknown): ChrRegionValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      valid: false,
      errors: [
        {
          code: 'invalid-id',
          message: 'Region must be an object.',
          field: 'id',
        },
      ],
    };
  }

  const raw = value as Record<string, unknown>;
  const errors: ChrRegionValidationError[] = [];

  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!rawId) {
    errors.push({
      code: 'invalid-id',
      message: 'Region id must be a non-empty string.',
      field: 'id',
    });
  }

  const rawName = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!rawName) {
    errors.push({
      code: 'invalid-name',
      message: 'Region name must be a non-empty string.',
      field: 'name',
    });
  }

  const pt = raw.patternTable;
  if (
    typeof pt !== 'number' ||
    !Number.isInteger(pt) ||
    (pt !== 0 && pt !== 1)
  ) {
    errors.push({
      code: 'invalid-pattern-table',
      message: 'Pattern table must be 0 (PT0) or 1 (PT1).',
      field: 'patternTable',
    });
  }

  const startTile = raw.startTile;
  if (
    typeof startTile !== 'number' ||
    !Number.isInteger(startTile) ||
    startTile < 0 ||
    startTile >= NES_PATTERN_TABLE_TILE_COUNT
  ) {
    errors.push({
      code: 'invalid-start-tile',
      message:
        'Start tile index must be an integer between 0 and 255 ($00..$FF).',
      field: 'startTile',
    });
  }

  const endTile = raw.endTile;
  if (
    typeof endTile !== 'number' ||
    !Number.isInteger(endTile) ||
    endTile < 0 ||
    endTile >= NES_PATTERN_TABLE_TILE_COUNT
  ) {
    errors.push({
      code: 'invalid-end-tile',
      message:
        'End tile index must be an integer between 0 and 255 ($00..$FF).',
      field: 'endTile',
    });
  }

  if (
    typeof startTile === 'number' &&
    Number.isInteger(startTile) &&
    typeof endTile === 'number' &&
    Number.isInteger(endTile) &&
    startTile >= 0 &&
    startTile < NES_PATTERN_TABLE_TILE_COUNT &&
    endTile >= 0 &&
    endTile < NES_PATTERN_TABLE_TILE_COUNT &&
    startTile > endTile
  ) {
    errors.push({
      code: 'start-after-end',
      message: `Start tile ($${startTile.toString(16).toUpperCase().padStart(2, '0')}) cannot be greater than end tile ($${endTile.toString(16).toUpperCase().padStart(2, '0')}).`,
      field: 'startTile',
    });
  }

  const kind = raw.kind;
  if (kind !== 'region' && kind !== 'reservation') {
    errors.push({
      code: 'invalid-kind',
      message: "Region kind must be either 'region' or 'reservation'.",
      field: 'kind',
    });
  }

  let notes: string | undefined;
  if (raw.notes !== undefined && raw.notes !== null) {
    if (typeof raw.notes !== 'string') {
      errors.push({
        code: 'invalid-notes',
        message: 'Region notes must be a string.',
        field: 'notes',
      });
    } else {
      const trimmedNotes = raw.notes.trim();
      if (trimmedNotes) {
        notes = trimmedNotes;
      }
    }
  }

  let color: string | undefined;
  if (raw.color !== undefined && raw.color !== null) {
    if (typeof raw.color !== 'string') {
      errors.push({
        code: 'invalid-color',
        message: 'Region color must be a string.',
        field: 'color',
      });
    } else {
      const trimmedColor = raw.color.trim();
      if (trimmedColor) {
        color = trimmedColor;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const region: ChrRegion = {
    id: rawId,
    name: rawName,
    patternTable: pt as SpritePatternTable,
    startTile: startTile as number,
    endTile: endTile as number,
    kind: kind as ChrRegionKind,
    ...(notes !== undefined ? { notes } : {}),
    ...(color !== undefined ? { color } : {}),
  };

  return { valid: true, region };
}

export function chrRegionPhysicalRange(
  region: ChrRegion,
): readonly [number, number] {
  const base = region.patternTable * NES_PATTERN_TABLE_TILE_COUNT;
  return [base + region.startTile, base + region.endTile];
}

export function isPhysicalTileInRegion(
  physicalIndex: number,
  region: ChrRegion,
): boolean {
  if (
    !Number.isInteger(physicalIndex) ||
    physicalIndex < 0 ||
    physicalIndex >= NES_CHR_ROM_TILE_COUNT
  ) {
    return false;
  }
  const [start, end] = chrRegionPhysicalRange(region);
  return physicalIndex >= start && physicalIndex <= end;
}

export function isLocalTileInRegion(
  patternTable: SpritePatternTable,
  localIndex: number,
  region: ChrRegion,
): boolean {
  if (
    !isSpritePatternTable(patternTable) ||
    !Number.isInteger(localIndex) ||
    localIndex < 0 ||
    localIndex >= NES_PATTERN_TABLE_TILE_COUNT
  ) {
    return false;
  }
  return (
    region.patternTable === patternTable &&
    localIndex >= region.startTile &&
    localIndex <= region.endTile
  );
}

export function doChrRegionsOverlap(a: ChrRegion, b: ChrRegion): boolean {
  if (a.patternTable !== b.patternTable) {
    return false;
  }
  return Math.max(a.startTile, b.startTile) <= Math.min(a.endTile, b.endTile);
}

export function getChrRegionOverlapRange(
  a: ChrRegion,
  b: ChrRegion,
): readonly [number, number] | null {
  if (!doChrRegionsOverlap(a, b)) {
    return null;
  }
  return [Math.max(a.startTile, b.startTile), Math.min(a.endTile, b.endTile)];
}

export function findChrRegionOverlaps(
  regions: readonly ChrRegion[],
): readonly ChrRegionOverlap[] {
  const overlaps: ChrRegionOverlap[] = [];
  for (let i = 0; i < regions.length; i += 1) {
    const a = regions[i];
    if (!a) continue;
    for (let j = i + 1; j < regions.length; j += 1) {
      const b = regions[j];
      if (!b) continue;
      const range = getChrRegionOverlapRange(a, b);
      if (range !== null) {
        overlaps.push({
          regionA: a,
          regionB: b,
          patternTable: a.patternTable,
          overlapStartTile: range[0],
          overlapEndTile: range[1],
        });
      }
    }
  }
  return overlaps;
}

export function collectReservedPhysicalTileIndices(
  regions: readonly ChrRegion[] = [],
  patternTable?: SpritePatternTable,
): ReadonlySet<number> {
  const reserved = new Set<number>();
  for (const region of regions) {
    if (region.kind === 'reservation') {
      if (patternTable === undefined || region.patternTable === patternTable) {
        const [start, end] = chrRegionPhysicalRange(region);
        for (let i = start; i <= end; i += 1) {
          reserved.add(i);
        }
      }
    }
  }
  return reserved;
}

export function collectReservedLocalTileIndices(
  regions: readonly ChrRegion[] = [],
  patternTable: SpritePatternTable,
): ReadonlySet<number> {
  const reserved = new Set<number>();
  for (const region of regions) {
    if (region.kind === 'reservation' && region.patternTable === patternTable) {
      for (let i = region.startTile; i <= region.endTile; i += 1) {
        reserved.add(i);
      }
    }
  }
  return reserved;
}

/**
 * Formats a local tile index ($00..$FF) into canonical NES hex notation.
 */
export function formatTileIndexHex(value: number): string {
  return `$${(value & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * Formats a tile index interval ($00..$FF) into canonical NES hex range notation.
 */
export function formatTileRangeHex(startTile: number, endTile: number): string {
  return startTile === endTile
    ? formatTileIndexHex(startTile)
    : `${formatTileIndexHex(startTile)}-${formatTileIndexHex(endTile)}`;
}

/**
 * Aggregates a list of local tile indices into concise comma-separated hex ranges.
 * E.g., [0, 1, 2, 3, 8] -> "$00-$03, $08"
 */
export function formatConsecutiveTileRanges(
  indices: readonly number[],
): string {
  if (indices.length === 0) return '';
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  let rangeStart = sorted[0] ?? 0;
  let rangeEnd = sorted[0] ?? 0;

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i] ?? 0;
    if (current === rangeEnd + 1) {
      rangeEnd = current;
    } else {
      ranges.push([rangeStart, rangeEnd]);
      rangeStart = current;
      rangeEnd = current;
    }
  }
  ranges.push([rangeStart, rangeEnd]);

  return ranges
    .map(([start, end]) => formatTileRangeHex(start, end))
    .join(', ');
}

/**
 * Default threshold of remaining unallocated slots below which a low capacity warning is generated.
 */
export const CHR_LOW_CAPACITY_THRESHOLD = 8;

export interface PatternTableCapacityMetrics {
  readonly patternTable: SpritePatternTable;
  readonly capacityTiles: number;
  readonly totalOccupiedTiles: number;
  readonly totalReservedEmptyTiles: number;
  readonly totalEmptyTiles: number;
  readonly availableSlots: number;
  readonly isExhausted: boolean;
  readonly isLowCapacity: boolean;
}

/**
 * Pure calculation of Pattern Table capacity and remaining slots available for new allocations.
 *
 * Invariant: occupied != reserved.
 * - Occupied tiles (base or project) within a reservation are counted under `totalOccupiedTiles`.
 * - Empty slots within a reservation are counted under `totalReservedEmptyTiles`.
 * - `availableSlots = 256 - totalOccupiedTiles - totalReservedEmptyTiles = totalEmptyTiles`.
 * - No double counting occurs.
 */
export function calculatePatternTableCapacity(
  classifications: readonly ChrSlotClassification[],
  patternTable: SpritePatternTable,
): PatternTableCapacityMetrics {
  const [start, end] = patternTablePhysicalRange(patternTable);
  let totalOccupiedTiles = 0;
  let totalReservedEmptyTiles = 0;
  let totalEmptyTiles = 0;

  for (let i = start; i <= end; i += 1) {
    const slot = classifications[i];
    if (slot?.occupancy === 'base' || slot?.occupancy === 'project') {
      totalOccupiedTiles += 1;
    } else if (slot?.occupancy === 'reserved') {
      totalReservedEmptyTiles += 1;
    } else {
      totalEmptyTiles += 1;
    }
  }

  const availableSlots = totalEmptyTiles;
  return {
    patternTable,
    capacityTiles: NES_PATTERN_TABLE_TILE_COUNT,
    totalOccupiedTiles,
    totalReservedEmptyTiles,
    totalEmptyTiles,
    availableSlots,
    isExhausted: availableSlots === 0,
    isLowCapacity:
      availableSlots > 0 && availableSlots <= CHR_LOW_CAPACITY_THRESHOLD,
  };
}

export interface ChrRegionCapacityMetrics {
  readonly region: ChrRegion;
  readonly patternTable: SpritePatternTable;
  readonly totalTiles: number;
  readonly occupiedTiles: number;
  readonly reservedEmptyTiles: number;
  readonly availableTiles: number;
  readonly isFull: boolean;
}

/**
 * Pure calculation of capacity for a specific CHR region or reservation.
 */
export function calculateChrRegionCapacity(
  region: ChrRegion,
  classifications: readonly ChrSlotClassification[],
): ChrRegionCapacityMetrics {
  const [start, end] = chrRegionPhysicalRange(region);
  const totalTiles = region.endTile - region.startTile + 1;
  let occupiedTiles = 0;
  let reservedEmptyTiles = 0;

  for (let i = start; i <= end; i += 1) {
    const slot = classifications[i];
    if (slot?.occupancy === 'base' || slot?.occupancy === 'project') {
      occupiedTiles += 1;
    } else if (slot?.occupancy === 'reserved') {
      reservedEmptyTiles += 1;
    }
  }

  const availableTiles = totalTiles - occupiedTiles - reservedEmptyTiles;
  return {
    region,
    patternTable: region.patternTable,
    totalTiles,
    occupiedTiles,
    reservedEmptyTiles,
    availableTiles,
    isFull: occupiedTiles === totalTiles,
  };
}

export type ChrRegionDiagnosticFact =
  | {
      readonly kind: 'region-overlap';
      readonly id: string;
      readonly regionA: ChrRegion;
      readonly regionB: ChrRegion;
      readonly patternTable: SpritePatternTable;
      readonly overlapStartTile: number;
      readonly overlapEndTile: number;
      readonly overlapType:
        'region-region' | 'region-reservation' | 'reservation-reservation';
      readonly severity: 'warning' | 'info';
    }
  | {
      readonly kind: 'reservation-contains-occupied';
      readonly id: string;
      readonly region: ChrRegion;
      readonly patternTable: SpritePatternTable;
      readonly occupiedCount: number;
      readonly occupiedTileIndices: readonly number[];
      readonly startTile: number;
      readonly endTile: number;
      readonly severity: 'warning';
    }
  | {
      readonly kind: 'pattern-table-exhausted';
      readonly id: string;
      readonly patternTable: SpritePatternTable;
      readonly capacityTiles: number;
      readonly totalOccupied: number;
      readonly totalReservedEmpty: number;
      readonly severity: 'error';
    }
  | {
      readonly kind: 'pattern-table-low-capacity';
      readonly id: string;
      readonly patternTable: SpritePatternTable;
      readonly capacityTiles: number;
      readonly availableSlots: number;
      readonly totalOccupied: number;
      readonly totalReservedEmpty: number;
      readonly severity: 'warning';
    }
  | {
      readonly kind: 'region-full';
      readonly id: string;
      readonly region: ChrRegion;
      readonly patternTable: SpritePatternTable;
      readonly totalTiles: number;
      readonly occupiedTiles: number;
      readonly severity: 'info';
    };

export interface AnalyzeChrRegionDiagnosticsOptions {
  readonly chrRegions?: readonly ChrRegion[];
  readonly classifications?: readonly ChrSlotClassification[];
  readonly checkPatternTableCapacity?: boolean;
}

/**
 * Pure domain analysis of CHR regions, reservations, overlaps, and capacity constraints.
 * Returns structured, deterministic facts without any mutation or side-effects.
 */
export function analyzeChrRegionDiagnostics(
  options: AnalyzeChrRegionDiagnosticsOptions = {},
): readonly ChrRegionDiagnosticFact[] {
  const regions = options.chrRegions ?? [];
  const classifications = options.classifications;
  const facts: ChrRegionDiagnosticFact[] = [];

  // 1. Overlaps
  const overlaps = findChrRegionOverlaps(regions);
  for (const overlap of overlaps) {
    const { regionA, regionB, patternTable, overlapStartTile, overlapEndTile } =
      overlap;
    const [id1, id2] = [regionA.id, regionB.id].sort();
    let overlapType:
      'region-region' | 'region-reservation' | 'reservation-reservation';
    let severity: 'warning' | 'info';
    let idPrefix: string;

    if (regionA.kind === 'reservation' && regionB.kind === 'reservation') {
      overlapType = 'reservation-reservation';
      severity = 'warning';
      idPrefix = 'chr-reservation-overlap';
    } else if (regionA.kind === 'region' && regionB.kind === 'region') {
      overlapType = 'region-region';
      severity = 'warning';
      idPrefix = 'chr-region-overlap';
    } else {
      overlapType = 'region-reservation';
      severity = 'info';
      idPrefix = 'chr-region-reservation-overlap';
    }

    facts.push({
      kind: 'region-overlap',
      id: `${idPrefix}:${id1 ?? ''}:${id2 ?? ''}`,
      regionA,
      regionB,
      patternTable,
      overlapStartTile,
      overlapEndTile,
      overlapType,
      severity,
    });
  }

  // 2. Reservations containing occupied content & Region Fullness
  if (classifications?.length === NES_CHR_ROM_TILE_COUNT) {
    for (const region of regions) {
      if (region.kind === 'reservation') {
        const [start, end] = chrRegionPhysicalRange(region);
        const occupiedTileIndices: number[] = [];

        for (let i = start; i <= end; i += 1) {
          const slot = classifications[i];
          if (slot?.occupancy === 'base' || slot?.occupancy === 'project') {
            occupiedTileIndices.push(slot.localIndex);
          }
        }

        if (occupiedTileIndices.length > 0) {
          facts.push({
            kind: 'reservation-contains-occupied',
            id: `chr-reservation-occupied:${region.id}`,
            region,
            patternTable: region.patternTable,
            occupiedCount: occupiedTileIndices.length,
            occupiedTileIndices,
            startTile: region.startTile,
            endTile: region.endTile,
            severity: 'warning',
          });
        }
      } else {
        const capacity = calculateChrRegionCapacity(region, classifications);
        if (capacity.isFull && capacity.totalTiles > 0) {
          facts.push({
            kind: 'region-full',
            id: `chr-region-full:${region.id}`,
            region,
            patternTable: region.patternTable,
            totalTiles: capacity.totalTiles,
            occupiedTiles: capacity.occupiedTiles,
            severity: 'info',
          });
        }
      }
    }

    // 3. Pattern Table Capacity
    if (options.checkPatternTableCapacity !== false) {
      for (const pt of [0, 1] as const) {
        const cap = calculatePatternTableCapacity(classifications, pt);
        if (cap.isExhausted) {
          facts.push({
            kind: 'pattern-table-exhausted',
            id: `chr-pattern-table-exhausted:${String(pt)}`,
            patternTable: pt,
            capacityTiles: cap.capacityTiles,
            totalOccupied: cap.totalOccupiedTiles,
            totalReservedEmpty: cap.totalReservedEmptyTiles,
            severity: 'error',
          });
        } else if (cap.isLowCapacity) {
          facts.push({
            kind: 'pattern-table-low-capacity',
            id: `chr-pattern-table-low-capacity:${String(pt)}`,
            patternTable: pt,
            capacityTiles: cap.capacityTiles,
            availableSlots: cap.availableSlots,
            totalOccupied: cap.totalOccupiedTiles,
            totalReservedEmpty: cap.totalReservedEmptyTiles,
            severity: 'warning',
          });
        }
      }
    }
  }

  return facts;
}

/**
 * Predicate to determine if a specific physical CHR slot is available for allocating a NEW tile.
 *
 * Requirements:
 * 1. The slot must exist and be within valid physical bounds (0..511);
 * 2. The slot must not be already occupied by Base CHR or an existing project tile (`slot.tile === null`);
 * 3. The physical slot index must NOT be included in the reserved set (`!reservedIndices?.has(slot.physicalTileIndex)`).
 */
export function isChrSlotAvailableForAllocation(
  slot: PatternTableSlot | null | undefined,
  reservedIndices?: ReadonlySet<number>,
): boolean {
  if (!slot) {
    return false;
  }
  if (slot.tile !== null) {
    return false;
  }
  if (reservedIndices?.has(slot.physicalTileIndex)) {
    return false;
  }
  return true;
}

export interface FindAvailableChrSlotOptions {
  readonly startIndex?: number;
  readonly endIndex?: number;
  readonly patternTable?: SpritePatternTable;
  readonly reservedIndices?: ReadonlySet<number>;
}

/**
 * Searches for the next available slot within a pattern table or CHR slots array.
 * Returns the first eligible PatternTableSlot or undefined if none available.
 */
export function findNextAvailableChrSlot(
  slots: readonly PatternTableSlot[],
  options: FindAvailableChrSlotOptions = {},
): PatternTableSlot | undefined {
  let start = options.startIndex ?? 0;
  let end = options.endIndex ?? slots.length - 1;

  if (options.patternTable !== undefined) {
    const [ptStart, ptEnd] = patternTablePhysicalRange(options.patternTable);
    start = Math.max(start, ptStart);
    end = Math.min(end, ptEnd);
  }

  for (let i = start; i <= end && i < slots.length; i += 1) {
    const slot = slots[i];
    if (isChrSlotAvailableForAllocation(slot, options.reservedIndices)) {
      return slot;
    }
  }

  return undefined;
}

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
  readonly chrRegions?: readonly ChrRegion[];
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

export function baseChrPhysicalStart(
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

export function composeChrWithAllocatedTiles(
  baseChr: Uint8Array,
  destinationPatternTable: SpritePatternTable,
  tiles: readonly Tile[],
  reserved?: ReadonlySet<number> | readonly ChrRegion[],
): Uint8Array {
  const reservedIndices =
    reserved instanceof Set
      ? reserved
      : Array.isArray(reserved)
        ? collectReservedPhysicalTileIndices(reserved)
        : undefined;

  const slots = createPatternTableSlots(baseChr, destinationPatternTable);
  let searchIndex = 0;
  for (const tile of tiles) {
    const availableSlot = findNextAvailableChrSlot(slots, {
      startIndex: searchIndex,
      reservedIndices,
    });
    if (availableSlot === undefined) {
      break;
    }
    const physicalIndex = availableSlot.physicalTileIndex;
    slots[physicalIndex] = {
      physicalTileIndex: physicalIndex,
      tile,
      source: 'imported',
    };
    searchIndex = physicalIndex + 1;
  }
  return encodePatternTableSlots(slots);
}

export function classifyChrSlots(
  options: ClassifyChrSlotsOptions = {},
): readonly ChrSlotClassification[] {
  const result: ChrSlotClassification[] = [];
  const baseChr = options.baseChr;
  const destinationPt = options.destinationPatternTable ?? 0;
  const mode = options.mode ?? 'tileset';
  const finalChrBytes = options.finalChrBytes;
  const reservedPhysicalSet = collectReservedPhysicalTileIndices(
    options.chrRegions ?? [],
  );

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
          } else if (reservedPhysicalSet.has(physicalIndex)) {
            result.push({
              physicalIndex,
              localIndex,
              patternTable,
              occupancy: 'reserved',
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

  // Tileset or Playfield mode (with or without Base CHR)
  const slots = createPatternTableSlots(
    baseChr && baseChr.length > 0 ? baseChr : new Uint8Array(NES_CHR_ROM_SIZE),
    destinationPt,
  );
  const deduplicated = options.flipDeduplicationEnabled
    ? deduplicateTilesConsideringFlips(options.tiles ?? [])
    : options.deduplicationEnabled !== false
      ? deduplicateTiles(options.tiles ?? [])
      : (options.tiles ?? []);

  let searchIndex = 0;
  for (const tile of deduplicated) {
    const availableSlot = findNextAvailableChrSlot(slots, {
      startIndex: searchIndex,
      reservedIndices: reservedPhysicalSet,
    });
    if (availableSlot !== undefined) {
      const physicalIndex = availableSlot.physicalTileIndex;
      slots[physicalIndex] = {
        physicalTileIndex: physicalIndex,
        tile,
        source: 'imported',
      };
      searchIndex = physicalIndex + 1;
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

      const matchedDirect = (options.tiles ?? []).find(
        (tItem) => tItem.id === physicalIndex,
      );

      if (isNonZero || matchedDirect !== undefined) {
        const matchedTile = matchedDirect ?? slot?.tile;
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
      } else if (reservedPhysicalSet.has(physicalIndex)) {
        result.push({
          physicalIndex,
          localIndex,
          patternTable,
          occupancy: 'reserved',
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
  readonly sourceTileColumn?: number;
  readonly sourceTileRow?: number;
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
              sourceTileColumn: sprite.sourceTileColumn,
              sourceTileRow: sprite.sourceTileRow,
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
