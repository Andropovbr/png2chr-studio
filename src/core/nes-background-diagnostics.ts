import {
  BACKGROUND_WIDTH_TILES,
  NAMETABLE_BYTE_COUNT,
  type BackgroundPatternTable,
} from './background-model';
import {
  NES_PATTERN_TABLE_TILE_COUNT,
  type ChrSlotClassification,
} from './chr-pattern-table';

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
