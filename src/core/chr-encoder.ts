import type { Tile } from './types';

const TILE_SIZE = 8;
const PIXELS_PER_TILE = TILE_SIZE * TILE_SIZE;
const BYTES_PER_TILE = 16;

export function encodeTile(tile: Tile): Uint8Array {
  if (tile.pixels.length !== PIXELS_PER_TILE) {
    throw new RangeError('A CHR tile must contain exactly 64 pixels.');
  }

  const bytes = new Uint8Array(BYTES_PER_TILE);

  for (let row = 0; row < TILE_SIZE; row += 1) {
    let bitplane0 = 0;
    let bitplane1 = 0;

    for (let column = 0; column < TILE_SIZE; column += 1) {
      const colorIndex = tile.pixels[row * TILE_SIZE + column];
      if (colorIndex === undefined || colorIndex > 3) {
        throw new RangeError('CHR color indices must be between 0 and 3.');
      }

      const bit = 7 - column;
      bitplane0 |= (colorIndex & 0b01) << bit;
      bitplane1 |= ((colorIndex >> 1) & 0b01) << bit;
    }

    bytes[row] = bitplane0;
    bytes[row + TILE_SIZE] = bitplane1;
  }

  return bytes;
}

export function encodeChr(tiles: readonly Tile[]): Uint8Array {
  const chr = new Uint8Array(tiles.length * BYTES_PER_TILE);

  tiles.forEach((tile, index) => {
    chr.set(encodeTile(tile), index * BYTES_PER_TILE);
  });

  return chr;
}
