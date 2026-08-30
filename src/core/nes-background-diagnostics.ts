import {
  BACKGROUND_WIDTH_TILES,
  NAMETABLE_BYTE_COUNT,
  type BackgroundPatternTable,
} from './background-model';
import {
  NES_PATTERN_TABLE_TILE_COUNT,
  type ChrSlotClassification,
} from './chr-pattern-table';
import {
  createLogicalTileKey,
  type LogicalTileKey,
  type ProjectAssetId,
} from './asset-identity';
import type { BackgroundProjectModel } from './chr-background-allocation';
import type { BackgroundPhysicalAssignment } from './chr-background-allocation';
import type { BackgroundMapDefinition } from './background-model';
import type { Tile } from './types';

export interface BuildSourceTilePaletteContextsOptions {
  readonly assetId: ProjectAssetId;
  readonly imageWidth: number;
  readonly regionSize: number;
  readonly paletteAssignments: Uint8Array;
  readonly tiles: readonly Tile[];
}

/**
 * Builds palette provenance keyed by logical source tile identity. This keeps
 * palette context independent from later CHR allocation and deduplication.
 */
export function buildSourceTilePaletteContexts(
  options: BuildSourceTilePaletteContextsOptions,
): ReadonlyMap<LogicalTileKey, number> {
  if (
    options.imageWidth <= 0 ||
    options.regionSize <= 0 ||
    options.imageWidth % options.regionSize !== 0
  ) {
    return new Map();
  }

  const regionColumns = options.imageWidth / options.regionSize;
  const contexts = new Map<LogicalTileKey, number>();
  for (const tile of options.tiles) {
    const regionColumn = Math.floor((tile.column * 8) / options.regionSize);
    const regionRow = Math.floor((tile.row * 8) / options.regionSize);
    const paletteContext =
      options.paletteAssignments[regionRow * regionColumns + regionColumn];
    if (
      paletteContext === undefined ||
      !Number.isInteger(paletteContext) ||
      paletteContext < 0 ||
      paletteContext > 3
    ) {
      continue;
    }
    contexts.set(
      createLogicalTileKey(options.assetId, tile.column, tile.row),
      paletteContext,
    );
  }
  return contexts;
}

export type AttributeTableAssignmentFactKind =
  'attribute-palette-context-mismatch';

export interface AttributeTableAssignmentFact {
  readonly kind: AttributeTableAssignmentFactKind;
  readonly id: string;
  readonly severity: 'info';
  readonly mapId: string;
  readonly regionColumn: number;
  readonly regionRow: number;
  readonly pixelX: number;
  readonly pixelY: number;
  readonly paletteIndex: number;
  readonly requiredPaletteContexts: readonly number[];
  readonly physicalTileIndices: readonly number[];
}

export type NametableChrConsistencyFactKind =
  'nametable-reserved-tile' | 'nametable-unallocated-tile';

export interface NametableChrConsistencyFact {
  readonly kind: NametableChrConsistencyFactKind;
  readonly id: string;
  readonly severity: 'warning' | 'info';
  readonly patternTable: BackgroundPatternTable;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startColumn: number;
  readonly startRow: number;
  readonly endColumn: number;
  readonly endRow: number;
  readonly count: number;
  readonly localTileIndices: readonly number[];
  readonly physicalTileIndices: readonly number[];
}

interface PendingRun {
  readonly kind: NametableChrConsistencyFactKind;
  readonly severity: 'warning' | 'info';
  readonly startIndex: number;
  endIndex: number;
  readonly localTileIndices: Set<number>;
  readonly physicalTileIndices: Set<number>;
}

interface NametableIssue {
  readonly kind: NametableChrConsistencyFactKind;
  readonly severity: 'warning' | 'info';
}

function classifyNametableIssue(
  classification: ChrSlotClassification | undefined,
): NametableIssue | null {
  if (classification?.occupancy === 'reserved') {
    return { kind: 'nametable-reserved-tile', severity: 'info' };
  }
  if (classification?.occupancy === 'empty') {
    return { kind: 'nametable-unallocated-tile', severity: 'warning' };
  }
  return null;
}

function createFact(
  run: PendingRun,
  patternTable: BackgroundPatternTable,
): NametableChrConsistencyFact {
  const { startIndex, endIndex } = run;
  return {
    kind: run.kind,
    id: `${run.kind}:pt${String(patternTable)}:${String(startIndex)}-${String(endIndex)}`,
    severity: run.severity,
    patternTable,
    startIndex,
    endIndex,
    startColumn: startIndex % BACKGROUND_WIDTH_TILES,
    startRow: Math.floor(startIndex / BACKGROUND_WIDTH_TILES),
    endColumn: endIndex % BACKGROUND_WIDTH_TILES,
    endRow: Math.floor(endIndex / BACKGROUND_WIDTH_TILES),
    count: endIndex - startIndex + 1,
    localTileIndices: [...run.localTileIndices].sort((a, b) => a - b),
    physicalTileIndices: [...run.physicalTileIndices].sort((a, b) => a - b),
  };
}

/**
 * Checks whether each Nametable tile index has coherent backing in the selected
 * Background Pattern Table. Existing CHR classifiers remain the source of truth
 * for Base CHR, Project CHR, reservations, and truly empty physical slots.
 */
