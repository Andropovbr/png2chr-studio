import { describe, expect, it } from 'vitest';
import { compilePlayfieldBackground } from './playfield-background';
import type { Tile } from './types';

function tile(id: number, value: number): Tile {
  return {
    id,
    column: id % 32,
    row: Math.floor(id / 32),
    pixels: new Uint8Array(64).fill(value),
  };
}

describe('Playfield Background compilation adapter', () => {
  it('derives Nametable addresses and CHR from one canonical compiler result', () => {
    const tiles = Array.from({ length: 960 }, (_, index) =>
      tile(index, index % 2),
    );
    const result = compilePlayfieldBackground({
      assetId: 'asset-stage',
      mapId: 'map-stage',
      tiles,
      paletteAssignments: new Uint8Array(240).fill(2),
      patternTable: 1,
    });

    expect(result.graphics.success).toBe(true);
    if (!result.graphics.success) return;
    expect(result.graphics.backgrounds[0]?.nametable.slice(0, 4)).toEqual(
      new Uint8Array([0, 1, 0, 1]),
    );
    expect(result.graphics.logicalTilePlacements[0]).toMatchObject({
      physicalSlot: 256,
      patternTable: 1,
      localPatternTableIndex: 0,
    });
    expect(
      result.graphics.logicalTilePlacements.some(
        (placement) =>
          placement.physicalSlot === 257 &&
          placement.patternTable === 1 &&
          placement.localPatternTableIndex === 1,
      ),
    ).toBe(true);
    expect(result.graphics.finalChr).toHaveLength(8192);
    expect(result.attributeTable).toHaveLength(64);
  });
});
