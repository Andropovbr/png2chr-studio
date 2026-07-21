import { describe, expect, it } from 'vitest';

import { deduplicateTiles } from './tile-deduplication';
import type { Tile } from './types';

function tile(id: number, colorIndex: number): Tile {
  return {
    id,
    column: id,
    row: 0,
    pixels: new Uint8Array(64).fill(colorIndex),
  };
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
});