export function analyzeNametableChrConsistency(
  nametable: Uint8Array,
  chrSlotClassifications: readonly ChrSlotClassification[],
  patternTable: BackgroundPatternTable,
): readonly NametableChrConsistencyFact[] {
  const facts: NametableChrConsistencyFact[] = [];
  const entryCount = Math.min(nametable.length, NAMETABLE_BYTE_COUNT);
  let nametableIndex = 0;

  while (nametableIndex < entryCount) {
    const localTileIndex = nametable[nametableIndex];
    if (localTileIndex === undefined) {
      nametableIndex += 1;
      continue;
    }

    const physicalTileIndex =
      patternTable * NES_PATTERN_TABLE_TILE_COUNT + localTileIndex;
    const issue = classifyNametableIssue(
      chrSlotClassifications[physicalTileIndex],
    );

    if (issue === null) {
      nametableIndex += 1;
      continue;
    }

    const run: PendingRun = {
      kind: issue.kind,
      severity: issue.severity,
      startIndex: nametableIndex,
      endIndex: nametableIndex,
      localTileIndices: new Set([localTileIndex]),
      physicalTileIndices: new Set([physicalTileIndex]),
    };
    nametableIndex += 1;

    while (nametableIndex < entryCount) {
      const nextLocalTileIndex = nametable[nametableIndex];
      if (nextLocalTileIndex === undefined) {
        break;
      }
      const nextPhysicalTileIndex =
        patternTable * NES_PATTERN_TABLE_TILE_COUNT + nextLocalTileIndex;
      const nextIssue = classifyNametableIssue(
        chrSlotClassifications[nextPhysicalTileIndex],
      );
      if (nextIssue?.kind !== issue.kind) {
        break;
      }

      run.endIndex = nametableIndex;
      run.localTileIndices.add(nextLocalTileIndex);
      run.physicalTileIndices.add(nextPhysicalTileIndex);
      nametableIndex += 1;
    }

    facts.push(createFact(run, patternTable));
  }

  return facts;
}

/**
 * Checks canonical 16x16 Background regions for conflicting tile palette
 * contexts. This deliberately does not validate assignment shape/range or
 * re-encode the Attribute Table; those responsibilities remain in the
 * Background model and encoder.
 *
 * Physical identity comes only from the compiled Background model. Palette
 * provenance remains keyed by logical tile identity, so CHR deduplication or
 * Base CHR reuse cannot merge unrelated source palette contexts. Missing
 * context means the conflict cannot be established and produces no fact.
 */
export type AttributeTableCompiledInput =
  | Pick<BackgroundProjectModel, 'map' | 'resolvedCells'>
  | {
      readonly map: BackgroundMapDefinition;
      readonly assignments: readonly BackgroundPhysicalAssignment[];
    };

export function analyzeAttributeTableAssignments(
  model: AttributeTableCompiledInput,
  paletteContexts: ReadonlyMap<LogicalTileKey, number>,
): readonly AttributeTableAssignmentFact[] {
  const { map } = model;
  const facts: AttributeTableAssignmentFact[] = [];
  const maxRows = Math.min(15, Math.ceil(map.heightTiles / 2));
  const maxColumns = Math.min(16, Math.ceil(map.widthTiles / 2));
  const resolvedCells =
    'resolvedCells' in model ? model.resolvedCells : model.assignments;
  const resolvedCellsByIndex = new Map(
    resolvedCells.map((cell) => [cell.cellIndex, cell] as const),
  );

  for (let regionRow = 0; regionRow < maxRows; regionRow += 1) {
    for (let regionColumn = 0; regionColumn < maxColumns; regionColumn += 1) {
      const assignment = map.paletteAssignments[regionRow * 16 + regionColumn];
      if (
        typeof assignment !== 'number' ||
        !Number.isInteger(assignment) ||
        assignment < 0 ||
        assignment > 3
      ) {
        continue;
      }

      const contexts = new Set<number>();
      const physicalTileIndices: number[] = [];
      for (let tileY = 0; tileY < 2; tileY += 1) {
        for (let tileX = 0; tileX < 2; tileX += 1) {
          const column = regionColumn * 2 + tileX;
          const row = regionRow * 2 + tileY;
          if (column >= map.widthTiles || row >= map.heightTiles) continue;
          const cellIndex = row * BACKGROUND_WIDTH_TILES + column;
          const cell = map.cells[cellIndex];
          if (!cell) continue;
          const paletteContext = paletteContexts.get(cell.logicalKey);
          if (
            paletteContext === undefined ||
            !Number.isInteger(paletteContext) ||
            paletteContext < 0 ||
            paletteContext > 3
          ) {
            continue;
          }

          const resolvedCell = resolvedCellsByIndex.get(cellIndex);
          if (
            resolvedCell?.logicalKey !== cell.logicalKey ||
            resolvedCell.physicalTileIndex === undefined
          ) {
            continue;
          }

          contexts.add(paletteContext);
          physicalTileIndices.push(resolvedCell.physicalTileIndex);
        }
      }

      if (contexts.size <= 1) continue;
      const requiredPaletteContexts = [...contexts].sort((a, b) => a - b);
      facts.push({
        kind: 'attribute-palette-context-mismatch',
        id: `attribute-palette-context-mismatch:${map.id}:${String(regionColumn)}-${String(regionRow)}`,
        severity: 'info',
        mapId: map.id,
        regionColumn,
        regionRow,
        pixelX: regionColumn * 16,
        pixelY: regionRow * 16,
        paletteIndex: assignment,
        requiredPaletteContexts,
        physicalTileIndices: [...new Set(physicalTileIndices)].sort(
          (a, b) => a - b,
        ),
      });
    }
  }

  return facts;
}
