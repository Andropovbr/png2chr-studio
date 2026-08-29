import { describe, expect, it } from 'vitest';
import type { ChrSlotClassification } from './chr-pattern-table';
import { createEmptyBackgroundMap } from './background-model';
import { buildBackgroundProjectModel } from './chr-background-allocation';
import type { LogicalTileKey } from './asset-identity';
import type { Tile } from './types';
import {
  analyzeAttributeTableAssignments,
  analyzeNametableChrConsistency,
  buildSourceTilePaletteContexts,
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
    const cellIndices = [0, 1, 32, 33];
    for (const [sourceTileIndex, cellIndex] of cellIndices.entries()) {
      cells[cellIndex] = {
        logicalKey: `asset:${String(sourceTileIndex)}:0`,
        tileX: sourceTileIndex,
        tileY: 0,
        sourceTileIndex,
      };
    }
    return { ...map, cells };
  }

  function createTile(index: number): Tile {
    return {
      id: index,
      column: index,
      row: 0,
      pixels: new Uint8Array(64).fill(index % 4),
    };
  }

  function compile(map: ReturnType<typeof createMap>) {
    const tileMap = new Map<LogicalTileKey, Tile>();
    for (const cell of map.cells) {
      if (cell !== null) {
        tileMap.set(cell.logicalKey, createTile(cell.sourceTileIndex ?? 0));
      }
    }
    return buildBackgroundProjectModel({ map, tileMap });
  }

  function paletteContexts(
    map: ReturnType<typeof createMap>,
    contexts: readonly number[],
  ): ReadonlyMap<LogicalTileKey, number> {
    const result = new Map<LogicalTileKey, number>();
    for (const cell of map.cells) {
      const sourceTileIndex = cell?.sourceTileIndex;
      if (cell === null || sourceTileIndex === undefined) continue;
      const context = contexts[sourceTileIndex];
      if (context !== undefined) result.set(cell.logicalKey, context);
    }
    return result;
  }

  it('accepts a region whose four tiles share assigned palette context', () => {
    const map = createMap();
    expect(
      analyzeAttributeTableAssignments(
        compile(map),
        paletteContexts(map, [0, 0, 0, 0]),
      ),
    ).toEqual([]);
  });

  it('reports info when one 16x16 region contains incompatible tile contexts', () => {
    const map = createMap();
    const facts = analyzeAttributeTableAssignments(
      compile(map),
      paletteContexts(map, [0, 2, 0, 0]),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      kind: 'attribute-palette-context-mismatch',
      id: 'attribute-palette-context-mismatch:bg-test:0-0',
      severity: 'info',
      pixelX: 0,
      pixelY: 0,
      paletteIndex: 0,
      requiredPaletteContexts: [0, 2],
    });
    expect(Array.isArray(facts[0]?.physicalTileIndices)).toBe(true);
  });

  it('uses compiled physical assignments instead of source tile indexes', () => {
    const map = createMap();
    const baseChr = new Uint8Array(8192);
    baseChr[0] = 0xff;
    const model = buildBackgroundProjectModel({
      map,
      baseChr,
      tileMap: new Map(
        map.cells.flatMap((cell) =>
          cell === null
            ? []
            : [
                [
                  cell.logicalKey,
                  createTile(cell.sourceTileIndex ?? 0),
                ] as const,
              ],
        ),
      ),
    });

    const facts = analyzeAttributeTableAssignments(
      model,
      paletteContexts(map, [0, 2, 0, 0]),
    );

    expect(facts).toHaveLength(1);
    expect(facts[0]?.physicalTileIndices).not.toEqual([0, 1]);
    const regionCellIndices = new Set([0, 1, 32, 33]);
    expect(facts[0]?.physicalTileIndices).toEqual(
      [
        ...new Set(
          model.resolvedCells
            .filter((cell) => regionCellIndices.has(cell.cellIndex))
            .map((cell) => cell.physicalTileIndex),
        ),
      ]
        .filter((index): index is number => index !== undefined)
        .sort((a, b) => a - b),
    );
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
    expect(
      analyzeAttributeTableAssignments(
        compile(borderMap),
        paletteContexts(borderMap, [0, 0, 0, 0, 2]),
      ),
    ).toEqual([]);
  });

  it('reports independent mismatches in multiple regions deterministically', () => {
    const map = createMap();
    const cells = [...map.cells];
    const cellOne = cells[1];
    if (!cellOne) throw new Error('Expected test cell.');
    cells[1] = {
      ...cellOne,
      logicalKey: 'asset:4:0',
      tileX: 4,
      sourceTileIndex: 4,
    };
    cells[2] = {
      logicalKey: 'asset:5:0',
      tileX: 5,
      tileY: 0,
      sourceTileIndex: 5,
    };
    cells[3] = {
      logicalKey: 'asset:6:0',
      tileX: 6,
      tileY: 0,
      sourceTileIndex: 6,
    };
    const multiMap = {
      ...map,
      cells,
      paletteAssignments: map.paletteAssignments.map((value, index) =>
        index === 1 ? 1 : value,
      ),
    };
    const facts = analyzeAttributeTableAssignments(
      compile(multiMap),
      paletteContexts(multiMap, [0, 0, 0, 0, 2, 1, 3]),
    );
    expect(facts.map((fact) => fact.regionColumn)).toEqual([0, 1]);
  });

  it('does not duplicate structural or Attribute Table encoding validation', () => {
    const map = createMap();
    const invalid = { ...map, paletteAssignments: [9] };
    expect(
      analyzeAttributeTableAssignments(
        { map: invalid, resolvedCells: compile(map).resolvedCells },
        paletteContexts(map, [0, 0, 0, 0]),
      ),
    ).toEqual([]);
  });
});

describe('buildSourceTilePaletteContexts', () => {
  it('keys source palette provenance by canonical asset and tile identity', () => {
    const contexts = buildSourceTilePaletteContexts({
      assetId: 'asset-playfield-default',
      imageWidth: 32,
      regionSize: 16,
      paletteAssignments: new Uint8Array([0, 2, 1, 3]),
      tiles: [
        { id: 0, column: 0, row: 0, pixels: new Uint8Array(64) },
        { id: 1, column: 2, row: 0, pixels: new Uint8Array(64) },
        { id: 2, column: 0, row: 2, pixels: new Uint8Array(64) },
      ],
    });

    expect([...contexts.entries()]).toEqual([
      ['asset-playfield-default:0:0', 0],
      ['asset-playfield-default:2:0', 2],
      ['asset-playfield-default:0:2', 1],
    ]);
    expect(contexts.has('other-asset:0:0')).toBe(false);
  });

  it('keeps invalid or unavailable palette provenance unknown', () => {
    expect(
      buildSourceTilePaletteContexts({
        assetId: 'asset',
        imageWidth: 10,
        regionSize: 8,
        paletteAssignments: new Uint8Array([0]),
        tiles: [{ id: 0, column: 0, row: 0, pixels: new Uint8Array(64) }],
      }),
    ).toEqual(new Map());
  });
});
