import { describe, expect, it } from 'vitest';
import type { ChrSlotClassification } from './chr-pattern-table';
import { createEmptyBackgroundMap } from './background-model';
import {
  analyzeAttributeTableAssignments,
  analyzeNametableChrConsistency,
} from './nes-background-diagnostics';

function createClassifications(
  occupancy: ChrSlotClassification['occupancy'] = 'empty',
): ChrSlotClassification[] {
  return Array.from({ length: 512 }, (_, physicalIndex) => ({
    physicalIndex,
    localIndex: physicalIndex % 256,
    patternTable: physicalIndex < 256 ? 0 : 1,
    occupancy,
  }));
}

function setOccupancy(
  classifications: ChrSlotClassification[],
  physicalIndex: number,
  occupancy: ChrSlotClassification['occupancy'],
): void {
  const classification = classifications[physicalIndex];
  if (classification === undefined) {
    throw new Error(
      `Missing CHR classification for slot ${String(physicalIndex)}.`,
    );
  }
  classifications[physicalIndex] = { ...classification, occupancy };
}

describe('analyzeNametableChrConsistency', () => {
  it('returns no facts when every referenced slot is Project CHR', () => {
    const nametable = new Uint8Array(960).map((_, index) => index % 256);
    const classifications = createClassifications('project');

    expect(
      analyzeNametableChrConsistency(nametable, classifications, 0),
    ).toEqual([]);
  });

  it('accepts Base CHR and Project CHR backing, including blank allocated tiles', () => {
    const nametable = new Uint8Array(960).fill(0);
    nametable[1] = 1;
    const classifications = createClassifications('empty');
    setOccupancy(classifications, 0, 'base');
    setOccupancy(classifications, 1, 'project');

    expect(
      analyzeNametableChrConsistency(nametable, classifications, 0),
    ).toEqual([]);
  });

  it('reports one empty slot reference as a warning with its grid position', () => {
    const nametable = new Uint8Array(960).fill(1);
    nametable[65] = 9;
    const classifications = createClassifications('project');
    setOccupancy(classifications, 9, 'empty');

    const facts = analyzeNametableChrConsistency(nametable, classifications, 0);

    expect(facts).toEqual([
      {
        kind: 'nametable-unallocated-tile',
        id: 'nametable-unallocated-tile:pt0:65-65',
        severity: 'warning',
        patternTable: 0,
        startIndex: 65,
        endIndex: 65,
        startColumn: 1,
        startRow: 2,
        endColumn: 1,
        endRow: 2,
        count: 1,
        localTileIndices: [9],
        physicalTileIndices: [9],
      },
    ]);
  });

  it('reports one reserved slot reference as info', () => {
    const nametable = new Uint8Array(960).fill(1);
    nametable[31] = 7;
    const classifications = createClassifications('project');
    setOccupancy(classifications, 7, 'reserved');

    const facts = analyzeNametableChrConsistency(nametable, classifications, 0);

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      kind: 'nametable-reserved-tile',
      severity: 'info',
      startColumn: 31,
      startRow: 0,
      endColumn: 31,
      endRow: 0,
      localTileIndices: [7],
      physicalTileIndices: [7],
    });
  });

  it('uses the selected Pattern Table to resolve the physical CHR slot', () => {
    const nametable = new Uint8Array(960).fill(0x2a);
    const classifications = createClassifications('project');
    setOccupancy(classifications, 0x2a, 'empty');
    setOccupancy(classifications, 0x12a, 'reserved');

    const pt0Facts = analyzeNametableChrConsistency(
      nametable,
      classifications,
      0,
    );
    const pt1Facts = analyzeNametableChrConsistency(
      nametable,
      classifications,
      1,
    );

    expect(pt0Facts).toHaveLength(1);
    expect(pt0Facts[0]).toMatchObject({
      kind: 'nametable-unallocated-tile',
      patternTable: 0,
      physicalTileIndices: [0x2a],
    });
    expect(pt1Facts).toHaveLength(1);
    expect(pt1Facts[0]).toMatchObject({
      kind: 'nametable-reserved-tile',
      patternTable: 1,
      physicalTileIndices: [0x12a],
    });
  });

  it('aggregates consecutive issues into ranges and splits different issue kinds', () => {
    const nametable = new Uint8Array(960).fill(1);
    nametable.set([10, 11, 12, 13, 14], 30);
    const classifications = createClassifications('project');
    for (const index of [10, 11, 12, 14]) {
      setOccupancy(classifications, index, 'empty');
    }
    setOccupancy(classifications, 13, 'reserved');

    const facts = analyzeNametableChrConsistency(nametable, classifications, 0);

    expect(facts).toHaveLength(3);
    expect(facts[0]).toMatchObject({
      kind: 'nametable-unallocated-tile',
      startIndex: 30,
      endIndex: 32,
      startColumn: 30,
      startRow: 0,
      endColumn: 0,
      endRow: 1,
      count: 3,
      localTileIndices: [10, 11, 12],
    });
    expect(facts[1]).toMatchObject({
      kind: 'nametable-reserved-tile',
      startIndex: 33,
      endIndex: 33,
    });
    expect(facts[2]).toMatchObject({
      kind: 'nametable-unallocated-tile',
      startIndex: 34,
      endIndex: 34,
    });
  });

  it('handles tile and Nametable boundaries without crossing Pattern Tables', () => {
    const nametable = new Uint8Array(960).fill(1);
    nametable[0] = 0x00;
    nametable[959] = 0xff;
    const classifications = createClassifications('project');
    setOccupancy(classifications, 0x100, 'empty');
    setOccupancy(classifications, 0x1ff, 'reserved');

    const facts = analyzeNametableChrConsistency(nametable, classifications, 1);

    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({
      startIndex: 0,
      startColumn: 0,
      startRow: 0,
      physicalTileIndices: [256],
    });
    expect(facts[1]).toMatchObject({
      startIndex: 959,
      startColumn: 31,
      startRow: 29,
      physicalTileIndices: [511],
    });
  });

  it('does not infer empty backing when the classifier has no fact for a slot', () => {
    const nametable = new Uint8Array(960).fill(0xff);

    expect(analyzeNametableChrConsistency(nametable, [], 1)).toEqual([]);
  });
});

