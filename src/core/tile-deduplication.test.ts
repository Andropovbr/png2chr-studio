import { describe, expect, it } from 'vitest';

import {
  deduplicateTiles,
  deduplicateTilesConsideringFlips,
  deduplicateTileSet,
} from './tile-deduplication';
import type { Tile } from './types';

function tile(id: number, colorIndex: number): Tile {
  return {
    id,
    column: id,
    row: 0,
    pixels: new Uint8Array(64).fill(colorIndex),
  };
}

function asymmetricTile(
  id: number,
  horizontalFlip: boolean,
  verticalFlip: boolean,
): Tile {
  const source = new Uint8Array(64);
  source[0] = 1;
  source[1] = 2;
  source[8] = 3;
  const pixels = new Uint8Array(64);

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const sourceRow = verticalFlip ? 7 - row : row;
      const sourceColumn = horizontalFlip ? 7 - column : column;
      pixels[row * 8 + column] = source[sourceRow * 8 + sourceColumn] ?? 0;
    }
  }

  return { id, column: id, row: 0, pixels };
}

describe('tile deduplication', () => {
  it('removes exact duplicates and keeps their first occurrence', () => {
    const original = [tile(0, 1), tile(1, 2), tile(2, 1)];

    const unique = deduplicateTiles(original);

    expect(unique).toHaveLength(2);
    expect(unique[0]).toMatchObject({ id: 0, column: 0, row: 0 });
    expect(unique[1]).toMatchObject({ id: 1, column: 1, row: 0 });
  });

  it('reassigns exported IDs without modifying the original tiles', () => {
    const original = [tile(4, 0), tile(8, 0), tile(12, 3)];

    const unique = deduplicateTiles(original);

    expect(unique.map(({ id }) => id)).toEqual([0, 1]);
    expect(original.map(({ id }) => id)).toEqual([4, 8, 12]);
    expect(unique[1]?.column).toBe(12);
  });

  it('keeps tiles that differ by a single pixel', () => {
    const first = tile(0, 0);
    const second = tile(1, 0);
    second.pixels[63] = 1;

    expect(deduplicateTiles([first, second])).toHaveLength(2);
  });

  it('maps every original tile to its exported unique index', () => {
    const result = deduplicateTileSet([
      tile(0, 3),
      tile(1, 1),
      tile(2, 3),
      tile(3, 1),
    ]);

    expect(Array.from(result.originalToUnique)).toEqual([0, 1, 0, 1]);
  });

  it('groups horizontal, vertical, and combined flips', () => {
    const variants = [
      asymmetricTile(0, false, false),
      asymmetricTile(1, true, false),
      asymmetricTile(2, false, true),
      asymmetricTile(3, true, true),
    ];

    expect(deduplicateTiles(variants)).toHaveLength(4);
    expect(deduplicateTilesConsideringFlips(variants)).toHaveLength(1);
  });

  it('preserves the first encountered orientation', () => {
    const first = asymmetricTile(7, true, false);
    const original = asymmetricTile(8, false, false);

    const unique = deduplicateTilesConsideringFlips([first, original]);

    expect(unique).toHaveLength(1);
    expect(unique[0]).toMatchObject({ id: 0, column: 7 });
    expect(unique[0]?.pixels).toEqual(first.pixels);
  });
});
