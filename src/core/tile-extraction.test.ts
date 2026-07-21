import { describe, expect, it } from 'vitest';

import { extractTiles } from './tile-extraction';
import type { IndexedImage } from './types';

function createImage16x8(): IndexedImage {
  const pixels = new Uint8Array(16 * 8);
  for (let row = 0; row < 8; row += 1) {
    pixels.fill(1, row * 16, row * 16 + 8);
    pixels.fill(2, row * 16 + 8, row * 16 + 16);
  }

  return {
    width: 16,
    height: 8,
    pixels,
    colors: [null, null, null, null],
    transparentIndex: null,
    colorCount: 3,
  };
}

describe('tile extraction', () => {
  it('extracts two tiles from a 16x8 image', () => {
    expect(extractTiles(createImage16x8())).toHaveLength(2);
  });

  it('keeps tiles ordered from left to right', () => {
    const tiles = extractTiles(createImage16x8());

    expect(tiles[0]).toMatchObject({ id: 0, column: 0, row: 0 });
    expect(tiles[0]?.pixels).toEqual(new Uint8Array(64).fill(1));
    expect(tiles[1]).toMatchObject({ id: 1, column: 1, row: 0 });
    expect(tiles[1]?.pixels).toEqual(new Uint8Array(64).fill(2));
  });
});