describe('analyzeAttributeTableAssignments', () => {
  function createMap() {
    const map = createEmptyBackgroundMap({ id: 'bg-test' });
    const cells = [...map.cells];
    for (const [index, sourceTileIndex] of [0, 1, 2, 3].entries()) {
      cells[index] = {
        logicalKey: `asset:${String(sourceTileIndex)}:0`,
        tileX: sourceTileIndex,
        tileY: 0,
        sourceTileIndex,
      };
    }
    return { ...map, cells };
  }

  function classifications(contexts: readonly number[]) {
    return contexts.map((paletteContext, physicalIndex) => ({
      physicalIndex,
      localIndex: physicalIndex,
      patternTable: 0 as const,
      occupancy: 'project' as const,
      paletteContext,
    }));
  }

  it('accepts a region whose four tiles share assigned palette context', () => {
    const map = createMap();
    expect(
      analyzeAttributeTableAssignments(map, classifications([0, 0, 0, 0])),
    ).toEqual([]);
  });

  it('reports info when one 16x16 region contains incompatible tile contexts', () => {
    const map = createMap();
    const facts = analyzeAttributeTableAssignments(
      map,
      classifications([0, 2, 0, 0]),
    );
    expect(facts).toEqual([
      expect.objectContaining({
        kind: 'attribute-palette-context-mismatch',
        id: 'attribute-palette-context-mismatch:bg-test:0-0',
        severity: 'info',
        pixelX: 0,
        pixelY: 0,
        paletteIndex: 0,
        requiredPaletteContexts: [0, 2],
        physicalTileIndices: [0, 1],
      }),
    ]);
  });

  it('handles bottom and right screen borders without inspecting outside 32x30 tiles', () => {
    const map = createMap();
    const cells = [...map.cells];
    cells[14 * 32 + 30] = {
      logicalKey: 'asset:14:14',
      tileX: 14,
      tileY: 14,
      sourceTileIndex: 4,
    };
    const borderMap = { ...map, cells };
    const borderClassifications = [
      ...classifications([0, 0, 0, 0]),
      {
        physicalIndex: 4,
        localIndex: 4,
        patternTable: 0 as const,
        occupancy: 'project' as const,
        paletteContext: 2,
      },
    ];
    expect(
      analyzeAttributeTableAssignments(borderMap, borderClassifications),
    ).toEqual([]);
  });

  it('reports independent mismatches in multiple regions deterministically', () => {
    const map = createMap();
    const cells = [...map.cells];
    const cellTwo = cells[2];
    if (!cellTwo) throw new Error('Expected test cell.');
    const cellOne = cells[1];
    if (!cellOne) throw new Error('Expected test cell.');
    cells[1] = { ...cellOne, sourceTileIndex: 4 };
    cells[2] = { ...cellTwo, sourceTileIndex: 4 };
    cells[3] = {
      logicalKey: 'asset:5:1',
      tileX: 5,
      tileY: 1,
      sourceTileIndex: 5,
    };
    const multiMap = {
      ...map,
      cells,
      paletteAssignments: map.paletteAssignments.map((value, index) =>
        index === 1 ? 1 : value,
      ),
    };
    const facts = analyzeAttributeTableAssignments(multiMap, [
      ...classifications([0, 0, 2, 0]),
      {
        physicalIndex: 4,
        localIndex: 4,
        patternTable: 0 as const,
        occupancy: 'project' as const,
        paletteContext: 2,
      },
      {
        physicalIndex: 5,
        localIndex: 5,
        patternTable: 0 as const,
        occupancy: 'project' as const,
        paletteContext: 3,
      },
    ]);
    expect(facts.map((fact) => fact.regionColumn)).toEqual([0, 1]);
  });

  it('does not duplicate structural or Attribute Table encoding validation', () => {
    const map = createMap();
    const invalid = { ...map, paletteAssignments: [9] };
    expect(
      analyzeAttributeTableAssignments(invalid, classifications([0, 0, 0, 0])),
    ).toEqual([]);
  });
});
